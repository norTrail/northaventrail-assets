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
      injectTailsDonationBar();

      const bars = Array.from(document.querySelectorAll('.fund-bar:not([hidden])'));
      if (!bars.length) return;

      bars.forEach((root) => {
        const hasCustomProgressRow = Array.from(root.children).some((child) => child.classList?.contains('fund-progress-row'));
        if (!hasCustomProgressRow && !root.hasAttribute('data-hide-legacy-copy')) {
          root.setAttribute('data-hide-legacy-copy', 'true');
        }
      });

      // ====== CONFIG ======
      const REFRESH_MS     = 5 * 60 * 1000;   // poll every 5 minutes
      const CACHE_TTL_MS   = 10 * 60 * 1000;  // treat cache stale after 10 minutes
      const FOCUS_STALE_MS = 60 * 1000;       // refresh if stale > 60s on refocus
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

      function renderMatchLine(root, payload) {
        const matchLine = root.querySelector('.fund-match');
        if (!matchLine) return;

        const cap       = sanitizeNum(payload.matchingFunds);
        const remaining = sanitizeNum(payload.remainingFunds);
        const hasMatch  = Number.isFinite(cap) && Number.isFinite(remaining) && remaining > 0;

        if (!hasMatch) {
          matchLine.hidden = true;
          matchLine.innerHTML = '';
          return;
        }

        const html = `Double the baa-ng for your buck! Every $1 donated is matched.<br>${fmtMoney(cap)} in Matching Funds (${fmtMoney(Math.max(0, remaining))} remaining) — your gift goes twice as far.`;
        matchLine.hidden = false;
        if (matchLine.innerHTML !== html) matchLine.innerHTML = html;
      }

      function renderBar(root, payload, fallbacks) {
        const raised  = num(payload.raised, fallbacks.raisedAttr);
        const goal    = num(payload.goal, fallbacks.goalAttr);
        const updated = payload.updated || null;
        const greenbar    = root.querySelector('.greenbar');
        const progressLbl = root.querySelector('.fund-progress-label, .progress');
        const statusLine  = root.querySelector('.statusLine');
        const pct = goal > 0 ? clamp((raised / goal) * 100, 0, 100) : 0;

        if (greenbar) {
          greenbar.style.width = pct + '%';
          greenbar.setAttribute('aria-hidden', pct <= 0 ? 'true' : 'false');
        }
        if (progressLbl) progressLbl.textContent = Math.round(pct) + '%';
        if (statusLine && Number.isFinite(raised) && Number.isFinite(goal)) {
          const thankyou = (root.getAttribute('data-thankyou') || 'Thank you!').trim();
          const baseText = `We have raised ${fmtMoney(raised)} of our ${fmtMoney(goal)} goal so far.` +
                           (thankyou ? ` ${thankyou}` : '');
          statusLine.innerHTML = baseText +
            (updated ? `<br><span class="updatedLine">${fmtUpdated(updated)}</span>` : '');
        }

        const meter = root.querySelector('.meter');
        if (meter) {
          const pctRounded = Math.round(pct);
          meter.setAttribute('aria-valuenow', String(pctRounded));
          meter.setAttribute('aria-valuetext', `${pctRounded}% of goal raised`);
        }

        renderMatchLine(root, payload);
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
          const age      = cached ? (Date.now() - (cached._cachedAt || 0)) : Infinity;
          const paintForBars = (cached && age <= CACHE_TTL_MS)
            ? cached
            : { raised: raisedAttr, goal: goalAttr, updated: null };
          renderBar(root, paintForBars, { goalAttr, raisedAttr });
          if (!groups.has(jsonUrl)) {
            groups.set(jsonUrl, {
              bars: [], goalDefault: goalAttr, raisedDefault: raisedAttr,
              cacheKey, lastFetchedAt: 0, inFlight: false, timerId: null,
              initialAge: age
            });
          }
          groups.get(jsonUrl).bars.push({ root, goalAttr, raisedAttr });
        } else {
          renderBar(root, { raised: raisedAttr, goal: goalAttr, updated: null }, { goalAttr, raisedAttr });
        }
      });

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

        const renderGroup = (payload) => {
          group.bars.forEach(({ root, goalAttr, raisedAttr }) => {
            renderBar(root, payload, { goalAttr, raisedAttr });
          });
        };

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
              renderGroup(payload);
              saveCache(group.cacheKey, { ...payload, _manifestCurrent: dataUrl });
              group.lastFetchedAt = Date.now();
            });

        const run = isManifest
          ? fetch(url)
              .then(r => r.json())
              .then(manifest => {
                const currentUrl = String(manifest?.current || "").trim();
                const candidateUrls = window.NorthavenUtils.getManifestDataUrls(manifest);
                if (!candidateUrls.length) return; // manifest malformed — keep existing UI

                const cached = loadCache(group.cacheKey);
                if (cached && currentUrl && cached._manifestCurrent === currentUrl) {
                  renderGroup(cached);
                  group.lastFetchedAt = Date.now();
                  return;
                }

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
        if (group.initialAge > CACHE_TTL_MS) fetchAndRender(url, group);

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

    function injectTailsDonationBar() {
      const appRoot = document.getElementById('tails-app');
      if (!appRoot || document.getElementById('nt-tails-donate-bar')) return;

      const bar = document.createElement('section');
      bar.id = 'nt-tails-donate-bar';
      bar.className = 'fund-bar fund-bar--tails';
      bar.setAttribute('data-json', 'https://assets.northaventrail.org/json/tails-donations.v2026.latest.json');
      bar.setAttribute('data-thankyou', 'Thank you!');
      bar.innerHTML = `
        <p class="fund-title">🐑 Support the TAILS Grazing Project</p>
        <div class="fund-progress-row">
          <div class="meter"
               role="progressbar"
               aria-valuemin="0"
               aria-valuemax="100"
               aria-valuenow="0"
               aria-label="Donation progress">
            <div class="greenbar"></div>
          </div>
          <span class="fund-progress-label">0%</span>
        </div>
        <div class="fund-msg">
          <span class="statusLine"></span>
        </div>
        <p class="fund-match" hidden></p>
      `;

      // These are Squarespace block IDs specific to the /tails-2026 page layout.
      // If the page is rebuilt in Squarespace these IDs will change; the fallback
      // chain below (iconBlock → mapSqsBlock → appRoot) handles that gracefully.
      const oldFundBlock = document.getElementById('block-43e60a69556693902014'); // legacy donation block
      const iconBlock    = document.getElementById('block-63b26464c986557ea752'); // icon row above map
      const mapSqsBlock = appRoot.closest('.sqs-block');

      if (oldFundBlock?.parentNode) {
        oldFundBlock.parentNode.insertBefore(bar, oldFundBlock);
        oldFundBlock.hidden = true;
        oldFundBlock.setAttribute('data-nt-legacy-donation-hidden', 'true');
      } else if (iconBlock?.parentNode) {
        iconBlock.parentNode.insertBefore(bar, iconBlock);
      } else if (mapSqsBlock?.parentNode) {
        mapSqsBlock.parentNode.insertBefore(bar, mapSqsBlock);
      } else {
        const adaInfo = document.getElementById('ada-info');
        adaInfo ? appRoot.insertBefore(bar, adaInfo) : appRoot.prepend(bar);
      }
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

      document.querySelectorAll('.fund-bar:not([hidden])').forEach(bar => {
        if (bar.getAttribute('data-donate-button') === 'false') return;
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
