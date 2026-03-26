/* ============================================================
   trailmap-events-and-ui.js
   - All map events / UI / helper functions
   - IMPORTANT: map click handler is wired AFTER markers exist
   ============================================================ */

let rotateEndTimer = null;

function wireMapEventsAfterMarkers_() {
  // drag / rotate / pitch / zoom
  map.on("dragend", () => {
    if (!flyToFeature) updatePageDetails();
  });

  map.on("rotateend", () => {
    if (!backButton) {
      if (typeof rotateEndTimer !== "undefined") {
        clearTimeout(rotateEndTimer);
      }
      rotateEndTimer = setTimeout(updateBearing, 500);
    }
  });

  map.on("pitchend", () => {
    if (!flyToFeature) updatePageDetails();
  });

  map.on("zoomend", () => {
    if (suppressMapEvents) return;
    if (!flyToFeature) updatePageDetails();

    // popup visibility restore/remove
    // slim schema: id is on the feature itself
    if (popupFeature?.id) {
      const found = addPopupBack();
      if (!found) forceClosePopups();
    }
  });

  // keep selected feature popup visible
  map.on("moveend", () => {
    if (suppressMapEvents) return;

    addPopupBack();

    // slim schema: id is on the feature itself
    if (flyToFeature?.id) {
      let zoomLevel = map.getZoom();
      if (zoomLevel > 22) {
        flyToFeature = null;
        return;
      }

      const targetId = String(flyToFeature.id);

      // rendered features may not include derived label fields; match by id only
      if (!map.getLayer("trail_markers")) return;
      const visible = map.queryRenderedFeatures({ layers: ["trail_markers"] });
      for (let x = 0; x < visible.length; x++) {
        const f = visible[x];
        if (String(f?.id) === targetId) {
          createPopUp(flyToFeature);
          flyToFeature = null;
          break;
        }
      }

      // If the marker still isn't rendered/visible, nudge zoom and try again
      if (flyToFeature) {
        zoomLevel = zoomLevel + 0.1;
        map.flyTo({
          center: flyToFeature.geometry.coordinates,
          zoom: zoomLevel,
          speed: 0.9,
          curve: 1,
          easing(t) {
            return t;
          }
        });
      }
    }
  });

  // hover cursor changes
  map.on("mousemove", "trail_markers", () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "trail_markers", () => {
    map.getCanvas().style.cursor = "";
  });

  // click handler (safe after layer exists)
  map.on("click", onMapClick_);
}

function clearSelection_() {
  // close popups
  const popUps = document.getElementsByClassName("mapboxgl-popup");
  if (popUps[0]) popUps[0].remove();
  popupFeature = null;

  removeActive();

  if (activeFeatureID) {
    // Only safe if the source still exists
    if (map.getSource("trail_markers_source")) {
      map.setFeatureState(
        { source: "trail_markers_source", id: activeFeatureID },
        { active: false }
      );
    }
    activeFeatureID = null;
  }
}

function onMapClick_(event) {
  closeSearchControl();

  if (map?.getLayer?.("monarch_way")) {
    const monarchHit = map.queryRenderedFeatures(event.point, {
      layers: ["monarch_way"]
    });
    if (monarchHit.length) return; // let monarch layer click handler run
  }

  // Guard against trail_markers not being there
  if (!map.getLayer("trail_markers")) {
    clearSelection_();
    return;
  }

  const features = map.queryRenderedFeatures(event.point, {
    layers: ["trail_markers"]
  });

  if (!features.length) {
    clearSelection_();
    return;
  }

  const clickedPoint = features[0];

  resetCoordinates = true;

  // flyToMarker expects a GeoJSON feature with .geometry.coordinates
  // Rendered features usually have it, but if yours doesn't, resolve from poiData by id.
  const clickedId = String(clickedPoint?.id ?? "");
  const fullFeature =
    clickedId && Array.isArray(poiData?.features)
      ? poiData.features.find((f) => String(f.id) === clickedId) || clickedPoint
      : clickedPoint;

  flyToMarker(fullFeature);
  updatePageDetails(fullFeature);

  resetCoordinates = false;

  // dropdown active class
  document
    .querySelectorAll(".activeOption")
    .forEach((el) => el.classList.remove("activeOption"));

  // slim schema: id is on the feature itself (not properties.id)
  const listing = document.getElementById(`listing-${clickedId}`);
  if (listing) listing.classList.add("activeOption");

  // Sync with listing table if present
  if (window.TrailmapListing && window.TrailmapListing.highlightAndScrollTo) {
    window.TrailmapListing.highlightAndScrollTo(clickedId);
  }
}

/* ============================================================
   Custome Search
   ============================================================ */

let SEARCH_READY = false;
let SEARCH_INDEX = [];        /* [{ id, label, desc, haystackLower }]*/
let SEARCH_MAX_OPTIONS = 80;

function buildSearchIndex_(data) {
  const features = Array.isArray(data?.features) ? data.features : [];
  SEARCH_INDEX = [];

  // ONLY_SHOW_LIST is a list of TYPE LABELS (defs.types[*].l)
  const allowedTypeKeys = getAllowedTypeKeysFromOnlyShow_(data);

  for (const feature of features) {
    const p = feature?.properties || {};
    const id = String(feature?.id ?? '').trim();
    if (!id) continue;

    const typeKey = String(p.t || '').trim();
    if (allowedTypeKeys && !allowedTypeKeys.has(typeKey)) continue;

    const typeDef = typeKey && data?.defs?.types ? data.defs.types[typeKey] : null;

    // Hybrid: server provides effective label/icon/color/sort on each feature
    const label = String(p.l || p.n || typeDef?.l || '').trim();
    if (!label) continue;

    const near = String(p.r || '').trim();

    // Effective description/link fields (POI overrides type)
    const desc = String(p.d || typeDef?.d || '').trim();
    const linkText = String(p.e || typeDef?.e || '').trim();
    const linkUrl = String(p.f || typeDef?.f || '').trim();

    // Keywords: POI + type
    const keywords = [p.k, typeDef?.k].filter(Boolean).map(String).join(' ').trim();

    const haystackLower = [
      label,
      near,
      desc,
      keywords,
      linkText,
      linkUrl
    ].filter(Boolean).join(' ').toLowerCase();

    SEARCH_INDEX.push({
      id,
      label,
      desc,
      typeKey,
      typeLabel: String(typeDef?.l || '').trim(),
      haystackLower
    });
  }

  SEARCH_READY = true;
}


function wireCustomSearchUI_() {
  const input = document.getElementById("locationListInput");
  const box = document.getElementById("locationListbox");
  const clear = document.getElementById("clearSearch");
  const wrap = document.getElementById("locationListDiv");

  if (!input || !box || !wrap) return;
  if (input.dataset.searchWired === "1") return;
  input.dataset.searchWired = "1";
  input.setAttribute("aria-label", "Search map POIs");

  let open = false;
  let activeIndex = -1;
  let lastResults = [];

  function setClearVisible(show) {
    if (!clear) return;
    clear.classList.toggle("visible", !!show);
  }

  function openBox() {
    if (!open) {
      open = true;
      box.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }
  }

  function closeBox() {
    open = false;
    activeIndex = -1;
    lastResults = [];
    box.hidden = true;
    input.setAttribute("aria-expanded", "false");
    box.innerHTML = "";
  }

  function render(results) {
    lastResults = results;
    activeIndex = results.length ? 0 : -1;

    if (!results.length) {
      box.innerHTML = `<div class="searchOption" aria-selected="false"><span class="label">No matches</span></div>`;
      openBox();
      return;
    }

    const html = results.map((r, i) => {
      const selected = i === activeIndex ? ` aria-selected="true"` : ` aria-selected="false"`;
      const descHtml = r.desc ? `<span class="desc">${escapeHtml_(r.desc)}</span>` : "";
      return `
       <div
         class="searchOption"
         role="option"
         id="search-opt-${r.id}"
         data-id="${escapeHtmlAttr_(r.id)}"
         data-idx="${i}"
         ${selected}
       >
         <span class="label">${normalizeText_(r.label)}</span>
       </div>`;
    }).join("");

    box.innerHTML = html;
    openBox();
    syncActiveAria();
  }

  function syncActiveAria() {
    // aria-activedescendant helps screen readers follow keyboard highlight
    if (activeIndex < 0 || !lastResults[activeIndex]) {
      input.removeAttribute("aria-activedescendant");
      return;
    }
    input.setAttribute("aria-activedescendant", `search-opt-${lastResults[activeIndex].id}`);

    // update row aria-selected
    const rows = box.querySelectorAll(".searchOption[role='option']");
    rows.forEach((el) => el.setAttribute("aria-selected", "false"));
    const activeEl = box.querySelector(`.searchOption[data-idx="${activeIndex}"]`);
    if (activeEl) activeEl.setAttribute("aria-selected", "true");
  }

  function getMatches(q) {
    if (!SEARCH_READY) return [];
    const query = (q || "").trim().toLowerCase();
    if (!query) return SEARCH_INDEX.slice(0, SEARCH_MAX_OPTIONS);

    const out = [];
    for (const item of SEARCH_INDEX) {
      if (item.haystackLower.includes(query)) {
        out.push(item);
        if (out.length >= SEARCH_MAX_OPTIONS) break;
      }
    }
    return out;
  }

  function selectByIndex(idx) {
    const item = lastResults[idx];
    if (!item) return;

    // keep your existing navigation flow
    activeFeatureID = item.id;

    const url = buildURL({ markerID: item.id }, false);
    if (window.location.href !== url) {
      window.history.pushState(null, document.title, url);
    }

    forcedClosePopup = true;
    goToElement(item.id);
    forcedClosePopup = false;

    // requested behavior: clear input, close dropdown
    input.value = "";
    setClearVisible(false);
    closeBox();
    closeSearchControl(); // uses your existing helper to close search UI
  }

  // Typing filters
  input.addEventListener("input", () => {
    const v = input.value || "";
    setClearVisible(v.trim().length > 0);
    render(getMatches(v));
  });

  // Focus shows initial list (after SEARCH_READY, but still “delayed” until user interacts)
  input.addEventListener("focus", () => {
    if (!SEARCH_READY) return;
    render(getMatches(input.value));
  });

  // Keyboard UX
  input.addEventListener("keydown", (e) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      render(getMatches(input.value));
    }

    if (!open) return;

    if (e.key === "Escape") {
      e.preventDefault();
      closeBox();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!lastResults.length) return;
      activeIndex = Math.min(activeIndex + 1, lastResults.length - 1);
      syncActiveAria();
      box.querySelector(`.searchOption[data-idx="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!lastResults.length) return;
      activeIndex = Math.max(activeIndex - 1, 0);
      syncActiveAria();
      box.querySelector(`.searchOption[data-idx="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
      return;
    }

    if (e.key === "Enter") {
      if (activeIndex >= 0) {
        e.preventDefault();
        selectByIndex(activeIndex);
      }
    }
  });

  // Mouse hover + click
  box.addEventListener("mousemove", (e) => {
    const opt = e.target.closest(".searchOption[role='option']");
    if (!opt) return;
    const idx = Number(opt.dataset.idx);
    if (!Number.isFinite(idx)) return;
    if (idx !== activeIndex) {
      activeIndex = idx;
      syncActiveAria();
    }
  });

  // mousedown (not click) prevents input blur-before-select
  box.addEventListener("mousedown", (e) => {
    const opt = e.target.closest(".searchOption[role='option']");
    if (!opt) return;
    e.preventDefault();
    const idx = Number(opt.dataset.idx);
    selectByIndex(idx);
  });

  // Clear button
  clear?.addEventListener("click", (e) => {
    e.preventDefault();
    input.value = "";
    setClearVisible(false);
    if (document.activeElement !== input) input.focus();
    if (SEARCH_READY) render(getMatches(""));
  });

  // Close when clicking outside
  document.addEventListener("mousedown", (e) => {
    if (!wrap.contains(e.target)) closeBox();
  });
}

function normalizeText_(s = "") {
  return String(s)
    .replace(/\u00A0/g, " ")   // real NBSP → normal space
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml_(s = "") {
  return String(s).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}
function escapeHtmlAttr_(s = "") {
  return escapeHtml_(s);
}

/* ============================================================
   Your existing functions (kept) — only minor let/const cleanup
   ============================================================ */

// timer event for MapBox bug - rotateEnd firing all the time
function updateBearing() {
  updatePageDetails();
}

// Add popups back when zooming in to the map and the icon appears
function addPopupBack() {
  let found = false;

  if (!map.getLayer("trail_markers")) return false;  // prevent mapbox errors

  // slim schema: id is on the feature itself
  if (popupFeature?.id) {
    const targetId = String(popupFeature.id);
    const visibleFeatures = map.queryRenderedFeatures({ layers: ["trail_markers"] });

    for (let x = 0; x < visibleFeatures.length; x++) {
      const vf = visibleFeatures[x];

      // match by id only (rendered features may not have old properties)
      if (String(vf?.id) === targetId) {
        const popUps = document.getElementsByClassName("mapboxgl-popup");
        if (!popUps || popUps.length < 1) createPopUp(popupFeature);
        found = true;
        break;
      }
    }
  }

  return found;
}

function flyToMarker(currentFeature, zoomLevel, coords) {
  forceClosePopups();

  let zl = zoomLevel;
  if (!zl) {
    zl = Number(map.getZoom().toFixed(URL_FIXED_NUMBER));
    if (zl < DEFAULT_FLYTO_ZOOM) zl = DEFAULT_FLYTO_ZOOM;
  }

  if (activeFeatureID) {
    map.setFeatureState({ source: 'trail_markers_source', id: activeFeatureID }, { active: false });
    activeFeatureID = null;
  }

  if (currentFeature?.id) {
    map.setFeatureState({ source: 'trail_markers_source', id: currentFeature.id }, { active: true });
  }

  flyToFeature = currentFeature;
  activeFeatureID = currentFeature.id;

  const flyToCords = coords || currentFeature.geometry.coordinates;

  map.flyTo({
    center: flyToCords,
    zoom: zl,
    speed: 0.9,
    curve: 1,
    easing(t) { return t; }
  });
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


function getPropertyDetails(prop, feature = null, payload = poiData) {
  if (!prop) return {};

  const typeKey = String(prop.t || '').trim();
  const typeDef = typeKey && payload?.defs?.types ? payload.defs.types[typeKey] : null;

  // Effective description (POI overrides type)
  const desc = String(prop.d || typeDef?.d || '').trim();

  // Effective link fields (POI overrides type)
  const linkText = String(prop.e || typeDef?.e || '').trim();
  const linkUrlRaw = String(prop.f || typeDef?.f || '').trim();
  const linkUrl = linkUrlRaw ? normalizeAbsUrl_(linkUrlRaw) : '';
  const includeLink = Boolean(linkUrl && !isSamePageUrl_(linkUrl));
  const external = includeLink && isExternalDomain_(linkUrl);

  // Image: POI.u > POI.m > type.u > type.m
  const imgUrl =
    normalizeSquarespaceAssetUrl_(prop.u) ||
    driveThumbFromId_(prop.m, 400) ||
    normalizeSquarespaceAssetUrl_(typeDef?.u) ||
    driveThumbFromId_(typeDef?.m, 400);

  // Build body HTML (desc + optional link)
  let bodyHtml = desc;
  if (includeLink && linkUrl) {
    const target = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    const text = linkText || 'Learn more';
    const linkHtml = `<a class="map-popup-link" href="${escapeHtml(linkUrl)}"${target}>${escapeHtml(text)}</a>`;
    bodyHtml = bodyHtml ? `${bodyHtml} ${linkHtml}` : linkHtml;
  }

  return {
    d: bodyHtml,
    icon: imgUrl
  };
}

function getCategoryDefaults_(category, feature = null) {
  switch (category) {
    case "bicycle-15":
      return {
        d: "Basic tools for repairing your bike including a pump for your tires.",
        icon: "/s/Bike_Icon.png"
      };

    case "information":
      return {
        d: "Information about the trail and upcoming events are posted here.",
        icon: "/s/Information_Icon.png"
      };

    case "parking":
      return {
        // leave d blank if you don’t want boilerplate
        icon: "https://assets.northaventrail.org/img/Parking_Icon.avif"
      };

    case "water":
      return {
        d: "A water fountain for humans and another one for dogs.",
        icon: "/s/Drinking_Icon.png",
        icon2: "/s/Pet_Drinking_Icon.png"
      };

    case "garden":
      const adoptAGardenPath = "/adoptgarden";
      const isOnGardenPage =
        window.location.pathname.replace(/\/$/, "") === adoptAGardenPath;

      const additionalText = !isOnGardenPage
        ? `Sign up <a class="map-popup-link" target="_blank" href="https://northaventrail.org/adoptgarden">here</a>.`
        : "Sign up below.";
      return {
        additionalText: additionalText,
        icon: "https://drive.google.com/thumbnail?id=1UwacGgwVwILtZZSJj35-KYmKnSA5jcut&sz=w400"
      }

    // Add more categories as you need:
    // case "waste-basket":
    // case "garden":
    // case "mural":
    // case "bridge":
    // case "traffic-light":

    default:
      return {};
  }
}

function createPopUp(currentFeature) {
  forceClosePopups();
  popupFeature = currentFeature;

  // Resolve to full feature (rendered features sometimes lack full data)
  const idStr = String(currentFeature?.id ?? "");
  const fullFeature =
    idStr && Array.isArray(poiData?.features)
      ? poiData.features.find((f) => String(f.id) === idStr) || currentFeature
      : currentFeature;

  const coords = fullFeature?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return;

  const lng = Number(coords[0]);
  const lat = Number(coords[1]);

  const p = fullFeature.properties || {};
  const title = String(p.l || p.n || '').trim();
  const typeKey = p.t;
  const typeDef = typeKey && poiData?.defs?.types ? poiData.defs.types[typeKey] : null;

  const iconName = String(typeDef?.i || "");
  const labelName = String(p.l || typeDef?.l || '');
  const mapLatLng = `${lat},${lng}`;

  const propertyDetails = getPropertyDetails(p);
  const imageURL = propertyDetails.icon || "";
  const body = propertyDetails.d || String(p.d || "").trim() || "";

  const googleHref = `${GOOGLE_MAP_URL}${mapLatLng}`;
  const appleHref = `${APPLE_MAP_URL}${mapLatLng}`;

  const showNav = true;

  // If Listing Table is there:
  window.TrailmapListing?.highlightFeature?.(idStr);

  const html = `
  <div class="map-popup ${imageURL ? "has-image" : "no-image"}">
    <div class="map-popup-row">
      ${imageURL
      ? `<div class="map-popup-image">
               <img src="${imageURL}" width="64" height="64"
                    alt="${escapeHtml(labelName || "Marker")}" loading="lazy">
             </div>`
      : ""
    }

      <div class="map-popup-body">
        ${title
      ? `<div class="map-popup-header">${title}</div>`
      : ""
    }
        ${body
      ? `<div class="map-popup-text">${body}</div>`
      : ""
    }
      </div>
    </div>

    ${showNav
      ? `<div class="map-popup-actions" tabindex="-1">
             <a tabindex="-1" style="display:none"></a>
             <a class="popupIconLink" title="Open in Google Maps" aria-label="Open in Google Maps" href="${googleHref}">
               <svg aria-hidden="true" class="popupIcon googleMapButton"><use href="#google-logo"></use></svg>
             </a>
             <a class="popupIconLink" title="Open in Apple Maps" aria-label="Open in Apple Maps" href="${appleHref}">
               <svg aria-hidden="true" class="popupIcon"><use href="#apple-logo"></use></svg>
             </a>
             <button class="popupIconLink shareButton" type="button" title="Share" aria-label="Share">
                <svg aria-hidden="true" class="popupIcon">
                  <use href="#share-icon"></use>
                </svg>
              </button>
           </div>`
      : ""
    }
  </div>
`;

  const popup = new mapboxgl.Popup({
    closeOnClick: false,
    offset: POP_UP_OFFSET,
    maxWidth: POP_UP_MAX_WIDTH
  });

  const safe = toLngLat_(coords, null);
  if (!safe) return;
  popup.setLngLat(safe);
  popup.setHTML(html);

  popup.on("open", () => {
    // We removed document.activeElement.blur() to allow focus to flow normally 
    // for keyboard and screen reader users.

    const popupEl = popup.getElement();
    if (!popupEl) return;

    // prevent double-binding if something weird re-triggers open
    if (popupEl.dataset.shareWired === "1") return;
    popupEl.dataset.shareWired = "1";

    // Delegate: catches clicks on <a>, <svg>, <use>, etc.
    popupEl.addEventListener("click", (e) => {
      const share = e.target?.closest?.(".shareButton");
      if (!share) return;

      e.preventDefault();
      e.stopPropagation();

      // Use real values (don’t rely on inline onclick="clickShare()")
      clickShare(
        "Northaven Trail Map",
        title ? `${title} on the Northaven Trail` : "Northaven Trail Map",
        buildURL({ markerID: idStr, markerTitle: title }, true)
      );
    }, { passive: false });
  });

  popup.on("close", () => {
    if (activeFeatureID) {
      map.setFeatureState(
        { source: "trail_markers_source", id: activeFeatureID },
        { active: false }
      );
    }
    activeFeatureID = null;
    popupFeature = null;

    // If Listing Table is there:
    window.TrailmapListing?.clearActiveFeature?.();

    if (!forcedClosePopup) {
      resetPageDetails();
    }

    removeActive();
  })

  popup.addTo(map);
}

/* Minimal HTML escaper (keep your existing one if you already have it) */
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
/* ---------- URL + filter helpers (kept) ---------- */

/**
 * Return the human-readable label for a POI.
 * Hybrid schema priority:
 *  1) feature.properties.l  (server-computed effective label)
 *  2) feature.properties.n  (explicit POI name, if different)
 *  3) defs.types[t].l       (type label fallback)
 *  4) feature.id            (last-resort)
 */

function driveThumbFromId_(id, w = 400) {
  const s = String(id || "").trim();
  if (!s) return "";
  // Accept either full Drive URL or an ID
  const m = s.match(/(?:id=)([a-zA-Z0-9_-]{10,})/) || s.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  const driveId = m ? m[1] : s;
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveId)}&sz=w${Number(w) || 400}`;
}

function normalizeAbsUrl_(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  try {
    return new URL(s, location.href).toString();
  } catch {
    return s; // leave as-is if it can’t parse
  }
}

function isSamePageUrl_(u) {
  try {
    const url = new URL(String(u || ""), location.href);
    const here = new URL(location.href);
    // treat same origin+path as “same page” (ignore query/hash)
    return url.origin === here.origin && url.pathname.replace(/\/+$/, "") === here.pathname.replace(/\/+$/, "");
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

/**
 * Hybrid resolver: POI props override type defaults.
 * Returns all “effective” fields needed for popup/list/search.
 */
function resolvePoi_(feature, data) {
  const p = feature?.properties || {};
  const t = String(p.t || "").trim();
  const td = (data?.defs?.types && t) ? (data.defs.types[t] || {}) : {};

  const label = String(p.l || p.n || td.l || feature?.id || "Location").trim();
  const desc = String(p.d || td.d || "").trim();

  const linkText = String(p.e || td.e || "").trim();
  const linkUrlRaw = String(p.f || td.f || "").trim();
  const linkUrl = linkUrlRaw ? normalizeAbsUrl_(linkUrlRaw) : "";

  const includeLink = Boolean(linkUrl && !isSamePageUrl_(linkUrl));
  const externalLink = includeLink && isExternalDomain_(linkUrl);

  const imgUrl =
    normalizeSquarespaceAssetUrl_(p.u) ||
    driveThumbFromId_(p.m, 400) ||
    normalizeSquarespaceAssetUrl_(td.u) ||
    driveThumbFromId_(td.m, 400) ||
    "";

  const keywords = [p.k, td.k].filter(Boolean).map(String).join(" ").trim();

  const iconName = String(p.i || td.i || "").trim();
  const color = String(p.c || td.c || "").trim();
  const sort = (p.s !== undefined && p.s !== null && p.s !== "")
    ? Number(p.s)
    : Number(td.s);

  return {
    id: String(feature?.id ?? ""),
    typeKey: t,
    label,
    desc,
    linkText,
    linkUrl,
    includeLink,
    externalLink,
    imgUrl,
    keywords,
    iconName,
    color,
    sort: Number.isFinite(sort) ? sort : undefined
  };
}

function buildDropdownText_(feature, data) {
  // In the hybrid file, dropdown should basically be the label.
  return resolvePoi_(feature, data).label;
}


function filterData(filter) {
  const layerId = "trail_markers";

  if (!map?.getLayer?.(layerId)) {
    console.warn("Layer not ready / not found:", layerId);
    return;
  }

  if (!filter) {
    map.setFilter(layerId, startupFilter);
    dataFilter = startupFilter;
    return;
  }

  const filterLabels = normalizeOnlyShowListLabels_(filter);

  if (!filterLabels?.length) {
    map.setFilter(layerId, null);
    dataFilter = null;
    return;
  }

  const matchingTypeKeys = typeKeysForLabels_(poiData, filterLabels);

  if (!matchingTypeKeys.length) {
    console.warn("No types found for labels:", filterLabels);
    map.setFilter(layerId, ["==", ["get", "t"], "__no_match__"]);
    dataFilter = "__no_match__";
    return;
  }

  const filterExpression = ["in", ["get", "t"], ["literal", matchingTypeKeys]];

  forceClosePopups();
  map.setFilter(layerId, filterExpression);

  dataFilter = filterLabels;
}


/* ============================================================
   UI / URL / Popup / Search helpers
   ============================================================ */

function resetPageDetails() {
  const pageTitle = PAGE_TITLE;
  const url = buildURL();

  if (!backButton && window.location.href !== url) {
    window.history.pushState(null, pageTitle, url);
  }

  updatePageTitle(pageTitle);
  setShareButton();

  const googleMapsEl = document.getElementById('googleMaps');
  const appleMapsEl = document.getElementById('applesMaps');

  if (googleMapsEl) googleMapsEl.style.display = 'none';
  if (appleMapsEl) appleMapsEl.style.display = 'none';
}

/* ------------------------------------------------------------ */

function updatePageDetails(object) {
  if (typeof ONLY_SHOW_LIST !== "undefined" && ONLY_SHOW_LIST !== null) return;
  if (typeof DONT_UPDATE_URL !== "undefined" && DONT_UPDATE_URL) return;

  let markerID = null;
  let markerTitle = "";

  // Helpers: build map links from coords
  const setMapLinksFromCoords_ = (lng, lat) => {
    if (!isFiniteNumber_(lng) || !isFiniteNumber_(lat)) return;

    const coords = `${lat},${lng}`; // maps expect lat,lng
    const googleBtn = document.getElementById("googleMapsButton");
    const googleWrap = document.getElementById("googleMaps");

    if (googleBtn) googleBtn.setAttribute("href", GOOGLE_MAP_URL + coords);
    if (googleWrap) googleWrap.style.display = "";

    if (isApple()) {
      const appleBtn = document.getElementById("appleMapsButton");
      const appleWrap = document.getElementById("applesMaps");

      if (appleBtn) appleBtn.setAttribute("href", APPLE_MAP_URL + coords);
      if (appleWrap) appleWrap.style.display = "";
    }
  };

  const hideMapLinks_ = () => {
    const googleWrap = document.getElementById("googleMaps");
    const appleWrap = document.getElementById("applesMaps");
    if (googleWrap) googleWrap.style.display = "none";
    if (appleWrap) appleWrap.style.display = "none";
  };

  // ─────────────────────────────────────────
  // If a feature object is provided (new slim schema)
  // ─────────────────────────────────────────
  if (object && (object.id !== undefined && object.id !== null)) {
    markerID = String(object.id);

    // slim fields
    markerTitle = String(object?.properties?.n || "").trim();

    // derive map links from geometry (no more stored URLs)
    const coords = object?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length === 2) {
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      setMapLinksFromCoords_(lng, lat);
    } else {
      hideMapLinks_();
    }
  } else {
    // ─────────────────────────────────────────
    // No feature object: derive from URL params (existing behavior)
    // ─────────────────────────────────────────
    const params = getURLParams();
    markerID = params?.[LOCATION_PARM] ? String(params[LOCATION_PARM]) : null;
    markerTitle = params?.[PAGE_TITLE_PARM] || "";

    // If URL has explicit lat/lng, show map links
    if (params?.lat && params?.lng) {
      setMapLinksFromCoords_(Number(params.lng), Number(params.lat));
    } else {
      hideMapLinks_();
    }
  }

  // ─────────────────────────────────────────
  // Title + URL + share
  // ─────────────────────────────────────────
  let pageTitle = PAGE_TITLE;
  if (markerTitle) pageTitle = `${markerTitle} - ${PAGE_TITLE}`;

  const url = buildURL({ markerID, markerTitle });

  if (!backButton && window.location.href !== url) {
    window.history.pushState(null, pageTitle, url);
  }

  updatePageTitle(pageTitle);

  if (markerTitle) {
    const text = `${markerTitle} on the Northaven Trail`;
    setShareButton("Northaven Trail Map", text, buildURL({ markerID, markerTitle }, true));
  } else {
    setShareButton();
  }
}

function isFiniteNumber_(n) {
  const x = Number(n);
  return Number.isFinite(x);
}

/* ------------------------------------------------------------ */

function buildURL(urlParams = {}, makeShort = false) {
  let url = `${location.origin}${location.pathname}`;

  if (typeof DONT_UPDATE_URL !== "undefined" && DONT_UPDATE_URL) {
    return url
  };


  let joiner = "?";

  const params = getURLParams();

  if (activeFeatureID) {
    url += `${joiner}${LOCATION_PARM}=${encodeURIComponent(activeFeatureID)}`;
    joiner = "&";

    // Find the feature using feature.id (not feature.properties.id)
    const features = Array.isArray(poiData?.features) ? poiData.features : [];
    const activeIdStr = String(activeFeatureID);

    for (const feature of features) {
      if (String(feature?.id) === activeIdStr) {
        // dropDownText -> properties.n
        const titleText = String(feature?.properties?.l || feature?.properties?.n || "").trim();
        const pt = window.btoa(`${titleText} - ${PAGE_TITLE}`);

        if (!makeShort) {
          url += `${joiner}${PAGE_TITLE_PARM}=${encodeURIComponent(pt)}`;
          joiner = "&";
        }
        break;
      }
    }
  }

  const zoom = map.getZoom().toFixed(URL_FIXED_NUMBER);
  if (parseFloat(zoom) !== parseFloat(DEFAULT_ZOOM)) {
    url += `${joiner}${ZOOM_PARM}=${zoom}`;
    joiner = "&";
  }

  const bearing = map.getBearing().toFixed(URL_FIXED_NUMBER);
  if (parseFloat(bearing) !== DEFAULT_BEARING) {
    url += `${joiner}${BEARING_PARAM}=${bearing}`;
    joiner = "&";
  }

  const pitch = map.getPitch().toFixed(URL_FIXED_NUMBER);
  if (parseFloat(pitch) !== DEFAULT_PITCH) {
    url += `${joiner}${PITCH_PARAM}=${pitch}`;
    joiner = "&";
  }

  const sat = map.getLayer("mapbox-satellite")
    ? map.getLayoutProperty("mapbox-satellite", "visibility")
    : DEFAULT_SATELLITE;
  if (sat !== DEFAULT_SATELLITE) {
    url += `${joiner}${SATELLITE_PARAM}=${sat}`;
    joiner = "&";
  }

  if (!resetCoordinates) {
    const c = map.getCenter();
    const coords = [c.lng.toFixed(URL_FIXED_NUMBER), c.lat.toFixed(URL_FIXED_NUMBER)];

    if (
      parseFloat(coords[0]) !== parseFloat(DEFAULT_COORDS[0]) ||
      parseFloat(coords[1]) !== parseFloat(DEFAULT_COORDS[1])
    ) {
      url += `${joiner}${COORDINATES_PARM}=${coords}`;
      joiner = "&";
    }
  }

  if (dataFilter) {
    url += `${joiner}${GROUP_FILTER_PARAM}=${window.btoa(dataFilter)}`;
  }

  return url;
}

/* ------------------------------------------------------------ */

// Cache URL params between navigations — invalidated on pushState
let _urlParamsCache = null;
(function () {
  const _orig = history.pushState.bind(history);
  history.pushState = function (...args) {
    _urlParamsCache = null;
    return _orig(...args);
  };
})();

function getURLParams() {
  if (_urlParamsCache) return _urlParamsCache;
  const result = {};
  const params = new URLSearchParams(window.location.search);

  for (const [key, value] of params.entries()) {
    result[key] = decodeURIComponent(value);
  }

  if (result[PAGE_TITLE_PARM]) {
    try { result[PAGE_TITLE_PARM] = window.atob(result[PAGE_TITLE_PARM]); }
    catch { delete result[PAGE_TITLE_PARM]; }
  }

  if (result[COORDINATES_PARM]) {
    const [lng, lat] = result[COORDINATES_PARM].split(',');
    result.lng = lng;
    result.lat = lat;
    result[COORDINATES_PARM_ARRAY] = [lng, lat];
  }

  if (result[GROUP_FILTER_PARAM]) {
    try { result[GROUP_FILTER_PARAM] = window.atob(result[GROUP_FILTER_PARAM]); }
    catch { delete result[GROUP_FILTER_PARAM]; }
  }

  _urlParamsCache = result;
  return result;
}

window.initTrailmapSearch = function initTrailmapSearch(map) {
  const inputDiv = document.getElementById("locationListDiv");
  const input = document.getElementById("locationListInput");

  // NEW: custom dropdown panel (replaces <datalist>)
  const listbox = document.getElementById("locationListbox");

  // If the page doesn’t have the search HTML, just no-op.
  if (!inputDiv || !input || !listbox) return;

  // Optional but recommended aria wiring (if you didn’t already add these in HTML)
  input.setAttribute("aria-controls", "locationListbox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");

  // Install the map control button (magnifier) if not already present
  if (!document.getElementById("searchButton")) {
    class SearchCustomControl {
      onAdd(mapInstance) {
        this.map = mapInstance;
        this.container = document.createElement("div");
        this.container.className = "search-custom-control";

        const el = document.createElement("img");
        el.id = "searchButton";
        el.src = "https://assets.northaventrail.org/img/searchOff.avif";
        el.role = "button";
        el.ariaLabel = "Search the trail for points of interest";
        el.tabIndex = 0;
        el.alt = "Search";
        el.title = "Search the trail for points of interest";

        el.addEventListener("click", () => {
          if (inputDiv.classList.contains("visible")) {
            closeSearchControl();
            el.src = "https://assets.northaventrail.org/img/searchOff.avif";
            el.title = "Search the trail for points of interest";
          } else {
            // Close other popups
            forceClosePopups();

            inputDiv.style.display = "";
            inputDiv.classList.add("visible");

            // IMPORTANT: allow dropdown to extend (you’ll also do this via CSS)
            // inputDiv.style.overflow = "visible";

            el.src = "https://assets.northaventrail.org/img/searchOnMouseOver.avif";
            if (!isMobile()) input.focus();
            el.title = "Hide search";
          }
        });

        el.addEventListener("mouseover", () => {
          this.container.style.backgroundColor = 'rgba(0,0,0,0.05)';
        });

        el.addEventListener("mouseout", () => {
          this.container.style.backgroundColor = '';
        });

        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault(); // prevents page scroll on Space
            el.click();
          }
        });

        this.container.appendChild(el);
        return this.container;
      }
      onRemove() {
        this.container?.parentNode?.removeChild(this.container);
        this.map = undefined;
      }
    }

    map.addControl(new SearchCustomControl(), "top-left");
  }

  // NEW: wire the custom search behavior (replaces datalist-based wiring)
  // This should be idempotent (your function should guard against double-wiring).
  if (typeof wireCustomSearchUI_ === "function") {
    wireCustomSearchUI_();
  } else {
    console.warn("wireCustomSearchUI_ is not defined");
  }
};


/* ------------------------------------------------------------ */

function setupLegendClickedFor_(legendEl) {
  if (!legendEl) return;

  if (legendEl.dataset.legendClicksWired === "1") return;
  legendEl.dataset.legendClicksWired = "1";

  const items = legendEl.querySelectorAll(".legendElement.clickable");

  items.forEach((el) => {
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "button");

    el.addEventListener("click", () => {
      const filter = el.dataset.filter;
      if (!filter) return;

      // Toggle active
      if (el.classList.contains("active")) {
        el.classList.remove("active");
        filterData(null);
      } else {
        items.forEach((o) => o.classList.remove("active"));
        el.classList.add("active");
        filterData(filter);
      }
      el.setAttribute("aria-pressed", String(el.classList.contains("active")));

      updatePageDetails?.();
      legendEl.classList.remove("visible");
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault(); // prevents page scroll on Space
        el.click();
      }
    });
  });
}

/* ------------------------------------------------------------ */
let currentFocus = -1;
function addActive(options) {
  removeActive();
  if (currentFocus >= options.length) currentFocus = 0;
  if (currentFocus < 0) currentFocus = options.length - 1;
  options[currentFocus]?.classList.add('activeOption');
}

function removeActive() {
  document.querySelectorAll('.activeOption')
    .forEach(el => el.classList.remove('activeOption'));
}

/* ------------------------------------------------------------ */

const isApple = () => /(Mac|iPhone|iPad|iPod)/i.test(navigator.platform);
const isSafari = () =>
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
const isMobile = () =>
  /(iPhone|Android|BlackBerry|Windows Phone)/i.test(navigator.userAgent);

/* ------------------------------------------------------------ */

function clickShare(title, text, url) {
  if (!navigator.share) {
    return;
  }

  const payload = {
    title: String(title || "Northaven Trail"),
    text: String(text || ""),
    url: String(url || location.href)
  };

  navigator.share(payload).catch(err => {
    console.log("Share rejected:", err?.name);
  });
}

/* ------------------------------------------------------------ */

function forceClosePopups() {
  const popups = document.getElementsByClassName('mapboxgl-popup');
  while (popups.length) {
    forcedClosePopup = true;
    popups[0].remove();
    forcedClosePopup = false;
  }
  popupFeature = null;
}

function closeSearchControl() {
  const inputDiv = document.getElementById("locationListDiv");
  const input = document.getElementById("locationListInput");
  const box = document.getElementById("locationListbox");

  inputDiv?.classList.remove("visible");
  if (box) box.hidden = true;
  if (input) input.setAttribute("aria-expanded", "false");
}

function toFiniteNumber_(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toLngLat_(arr, fallback) {
  if (!Array.isArray(arr) || arr.length !== 2) return fallback;
  const lng = Number(arr[0]);
  const lat = Number(arr[1]);
  return (Number.isFinite(lng) && Number.isFinite(lat)) ? [lng, lat] : fallback;
}

function goToElement(idOverride = null) {
  if (suppressMapEvents) return;

  const params = getURLParams();
  const hasParams = params && Object.keys(params).length > 0;

  // Resolve target ID:
  // 1) explicit override (search)
  // 2) URL param (existing behavior)
  const targetId = idOverride ?? params?.[LOCATION_PARM];

  // ─────────────────────────────────────────
  // No params + no override → reset map
  // ─────────────────────────────────────────
  if (!targetId && !hasParams) {
    forceClosePopups();

    if (activeFeatureID) {
      map.setFeatureState(
        { source: "trail_markers_source", id: activeFeatureID },
        { active: false }
      );
      activeFeatureID = null;
    }

    map.setBearing(DEFAULT_BEARING);
    map.setPitch(DEFAULT_PITCH);
    map.setLayoutProperty("mapbox-satellite", "visibility", DEFAULT_SATELLITE);

    map.flyTo({
      center: DEFAULT_COORDS,
      zoom: DEFAULT_ZOOM,
      speed: 0.9,
      curve: 1,
      easing(t) {
        return t;
      }
    });

    return;
  }

  // ─────────────────────────────────────────
  // Apply bearing / pitch / satellite
  // ─────────────────────────────────────────
  map.setBearing(toFiniteNumber_(params?.[BEARING_PARAM], DEFAULT_BEARING));
  map.setPitch(toFiniteNumber_(params?.[PITCH_PARAM], DEFAULT_PITCH));
  map.setLayoutProperty(
    "mapbox-satellite",
    "visibility",
    params?.[SATELLITE_PARAM] ?? DEFAULT_SATELLITE
  );

  // ─────────────────────────────────────────
  // Fly to coordinates (no marker)
  // ─────────────────────────────────────────
  if (
    !targetId &&
    (params?.[COORDINATES_PARM_ARRAY] || params?.[ZOOM_PARM])
  ) {
    map.flyTo({
      center: toLngLat_(params?.[COORDINATES_PARM_ARRAY], DEFAULT_COORDS),
      zoom: toFiniteNumber_(params?.[ZOOM_PARM], DEFAULT_ZOOM),
      speed: 0.9,
      curve: 1,
      easing(t) { return t; }
    });
    return;
  }

  // ─────────────────────────────────────────
  // Fly to marker (URL OR override)
  // ─────────────────────────────────────────
  const features = Array.isArray(poiData?.features) ? poiData.features : [];
  if (targetId && features.length) {
    const targetStr = String(targetId);

    for (let i = 0; i < features.length; i++) {
      const feature = features[i];

      // ✅ slim schema: id is on feature.id
      if (String(feature?.id) === targetStr) {
        const zoom = params?.[ZOOM_PARM] ?? DEFAULT_FLYTO_ZOOM;

        const coords =
          params?.[COORDINATES_PARM_ARRAY] ??
          feature?.geometry?.coordinates;
        if (!coords || coords.length !== 2) return;
        flyToMarker(feature, zoom, coords);
        updatePageDetails(feature); // ensure this reads feature.properties.n / d now
        break;
      }
    }
  }
}

function updatePageTitle(pageTitle) {
  return;
}

function setShareButton(title, text, url) {
  const el = document.getElementById("share-button");
  if (!el) return;

  const shareTitle = title?.trim() || "Northaven Trail Map";
  const shareText = text?.trim() || "Here is a map of the Northaven Trail";
  const shareUrl = url?.trim() || buildURL(undefined, true);

  el.setAttribute("share-title", shareTitle);
  el.setAttribute("share-text", shareText);
  el.setAttribute("share-url", shareUrl);
}

function fitBoundsSilently(bounds, options = {}) {
  suppressMapEvents = true;

  map.fitBounds(bounds, {
    //duration: 0,   // no animation (optional)
    ...options
  });

  // set defaults derived from bounds-based init
  DEFAULT_ZOOM = Number(map.getZoom().toFixed(URL_FIXED_NUMBER));
  const latLng = map.getCenter();
  DEFAULT_COORDS = [
    Number(latLng.lng.toFixed(URL_FIXED_NUMBER)),
    Number(latLng.lat.toFixed(URL_FIXED_NUMBER))
  ];

  // clear flag after the map settles
  map.once("idle", () => {
    suppressMapEvents = false;
  });
}

////////////////////////////////////
// Setup the Legend               //
////////////////////////////////////


// Normalize ONLY_SHOW_LIST into an array of TYPE LABEL strings.
function normalizeOnlyShowListLabels_(value) {
  if (value === undefined || value === null) return null;

  const normalize = v =>
    String(v)
      .trim()
      .toLowerCase();

  if (Array.isArray(value)) {
    const out = value.map(normalize).filter(Boolean);
    return out.length ? out : null;
  }

  if (typeof value === "string") {
    const s = normalize(value);
    return s ? [s] : null;
  }

  return null;
}
// Backwards-compatible alias (older code called normalizeOnlyShowList)
function normalizeOnlyShowList(value) {
  return normalizeOnlyShowListLabels_(value);
}


function buildAllowedTypeKeySetByLabels_(data, labelSetLower) {
  const out = new Set();
  const types = data?.defs?.types || {};
  for (const [typeKey, def] of Object.entries(types)) {
    const l = String(def?.l || '').trim().toLowerCase();
    if (l && labelSetLower.has(l)) out.add(typeKey);
  }
  return out;
}

function getAllowedTypeKeysFromOnlyShow_(data) {
  const raw = (typeof ONLY_SHOW_LIST !== 'undefined') ? ONLY_SHOW_LIST : null;
  const labels = normalizeOnlyShowListLabels_(raw);
  if (!labels) return null;

  const labelSetLower = new Set(labels.map(x => String(x).trim().toLowerCase()).filter(Boolean));
  const allowed = buildAllowedTypeKeySetByLabels_(data, labelSetLower);

  // If defs.types is missing/empty, we can’t map labels -> keys; do not filter.
  if (!allowed.size) return null;
  return allowed;
}

function typeKeysForLabels_(data, labels) {
  const list = normalizeOnlyShowListLabels_(labels);
  if (!list) return [];
  const setLower = new Set(list.map(s => String(s).trim().toLowerCase()).filter(Boolean));
  return Array.from(buildAllowedTypeKeySetByLabels_(data, setLower));
}

// Build the legend from the json data
function buildFilterableLegendItemsFromTypes_(data, options = {}) {
  const {
    onlyShowLabels = null,     // array of labels (already normalized/lowercase is fine)
    requireIcon = true,        // only include types that have i
    defaultClickable = true,
    // optional: allow a type to opt-out via a property like `h: true` (hide)
    hideKey = "h"              // if def[h] truthy -> skip
  } = options;

  const types = data?.defs?.types || {};
  if (!types || typeof types !== "object") return [];

  const onlySet = Array.isArray(onlyShowLabels) && onlyShowLabels.length
    ? new Set(onlyShowLabels.map(s => String(s).trim().toLowerCase()).filter(Boolean))
    : null;

  const items = [];

  for (const [typeKey, def] of Object.entries(types)) {
    if (!def || typeof def !== "object") continue;

    // optional opt-out
    if (hideKey && def[hideKey]) continue;

    const label = String(def.l || "").trim();
    if (!label) continue;

    if (onlySet && !onlySet.has(label.toLowerCase())) continue;

    const iconRaw = String(def.i || "").trim();   // NEW: your json "i" property
    if (requireIcon && !iconRaw) continue;

    // normalize Squarespace-style asset keys/paths into a usable URL
    const iconUrl = iconRaw ? normalizeSquarespaceAssetUrl_(iconRaw) : "";

    // sort: prefer def.s, else label
    const sort = (def.s !== undefined && def.s !== null && def.s !== "")
      ? Number(def.s)
      : undefined;

    items.push({
      typeKey,
      label,
      iconUrl,                 // used to set background-image
      clickable: defaultClickable,
      sort: Number.isFinite(sort) ? sort : undefined
    });
  }

  // stable ordering: sort asc by sort (if present), then alpha label
  items.sort((a, b) => {
    const as = Number.isFinite(a.sort) ? a.sort : Number.POSITIVE_INFINITY;
    const bs = Number.isFinite(b.sort) ? b.sort : Number.POSITIVE_INFINITY;
    if (as !== bs) return as - bs;
    return a.label.localeCompare(b.label);
  });

  return items;
}



function addNotFullScreenClass(isFullscreen) {
  const legend = document.getElementById("map-legend");
  if (!legend) return;

  legend.classList.toggle("notFullScreen", !isFullscreen);
}

// Creates the legend DOM only if it doesn't exist already.
// Call this BEFORE setupLegendClicked2() is invoked.
function ensureLegendExists(options = {}) {
  const {
    mountEl = null,
    mountId = "map",
    legendId = "map-legend",
    headerId = "legendHeader",
    bodyId = "hideLegend",
    startCollapsed = true,
    onlyShow = null // pass your normalized ONLY_SHOW_LIST array here (or null)
  } = options;

  const mount = mountEl || (mountId ? document.getElementById(mountId) : null);
  if (!mount) {
    console.warn("[Legend] mount not found");
    return;
  }

  // If it already exists in this mount, return it
  const existing = mount.querySelector(`#${legendId}`);
  if (existing) return existing;

  // ---------------------------
  // Build visible legend items
  // ---------------------------
  const BASE_ALWAYS_ITEMS = [
    { iconName: "existing_trail", label: "Existing Trail", iconClass: "legend_existing_trail", clickable: false },
    { iconName: "expansion_trail", label: "Future Expansions", iconClass: "legend_future_expansions", clickable: false }
  ];

  const showMonarch =
    typeof SHOW_MONARCH_WAY !== "undefined" && !!SHOW_MONARCH_WAY;

  const ALWAYS_ITEMS = [
    ...BASE_ALWAYS_ITEMS,
    ...(showMonarch
      ? [{
        iconName: "monarch_way",
        label: "Monarch Way",
        iconClass: "legend_monarch_way",
        clickable: false
      }]
      : [])
  ];

  const only = Array.isArray(onlyShow)
    ? onlyShow.map(String)
    : null;

  const filterableItemsFromJson = buildFilterableLegendItemsFromTypes_(poiData, {
    onlyShowLabels: only,
    requireIcon: true,     // if you want to hide types with no icon
    defaultClickable: true,
    hideKey: "h"           // optional; harmless if not present in defs
  });

  const visibleItems = [...ALWAYS_ITEMS, ...filterableItemsFromJson];

  // ---------------------------
  // Build DOM
  // ---------------------------
  const legend = document.createElement("div");
  legend.id = legendId;
  legend.className = "legend notFullScreen";
  if (!startCollapsed) legend.classList.add("visible");

  const header = document.createElement("div");
  header.id = headerId;
  header.className = "legend-header";
  const headerBtn = document.createElement("button");
  headerBtn.textContent = "Legend";
  header.appendChild(headerBtn);
  legend.appendChild(header);

  const body = document.createElement("div");
  body.id = bodyId;

  visibleItems.forEach((it) => {
    const row = document.createElement("div");
    row.className = "legendElement" + (it.clickable ? " clickable" : "");
    row.dataset.filter = it.clickable ? it.label.toLowerCase() : "";

    const icon = document.createElement("div");
    icon.className = "legendIcon";
    icon.setAttribute("aria-hidden", "true");

    // Set background icon
    if (it.iconUrl) {
      icon.style.backgroundImage = `url("${it.iconUrl}")`;
      icon.style.backgroundRepeat = "no-repeat";
      icon.style.backgroundPosition = "center";
      icon.style.backgroundSize = "contain";
    } else if (it.iconClass) {
      // keep backwards compatibility for ALWAYS_ITEMS that still use CSS classes
      icon.className = "legendIcon " + it.iconClass;
    }

    const label = document.createElement("span");
    label.className = "legendLabel";
    label.textContent = it.label || "";

    row.appendChild(icon);
    row.appendChild(label);
    body.appendChild(row);
  });

  legend.appendChild(body);
  mount.appendChild(legend);

  return legend;
}

class LegendControl {
  onAdd(map) {
    this._map = map;
    this._container = document.createElement("div");
    this._container.className = "mapboxgl-ctrl";

    const onlyShowList =
      (typeof ONLY_SHOW_LIST !== "undefined" && ONLY_SHOW_LIST !== null)
        ? normalizeOnlyShowList(ONLY_SHOW_LIST)
        : null;

    const legendEl = ensureLegendExists({
      mountEl: this._container,
      startCollapsed: true,
      onlyShow: onlyShowList
    });

    initLegendUIFor_(legendEl, { startOpen: false });
    setupLegendClickedFor_(legendEl);

    return this._container;
  }

  onRemove() {
    this._container?.remove();
    this._map = null;
  }
}

function initLegendUIFor_(legendEl, { startOpen = false } = {}) {
  if (!legendEl) return;

  if (legendEl.dataset.legendWired === "1") return;
  legendEl.dataset.legendWired = "1";

  const header = legendEl.querySelector("#legendHeader");
  const headerBtn = header ? header.querySelector("button") : null;
  const body = legendEl.querySelector("#hideLegend");
  if (!headerBtn || !body) return;

  legendEl.classList.toggle("visible", !!startOpen);
  headerBtn.title = startOpen ? "Click to close map legend" : "Click to open map legend";

  const toggle = () => {
    const isOpen = legendEl.classList.toggle("visible");
    headerBtn.title = isOpen ? "Click to close map legend" : "Click to open map legend";
  };

  header.addEventListener("click", toggle);

  headerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });
}

////////////////////////////////////

// Open the DIB to show an image based only on Task ID
function showLargeImage(pictureURL) {
  if (!pictureURL) {
    console.warn("showLargeImage: missing pictureURL");
    return;
  }

  // Retrieve the larger image size
  pictureURL = pictureURL.replace("=w200", "=w2400")
  pictureURL = pictureURL.replace("=w400", "=w2400")

  const lightBox = document.getElementById(MAP_LIGHT_BOX_ID);
  const lightBoxContent = document.getElementById(MAP_LIGHT_BOX_CONTENT_ID);

  if (!lightBox || !lightBoxContent) {
    console.warn("showLargeImage: missing lightbox elements");
    return;
  }
  // Turn off scrolling
  document.documentElement.style.overflow = "hidden"; // <html>
  document.body.style.overflow = "hidden";            // <body>

  // Set the image
  lightBoxContent.innerHTML = `
    <img class="lightbox-image" src="${pictureURL}" alt="Zoomed In Image">
  `;

  //Add Closing X
  var closeX = document.getElementById("lightbox-closing");
  if (!closeX) {
    closeX = document.createElement("span");
  }
  closeX.className = "lightBoxClosing";
  closeX.setAttribute("role", "button");
  closeX.setAttribute("tabindex", "0");
  closeX.setAttribute("aria-label", "Close image");
  closeX.setAttribute("id", "lightbox-closing");

  lightBox.appendChild(closeX);

  //Make DIV visible
  lightBox.style.display = "flex";

  wireLightboxOnce(); // set the events once
}


let lightboxWired = false;

function wireLightboxOnce() {
  if (lightboxWired) return;
  lightboxWired = true;

  const lightBox = document.getElementById(MAP_LIGHT_BOX_ID);
  const lightBoxContent = document.getElementById(MAP_LIGHT_BOX_CONTENT_ID);
  const closeX = document.getElementById("lightbox-closing");

  if (!lightBox || !lightBoxContent || !closeX) return;

  // Click outside content closes
  lightBox.addEventListener("click", () => {
    closeLargeImage();
  });

  // Click inside content does NOT close
  lightBoxContent.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  // Close button
  closeX.addEventListener("click", (e) => {
    e.stopPropagation();
    closeLargeImage();
  });

  closeX.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      closeLargeImage();
    }
  });

  // ESC key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLargeImage();
  });
}

function closeLargeImage() {
  const lightBox = document.getElementById(MAP_LIGHT_BOX_ID);
  if (!lightBox) return;
  lightBox.style.display = "none";
  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
}

// Try to deal with the map getting hidden when inactive
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    try {
      map.resize();
      map.triggerRepaint();
    } catch (_) { }
  }
});

// expose functions used by other files
window.getURLParams = getURLParams;
window.setShareButton = setShareButton;
window.buildURL = buildURL;
window.goToElement = goToElement;
window.forceClosePopups = forceClosePopups;
