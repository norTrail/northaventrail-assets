/* ============================================================
   Northaven TAILS — UI + State Rendering Layer
   ============================================================ */

/* ----------------------------
   Cached DOM references
   ---------------------------- */

const UI = {
  overlayBanner: document.getElementById("overlay-banner"),
  overlayMessage: document.getElementById("overlayMessage"),
  overlayImage: document.getElementById("overlayImage"),
  countdown: document.getElementById("countdown"),

  controls: document.getElementById("controls"),
  statusPill: document.getElementById("status-pill"),

  tableBtn: document.getElementById("toggleTableBtn"),
  zoomInBtn: document.getElementById("zoom-sheep-btn"),
  zoomOutBtn: document.getElementById("zoom-out-btn"),

  mapView: document.getElementById("mapView"),
  tableView: document.getElementById("tableView"),
  backToMapBtn: document.getElementById("backToMapBtn"),

  openMapBtn: document.getElementById("open-map-btn"),
  adaInfo: document.getElementById("ada-info"),
  adaInfoLong: document.getElementById("ada-long-text"),
  adaInfoShort: document.getElementById("ada-short-text")
};


/* ----------------------------
   Internal UI state
   ---------------------------- */

let currentState = null;
let countdownTimer = null;
let isZoomedToHerd = false;
let lastVisibleZoneCode = null;
let userHasScrolledTable = false;
const TAILS_SHARE_HERD_PARAM = "herd";
const TAILS_SHARE_ZONE_PARAM = "nomowzone";
let activeHerdCode = null;
let sharedHerdLookupReady = false;
let sharedNoMowLookupReady = false;
let pendingSharedSelection = parseSharedSelectionFromUrl_();

function normalizeSharedId_(value) {
  return String(value || "").trim();
}

function parseSharedSelectionFromUrl_() {
  const params = new URLSearchParams(window.location.search || "");
  const herdCode = normalizeSharedId_(params.get(TAILS_SHARE_HERD_PARAM));
  const zoneCode = normalizeSharedId_(params.get(TAILS_SHARE_ZONE_PARAM));
  if (!herdCode && !zoneCode) return null;
  return { herdCode, zoneCode };
}

function buildTailsShareUrl_(options) {
  const url = new URL(window.location.href);
  const herdCode = normalizeSharedId_(options?.herdCode);
  const zoneCode = normalizeSharedId_(options?.zoneCode);

  url.searchParams.delete(TAILS_SHARE_HERD_PARAM);
  url.searchParams.delete(TAILS_SHARE_ZONE_PARAM);

  if (herdCode) {
    url.searchParams.set(TAILS_SHARE_HERD_PARAM, herdCode);
  } else if (zoneCode) {
    url.searchParams.set(TAILS_SHARE_ZONE_PARAM, zoneCode);
  }

  return url.toString();
}

function syncPageShareButtonUrl_(url) {
  const shareBtn = document.getElementById("share-button");
  if (!shareBtn) return;

  shareBtn.setAttribute("share-url", String(url || window.location.href));

  if (!shareBtn.getAttribute("share-title")) {
    shareBtn.setAttribute("share-title", "Northaven TAILS");
  }
  if (!shareBtn.getAttribute("share-text")) {
    shareBtn.setAttribute("share-text", "Explore the Northaven TAILS grazing map.");
  }
}

function syncTailsShareState_(options, historyMode = "replace") {
  const nextUrl = buildTailsShareUrl_(options);
  const currentUrl = window.location.href;

  activeHerdCode = normalizeSharedId_(options?.herdCode) || null;
  selectedZoneCode = activeHerdCode ? null : normalizeSharedId_(options?.zoneCode) || null;

  if (currentUrl !== nextUrl) {
    const state = window.history.state;
    if (historyMode === "push") {
      window.history.pushState(state, document.title, nextUrl);
    } else {
      window.history.replaceState(state, document.title, nextUrl);
    }
  }

  syncPageShareButtonUrl_(nextUrl);
  return nextUrl;
}

function ensureNoMowVisible_() {
  const checkbox = document.getElementById("showNoMow");
  if (checkbox?.checked) return;

  if (checkbox) {
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  Object.values(noMowZoneMarkers || {}).forEach(obj => {
    if (obj?.element) obj.element.style.display = "inline-flex";
  });
}

function activateHerdByCode(herdCode, options = {}) {
  const normalizedCode = normalizeSharedId_(herdCode);
  const marker = normalizedCode ? herdMarkers?.[normalizedCode] : null;
  const markerEl = marker?.__tailsElement || marker?._element || null;
  const feature = marker?.__tailsFeature || null;
  const map = window.TAILS?.getMap?.();

  if (!normalizedCode || !markerEl || !feature || !map) return false;

  closeAllPopups({ preserveShareState: true });
  const shareUrl = syncTailsShareState_({ herdCode: normalizedCode });
  window.TailsCards?.showHerd?.(feature, markerEl, map, {
    herdCode: normalizedCode,
    shareUrl,
    onClose: () => {
      activeHerdCode = null;
      syncTailsShareState_({});
    }
  });
  return true;
}

function tryApplySharedSelection_() {
  if (!pendingSharedSelection) return;

  const herdCode = normalizeSharedId_(pendingSharedSelection.herdCode);
  const zoneCode = normalizeSharedId_(pendingSharedSelection.zoneCode);

  if (herdCode) {
    if (!sharedHerdLookupReady) return;
    if (activateHerdByCode(herdCode)) {
      pendingSharedSelection = null;
      return;
    }
  }

  if (zoneCode) {
    if (herdCode && !sharedHerdLookupReady) return;
    if (!sharedNoMowLookupReady) return;
    if (focusNoMowZone(zoneCode, { fromSharedUrl: true })) {
      pendingSharedSelection = null;
      return;
    }
  }

  if ((!herdCode || sharedHerdLookupReady) && (!zoneCode || sharedNoMowLookupReady)) {
    pendingSharedSelection = null;
    syncTailsShareState_({});
  }
}

window.TAILS_SHARE = {
  buildShareUrl: buildTailsShareUrl_,
  getCurrentShareUrl: () => buildTailsShareUrl_({
    herdCode: activeHerdCode,
    zoneCode: selectedZoneCode
  })
};

function formatMarkerStatusLabel_(props) {
  const status = String(props?.status || "").trim().toLowerCase();
  const icon = String(props?.icon || "").trim();

  if (status === "coming" || icon === "🌼") return "coming up";
  if (status === "grazing" || status === "active" || icon === "🐐" || icon === "🐑") return "grazing now";
  if (status === "finished" || status === "history" || status === "complete" || icon === "🌱") return "grazed / finished";
  return status || "grazing area";
}

function buildMarkerAriaLabel_(name, props) {
  const cleanName = String(name || "Grazing area").trim();
  const statusLabel = formatMarkerStatusLabel_(props);
  const dateLabel = formatDateISOLong(props?.estimatedDate) || String(props?.estimatedDateLong || "").trim();
  const zoneCode = String(props?.zoneCode || "").trim();
  const suffix = [statusLabel, dateLabel, zoneCode ? `zone ${zoneCode}` : ""].filter(Boolean).join(", ");
  return suffix ? `${cleanName}, ${suffix}: open details` : `${cleanName}: open details`;
}

function preferredZoneCenter_(feature) {
  const props = feature?.properties || {};
  const centerLng = Number(props.centerLng);
  const centerLat = Number(props.centerLat);
  return (Number.isFinite(centerLng) && Number.isFinite(centerLat) ? [centerLng, centerLat] : null)
    || props.center
    || featureCenter(feature?.geometry)
    || null;
}

function syncMapMarkerPositions_() {
  Object.values(noMowZoneMarkers || {}).forEach(obj => {
    const center = preferredZoneCenter_(obj?.feature);
    if (center && obj?.marker?.setLngLat) {
      obj.marker.setLngLat(center);
    }
  });

  Object.entries(herdMarkers || {}).forEach(([herdCode, marker]) => {
    const feature = marker?.__tailsFeature;
    const coords = feature?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2 && marker?.setLngLat) {
      marker.setLngLat([coords[0], coords[1]]);
    }
  });
}

function queueMapResize_() {
  const mapInstance = window.TAILS?.getMap?.();
  if (!mapInstance || typeof mapInstance.resize !== "function") return;

  window.requestAnimationFrame(() => {
    mapInstance.resize();
    window.requestAnimationFrame(() => {
      mapInstance.resize();
      syncMapMarkerPositions_();
    });
  });
}

function parseEventDate_(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const raw = String(value).trim();
  if (!raw) return null;

  const nativeDate = new Date(raw);
  if (!Number.isNaN(nativeDate.getTime())) return nativeDate;

  const dayMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dayMatch) return null;

  const parsed = new Date(Number(dayMatch[1]), Number(dayMatch[2]) - 1, Number(dayMatch[3]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatEventDateLong_(value) {
  const parsed = parseEventDate_(value);
  if (!parsed) return "";
  return parsed.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}


/* ============================================================
   OVERLAY STATE RENDERING
   ============================================================ */

function updateOverlayState(state) {
  if (!state || !state.state) return;

  currentState = state;
  if (state.state !== "active" && state.state !== "grazing") {
    sharedHerdLookupReady = true;
  }

  clearCountdown();

  switch (state.state) {

    /* ---------------- COMING ---------------- */
    case "coming": {
      hideFlockLoader();
      showBanner();
      hideSheepUI();
      hideMapButtonAndLocation();
      UI.controls.style.display = "none";

      const startDateLabel = formatEventDateLong_(state.startDate);

      UI.overlayMessage.innerHTML =
        startDateLabel
          ? `The sheep and goats are coming!<br><span class="overlay-date">${startDateLabel}</span>`
          : `The sheep and goats are coming!`;

      UI.statusPill.innerText = "Coming";
      UI.statusPill.dataset.state = "coming";
      UI.statusPill.style.display = "block";

      UI.overlayImage.src = state.image || "";
      UI.overlayImage.alt = "The sheep and goats are coming to the Northaven Trail.";
      UI.overlayImage.onload = () => queueMapResize_();
      UI.overlayImage.onerror = () => queueMapResize_();
      startCountdown(state.startDate);

      break;
    }

    /* ---------------- SLEEPING ---------------- */
    case "sleeping":
      hideFlockLoader();
      showBanner();
      hideSheepUI();
      hideMapButtonAndLocation();
      UI.controls.style.display = "none";

      UI.overlayMessage.innerHTML = "SHHHH!<br>The sheep and goats are sleeping!";
      UI.overlayImage.src = state.image || "";
      UI.overlayImage.alt = "The herd is resting overnight off the trail.";
      UI.overlayImage.onload = () => queueMapResize_();
      UI.overlayImage.onerror = () => queueMapResize_();

      UI.statusPill.innerText = "Sleeping";
      UI.statusPill.dataset.state = "sleeping";
      UI.statusPill.style.display = "block";

      if (state.grazingStartHour) {
        const updateTextHour = `The herd returns at ${to12Hour(state.grazingStartHour)}:00 ${amPm(state.grazingStartHour)}.`;
        UI.adaInfoLong.innerHTML = updateTextHour;
        UI.adaInfoShort.innerHTML = updateTextHour;
      }

      break;

    /* ---------------- HISTORY ---------------- */
    case "history":
      hideFlockLoader();
      showBanner();
      hideSheepUI();
      hideMapButtonAndLocation();
      UI.controls.style.display = "none";

      UI.overlayMessage.innerHTML =
        "They came, they nibbled, they frolicked.";
      UI.adaInfoLong.innerHTML = "Mission complete! Prairie restoration is underway.";
      UI.adaInfoShort.innerHTML = "Mission complete! Prairie restoration is underway.";


      UI.overlayImage.src = state.image || "";
      UI.overlayImage.alt = "The herd has completed grazing on this section of the Northaven Trail.";
      UI.overlayImage.onload = () => queueMapResize_();
      UI.overlayImage.onerror = () => queueMapResize_();

      UI.statusPill.innerText = "Finished";
      UI.statusPill.dataset.state = "history";
      UI.statusPill.style.display = "block";

      break;

    /* ---------------- ACTIVE / GRAZING ---------------- */
    default:
      hideBanner();
      UI.controls.style.display = "";
      sharedHerdLookupReady = false;

      UI.statusPill.innerText = "Grazing";
      UI.statusPill.dataset.state = "grazing";
      UI.statusPill.style.display = "block";
      showSheepUI();
      break;
  }

  tryApplySharedSelection_();
}


/* ============================================================
   SHEEP MAP UI
   ============================================================ */

let herdMarkers = {};
let herdHistorySources = {};

function updateMarker(herdCode, herdObj, map) {
  const feature = herdObj.current?.features?.[0];
  if (!feature) {
    console.warn(`No Sheep Data for Herd ${herdCode}: ${JSON.stringify(herdObj)}`);
    logCaughtError?.("updateMarker", new Error(`No sheep data for herd ${herdCode}`), { herdCode });
    return;
  }

  const [lng, lat] = feature.geometry.coordinates;

  setCurrentHerdLocation(lat, lng);
  hideFlockLoader();

  if (UI.zoomInBtn && !isZoomedToHerd) {
    UI.zoomInBtn.style.display = "block";
    updateBottomUiState();
  }

  const props = feature.properties;
  const color = herdObj.color || "#66BB66";
  const herdName = String(props.herdName || "The herd");
  const sheepInfo = String(props.sheepInfo || "");
  const trailSectionShort = String(props.trailSectionShort || "");
  const longText = String(props.trailSectionLong || "The herd is grazing on the trail.");
  const shortText = String(feature.properties.trailSectionShort || "The herd is grazing on the trail.");

  if (herdMarkers[herdCode]) {
    herdMarkers[herdCode].setLngLat([lng, lat]);
    showMapButtonAndLocation(lat, lng, shortText, longText)
    return;
  }

  const el = document.createElement("button");
  el.type = "button";
  el.tabIndex = 0;
  el.className = "sheep-marker outlined-sheep-marker";
  el.innerHTML = `
   <svg class="sheep-pin-svg" viewBox="0 0 54 72" aria-hidden="true">
     <use href="#icon-sheep-pin"/>
   </svg>
   <span class="marker-inner" aria-hidden="true">🐑</span>
 `;
  el.style.color = color;
  el.dataset.outline = color;
  el.title = herdName;
  el.setAttribute("aria-label", buildMarkerAriaLabel_(herdName, {
    status: "grazing",
    estimatedDateLong: trailSectionShort || shortText
  }));
  el.setAttribute("role", "button");
  el.setAttribute("aria-pressed", "false");
  el.setAttribute("aria-expanded", "false");

  el.addEventListener("mouseenter", () => el.classList.add("is-hover"));
  el.addEventListener("mouseleave", () => el.classList.remove("is-hover"));
  el.addEventListener('focus', () => el.classList.add('is-hover'));
  el.addEventListener('blur', () => el.classList.remove('is-hover'));

  el.addEventListener("click", e => {
    e.stopPropagation();

    activateHerdByCode(herdCode);
  });

  herdMarkers[herdCode] = new mapboxgl.Marker({
    element: el,
    anchor: "bottom"
  })
    .setLngLat([lng, lat])
    .addTo(map);
  herdMarkers[herdCode].__tailsElement = el;
  herdMarkers[herdCode].__tailsFeature = feature;


  const hamburgerElement = document.getElementById("hamburger");
  if (hamburgerElement) { hamburgerElement.style.display = "block"; }

  showMapButtonAndLocation(lat, lng, shortText, longText)
}

function updateHerdHistoryLine(herdCode, historyGeoJSON, color, map) {
  if (!historyGeoJSON || !historyGeoJSON.features?.length) {
    console.warn(`No history data given: ${JSON.stringify(historyGeoJSON)}`);
    return;
  }

  const sourceId = `herd-${herdCode}-history-src`;
  const layerId = `herd-${herdCode}-history-line`;

  // 🔑 RECORD THE SOURCE ID
  herdHistorySources[herdCode] = sourceId;

  if (map.getSource(sourceId)) {
    map.getSource(sourceId).setData(historyGeoJSON);
    return;
  }

  map.addSource(sourceId, {
    type: "geojson",
    data: historyGeoJSON
  });

  map.addLayer({
    id: layerId,
    type: "line",
    source: sourceId,
    layout: {
      "line-join": "round",
      "line-cap": "round",
      visibility: 'none'   // start hidden
    },
    paint: {
      "line-color": color || "#66BB66",
      "line-width": 3,
      "line-opacity": 0.9
    }
  });

  const showHistory = document.getElementById('showHistory')?.checked ?? false;
  map.setLayoutProperty(layerId, 'visibility', showHistory ? 'visible' : 'none');
}

function renderAllHerds(data, map) {
  if (currentState?.state !== "active" && currentState?.state !== "grazing") {
    // Prevents this from being called before the OverlayState is returned
    return;
  }

  Object.entries(data).forEach(([herdCode, herdObj]) => {
    const feature = herdObj.current?.features?.[0];

    if (!feature) {
      console.warn(`No data for herd ${herdCode}: ${JSON.stringify(herdObj)}`);
      logCaughtError?.("renderAllHerds", new Error(`No data for herd ${herdCode}`), { herdCode });
      return;
    }

    // Marker
    updateMarker(herdCode, herdObj, map);

    // History
    updateHerdHistoryLine(
      herdCode,
      herdObj.history,
      herdObj.color,
      map
    );
  });

  sharedHerdLookupReady = true;
  tryApplySharedSelection_();
}


/* ============================================================
   NO-MOW ZONES (table lives elsewhere)
   ============================================================ */

const noMowZoneMarkers = {};
let selectedZoneCode = null;
let pendingZoneScrollCode = null;
let lastNoMowHash = null;
let noMowMarkerDelegationBound = false;
let tableInteractionDelegationBound = false;

// Cheap structural hash — avoids full JSON.stringify on every poll
function quickGeoHash_(geojson) {
  const features = geojson.features || [];
  return `${features.length}:${features[0]?.properties?.zoneCode ?? ""}:${features[features.length - 1]?.properties?.zoneCode ?? ""}`;
}

function featureCenter(geometry) {
  if (geometry.type === "Point") return geometry.coordinates;

  if (geometry.type === "Polygon") {
    return geometry.coordinates[0][0];
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates[0][0][0];
  }

  return null;
}

function pruneOpenPopups() {
  openPopups = openPopups.filter(popup => popup?.isOpen?.());
  if (currentFullPopup && !currentFullPopup?.isOpen?.()) {
    currentFullPopup = null;
  }
}

function setNoMowMarkerHoverState_(markerEl, hovered) {
  if (!markerEl) return;
  markerEl.classList.toggle("is-hover", hovered);
}

function openNoMowZonePopup_(zoneCode, markerEl, options = {}) {
  const normalizedCode = normalizeSharedId_(zoneCode);
  const obj = noMowZoneMarkers?.[normalizedCode];
  const map = window.TAILS?.getMap?.();
  if (!obj || !obj.feature || !markerEl || !map) return false;

  const center = preferredZoneCenter_(obj.feature);
  if (!center) return false;

  ensureNoMowVisible_();
  closeAllPopups({ preserveShareState: true });
  const shareUrl = syncTailsShareState_({ zoneCode: normalizedCode });
  window.TailsCards?.showNoMowZone?.(obj.feature, markerEl, map, {
    zoneCode: normalizedCode,
    shareUrl,
    onClose: () => {
      selectedZoneCode = null;
      syncTailsShareState_({});
    }
  });
  return true;
}

function attachNoMowMarkerDelegationOnce() {
  if (noMowMarkerDelegationBound) return;

  const mapContainer = document.getElementById("map");
  if (!mapContainer) return;

  mapContainer.addEventListener("mouseover", event => {
    const markerEl = event.target.closest(".no-mow-marker");
    if (!markerEl || !mapContainer.contains(markerEl)) return;
    if (markerEl.contains(event.relatedTarget)) return;
    setNoMowMarkerHoverState_(markerEl, true);
  });

  mapContainer.addEventListener("mouseout", event => {
    const markerEl = event.target.closest(".no-mow-marker");
    if (!markerEl || !mapContainer.contains(markerEl)) return;
    if (markerEl.contains(event.relatedTarget)) return;
    setNoMowMarkerHoverState_(markerEl, false);
  });

  mapContainer.addEventListener("focusin", event => {
    const markerEl = event.target.closest(".no-mow-marker");
    if (!markerEl || !mapContainer.contains(markerEl)) return;
    setNoMowMarkerHoverState_(markerEl, true);
  });

  mapContainer.addEventListener("focusout", event => {
    const markerEl = event.target.closest(".no-mow-marker");
    if (!markerEl || !mapContainer.contains(markerEl)) return;
    if (markerEl.contains(event.relatedTarget)) return;
    setNoMowMarkerHoverState_(markerEl, false);
  });

  mapContainer.addEventListener("keydown", event => {
    const markerEl = event.target.closest(".no-mow-marker");
    if (!markerEl || !mapContainer.contains(markerEl)) return;
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    openNoMowZonePopup_(markerEl.dataset.zoneCode, markerEl);
  });

  mapContainer.addEventListener("click", event => {
    const markerEl = event.target.closest(".no-mow-marker");
    if (!markerEl || !mapContainer.contains(markerEl)) {
      if (event.target.closest(".mapboxgl-canvas")) {
        closeAllPopups();
      }
      return;
    }

    event.stopPropagation();
    openNoMowZonePopup_(markerEl.dataset.zoneCode, markerEl);
  });

  noMowMarkerDelegationBound = true;
}

function updateNoMowLayers(map, geojson, force = false) {
  if (!map || !geojson || geojson.type !== "FeatureCollection") {
    if (UI.tableBtn) UI.tableBtn.style.display = "none";
    return;
  }

  const hash = quickGeoHash_(geojson);

  // Skip unchanged unless forced
  if (!force && hash === lastNoMowHash) return;
  lastNoMowHash = hash;
  attachNoMowMarkerDelegationOnce();

  UI.tableBtn.style.display = "block";
  updateBottomUiState();

  /* ---------------------------
     Polygon source & fill
     --------------------------- */

  if (map.getSource("no-mow-zones")) {
    map.getSource("no-mow-zones").setData(geojson);
  } else {
    map.addSource("no-mow-zones", {
      type: "geojson",
      data: geojson
    });

    map.addLayer({
      id: "no-mow-zones-layer",
      type: "fill",
      source: "no-mow-zones",
      paint: {
        "fill-color": ["get", "color"],
        "fill-opacity": 0.4
      }
    });
  }

  /* ---------------------------
     Clear existing markers
     --------------------------- */

  Object.values(noMowZoneMarkers).forEach(obj => obj.marker.remove());
  for (const k in noMowZoneMarkers) delete noMowZoneMarkers[k];

  /* ---------------------------
     Rebuild emoji markers
     --------------------------- */

  geojson.features.forEach(feature => {
    if (!feature?.geometry) return;

    const props = feature.properties || {};
    const center =
      props.center || featureCenter(feature.geometry);

    if (!center) return;

    const code = props.zoneCode || props.zoneName || "zone";

    const el = document.createElement("button");
    el.type = "button";
    el.tabIndex = 0;
    el.className = "no-mow-marker";
    const markerInner = document.createElement("span");
    markerInner.className = "marker-inner";
    markerInner.textContent = String(props.icon || "🌼");
    el.appendChild(markerInner);
    el.title = props.zoneCode || "";

    const name = (props.zoneName || "No-Mow Zone").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

    el.setAttribute("aria-label", buildMarkerAriaLabel_(name, props));
    el.setAttribute("aria-expanded", "false");
    el.dataset.zoneCode = code;

    const marker = new mapboxgl.Marker(el, { anchor: "center" })
      .setLngLat(center)
      .addTo(map);
    el.removeAttribute("role"); // MapboxGL may inject role="img"; remove it — <button> has implicit role
    el.__mapboxMarker = marker; // stash so cards layer can call setOffset on activate/deactivate

    noMowZoneMarkers[code] = { marker, element: el, feature };
  });

  sharedNoMowLookupReady = true;

  /* ---------------------------
     Visibility toggle
     --------------------------- */

  const cb = document.getElementById("showNoMow");
  // Default to showing no-mow zones on first data load
  if (cb && !cb.dataset.initialized) {
    cb.checked = true;
    cb.dataset.initialized = "1";
  }
  const showNoMow = cb?.checked ?? true;

  if (map.getLayer("no-mow-zones-layer")) {
    map.setLayoutProperty(
      "no-mow-zones-layer",
      "visibility",
      showNoMow ? "visible" : "none"
    );
  }

  Object.values(noMowZoneMarkers).forEach(obj => {
    obj.element.style.display = showNoMow ? "inline-flex" : "none";
  });

  UI.tableBtn.style.display = Object.keys(noMowZoneMarkers).length > 0 ? "block" : "none";
  queueMapResize_();
  tryApplySharedSelection_();
}


/* ============================================================
   Build the No Mow Zone Table
   ============================================================ */
function openZoneGoogleMaps(lat, lng) {
  if (lat == null || lng == null) return;
  const url = `https://www.google.com/maps?q=${lat},${lng}`;
  window.open(url, "_blank", "noopener");
}
function buildGrazingTable() {
  const zones = Object.values(noMowZoneMarkers).map(z => {
    const f = z.feature;
    return {
      name: f.properties.zoneName.replace(/^Grazing Area<br>\s*/i, ""),
      status: f.properties.status,
      statusIcon: f.properties.icon,
      grazeDate: f.properties.estimatedDate || "",
      grazeDateLong: formatDateISOLong(f.properties.estimatedDate) || f.properties.estimatedDateLong || "",
      code: f.properties.zoneCode,
      lng: f.properties.centerLng,
      lat: f.properties.centerLat,
      color: f.properties.color
    };
  });

  showTableView(zones);
}

/* ============================================================
   VIEW FLIP ANIMATION (map ↔ table)
   ============================================================ */

/**
 * Animate a horizontal card-flip between two full-height views.
 * @param {HTMLElement} exitEl   – view currently visible
 * @param {HTMLElement} enterEl  – view to show
 * @param {"forward"|"back"} direction
 * @param {Function}  [onReady] – called at the midpoint (while enterEl is
 *                                still invisible) so the DOM can be populated
 *                                before the enter animation begins.
 */
function flipToView(exitEl, enterEl, direction, onReady, onComplete) {
  // Respect user's motion preference (WCAG 2.1 AA — no animation if reduced-motion)
  const prefersNoMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const exitClass  = direction === "forward" ? "view-flip-exit-fwd"  : "view-flip-exit-back";
  const enterClass = direction === "forward" ? "view-flip-enter-fwd" : "view-flip-enter-back";
  const HALF_MS    = prefersNoMotion ? 0 : 170;

  // Prevent double-taps while animating
  document.querySelectorAll(".map-bottom-button").forEach(b => (b.disabled = true));

  if (!prefersNoMotion) exitEl.classList.add(exitClass);

  setTimeout(() => {
    exitEl.classList.remove(exitClass);
    exitEl.style.display = "none";

    // Populate the incoming view while it is still off-screen
    if (onReady) onReady();

    enterEl.style.display = "block";
    void enterEl.offsetWidth; // force reflow so CSS animation triggers cleanly
    if (!prefersNoMotion) enterEl.classList.add(enterClass);
    updateBottomUiState();

    setTimeout(() => {
      enterEl.classList.remove(enterClass);
      document.querySelectorAll(".map-bottom-button").forEach(b => (b.disabled = false));
      // Move focus to first usable element in the new view (WCAG 2.1 A — focus management)
      const firstFocusable = enterEl.querySelector(
        "button:not(:disabled), a[href], [tabindex='0']"
      );
      if (firstFocusable) firstFocusable.focus();
      if (onComplete) onComplete();
    }, HALF_MS);

  }, HALF_MS);
}

if (UI.tableBtn) {
  UI.tableBtn.title = "View no-mow zones as a table";
  UI.tableBtn.setAttribute("aria-label", "View no-mow zones as a table");
}

UI.tableBtn?.addEventListener("click", () => {
  const mapView = document.getElementById("mapView");
  const tableView = document.getElementById("tableView");
  if (!mapView || !tableView) return;
  pendingZoneScrollCode = selectedZoneCode; // capture before animation/popup-close
  flipToView(mapView, tableView, "forward", buildGrazingTable, applyPendingTableScroll);
});

UI.backToMapBtn?.addEventListener("click", () => {
  const mapView = document.getElementById("mapView");
  const tableView = document.getElementById("tableView");
  if (!mapView || !tableView) return;
  flipToView(tableView, mapView, "back");
});

function getTopVisibleZoneCode() {
  const container = document.getElementById("tableWrapper");
  if (!container) return null;

  const header = container.querySelector("thead");
  const rows = container.querySelectorAll("tr[data-code]");
  if (!rows.length) return null;

  const containerTop = container.getBoundingClientRect().top;
  const headerHeight = header ? header.getBoundingClientRect().height : 0;
  const visualTop = containerTop + headerHeight;

  let bestRow = null;
  let bestDistance = Infinity;

  rows.forEach(row => {
    const rect = row.getBoundingClientRect();
    const distance = Math.abs(rect.top - visualTop);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestRow = row;
    }
  });

  return bestRow ? bestRow.dataset.code : null;
}

function showTableView(zones) {
  if (!Array.isArray(zones) || zones.length === 0) {
    console.warn("showTableView called with no zones:", zones);
    return;
  }

  const table = document.getElementById("grazingTableBody");
  if (!table) return;
  attachTableInteractionDelegationOnce();
  table.innerHTML = "";

  // 1️⃣ Sort by date (ISO strings sort correctly without parsing)
  const sorted = [...zones].sort((a, b) => {
    if (!a.grazeDate && !b.grazeDate) return 0;
    if (!a.grazeDate) return 1;
    if (!b.grazeDate) return -1;
    return a.grazeDate < b.grazeDate ? -1 : a.grazeDate > b.grazeDate ? 1 : 0;
  });

  // Pre-build Set of dates that have at least one "Coming" zone — O(n) vs O(n²)
  const comingDates = new Set(
    sorted.filter(z => z.status === "Coming").map(z => z.grazeDateLong)
  );

  let lastDateLabel = "";
  let firstDataRow = true;   // roving tabindex — only the first row is in the tab order

  sorted.forEach(zone => {
    const currentDate = zone.grazeDateLong;

    if (currentDate !== lastDateLabel) {
      const hasComing = comingDates.has(currentDate);

      const headerTr = document.createElement("tr");
      headerTr.className = "date-header-row";
      headerTr.innerHTML = `
        <td colspan="3" class="date-header-cell">
          ${escapeHtml(hasComing ? `${currentDate} - Estimated Date` : currentDate)}
        </td>
      `;
      table.appendChild(headerTr);

      lastDateLabel = currentDate;
    }

    const tr = document.createElement("tr");
    tr.dataset.status = zone.status;
    tr.dataset.code = zone.code;
    tr.style.color = zone.color;
    tr.title = "Click to see this no-mow zone on the map.";
    tr.setAttribute("aria-label", `${zone.name} — click to view on map`);
    // Roving tabindex: first row = 0 (Tab entry point); rest = -1 (arrow-key only)
    tr.setAttribute("tabindex", firstDataRow ? "0" : "-1");
    firstDataRow = false;

    tr.innerHTML = `
      <td data-label="Zone">${escapeHtml(zone.name)}</td>
      <td class="status-cell" data-label="Status">${escapeHtml(zone.status)}</td>
      <td class="map-icons" data-label="Map">
        <span class="status-emoji" aria-hidden="true">${escapeHtml(zone.statusIcon)}</span>
        <span class="gmaps-emoji" role="button" tabindex="-1"
              aria-label="Open ${escapeHtmlAttr(zone.name)} in Google Maps">
          <svg class="gmap-icon" width="22" height="22" aria-hidden="true">
            <use href="#google-logo-color"></use>
          </svg>
        </span>
      </td>
    `;

    const gmapsSpan = tr.querySelector(".gmaps-emoji");
    if (gmapsSpan) {
      gmapsSpan.dataset.lat = String(zone.lat ?? "");
      gmapsSpan.dataset.lng = String(zone.lng ?? "");
    }

    table.appendChild(tr);
  });

  const targetCode = resolveInitialTableTarget(zones);

  // Double-rAF ensures layout is fully settled after display:none → display:block.
  // scrollIntoView uses scroll-margin-top: 120px (CSS) to clear sticky headers.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!targetCode) return;

      const container = document.getElementById("tableWrapper");
      if (!container) return;
      const row = container.querySelector(`tr[data-code="${targetCode}"]`);
      if (!row) return;

      row.scrollIntoView({ block: "start", behavior: "instant" });
      row.classList.add("active");
    });
  });
}

function resolveInitialTableTarget(zones) {
  // If an explicit zone scroll is pending, skip the default scroll to avoid a
  // visible flash. applyPendingTableScroll() will handle it post-animation.
  if (pendingZoneScrollCode) return null;

  // Restore only if the user actually scrolled before
  if (userHasScrolledTable && lastVisibleZoneCode) {
    return lastVisibleZoneCode;
  }

  // First-time default behavior
  const now = zones.find(z => z.status === "Now Grazing");
  if (now) return now.code;

  const coming = zones.find(z => z.status === "Coming");
  if (coming) return coming.code;

  return null;
}

// Called by flipToView's onComplete (after the enter animation finishes) so that
// scrollIntoView works correctly on a fully-visible, non-transforming element.
function applyPendingTableScroll() {
  const code = pendingZoneScrollCode;
  if (!code) return;
  pendingZoneScrollCode = null;

  const container = document.getElementById("tableWrapper");
  if (!container) return;
  const row = container.querySelector(`tr[data-code="${code}"]`);
  if (!row) return;

  container.querySelectorAll("tr.active").forEach(r => r.classList.remove("active"));
  row.classList.add("active");
  row.scrollIntoView({ block: "start", behavior: "instant" });
}

let tableScrollListenerAttached = false;
function activateTableRow_(row) {
  const zoneCode = row?.dataset?.code;
  if (!zoneCode) return;
  selectedZoneCode = zoneCode;
  focusNoMowZone(zoneCode);
}

function moveTableRowFocus_(row, direction) {
  const table = document.getElementById("grazingTableBody");
  if (!table || !row) return;

  const rows = Array.from(table.querySelectorAll("tr[data-code]"));
  const idx = rows.indexOf(row);
  if (idx === -1) return;

  const next = direction === "down"
    ? Math.min(idx + 1, rows.length - 1)
    : Math.max(idx - 1, 0);

  if (next === idx) return;

  row.setAttribute("tabindex", "-1");
  rows[next].setAttribute("tabindex", "0");
  rows[next].focus();
}

function attachTableInteractionDelegationOnce() {
  if (tableInteractionDelegationBound) return;

  const table = document.getElementById("grazingTableBody");
  if (!table) return;

  table.addEventListener("click", event => {
    const mapsButton = event.target.closest(".gmaps-emoji");
    if (mapsButton && table.contains(mapsButton)) {
      event.stopPropagation();
      openZoneGoogleMaps(mapsButton.dataset.lat, mapsButton.dataset.lng);
      return;
    }

    const row = event.target.closest("tr[data-code]");
    if (!row || !table.contains(row)) return;
    activateTableRow_(row);
  });

  table.addEventListener("keydown", event => {
    const mapsButton = event.target.closest(".gmaps-emoji");
    if (mapsButton && table.contains(mapsButton)) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        openZoneGoogleMaps(mapsButton.dataset.lat, mapsButton.dataset.lng);
      }
      return;
    }

    const row = event.target.closest("tr[data-code]");
    if (!row || !table.contains(row)) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateTableRow_(row);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveTableRowFocus_(row, event.key === "ArrowDown" ? "down" : "up");
    }
  });

  tableInteractionDelegationBound = true;
}

function attachTableScrollTrackingOnce() {
  if (tableScrollListenerAttached) return;

  const container = document.getElementById("tableWrapper");
  if (!container) return;

  let _scrollThrottlePending = false;
  container.addEventListener(
    "scroll",
    () => {
      if (_scrollThrottlePending) return;
      _scrollThrottlePending = true;
      requestAnimationFrame(() => {
        _scrollThrottlePending = false;
        userHasScrolledTable = true;
        lastVisibleZoneCode = getTopVisibleZoneCode();
      });
    },
    { passive: true }
  );

  tableScrollListenerAttached = true;
}

document.addEventListener("DOMContentLoaded", () => {
  attachTableInteractionDelegationOnce();
  attachTableScrollTrackingOnce();
});


/* ============================================================
   UI HELPERS
   ============================================================ */


function showBanner() {
  if (UI.overlayBanner) UI.overlayBanner.hidden = false;
  if (UI.statusPill) UI.statusPill.style.display = "none";
  queueMapResize_();
}

function hideBanner() {
  if (UI.overlayBanner) UI.overlayBanner.hidden = true;
  queueMapResize_();
}

function showSheepUI() {
  // Zoom button is data-driven, not state-driven
  updateBottomUiState();

  const hamburgerElement = document.getElementById("hamburger");
  if (hamburgerElement) { hamburgerElement.style.display = "block"; }
}

function hideSheepUI() {
  isZoomedToHerd = false;

  if (UI.zoomInBtn) UI.zoomInBtn.style.display = "none";
  if (UI.zoomOutBtn) UI.zoomOutBtn.style.display = "none";
  updateBottomUiState();

  // hide the hamburger
  const hamburgerElement = document.getElementById("hamburger");
  if (hamburgerElement) { hamburgerElement.style.display = "none"; }
}



/* ============================================================
   COUNTDOWN
   ============================================================ */

function startCountdown(startDate) {
  const start = parseEventDate_(startDate);
  if (!start) {
    if (UI.countdown) UI.countdown.innerText = "";
    return;
  }

  function tick() {
    const now = new Date();
    const diff = start - now;

    if (diff <= 0) {
      UI.countdown.innerText = "The herd has arrived!";
      clearCountdown();
      return;
    }

    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff / 3600000) % 24);
    const m = Math.floor((diff / 60000) % 60);

    const parts = [];
    if (d) parts.push(`${d}\u00A0day${d !== 1 ? "s" : ""}`);
    if (h) parts.push(`${h}\u00A0hour${h !== 1 ? "s" : ""}`);
    if (m) parts.push(`${m}\u00A0minute${m !== 1 ? "s" : ""}`);

    UI.countdown.innerText =
      "Grazing starts in " + parts.join(", ");
  }

  tick();
  countdownTimer = setInterval(tick, 60000);
}

function clearCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  if (UI.countdown) UI.countdown.innerText = "";
}

/* ----------------------------
   Flock loader
   ---------------------------- */
function hideFlockLoader() {
  const el = document.getElementById("flock-loader");
  if (el) {
    el.classList.add("flock-loader--hidden");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
  }
  window.TAILS?.setLoadingState?.(false);
}


/* ============================================================
   Google Map Button and Location Text Controls
   ============================================================ */

function showMapButtonAndLocation(lat, lng, shortText, longText) {
  if (!UI.openMapBtn || !UI.adaInfoLong || !UI.adaInfoShort) return;
  if (lat == null || lng == null) return;

  UI.openMapBtn.href  = `https://www.google.com/maps?q=${lat},${lng}`;
  UI.openMapBtn.title = "Open herd location in Google Maps";
  UI.openMapBtn.setAttribute("aria-label", "Open herd location in Google Maps");
  UI.openMapBtn.style.display = "inline-flex";
  updateBottomUiState();

  UI.adaInfoLong.textContent = longText || "";
  UI.adaInfoShort.textContent = shortText || "";
}

function hideMapButtonAndLocation() {
  if (UI.openMapBtn) {
    UI.openMapBtn.style.display = "none";
    UI.openMapBtn.removeAttribute("href");
    updateBottomUiState();
  }

  if (UI.adaInfoLong) {
    UI.adaInfoLong.textContent = "";
  }
  if (UI.adaInfoShort) {
    UI.adaInfoShort.textContent = "";
  }
}


/* ============================================================
   UTILITIES
   ============================================================ */

/** Returns true on iPhone, iPad, iPod, or Mac (where Apple Maps is native) */
const isApple = () => window.NorthavenUtils.isApple();

function clickShare(title, text, url) {
  window.NorthavenUtils.clickShare({ title, text, url });
}

/**
 * Build the navigation icon row (Google Maps, Apple Maps, Share)
 * shown at the bottom of every popup.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {string} shareText  – human-readable description for the share payload
 * @returns {string}  HTML string for a .popup-nav-icons div
 */
function buildPopupNavIcons(lat, lng, shareText) {
  const googleHref = `https://maps.google.com/maps?q=${lat},${lng}`;
  const appleHref = `https://maps.apple.com/?z=20&q=${lat},${lng}`;
  const shareUrl = window.TAILS_SHARE?.getCurrentShareUrl?.() || location.href;

  const appleLink = isApple() ? `
    <a class="popupIconLink" href="${appleHref}" target="_blank" rel="noopener noreferrer"
       title="Open in Apple Maps" aria-label="Open in Apple Maps">
      <svg class="popupIcon" aria-hidden="true"><use href="#apple-logo"/></svg>
    </a>` : "";

  const shareBtn = navigator.share ? `
    <button class="popupIconLink shareButton" type="button"
            title="Share" aria-label="Share location"
            data-share-title="Northaven TAILS"
            data-share-text="${escapeHtmlAttr(shareText)}"
            data-share-url="${escapeHtmlAttr(shareUrl)}">
      <svg class="popupIcon" aria-hidden="true"><use href="#share-icon"/></svg>
    </button>` : "";

  return `
    <div class="popup-nav-icons">
      <a class="popupIconLink" href="${googleHref}" target="_blank" rel="noopener noreferrer"
         title="Open in Google Maps" aria-label="Open in Google Maps">
        <svg class="popupIcon" aria-hidden="true"><use href="#google-logo-color"/></svg>
      </a>
      ${appleLink}
      ${shareBtn}
    </div>`;
}

/** Wire the share button inside a Mapbox popup after it has been added to the map. */
function wirePopupShare(popup) {
  const el = popup.getElement();
  if (!el || el.dataset.shareWired === "1") return;
  el.dataset.shareWired = "1";

  el.addEventListener("click", e => {
    const btn = e.target?.closest?.(".shareButton");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    clickShare(
      btn.dataset.shareTitle,
      btn.dataset.shareText,
      btn.dataset.shareUrl
    );
  });
}

function formatLongDate(d) { return window.NorthavenUtils.formatDateISO(d, { weekday: "long", month: "long", day: "numeric" }); }
function formatDateISO(d, opts) { return window.NorthavenUtils.formatDateISO(d, opts); }
function formatDateISOLong(d) { return window.NorthavenUtils.formatDateISOLong(d); }
function escapeHtml(v) { return window.NorthavenUtils.escapeHtml(v); }
function escapeHtmlAttr(v) { return window.NorthavenUtils.escapeHtmlAttr(v); }
function to12Hour(h) { return window.NorthavenUtils.to12Hour(h); }
function amPm(h) { return window.NorthavenUtils.amPm(h); }


function zoomToHerd(map) {
  if (!map) return;

  const loc = window.TAILS_DATA?.getCurrentHerdLocation();
  if (!loc) {
    console.warn("zoomToHerd: herd location not available yet");
    return;
  }

  map.flyTo({
    center: [loc.lng, loc.lat],
    zoom: 17,
    speed: 0.8,
    curve: 1.4,
    essential: true
  });
}

/* ============================================================
   Popup Management
   ============================================================ */

let openPopups = [];
let currentFullPopup = null;

function closeAllPopups(options = {}) {
  try {
    pruneOpenPopups();
    while (openPopups.length) {
      openPopups.pop().remove();
    }
    window.TailsCards?.hide?.();
    activeHerdCode = null;
    selectedZoneCode = null;
    currentFullPopup = null;
    if (!options.preserveShareState) {
      syncTailsShareState_({});
    }
  } catch (error) {
    console.warn("closeAllPopups error:", error);
    logCaughtError?.("closeAllPopups", error);
  }
}

function focusNoMowZone(zoneCode, options = {}) {
  // Instant switch (no flip): user tapped a table row and expects immediate map response
  const tableView = document.getElementById("tableView");
  const mapView = document.getElementById("mapView");

  if (tableView) tableView.style.display = "none";
  if (mapView) mapView.style.display = "block";
  updateBottomUiState();

  const map = window.TAILS?.getMap?.();
  if (!map) {
    console.warn("focusNoMowZone: map not ready");
    return false;
  }

  const obj = noMowZoneMarkers?.[zoneCode];
  if (!obj || !obj.feature) {
    console.warn("focusNoMowZone: zone not found", zoneCode);
    return false;
  }

  // Determine center safely
  const center =
    obj.feature.properties?.center ||
    [
      obj.feature.properties?.centerLng,
      obj.feature.properties?.centerLat
    ];

  if (!center || center.length !== 2) {
    console.warn("focusNoMowZone: invalid center for zone", zoneCode);
    return false;
  }

  // Open popup (same behavior as before)
  ensureNoMowVisible_();
  if (obj.element && !openNoMowZonePopup_(zoneCode, obj.element, options)) {
    return false;
  }

  // Fly map
  map.flyTo({
    center,
    zoom: 15,
    essential: true
  });
  return true;
}

let _bottomUiPending = false;
function updateBottomUiState() {
  if (_bottomUiPending) return;
  _bottomUiPending = true;
  requestAnimationFrame(() => {
    _bottomUiPending = false;
    _doUpdateBottomUiState();
  });
}

function _doUpdateBottomUiState() {
  const groupSelectors = [
    '#bottomUiGroupMap',
    '#bottomUiGroupTable'
  ];

  groupSelectors.forEach(selector => {
    const group = document.querySelector(selector);
    if (!group) return;

    const items = [...group.querySelectorAll('.map-bottom-button')]
      .filter(el => el.offsetParent !== null); // visible only

    // Clear previous state
    group.querySelectorAll(
      '.map-bottom-button.is-first, .map-bottom-button.is-last, .map-bottom-button.is-only'
    ).forEach(el =>
      el.classList.remove('is-first', 'is-last', 'is-only')
    );

    if (items.length === 1) {
      items[0].classList.add('is-only');
      return;
    }

    if (items.length > 1) {
      items[0].classList.add('is-first');
      items.at(-1).classList.add('is-last');
    }
  });
}



/* ============================================================
   PUBLIC API
   ============================================================ */

window.updateOverlayState = updateOverlayState;
window.renderAllHerds = renderAllHerds;
window.updateNoMowLayers = updateNoMowLayers;
window.zoomToHerd = zoomToHerd;
window.closeAllPopups = closeAllPopups;
window.showSheepUI = showSheepUI;
window.hideSheepUI = hideSheepUI;
window.updateBottomUiState = updateBottomUiState;
