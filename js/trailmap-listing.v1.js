/* ============================================================
   trailmap-listing.js
   - Single table: TrailmapListing.initTrailListing(cfg)
   - Multi table:  TrailmapListing.hydratePoiTables(cfg)
   - Uses trail-poi.latest.json manifest from CDN (reuses window.poiData when present)
   ============================================================ */

/* prevent scroll to hash on page load */
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

(function () {
  "use strict";

  const DEFAULTS = {
    emptyMessage: "No locations found.",
    errorMessage: "Unable to load locations at this time.",
    tableClass: "listing-table",
    // Manifest URL — resolves to current versioned data file at runtime.
    dataUrl:
      "https://assets.northaventrail.org/json/trail-poi.latest.json",
  };

  // ---------------------------
  // Small helpers
  // ---------------------------

  function safeOnReady(fn) {
    if (window.NorthavenUtils?.onReady) {
      window.NorthavenUtils.onReady(fn);
    } else if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function escHtml(s) {
    if (window.NorthavenUtils?.escapeHtml) return window.NorthavenUtils.escapeHtml(s);
    let str = String(s ?? "");
    str = str.replace(/&nbsp;/g, "\u00A0");
    return str.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function htmlToText(html) {
    const div = document.createElement("div");
    div.innerHTML = String(html ?? "");
    return (div.textContent || "").replace(/\s+/g, " ").trim();
  }

  function stopRowLinkPropagation(tbody) {
    if (!tbody) return;

    tbody.addEventListener("click", (e) => {
      const target = e.target;

      // Let Maps UI bubble to document so the menu controller works.
      if (target && target.closest && target.closest(".poiMaps")) return;

      // Still prevent row click when user taps other links inside the row.
      const el = target && target.closest ? target.closest("a") : null;
      if (el) e.stopPropagation();
    });
  }

  function getURLParamsSafe() {
    try {
      if (typeof window.getURLParams === "function") return window.getURLParams();
    } catch (_) { }
    const out = {};
    const qs = new URLSearchParams(location.search);
    for (const [k, v] of qs.entries()) out[k] = v;
    return out;
  }

  function setHistoryParam(param, value, pageTitle) {
    try {
      const u = new URL(location.href);
      u.searchParams.set(param, value);
      history.pushState(null, pageTitle || document.title, u.toString());
    } catch (_) { }
  }

  function normalizeAbsUrl_(u) {
    if (window.NorthavenUtils?.normalizeAbsUrl) return window.NorthavenUtils.normalizeAbsUrl(u);
    const s = String(u || "").trim();
    if (!s) return "";
    try {
      return new URL(s, location.href).toString();
    } catch {
      return s;
    }
  }

  function isSamePageUrl_(u) {
    if (window.NorthavenUtils?.isSamePageUrl) return window.NorthavenUtils.isSamePageUrl(u);
    try {
      const url = new URL(String(u || ""), location.href);
      const here = new URL(location.href);
      return (
        url.origin === here.origin &&
        url.pathname.replace(/\/+$/, "") === here.pathname.replace(/\/+$/, "")
      );
    } catch {
      return false;
    }
  }

  function isExternalDomain_(u) {
    if (window.NorthavenUtils?.isExternalDomain) return window.NorthavenUtils.isExternalDomain(u);
    try {
      const url = new URL(String(u || ""), location.href);
      return url.origin !== location.origin;
    } catch {
      return false;
    }
  }

  function driveThumbFromId_(id, w) {
    if (window.NorthavenUtils?.driveThumbFromId) return window.NorthavenUtils.driveThumbFromId(id, w);
    const s = String(id || "").trim();
    if (!s) return "";
    const m =
      s.match(/(?:id=)([a-zA-Z0-9_-]{10,})/) ||
      s.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    const driveId = m ? m[1] : s;
    const width = Number(w) || 400;
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveId)}&sz=w${width}`;
  }

  function normalizeOnlyShowListLabels_(v) {
    if (v === undefined || v === null) return null;
    const arr = Array.isArray(v) ? v : [v];
    const out = arr
      .map((x) => String(x ?? "").trim())
      .filter(Boolean);
    return out.length ? out : null;
  }

  function typeKeysForLabels_(payload, labels) {
    const labelSet = new Set((labels || []).map((s) => String(s).trim()));
    const out = [];
    const types = payload?.defs?.types || {};
    for (const [tKey, def] of Object.entries(types)) {
      const l = String(def?.l || "").trim();
      if (l && labelSet.has(l)) out.push(tKey);
    }
    return out;
  }

  function typeKeysForKeysOrLabels_(payload, keysOrLabels) {
    // Allow cfg.groupName to be either type keys ("hk") or labels ("HAWK Light")
    const want = new Set((keysOrLabels || []).map((s) => String(s).trim()));
    const types = payload?.defs?.types || {};
    const out = [];

    for (const [tKey, def] of Object.entries(types)) {
      const lbl = String(def?.l || "").trim();
      if (want.has(tKey) || (lbl && want.has(lbl))) out.push(tKey);
    }
    return out;
  }

  function getTypeDef_(payload, typeKey) {
    return (payload && payload.defs && payload.defs.types && payload.defs.types[typeKey]) || {};
  }

  function tableClassSelector_(tableClass) {
    const classes = String(tableClass || DEFAULTS.tableClass)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return classes.length ? `.${classes.join(".")}` : `.${DEFAULTS.tableClass}`;
  }

  function columnToLabel_(col) {
    const mapping = {
      name: "Name",
      near: "Location",
      signal: "Signal",
      type: "Signal",
      description: "Description",
      image: "Image",
      maps: "Maps"
    };
    return mapping[col] || (col.charAt(0).toUpperCase() + col.slice(1));
  }

  function getFeatureCoords_(feature) {
    const c = feature?.geometry?.coordinates;
    if (!Array.isArray(c) || c.length < 2) return null;
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }

  function buildDropdownText_(feature, payload) {
    const p = feature?.properties || {};
    const t = String(p.t || "").trim();
    const td = getTypeDef_(payload, t);

    // Prefer stored label (your current decision)
    const l = String(p.l || "").trim();
    if (l) return l;

    // Fallback to POI name if present
    const n = String(p.n || "").trim();
    if (n) return n;

    // Fallback to type label
    const tl = String(td.l || "").trim();
    if (tl) return tl;

    return String(feature?.id || "Location");
  }

  function normalizeSquarespaceAssetUrl_(u) {
    const s = String(u || "").trim();
    if (!s) return "";

    // already absolute (https://, http://, //)
    if (/^(https?:)?\/\//i.test(s)) return s;

    // already a site-relative path
    if (s.startsWith("/")) return s;

    // Squarespace asset key → prefix with /s/
    return "/s/" + s;
  }

  // ---------------------------
  // Maps menu (Option 1: single "Maps" control)
  // - Desktop: popover menu
  // - Mobile: bottom sheet + backdrop
  // ---------------------------


  function isMobileMapsMenu_() {
    return window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
  }

  function buildMapsMenuHtml_(featureId, trailUrl, gUrl, aUrl, poiName, poiCategory) {
    const menuId = "maps-menu-" + escHtml(featureId || "");
    const btnId = "maps-btn-" + escHtml(featureId || "");
    const tUrl = trailUrl || "";
    const gg = gUrl || "";
    const aa = aUrl || "";
    const name = poiName ? escHtml(String(poiName)) : "";
    const category = poiCategory ? escHtml(String(poiCategory)) : "";

    const titleHtml = name ? `
          <div class="mapsMenuTitle">
            <div class="mapsMenuTitle__text">
              <span class="mapsMenuTitle__name">${name}</span>
              ${category ? `<span class="mapsMenuTitle__category">${category}</span>` : ""}
            </div>
            <button type="button" class="mapsMenuTitle__close" aria-label="Close">&#x2715;</button>
          </div>` : "";

    return `
      <div class="poiMaps">
        <button
          type="button"
          class="mapsBtn"
          id="${btnId}"
          title="Open Map Options"
          aria-expanded="false"
          aria-controls="${menuId}"
          aria-label="${name ? `Maps options for ${name}` : "Maps options"}"
          data-menu-id="${menuId}"
        >
          Maps <span class="mapsBtnCaret" aria-hidden="true">▾</span>
        </button>

        <div class="mapsMenu" id="${menuId}" aria-label="Map options${name ? ` for ${name}` : ""}" hidden>
          ${titleHtml}
          <div class="mapsMenuList">
            ${tUrl ? `<a class="mapsMenuItem" title="Open in Trail Map" href="${escHtml(tUrl)}">Trail Map</a>` : ""}
            ${gg ? `<a class="mapsMenuItem" title="Open location in Google Maps" href="${escHtml(gg)}" target="_blank" rel="noopener noreferrer">Google Maps</a>` : ""}
            ${aa ? `<a class="mapsMenuItem" title="Open location in Apple Maps" href="${escHtml(aa)}" target="_blank" rel="noopener noreferrer">Apple Maps</a>` : ""}
            <button type="button" class="mapsMenuItem mapsMenuCancel">Cancel</button>
          </div>
        </div>
      </div>
    `.trim();
  }

  function clearMenuRowHighlight_() {
    document.querySelectorAll("tr.maps-menu-open").forEach((tr) => {
      tr.classList.remove("maps-menu-open");
    });
  }

  function setMenuRowHighlight_(btn) {
    clearMenuRowHighlight_();
    const tr = btn?.closest?.("tr");
    if (tr) tr.classList.add("maps-menu-open");
  }

  function installMapsMenuController_() {
    if (window.__mapsMenuControllerInstalled) return;
    window.__mapsMenuControllerInstalled = true;

    let openBtn = null;
    let menuFocusOut_ = null;    // track so we can remove it on close
    let menuKeyDown_ = null;

    function getMenu_(btn) {
      const id = btn?.dataset?.menuId;
      return id ? document.getElementById(id) : null;
    }

    function closeMenu_(restoreFocus = false) {
      if (!openBtn) return;
      const menu = getMenu_(openBtn);
      const btnToRestore = openBtn;
      openBtn.setAttribute("aria-expanded", "false");
      if (menu) {
        menu.hidden = true;
        if (menuFocusOut_) menu.removeEventListener("focusout", menuFocusOut_);
        if (menuKeyDown_) menu.removeEventListener("keydown", menuKeyDown_);
      }
      menuFocusOut_ = null;
      menuKeyDown_ = null;
      openBtn = null;
      clearMenuRowHighlight_();
      if (restoreFocus) btnToRestore?.focus?.();
    }

    function openMenu_(btn) {
      closeMenu_();
      const menu = getMenu_(btn);
      if (!menu) return;
      openBtn = btn;
      btn.setAttribute("aria-expanded", "true");
      menu.hidden = false;

      // 1. Reset any previous "drop-up" logic before measuring
      menu.style.left = "";
      menu.style.right = "";
      menu.style.top = "";
      menu.style.bottom = "";

      // Desktop default is anchored to the left edge of the trigger wrapper.
      // Re-apply it here so any previous collision adjustment is cleared.
      if (!isMobileMapsMenu_()) {
        menu.style.left = "0";
      }

      // 2. Perform the boundary check
      const rect = menu.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const viewportPadding = 12;

      // 3. If the menu bottom goes past the viewport, flip it
      if (rect.bottom > viewportHeight) {
        menu.style.top = "auto";
        menu.style.bottom = "calc(100% + 4px)";
      }

      // 4. Keep the menu visually attached to the trigger and nudge it only
      // as much as needed to keep it inside the viewport.
      if (!isMobileMapsMenu_()) {
        const overshootRight = rect.right - (viewportWidth - viewportPadding);
        if (overshootRight > 0) {
          const currentLeft = Number.parseFloat(menu.style.left || "0") || 0;
          menu.style.left = `${currentLeft - overshootRight}px`;
        }

        const clampedRect = menu.getBoundingClientRect();
        const overshootLeft = viewportPadding - clampedRect.left;
        if (overshootLeft > 0) {
          const currentLeft = Number.parseFloat(menu.style.left || "0") || 0;
          menu.style.left = `${currentLeft + overshootLeft}px`;
        }
      }

      setMenuRowHighlight_(btn);

      // Focus first item after browser renders the menu
      requestAnimationFrame(() => {
        const first = menu.querySelector(".mapsMenuItem");
        first?.focus?.();
      });

      // Arrow key navigation between items
      menuKeyDown_ = (e) => {
        const items = Array.from(menu.querySelectorAll(".mapsMenuItem"));
        const idx = items.indexOf(document.activeElement);
        if (e.key === "ArrowDown") {
          e.preventDefault();
          items[(idx + 1) % items.length]?.focus?.();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          items[(idx - 1 + items.length) % items.length]?.focus?.();
        }
      };
      menu.addEventListener("keydown", menuKeyDown_);

      // Close menu when Tab moves focus outside
      menuFocusOut_ = (e) => {
        if (!menu.contains(e.relatedTarget)) {
          setTimeout(() => {
            if (openBtn && !menu.contains(document.activeElement)) {
              closeMenu_();
            }
          }, 0);
        }
      };
      menu.addEventListener("focusout", menuFocusOut_);
    }

    document.addEventListener("click", (e) => {
      const btn = e.target.closest?.(".mapsBtn");
      const inMaps = e.target.closest?.(".poiMaps");
      const cancel = e.target.closest?.(".mapsMenuCancel");
      const closeBtn = e.target.closest?.(".mapsMenuTitle__close");
      const menuLink = e.target.closest?.(".mapsMenu a.mapsMenuItem");

      // Button toggles
      if (btn) {
        e.preventDefault();
        e.stopPropagation(); // don't trigger row click
        const expanded = btn.getAttribute("aria-expanded") === "true";
        expanded ? closeMenu_(true) : openMenu_(btn);
        return;
      }

      // Cancel closes
      if (cancel || closeBtn) {
        e.preventDefault();
        e.stopPropagation();
        closeMenu_(true);
        return;
      }

      // Clicking a menu link should close, but allow navigation
      if (menuLink) {
        // Let the link navigate; just close and stop row click
        e.stopPropagation();
        closeMenu_();
        return;
      }

      // Clicking anywhere outside closes
      if (!inMaps) closeMenu_();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu_(true);
    });
  }


  function resolvePoi_(feature, payload) {
    const p = feature?.properties || {};
    const t = String(p.t || "").trim();
    const td = getTypeDef_(payload, t);

    const title = buildDropdownText_(feature, payload);
    const near = String(p.r || "").trim();

    const descHtml = String(p.d || td.d || "").trim();
    const descText = descHtml ? htmlToText(descHtml) : "";

    const linkText = String(p.e || td.e || "").trim();
    const linkUrlRaw = String(p.f || td.f || "").trim();
    const linkUrl = linkUrlRaw ? normalizeAbsUrl_(linkUrlRaw) : "";

    const includeLink = Boolean(linkUrl && !isSamePageUrl_(linkUrl));
    const external = includeLink && isExternalDomain_(linkUrl);

    // Image: POI.u > POI.m thumb > Type.u > Type.m thumb
    const imgUrl =
      normalizeSquarespaceAssetUrl_(p.u) ||
      driveThumbFromId_(p.m, 400) ||
      normalizeSquarespaceAssetUrl_(td.u) ||
      driveThumbFromId_(td.m, 400) ||
      "";

    return {
      id: String(feature?.id ?? ""),
      typeKey: t,
      typeLabel: String(td.l || "").trim(),
      title,
      near,
      descText,
      descHtml, // if you want to render HTML later
      includeLink,
      linkText,
      linkUrl,
      external,
      imgUrl,
    };
  }

  function getPoiCache_() {
    const cache = window.__trailPoiCache;
    if (!cache || !cache.data || !Array.isArray(cache.data.features) || !cache.sourceUrl) {
      return null;
    }
    return cache;
  }

  function setPoiCache_(payload, sourceUrl) {
    const resolvedSource = String(sourceUrl || "").trim();
    const cache = {
      data: payload,
      sourceUrl: resolvedSource
    };
    window.__trailPoiCache = cache;
    // Keep the legacy global for older consumers.
    window.poiData = payload;
    return payload;
  }

  function getManifestDataUrls_(manifest) {
    return [...new Set(
      [manifest?.current, manifest?.fallback, manifest?.previous]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )];
  }

  function getPoiData_(dataUrl) {
    const url = String(dataUrl || "").trim() || DEFAULTS.dataUrl;

    // 15-second timeout covers the full manifest + data fetch chain.
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 15000);

    const fetchData = (resolvedUrl) => {
      const sourceUrl = String(resolvedUrl || "").trim();
      const cached = getPoiCache_();
      if (cached && cached.sourceUrl === sourceUrl) {
        return Promise.resolve(cached.data);
      }

      return fetch(sourceUrl, { signal: controller.signal })
        .then((r) => {
          if (!r.ok) throw new Error(`Network ${r.status}`);
          return r.json();
        })
        .then((json) => setPoiCache_(json, sourceUrl));
    };

    // If the URL is a manifest (*.latest.json), resolve it to one or more versioned files first.
    const isManifest = url.endsWith(".latest.json");

    if (!isManifest) {
      return fetchData(url).finally(() => clearTimeout(timeoutId));
    }

    return fetch(url, { cache: "no-store", signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`Manifest HTTP ${r.status}`);
        return r.json();
      })
      .then((manifest) => {
        const currentUrl = String(manifest?.current || "").trim();
        const candidateUrls = getManifestDataUrls_(manifest);
        if (!candidateUrls.length) throw new Error("Manifest missing current POI URL");

        const cached = getPoiCache_();
        if (cached && currentUrl && cached.sourceUrl === currentUrl) {
          return cached.data;
        }

        let chain = Promise.reject();
        candidateUrls.forEach((candidateUrl) => {
          chain = chain.catch(() => fetchData(candidateUrl));
        });
        return chain;
      })
      .catch((err) => {
        // Don't fall back to stale cache on timeout — surface the AbortError to callers
        if (err.name === "AbortError") throw err;
        const cached = getPoiCache_();
        if (cached) return cached.data;
        throw err;
      })
      .finally(() => clearTimeout(timeoutId));
  }

  function buildRowModel_(feature, payload) {
    const poi = resolvePoi_(feature, payload);
    const coords = getFeatureCoords_(feature);
    const id = poi.id;
    const urlmapping = id ? `/trailmap?loc=${encodeURIComponent(id)}` : "/trailmap";
    const gUrl = coords ? `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}` : "";
    const aUrl = coords ? `https://maps.apple.com/?z=20&q=${coords.lat},${coords.lng}` : "";
    return { feature, poi, coords, id, urlmapping, gUrl, aUrl, sortTitle: poi.title };
  }

  function attachRowActivation_(tbody, pageTitle, tableClass) {
    if (!tbody || tbody.dataset.rowActivationBound === "1") return;
    tbody.dataset.rowActivationBound = "1";
    tbody.addEventListener("click", (e) => {
      if (e.target && e.target.closest && e.target.closest(".poiMaps")) return;
      const row = e.target && e.target.closest ? e.target.closest("tr[data-feature-id]") : null;
      if (!row) return;
      setActiveFeature_(row.dataset.featureId, pageTitle, tableClass);
    });
    tbody.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target && e.target.closest && e.target.closest(".poiMaps")) return;
      const row = e.target && e.target.closest ? e.target.closest("tr[data-feature-id]") : null;
      if (!row) return;
      e.preventDefault();
      setActiveFeature_(row.dataset.featureId, pageTitle, tableClass);
    });
  }

  // ---------------------------
  // Single-table listing
  // ---------------------------

  function initTrailListing(config) {
    const cfg = config || {};
    const containerId = cfg.containerId;
    const pageTitle = cfg.pageTitle || document.title;

    const emptyMessage = cfg.emptyMessage || DEFAULTS.emptyMessage;
    const errorMessage = cfg.errorMessage || DEFAULTS.errorMessage;
    const tableClass = cfg.tableClass || DEFAULTS.tableClass;
    const dataUrl = cfg.dataUrl || DEFAULTS.dataUrl;
    const cfgColumns = cfg.columns;
    const columns = Array.isArray(cfgColumns)
      ? cfgColumns.map((col) => String(col || "").trim().toLowerCase()).filter(Boolean)
      : String(cfgColumns || "").trim()
        ? String(cfgColumns).split(",").map((col) => col.trim().toLowerCase()).filter(Boolean)
        : null;

    // Filter can be:
    // - window.ONLY_SHOW_LIST (labels)
    // - cfg.groupName (type keys or labels; string or array)
    const cfgGroup = cfg.groupName;

    safeOnReady(() => {
      installMapsMenuController_();
      const container = document.getElementById(containerId);
      if (!container) return;

      container.innerHTML = `<p>Loading…</p>`;

      getPoiData_(dataUrl)
        .then((payload) => {
          const featuresAll = Array.isArray(payload?.features) ? payload.features : [];
          if (!featuresAll.length) {
            container.innerHTML = `<p>${escHtml(emptyMessage)}</p>`;
            return;
          }

          let allowedTypeKeys = null;

          // 1) Global ONLY_SHOW_LIST (labels)
          const onlyLabels = normalizeOnlyShowListLabels_(window.ONLY_SHOW_LIST);
          if (onlyLabels?.length) {
            allowedTypeKeys = new Set(typeKeysForLabels_(payload, onlyLabels));
          }

          // 2) cfg.groupName (keys or labels) overrides/combines
          if (cfgGroup !== undefined && cfgGroup !== null && String(cfgGroup).trim() !== "") {
            const arr = Array.isArray(cfgGroup) ? cfgGroup : [cfgGroup];
            const keys = typeKeysForKeysOrLabels_(payload, arr);
            allowedTypeKeys = new Set(keys);
          }

          let features = featuresAll.slice();

          if (allowedTypeKeys) {
            features = features.filter((f) => allowedTypeKeys.has(String(f?.properties?.t || "")));
          }

          if (!features.length) {
            container.innerHTML = `<p>${escHtml(emptyMessage)}</p>`;
            return;
          }

          const rowModels = features.map((feature) => buildRowModel_(feature, payload));
          rowModels.sort((a, b) => a.sortTitle.localeCompare(b.sortTitle));

          const table = document.createElement("table");
          table.className = tableClass;
          if (columns?.length) {
            table.innerHTML = `
              <thead>
                <tr>
                  ${columns.map((col) => `<th scope="col">${escHtml(columnToLabel_(col))}</th>`).join("")}
                </tr>
              </thead>
              <tbody></tbody>
            `;
          } else {
            table.innerHTML = `
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Description</th>
                </tr>
              </thead>
              <tbody></tbody>
            `;
          }

          const tbody = table.querySelector("tbody");
          attachRowActivation_(tbody, pageTitle, tableClass);

          rowModels.forEach((rowModel) => {
            if (columns?.length) {
              tbody.appendChild(buildRowForColumns_(rowModel, payload, pageTitle, tableClass, columns));
              return;
            }

            const { poi, id, urlmapping, gUrl, aUrl } = rowModel;
            const titleText = escHtml(poi.title);
            const menuHtml = buildMapsMenuHtml_(id, urlmapping, gUrl, aUrl, poi.title, poi.typeLabel);

            const tr = document.createElement("tr");
            tr.dataset.featureId = id;
            tr.setAttribute("tabindex", "0");

            const desc = poi.descText || "";
            tr.innerHTML = `
              <td>
                <div class="poi-name__title">${titleText}</div>
                ${poi.near ? `<div class="poi-near">${escHtml(poi.near)}</div>` : ""}
                <div class="poi-links">${menuHtml}</div>
              </td>
              <td>
                ${poi.imgUrl ? `<img src="${escHtml(poi.imgUrl)}" class="poi-marker-img" width="80" alt="${escHtml(poi.title)}" loading="lazy" decoding="async">` : ""}
                <div class="poi-desc">${escHtml(desc)}</div>
                ${poi.includeLink && poi.linkText && poi.linkUrl
                ? `<div><a class="map-popup-link" href="${escHtml(poi.linkUrl)}" ${poi.external ? `target="_blank" rel="noopener"` : ""
                }>${escHtml(poi.linkText)}</a></div>`
                : ""
              }
              </td>
            `;

            tbody.appendChild(tr);
          });

          stopRowLinkPropagation(tbody);

          container.innerHTML = "";
          container.appendChild(table);

          // Highlight from URL
          const params = getURLParamsSafe();
          const LOCATION_PARM = window.LOCATION_PARM || "loc";
          const locId = params && params[LOCATION_PARM] ? String(params[LOCATION_PARM]) : "";
          if (locId) highlightFeature_(locId, tableClass);
        })
        .catch((err) => {
          console.error("Listing load error:", err);
          container.innerHTML = `<p>${escHtml(errorMessage)}</p>`;
        });
    });
  }

  function clearActiveFeature_(tableClass) {
    const tableSelector = tableClassSelector_(tableClass);
    document.querySelectorAll(`${tableSelector} tbody tr`).forEach((row) => {
      row.classList.remove("active", "is-active");
    });
  }

  function highlightFeature_(featureId, tableClass, scroll = false) {
    const idStr = String(featureId ?? "");
    if (!idStr) return;
    const tableSelector = tableClassSelector_(tableClass);
    let found = null;
    document.querySelectorAll(`${tableSelector} tbody tr`).forEach((row) => {
      const isMatch = row.dataset.featureId === idStr;
      row.classList.toggle("active", isMatch);
      row.classList.toggle("is-active", isMatch);
      if (isMatch) found = row;
    });

    if (scroll && found) {
      found.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function setActiveFeature_(featureId, pageTitle, tableClass) {
    const idStr = String(featureId ?? "");
    if (!idStr) return;

    highlightFeature_(idStr, tableClass);

    const LOCATION_PARM = window.LOCATION_PARM || "loc";
    const hasEmbeddedMap =
      !!document.getElementById("map") &&
      typeof window.goToElement === "function" &&
      Array.isArray(window.poiData?.features);

    if (hasEmbeddedMap) {
      setHistoryParam(LOCATION_PARM, idStr, pageTitle);
      window.goToElement(idStr);
      return;
    }

    window.location.href = `/trailmap?${LOCATION_PARM}=${encodeURIComponent(idStr)}`;
  }

  // ---------------------------
  // Multi-table hydration
  // ---------------------------

  function parseColumnsFromWrap_(wrap) {
    const raw = String(wrap.getAttribute("data-columns") || "").trim();
    if (!raw) return ["name", "near", "maps"];
    return raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  function normalizeCategoryKey_(s) {
    return String(s || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function featureToCategory_(feature) {
    const p = feature?.properties || {};

    // b = bucket / category key (authoritative)
    const b = String(p.b || "").trim();
    if (b) return normalizeCategoryKey_(b);

    return "other";
  }

  function buildRowForColumns_(rowModel, payload, pageTitle, tableClass, columns) {
    const { poi, id, urlmapping, gUrl, aUrl } = rowModel;
    const titleText = escHtml(poi.title);

    const tr = document.createElement("tr");
    tr.dataset.featureId = id;
    tr.setAttribute("tabindex", "0");

    const cellHtml = columns.map((col) => {
      const label = escHtml(columnToLabel_(col));
      if (col === "name") {
        return `<td data-label="${label}"><div class="poi-name__title">${titleText}</div></td>`;
      }
      if (col === "image") {
        return `<td data-label="${label}">${poi.imgUrl
          ? `<img src="${escHtml(poi.imgUrl)}" class="poi-marker-img" width="80" alt="${escHtml(poi.title)}" loading="lazy" decoding="async">`
          : ""}</td>`;
      }
      if (col === "near") {
        return `<td data-label="${label}"><div class="poi-near">${escHtml(poi.near || "")}</div></td>`;
      }
      if (col === "signal" || col === "type") {
        return `<td data-label="${label}"><div class="poi-type">${escHtml(poi.typeLabel || "")}</div></td>`;
      }
      if (col === "description") {
        return `<td data-label="${label}"><div class="poi-desc">${escHtml(poi.descText || "")}</div></td>`;
      }
      if (col === "maps") {
        // Option 1: single "Maps" control (prevents 3-link overflow on mobile)
        const menuHtml = buildMapsMenuHtml_(id, urlmapping, gUrl, aUrl, poi.title, poi.typeLabel);
        return `<td data-label="${label}">${menuHtml}</td>`;
      }
      return `<td></td>`;
    }).join("");

    tr.innerHTML = cellHtml;
    return tr;
  }

  // Measure the actual site nav height by finding the tallest fixed/sticky
  // element anchored to the top of the viewport.
  function getSiteNavHeight_() {
    const candidates = document.querySelectorAll(
      "header, .site-header, #header, [class*='header'], [id*='header']"
    );
    let maxBottom = 0;
    candidates.forEach((el) => {
      const style = window.getComputedStyle(el);
      if (style.position === "fixed" || style.position === "sticky") {
        const rect = el.getBoundingClientRect();
        if (rect.top <= 4 && rect.bottom > maxBottom) {
          maxBottom = rect.bottom;
        }
      }
    });
    return Math.round(maxBottom);
  }

  // Push each section's H2 and thead down to sit flush below the site nav
  // (H2 sticks at nav bottom; thead sticks at nav bottom + H2 height).
  // Also writes --nt-nav-height so CSS can reference the measured value.
  function adjustStickyOffsets_() {
    const navHeight = getSiteNavHeight_();
    document.documentElement.style.setProperty("--nt-nav-height", navHeight + "px");
    document.querySelectorAll(".poi-section").forEach((section) => {
      const h2 = section.querySelector("h2");
      const ths = section.querySelectorAll("thead th");
      if (!h2) return;
      h2.style.top = navHeight + "px";
      if (!ths.length) return;
      const theadTop = navHeight + h2.offsetHeight;
      ths.forEach((th) => { th.style.top = theadTop + "px"; });
    });
  }

  function updatePoiHeader_(total, catCount) {
    const jumpList = document.querySelector(".poi-jump__list");

    // Inject summary sentence: before the jump list if one exists,
    // otherwise before the first table wrap on the page.
    if (!document.querySelector(".poi-summary")) {
      const anchor = jumpList || document.querySelector(".poi-table-wrap");
      if (anchor) {
        const p = document.createElement("p");
        p.className = "poi-summary";
        p.innerHTML = `<strong>${total}</strong> points of interest across <strong>${catCount}</strong> categories`;
        anchor.parentNode.insertBefore(p, anchor);
      }
    }

    if (!jumpList) return;
    jumpList.querySelectorAll("a[href]").forEach((link) => {
      const hash = link.getAttribute("href").replace(/^.*#/, "");
      if (!hash) return;
      const sectionEl = document.getElementById(hash);
      if (!sectionEl) return;
      const wrap = sectionEl.classList.contains("poi-table-wrap")
        ? sectionEl
        : sectionEl.querySelector(".poi-table-wrap");
      if (!wrap) return;
      const tbody = wrap.querySelector("tbody");
      if (!tbody) return;
      const count = Array.from(tbody.querySelectorAll("tr")).filter(
        (r) => !r.querySelector("td[colspan]")
      ).length;
      if (count > 0 && !link.querySelector(".poi-jump__count")) {
        const badge = document.createElement("span");
        badge.className = "poi-jump__count";
        badge.textContent = count;
        link.appendChild(badge);
      }
    });
  }

  function parseCategoryList_(attr) {
    return String(attr || "")
      .split(",")
      .map(s => normalizeCategoryKey_(s))
      .filter(Boolean);
  }

  function renderEmptyRow_(tbody, columns, message = "No items found in this category yet.") {
    if (!tbody) return;
    tbody.innerHTML = "";
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="${Math.max(1, columns.length)}">${escHtml(message)}</td>`;
    tbody.appendChild(tr);
  }

  function normalizeTableHead_(table, columns) {
    if (!table) return;

    let thead = table.querySelector("thead");
    if (!thead) {
      thead = document.createElement("thead");
      const tr = document.createElement("tr");
      columns.forEach(col => {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = columnToLabel_(col);
        tr.appendChild(th);
      });
      thead.appendChild(tr);
      table.insertBefore(thead, table.querySelector("tbody"));
      return;
    }

    const headerRow = thead.querySelector("tr");
    if (!headerRow) return;

    while (headerRow.children.length < columns.length) {
      const th = document.createElement("th");
      th.scope = "col";
      headerRow.appendChild(th);
    }

    Array.from(headerRow.children).forEach((cell, idx) => {
      if (cell.tagName !== "TH") return;
      cell.scope = "col";
      const col = columns[idx];
      if (!col) return;
      if (!String(cell.textContent || "").trim()) {
        cell.textContent = columnToLabel_(col);
      }
    });
  }

  function hydratePoiTables(config) {
    const cfg = config || {};
    const dataUrl = cfg.dataUrl || DEFAULTS.dataUrl;
    const pageTitle = cfg.pageTitle || document.title;
    const tableClass = cfg.tableClass || "poi-table";

    // ── Hash-scroll coordination ──────────────────────────────────────
    // Squarespace lazy-loads images via Intersection Observer, which fires
    // AFTER window.load and shifts layout. We use a ResizeObserver on the
    // body to detect when layout has stopped changing, then scroll.
    const hash = (history.state && history.state.initialHash) || location.hash;
    let tablesReady = false;
    let pageLoaded = document.readyState === "complete";

    const tryScrollToHash = () => {
      if (!hash || !tablesReady || !pageLoaded) return;

      let ro = null;
      let settleTimer = null;
      let hardStopTimer = null;

      // Tracks whether we have already scrolled at least once
      let hasScrolled = false;

      // If more resizes happen after we scroll, we'll allow another scroll,
      // but only after a quiet period again.
      const SETTLE_MS = 450;        // quiet window after last resize
      const MAX_TOTAL_MS = 8000;    // total time we'll keep trying
      const POST_SCROLL_GRACE_MS = 800; // after a scroll, keep watching briefly

      let postScrollTimer = null;

      const cleanup = () => {
        if (ro) ro.disconnect();
        ro = null;
        clearTimeout(settleTimer);
        clearTimeout(hardStopTimer);
        clearTimeout(postScrollTimer);
      };

      const restoreHashInUrl = () => {
        if (hash && !location.hash) {
          history.replaceState(
            Object.assign({}, history.state),
            "",
            location.pathname + location.search + hash
          );
        }
      };

      const doScroll = (reason) => {
        let scrollTarget;
        try { scrollTarget = document.querySelector(hash); } catch (_) { return; }
        if (!scrollTarget) return;

        scrollTarget.scrollIntoView({ behavior: "auto", block: "start" });
        restoreHashInUrl();
        hasScrolled = true;

        // After we scroll, keep observing for a bit:
        // if *nothing* else resizes during this grace period, we're done.
        clearTimeout(postScrollTimer);
        postScrollTimer = setTimeout(() => {
          cleanup();
        }, POST_SCROLL_GRACE_MS);
      };

      const scheduleSettled = (reason) => {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => doScroll(reason), SETTLE_MS);
      };

      // Observe the things that actually resize
      const wraps = Array.from(document.querySelectorAll(".poi-table-wrap[data-poi-category]"));
      if (!wraps.length) return;

      ro = new ResizeObserver(() => {
        // Any resize cancels the "we're done" grace timer
        clearTimeout(postScrollTimer);

        // Keep pushing the settle window out until resizes stop
        scheduleSettled(hasScrolled ? "settled-after-more-resize" : "initial-settled");
      });

      wraps.forEach(wrap => ro.observe(wrap));

      // Kick once in case things are already stable
      scheduleSettled("initial-kick");

      // Hard stop so we never loop forever
      hardStopTimer = setTimeout(() => {
        doScroll("hard-timeout");
        cleanup();
      }, MAX_TOTAL_MS);
    };

    if (hash && !pageLoaded) {
      window.addEventListener("load", () => {
        pageLoaded = true;
        tryScrollToHash();
      }, { once: true });
    }
    // ─────────────────────────────────────────────────────────────────
    safeOnReady(() => {
      installMapsMenuController_();
      const wraps = Array.from(document.querySelectorAll(".poi-table-wrap[data-poi-category]"));
      if (!wraps.length) return;

      // Give the first section a stable anchor and retarget the skip link so
      // keyboard users can bypass the map and jump straight to the POI listing.
      const firstWrap = wraps[0];
      if (!firstWrap.id) firstWrap.id = "poi-listing";
      if (window.NorthavenUtils) {
        window.NorthavenUtils.ensureSkipLink({
          target: "#" + firstWrap.id,
          label: "Skip to trail locations"
        });
      } else {
        const skipLink = document.querySelector(".skip-link");
        if (skipLink) {
          skipLink.href = "#" + firstWrap.id;
          skipLink.textContent = "Skip to trail locations";
        }
      }

      // Loading indicators
      wraps.forEach((w) => {
        const loading = w.querySelector("[data-poi-loading]");
        const err = w.querySelector("[data-poi-error]");
        w.setAttribute("aria-busy", "true");
        if (loading) {
          loading.hidden = false;
          loading.setAttribute("role", "status");
          loading.setAttribute("aria-live", "polite");
        }
        if (err) {
          err.hidden = true;
          err.setAttribute("role", "alert");
        }
      });

      getPoiData_(dataUrl)
        .then((payload) => {
          const featuresAll = Array.isArray(payload?.features) ? payload.features : [];

          // Global label filter (ONLY_SHOW_LIST)
          let allowedTypeKeys = null;
          const onlyLabels = normalizeOnlyShowListLabels_(window.ONLY_SHOW_LIST);
          if (onlyLabels?.length) {
            allowedTypeKeys = new Set(typeKeysForLabels_(payload, onlyLabels));
          }

          // Bucket features by category
          const buckets = new Map(); // cat -> rowModels[]
          for (const f of featuresAll) {
            const rowModel = buildRowModel_(f, payload);
            if (!rowModel.coords) continue;

            if (allowedTypeKeys && !allowedTypeKeys.has(String(f?.properties?.t || ""))) continue;

            const cat = featureToCategory_(f, payload);
            if (!buckets.has(cat)) buckets.set(cat, []);
            buckets.get(cat).push(rowModel);
          }

          const usedCats = new Set();   // category keys used by any table
          const usedFeatureIds = new Set(); // optional: track by feature id (prevents duplicates)
          let totalPois = 0;
          let filledCats = 0;

          // Sort each bucket by title
          for (const [cat, arr] of buckets.entries()) {
            arr.sort((a, b) => a.sortTitle.localeCompare(b.sortTitle));
          }

          // Fill each section
          wraps.forEach((wrap) => {
            const cats = parseCategoryList_(wrap.getAttribute("data-poi-category")); // ✅ supports comma list
            cats.forEach(c => usedCats.add(c)); // save them as used
            const table = wrap.querySelector("table");
            const tbody = table ? table.querySelector("tbody") : null;
            const loading = wrap.querySelector("[data-poi-loading]");
            const err = wrap.querySelector("[data-poi-error]");

            if (!table || !tbody) return;

            const columns = parseColumnsFromWrap_(wrap);
            attachRowActivation_(tbody, pageTitle, tableClass);

            // Ensure headers exist and blank headings are labeled.
            normalizeTableHead_(table, columns);

            tbody.innerHTML = "";

            if (!featuresAll.length) {
              wrap.setAttribute("aria-busy", "false");
              if (loading) loading.hidden = true;
              if (err) err.hidden = true;
              renderEmptyRow_(tbody, columns);
              return;
            }

            // Gather rows from one or more categories
            const rows = [];
            cats.forEach((c) => {
              const arr = buckets.get(c);
              if (arr && arr.length) rows.push(...arr);
            });

            // Optional: de-dupe by feature id
            const uniq = new Map();
            rows.forEach((rowModel) => uniq.set(String(rowModel.id || ""), rowModel));
            const finalRows = Array.from(uniq.values());

            // Keep stable order
            finalRows.sort((a, b) =>
              a.sortTitle.localeCompare(b.sortTitle)
            );

            finalRows.forEach((rowModel) => {
              tbody.appendChild(buildRowForColumns_(rowModel, payload, pageTitle, tableClass, columns));
            });

            if (finalRows.length > 0) {
              totalPois += finalRows.length;
              filledCats++;
            }

            finalRows.forEach(rowModel => usedFeatureIds.add(String(rowModel.id || ""))); // mark as used

            stopRowLinkPropagation(tbody);

            wrap.setAttribute("aria-busy", "false");
            if (loading) loading.hidden = true;
            if (err) err.hidden = true;

            if (!finalRows.length) {
              renderEmptyRow_(tbody, columns);
            }
          });

          // Add the unused POIs to "Other"
          const otherWrap = document.querySelector('.poi-table-wrap[data-poi-category="other"]');
          if (otherWrap) {
            const table = otherWrap.querySelector("table");
            const tbody = table ? table.querySelector("tbody") : null;
            if (tbody) {
              tbody.innerHTML = "";
              // collect explicit "other" rows plus leftover rows from buckets
              // that weren't referenced by any table.
              const leftovers = [];

              const otherBucket = buckets.get("other") || [];
              for (const rowModel of otherBucket) {
                const id = String(rowModel.id || "");
                if (!id || usedFeatureIds.has(id)) continue;
                leftovers.push(rowModel);
              }

              for (const [cat, arr] of buckets.entries()) {
                if (usedCats.has(cat)) continue;         // table already exists for this category
                for (const rowModel of arr) {
                  const id = String(rowModel.id || "");
                  if (!id || usedFeatureIds.has(id)) continue;
                  leftovers.push(rowModel);
                }
              }

              // sort leftovers
              leftovers.sort((a, b) => a.sortTitle.localeCompare(b.sortTitle));

              // append to Other table
              const columns = parseColumnsFromWrap_(otherWrap);
              attachRowActivation_(tbody, pageTitle, tableClass);
              leftovers.forEach((rowModel) => {
                tbody.appendChild(buildRowForColumns_(rowModel, payload, pageTitle, tableClass, columns));
              });

              stopRowLinkPropagation(tbody);

              const loading = otherWrap.querySelector("[data-poi-loading]");
              const err = otherWrap.querySelector("[data-poi-error]");
              otherWrap.setAttribute("aria-busy", "false");
              if (loading) loading.hidden = true;
              if (err) err.hidden = true;

              if (!leftovers.length) {
                renderEmptyRow_(tbody, columns);
              }
            }
          }



          updatePoiHeader_(totalPois, filledCats);
          adjustStickyOffsets_();

          // Highlight from URL if present
          const params = getURLParamsSafe();
          const LOCATION_PARM = window.LOCATION_PARM || "loc";
          const locId = params && params[LOCATION_PARM] ? String(params[LOCATION_PARM]) : "";
          if (locId) {
            document.querySelectorAll("table tbody tr").forEach((row) => {
              row.classList.toggle("active", row.dataset.featureId === locId);
              row.classList.toggle("is-active", row.dataset.featureId === locId);
            });
          }

          tablesReady = true;
          tryScrollToHash();
        })
        .catch((e) => {
          console.error("POI hydrate error:", e);
          wraps.forEach((wrap) => {
            const loading = wrap.querySelector("[data-poi-loading]");
            const err = wrap.querySelector("[data-poi-error]");
            wrap.setAttribute("aria-busy", "false");
            if (loading) loading.hidden = true;
            if (err) err.hidden = false;
          });
        });
    });
  }

  // ---------------------------
  // Expose public API + backward compat
  // ---------------------------
  window.TrailmapListing = window.TrailmapListing || {};
  window.TrailmapListing.initTrailListing = initTrailListing;
  window.TrailmapListing.highlightFeature = function (featureId, opts = {}) {
    const tableClass = opts.tableClass || DEFAULTS.tableClass;
    const scroll = opts.scroll || false;
    highlightFeature_(featureId, tableClass, scroll);
  };
  window.TrailmapListing.highlightAndScrollTo = function (featureId, opts = {}) {
    const tableClass = opts.tableClass || DEFAULTS.tableClass;
    highlightFeature_(featureId, tableClass, true);
  };
  window.TrailmapListing.hydratePoiTables = hydratePoiTables;
  window.TrailmapListing.clearActiveFeature = function (opts = {}) {
    const tableClass = opts.tableClass || DEFAULTS.tableClass;
    const pageTitle = opts.pageTitle || document.title;
    clearActiveFeature_(tableClass, pageTitle);
  };

  safeOnReady(() => {
    try {
      if (window.cfg && window.cfg.containerId) {
        initTrailListing(window.cfg);
      }
    } catch (_) { }
  });
})();
