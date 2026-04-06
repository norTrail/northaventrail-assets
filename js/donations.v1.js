/* ============================================================
   Northaven Trail — Fundraising Bar
   Multi-instance, auto-refresh, CDN-backed JSON
   ============================================================
   Usage: add data-json="https://assets.northaventrail.org/json/<file>.json"
   to the .fund-bar element to point at any donation data file.
   ============================================================ */
(function () {
  // Guard against double-init if script tag appears in multiple code blocks
  if (window._NTFundBarsInited) return;
  window._NTFundBarsInited = true;

  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else { init(); }

    function init() {
      const bars = Array.from(document.querySelectorAll('.fund-bar'));
      if (!bars.length) return;

      // ====== CONFIG ======
      const REFRESH_MS     = 5 * 60 * 1000;   // poll every 5 minutes
      const CACHE_TTL_MS   = 10 * 60 * 1000;  // treat cache stale after 10 minutes
      const FOCUS_STALE_MS = 60 * 1000;        // refresh if stale > 60s on refocus
      // ====================

      // Number helpers — tolerate "$", commas, spaces
      const sanitizeNum = (v) => {
        if (v === '' || v == null) return NaN;
        if (typeof v === 'number') return v;
        const s = String(v).replace(/[^0-9.\-]/g, '');
        return s ? parseFloat(s) : NaN;
      };
      const num      = (v, fb) => { const n = sanitizeNum(v); return Number.isFinite(n) ? n : fb; };
      const clamp    = (v, min, max) => Math.min(Math.max(v, min), max);
      const fmtMoney = (n) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
      const fmtUpdated = (iso) => {
        try {
          const d = new Date(iso);
          const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
          const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
          return `Updated ${dateStr} at ${timeStr}`;
        } catch { return ''; }
      };

      const CACHE_PREFIX = 'nt_fundraising_v1_';
      const loadCache = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
      const saveCache = (k, data) => { try { localStorage.setItem(k, JSON.stringify({ ...data, _cachedAt: Date.now() })); } catch {} };

      // Update all .fund-match elements on the page
      function updateMatchLines(payload) {
        if (!payload) return;
        const cap       = sanitizeNum(payload.matchingFunds);
        const remaining = sanitizeNum(payload.remainingFunds);
        if (!Number.isFinite(cap) || !Number.isFinite(remaining)) return;
        const html = (remaining <= 0)
          ? ''
          : `Double the baa-ng for your buck! Every $1 donated is matched.<br>${fmtMoney(cap)} in Matching Funds (${fmtMoney(Math.max(0, remaining))} remaining) — your gift goes twice as far.`;
        document.querySelectorAll('.fund-match').forEach(el => {
          if (remaining <= 0) {
            el.hidden = true;
            el.innerHTML = '';
          } else {
            el.hidden = false;
            if (el.innerHTML !== html) el.innerHTML = html;
          }
        });
      }

      // Render one bar (progress bar + status text)
      function renderBar(root, payload, fallbacks) {
        const raised  = num(payload.raised,  fallbacks.raisedAttr);
        const goal    = num(payload.goal,    fallbacks.goalAttr);
        const updated = payload.updated || null;
        const greenbar    = root.querySelector('.greenbar');
        const progressLbl = root.querySelector('.progress');
        const statusLine  = root.querySelector('.statusLine');
        const pct = goal > 0 ? clamp((raised / goal) * 100, 0, 100) : 0;
        if (greenbar)    greenbar.style.width = pct + '%';
        if (progressLbl) progressLbl.textContent = Math.round(pct) + '%';
        if (statusLine) {
          const baseText = `We have raised ${fmtMoney(raised)} of our ${fmtMoney(goal)} goal so far. Thank you!`;
          statusLine.innerHTML = `${baseText}<br><span class="updatedLine">${updated ? fmtUpdated(updated) : 'Updated —'}</span>`;
        }
      }

      // Group bars by unique data-json URL
      const groups = new Map();
      bars.forEach(root => {
        const goalAttr   = sanitizeNum(root.getAttribute('data-goal'));
        const raisedAttr = sanitizeNum(root.getAttribute('data-raised'));
        const jsonUrl    = (root.getAttribute('data-json') || '').trim();
        if (jsonUrl) {
          const cacheKey = CACHE_PREFIX + jsonUrl;
          const cached   = loadCache(cacheKey);
          if (cached) {
            const age          = Date.now() - (cached._cachedAt || 0);
            const paintForBars = (age > CACHE_TTL_MS)
              ? { raised: raisedAttr, goal: goalAttr, updated: null }
              : cached;
            renderBar(root, paintForBars, { goalAttr, raisedAttr });
            updateMatchLines(cached);
          } else {
            renderBar(root, { raised: raisedAttr, goal: goalAttr, updated: null }, { goalAttr, raisedAttr });
          }
          if (!groups.has(jsonUrl)) {
            groups.set(jsonUrl, {
              bars: [], goalDefault: goalAttr, raisedDefault: raisedAttr,
              cacheKey, lastFetchedAt: 0, inFlight: false, timerId: null
            });
          }
          groups.get(jsonUrl).bars.push({ root, goalAttr, raisedAttr });
        } else {
          renderBar(root, { raised: raisedAttr, goal: goalAttr, updated: null }, { goalAttr, raisedAttr });
        }
      });

      function getManifestDataUrls(manifest) {
        return [...new Set(
          [manifest?.current, manifest?.fallback, manifest?.previous]
            .map((value) => String(value || "").trim())
            .filter(Boolean)
        )];
      }

      // Fetch + render for one URL group.
      // If the URL ends in .latest.json it is treated as a manifest:
      //   1. Fetch the manifest to get the candidate versioned data URLs.
      //   2. Compare them to the cached _manifestCurrent value.
      //   3. If unchanged → skip the data fetch (use existing cached payload).
      //   4. If changed (or no cache) → try each versioned data file in order.
      function fetchAndRender(url, group) {
        if (group.inFlight) return;
        group.inFlight = true;

        const isManifest = url.endsWith('.latest.json');

        const doFetchData = (dataUrl) =>
          fetch(dataUrl, { cache: 'no-store' })
            .then(r => r.json())
            .then(data => {
              const payload = {
                raised:         num(data.raised,        group.raisedDefault),
                goal:           num(data.goal,          group.goalDefault),
                matchingFunds:  sanitizeNum(data.matchingFunds),
                remainingFunds: sanitizeNum(data.remainingFunds ?? data.remainingFundsCell),
                updated:        data.updated || new Date().toISOString()
              };
              group.bars.forEach(({ root, goalAttr, raisedAttr }) => {
                renderBar(root, payload, { goalAttr, raisedAttr });
              });
              updateMatchLines(payload);
              saveCache(group.cacheKey, { ...payload, _manifestCurrent: dataUrl });
              group.lastFetchedAt = Date.now();
            });

        const run = isManifest
          ? fetch(url)
              .then(r => r.json())
              .then(manifest => {
                const currentUrl = String(manifest?.current || "").trim();
                const candidateUrls = getManifestDataUrls(manifest);
                if (!candidateUrls.length) return; // manifest malformed — keep existing UI

                const cached = loadCache(group.cacheKey);
                if (cached && currentUrl && cached._manifestCurrent === currentUrl) return; // unchanged

                let chain = Promise.reject();
                candidateUrls.forEach((candidateUrl) => {
                  chain = chain.catch(() => doFetchData(candidateUrl));
                });
                return chain;
              })
          : doFetchData(url);

        run
          .catch(() => { /* keep existing UI on error */ })
          .finally(() => { group.inFlight = false; });
      }

      // Auto-refresh + visibility handling per URL group
      function scheduleGroup(url, group) {
        const cached = loadCache(group.cacheKey);
        const age    = cached ? (Date.now() - (cached._cachedAt || 0)) : Infinity;
        if (age > CACHE_TTL_MS) fetchAndRender(url, group);

        const jitter = Math.floor(Math.random() * (REFRESH_MS * 0.2));
        const stopTimer  = () => { if (group.timerId) { clearInterval(group.timerId); group.timerId = null; } };
        const startTimer = () => {
          stopTimer();
          group.timerId = setInterval(() => {
            if (document.hidden) return;
            fetchAndRender(url, group);
          }, REFRESH_MS + jitter);
        };
        startTimer();

        const onFocusOrVisible = () => {
          if (document.hidden) return;
          const since = Date.now() - (group.lastFetchedAt || 0);
          if (since > FOCUS_STALE_MS) fetchAndRender(url, group);
        };
        window.addEventListener('focus', onFocusOrVisible);
        document.addEventListener('visibilitychange', onFocusOrVisible);
      }

      for (const [url, group] of groups.entries()) {
        scheduleGroup(url, group);
      }

      injectFundBarDonateButtons();
    }

    // Inject a donate button into every .fund-bar that doesn't already have one.
    // Button label is read from the page's .sqs-donate-button (if present) so it
    // automatically picks up whatever text the Squarespace editor set (e.g. "#GiveToTheGraze").
    // Falls back to "Donate →" when no native donation button is found.
    // Clicking the injected button programmatically clicks .sqs-donate-button to
    // open the Squarespace donation modal.
    function injectFundBarDonateButtons() {
      const sqsBtn  = document.querySelector('.sqs-donate-button');
      const btnText = sqsBtn?.textContent?.trim() || 'Donate →';
      const ariaLbl = sqsBtn ? `Donate — ${btnText}` : 'Donate now';

      document.querySelectorAll('.fund-bar').forEach(bar => {
        if (bar.querySelector('.fund-donate-btn')) return; // already injected

        const btn = document.createElement('button');
        btn.type      = 'button';
        btn.className = 'fund-donate-btn';
        btn.textContent = btnText;
        btn.setAttribute('aria-label', ariaLbl);

        btn.addEventListener('click', () => {
          if (sqsBtn) sqsBtn.click();
        });

        bar.appendChild(btn);
      });
    }

  } catch (e) { console.warn('NT Fund bar error:', e); }
})();
