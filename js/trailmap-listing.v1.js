/* ============================================================
   trailmap-listing.js (GeoSlim2 / GeoJSON version)
   - Single table: TrailmapListing.initTrailListing(cfg)
   - Multi table:  TrailmapListing.hydratePoiTables(cfg)
   - Uses same geo_slim2 data as map (reuses window.poiData when present)
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
    // If you don't set window.TRAILMAP_DATA_URL, this is the fallback endpoint:
    dataUrl:
      "https://script.google.com/macros/s/AKfycbwBqR4y-aGF7R-pZPrhPI7hnejhd9_0_PK53whCQBICIvVULNgtFB7MW1syjhEVtNWhwQ/exec?page=geo_slim2",
  };

  // ---------------------------
  // Small helpers
  // ---------------------------

  function safeOnReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function escHtml(s) {
    let str = String(s ?? "");
    // If the string contains &nbsp;, it's likely intended as a space.
    // Replace it with the actual character so it doesn't get double-escaped to &amp;nbsp;
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
    const s = String(u || "").trim();
    if (!s) return "";
    try {
      return new URL(s, location.href).toString();
    } catch {
      return s;
    }
  }

  function isSamePageUrl_(u) {
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
    try {
      const url = new URL(String(u || ""), location.href);
      return url.origin !== location.origin;
    } catch {
      return false;
    }
  }

  function driveThumbFromId_(id, w) {
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

  function columnToLabel_(col) {
    const mapping = {
      name: "Name",
      near: "Location",
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
  // Maps menu (Option 1: single “Maps” control)
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
          aria-haspopup="true"
          aria-expanded="false"
          aria-controls="${menuId}"
          data-menu-id="${menuId}"
        >
          Maps <span class="mapsBtnCaret" aria-hidden="true">▾</span>
        </button>

        <div class="mapsMenu" id="${menuId}" aria-label="Map options${name ? ` for ${name}` : ""}" hidden>
          ${titleHtml}
          ${tUrl ? `<a class="mapsMenuItem" title="Open in Trail Map" href="${escHtml(tUrl)}">Trail Map</a>` : ""}
          ${gg ? `<a class="mapsMenuItem" title="Open location in Google Maps" href="${escHtml(gg)}" target="_blank" rel="noopener noreferrer">Google Maps</a>` : ""}
          ${aa ? `<a class="mapsMenuItem" title="Open location in Apple Maps" href="${escHtml(aa)}" target="_blank" rel="noopener noreferrer">Apple Maps</a>` : ""}
          <button type="button" class="mapsMenuItem mapsMenuCancel">Cancel</button>
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
    let openBtn = null;
    let menuFocusOut_ = null;    // track so we can remove it on close
    let menuKeyDown_ = null;

    function getMenu_(btn) {
      const id = btn?.dataset?.menuId;
      return id ? document.getElementById(id) : null;
    }

    function closeMenu_() {
      if (!openBtn) return;
      const menu = getMenu_(openBtn);
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
    }

    function openMenu_(btn) {
      closeMenu_();
      const menu = getMenu_(btn);
      if (!menu) return;
      openBtn = btn;
      btn.setAttribute("aria-expanded", "true");
      menu.hidden = false;

      // 1. Reset any previous "drop-up" logic before measuring
      menu.style.top = "";
      menu.style.bottom = "";

      // 2. Perform the boundary check
      const rect = menu.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

      // 3. If the menu bottom goes past the viewport, flip it
      if (rect.bottom > viewportHeight) {
        menu.style.top = "auto";
        menu.style.bottom = "calc(100% + 6px)";
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
      const menuLink = e.target.closest?.(".mapsMenu a.mapsMenuItem");

      // Button toggles
      if (btn) {
        e.preventDefault();
        e.stopPropagation(); // don't trigger row click
        const expanded = btn.getAttribute("aria-expanded") === "true";
        expanded ? closeMenu_() : openMenu_(btn);
        return;
      }

      // Cancel closes
      if (cancel) {
        e.preventDefault();
        e.stopPropagation();
        closeMenu_();
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
      if (e.key === "Escape") closeMenu_();
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

  function getPoiData_(dataUrl) {
    // Prefer map-loaded payload
    if (window.poiData && Array.isArray(window.poiData.features)) {
      return Promise.resolve(window.poiData);
    }

    const url = String(window.TRAILMAP_DATA_URL || dataUrl || "").trim() || DEFAULTS.dataUrl;

    return fetch(url, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`Network ${r.status}`);
        return r.json();
      })
      .then((json) => {
        // Cache for other consumers (and map pages that load listing first)
        window.poiData = json;
        return json;
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

          // Sort (if payload already server-sorted east->west, this keeps stable)
          features.sort((a, b) => {
            const ra = resolvePoi_(a, payload);
            const rb = resolvePoi_(b, payload);
            return ra.title.localeCompare(rb.title);
          });

          const table = document.createElement("table");
          table.className = tableClass;
          table.innerHTML = `
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Description</th>
              </tr>
            </thead>
            <tbody></tbody>
          `;

          const tbody = table.querySelector("tbody");

          features.forEach((feature) => {
            const poi = resolvePoi_(feature, payload);
            const coords = getFeatureCoords_(feature);

            // map deep link uses loc=id
            const id = poi.id;
            const urlmapping = id ? `/trailmap?loc=${encodeURIComponent(id)}` : "/trailmap";
            const titleLink = `<a href="${escHtml(urlmapping)}" class="poi-name__link">${escHtml(poi.title)}</a>`;

            const gUrl = coords ? `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}` : "";
            const aUrl = coords ? `https://maps.apple.com/?ll=${coords.lat},${coords.lng}` : "";
            const mapsLinks = [
              gUrl ? `<a href="${escHtml(gUrl)}" target="_blank" rel="noopener noreferrer">Google</a>` : "",
              aUrl ? `<a href="${escHtml(aUrl)}" target="_blank" rel="noopener noreferrer">Apple</a>` : ""
            ].filter(Boolean).join(" | ");

            const tr = document.createElement("tr");
            tr.dataset.featureId = id;
            tr.tabIndex = 0;
            tr.setAttribute("role", "button");
            tr.setAttribute("aria-label", `Show ${poi.title} on the map`);

            const desc = poi.descText || "";
            tr.innerHTML = `
              <td>
                <div class="poi-name__title">${titleLink}</div>
                ${poi.near ? `<div class="poi-near">${escHtml(poi.near)}</div>` : ""}
                ${mapsLinks ? `<div class="poi-links">${mapsLinks}</div>` : ""}
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

            tr.addEventListener("click", (e) => {
              if (e.target && e.target.closest && e.target.closest(".poiMaps")) return;
              setActiveFeature_(id, pageTitle, tableClass);
            });
            tr.addEventListener("keydown", (e) => {
              if (e.target && e.target.closest && e.target.closest(".poiMaps")) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setActiveFeature_(id, pageTitle, tableClass);
              }
            });

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
    const cls = tableClass || DEFAULTS.tableClass;
    document.querySelectorAll(`.${cls} tbody tr`).forEach((row) => {
      row.classList.remove("active", "is-active");
    });
  }

  function highlightFeature_(featureId, tableClass, scroll = false) {
    const idStr = String(featureId ?? "");
    if (!idStr) return;
    const cls = tableClass || DEFAULTS.tableClass;
    let found = null;
    document.querySelectorAll(`.${cls} tbody tr`).forEach((row) => {
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

    //const LOCATION_PARM = window.LOCATION_PARM || "loc";
    //setHistoryParam(LOCATION_PARM, idStr, pageTitle);

    try {
      if (typeof window.goToElement === "function") window.goToElement(idStr);
    } catch (_) { }

    //if (pageTitle) document.title = pageTitle;
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

  function buildRowForColumns_(feature, payload, pageTitle, tableClass, columns) {
    const poi = resolvePoi_(feature, payload);
    const coords = getFeatureCoords_(feature);

    const id = poi.id;
    const urlmapping = id ? `/trailmap?loc=${encodeURIComponent(id)}` : "/trailmap";
    const titleLink = `<a href="${escHtml(urlmapping)}" class="poi-name__link">${escHtml(poi.title)}</a>`;

    const gUrl = coords ? `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}` : "";
    const aUrl = coords ? `https://maps.apple.com/?ll=${coords.lat},${coords.lng}` : "";
    const mapsLinks = [
      urlmapping ? `<a href="${escHtml(urlmapping)}" class="poi-name__link">Trail</a>` : "",
      gUrl ? `<a href="${escHtml(gUrl)}" target="_blank" rel="noopener noreferrer">Google</a>` : "",
      aUrl ? `<a href="${escHtml(aUrl)}" target="_blank" rel="noopener noreferrer">Apple</a>` : ""
    ].filter(Boolean).join(" | ");

    const tr = document.createElement("tr");
    tr.dataset.featureId = id;
    tr.tabIndex = 0;
    tr.setAttribute("role", "button");
    tr.setAttribute("aria-label", `Show ${poi.title} on the map`);

    tr.addEventListener("click", (e) => {
      if (e.target && e.target.closest && e.target.closest(".poiMaps")) return;
      setActiveFeature_(id, pageTitle, tableClass);
    });
    tr.addEventListener("keydown", (e) => {
      if (e.target && e.target.closest && e.target.closest(".poiMaps")) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setActiveFeature_(id, pageTitle, tableClass);
      }
    });

    const cellHtml = columns.map((col) => {
      if (col === "name") {
        return `<td><div class="poi-name__title">${titleLink}</div></td>`;
      }
      if (col === "image") {
        return `<td>${poi.imgUrl
          ? `<img src="${escHtml(poi.imgUrl)}" class="poi-marker-img" width="80" alt="${escHtml(poi.title)}" loading="lazy" decoding="async">`
          : ""}</td>`;
      }
      if (col === "near") {
        return `<td><div class="poi-near">${escHtml(poi.near || "")}</div></td>`;
      }
      if (col === "description") {
        return `<td><div class="poi-desc">${escHtml(poi.descText || "")}</div></td>`;
      }
      if (col === "maps") {
        // Option 1: single “Maps” control (prevents 3-link overflow on mobile)
        const menuHtml = buildMapsMenuHtml_(id, urlmapping, gUrl, aUrl, poi.title, poi.typeLabel);
        return `<td>${menuHtml}</td>`;
      }
      return `<td></td>`;
    }).join("");

    tr.innerHTML = cellHtml;
    return tr;
  }

  function parseCategoryList_(attr) {
    return String(attr || "")
      .split(",")
      .map(s => normalizeCategoryKey_(s))
      .filter(Boolean);
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
      const MAX_TOTAL_MS = 8000;    // total time we’ll keep trying
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
        // if *nothing* else resizes during this grace period, we’re done.
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
        // Any resize cancels the “we’re done” grace timer
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

      // Loading indicators
      wraps.forEach((w) => {
        const loading = w.querySelector("[data-poi-loading]");
        const err = w.querySelector("[data-poi-error]");
        if (loading) loading.hidden = false;
        if (err) err.hidden = true;
      });

      getPoiData_(dataUrl)
        .then((payload) => {
          const featuresAll = Array.isArray(payload?.features) ? payload.features : [];
          if (!featuresAll.length) return;

          // Global label filter (ONLY_SHOW_LIST)
          let allowedTypeKeys = null;
          const onlyLabels = normalizeOnlyShowListLabels_(window.ONLY_SHOW_LIST);
          if (onlyLabels?.length) {
            allowedTypeKeys = new Set(typeKeysForLabels_(payload, onlyLabels));
          }

          // Bucket features by category
          const buckets = new Map(); // cat -> features[]
          for (const f of featuresAll) {
            const coords = getFeatureCoords_(f);
            if (!coords) continue;

            if (allowedTypeKeys && !allowedTypeKeys.has(String(f?.properties?.t || ""))) continue;

            const cat = featureToCategory_(f, payload);
            if (!buckets.has(cat)) buckets.set(cat, []);
            buckets.get(cat).push(f);
          }

          const usedCats = new Set();   // category keys used by any table
          const usedFeatureIds = new Set(); // optional: track by feature id (prevents duplicates)

          // Sort each bucket by title
          for (const [cat, arr] of buckets.entries()) {
            arr.sort((a, b) => buildDropdownText_(a, payload).localeCompare(buildDropdownText_(b, payload)));
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

            // Inject thead if missing for accessibility
            if (!table.querySelector("thead")) {
              const thead = document.createElement("thead");
              const tr = document.createElement("tr");
              columns.forEach(col => {
                const th = document.createElement("th");
                th.scope = "col";
                th.textContent = columnToLabel_(col);
                tr.appendChild(th);
              });
              thead.appendChild(tr);
              table.insertBefore(thead, tbody);
            }

            tbody.innerHTML = "";

            // Gather rows from one or more categories
            const rows = [];
            cats.forEach((c) => {
              const arr = buckets.get(c);
              if (arr && arr.length) rows.push(...arr);
            });

            // Optional: de-dupe by feature id
            const uniq = new Map();
            rows.forEach((f) => uniq.set(String(f.id || ""), f));
            const finalRows = Array.from(uniq.values());

            // Keep stable order
            finalRows.sort((a, b) =>
              buildDropdownText_(a, payload).localeCompare(buildDropdownText_(b, payload))
            );

            finalRows.forEach((f) => {
              tbody.appendChild(buildRowForColumns_(f, payload, pageTitle, tableClass, columns));
            });

            finalRows.forEach(f => usedFeatureIds.add(String(f.id || ""))); // mark as used

            stopRowLinkPropagation(tbody);

            if (loading) loading.hidden = true;
            if (err) err.hidden = true;

            if (!finalRows.length) {
              const tr = document.createElement("tr");
              tr.innerHTML = `<td colspan="${Math.max(1, columns.length)}">No items found in this category yet.</td>`;
              tbody.appendChild(tr);
            }
          });

          // Add the unused POIs to "Other"
          const otherWrap = document.querySelector('.poi-table-wrap[data-poi-category*="other"]');
          if (otherWrap) {
            const table = otherWrap.querySelector("table");
            const tbody = table ? table.querySelector("tbody") : null;
            if (tbody) {
              tbody.innerHTML = "";
              // collect leftover rows from buckets that weren't referenced by any table
              const leftovers = [];

              for (const [cat, arr] of buckets.entries()) {
                if (cat === "other") continue;           // don't double-add
                if (usedCats.has(cat)) continue;         // table already exists for this category
                for (const f of arr) {
                  const id = String(f?.id || "");
                  if (!id || usedFeatureIds.has(id)) continue;
                  leftovers.push(f);
                }
              }

              // sort leftovers
              leftovers.sort((a, b) => buildDropdownText_(a, payload).localeCompare(buildDropdownText_(b, payload)));

              // append to Other table
              const columns = parseColumnsFromWrap_(otherWrap);
              leftovers.forEach((f) => {
                tbody.appendChild(buildRowForColumns_(f, payload, pageTitle, tableClass, columns));
              });

              stopRowLinkPropagation(tbody);
            }
          }



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
