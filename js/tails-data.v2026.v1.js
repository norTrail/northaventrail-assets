/* ============================================================
   Northaven TAILS — Data & State Pipeline
   ============================================================ */

/* ----------------------------
   Configuration
   ---------------------------- */

const DATA_CONFIG = {
  sheepPollMs: 5 * 60 * 1000,
  overlayPollMs: 60 * 1000,
  fetchTimeoutMs: 15 * 1000,
  errorBackoffMs: 30 * 1000
};

const CDN_BASE = "https://assets.northaventrail.org/json";

/* ----------------------------
   Internal state
   ---------------------------- */

let mapRef = null;
let pageVisible = true;

let timers = {
  sheep: null,
  overlay: null
};

let lastOverlayState = null;
let lastSheepFetch = 0;
let lastOverlayFetch = 0;

let grazingActive = false; // 🔑 authoritative switch

/* ----------------------------
   Existing trail (Mapbox dataset)
   ---------------------------- */

const MAPBOX_DATASET_OWNER = "wdawso";
const MAPBOX_TRAIL_DATASET = "cjok8y2it0b1x2vmhi8x52nfe";

function getExistingTrailUrl() {
  return (
    `https://api.mapbox.com/datasets/v1/${MAPBOX_DATASET_OWNER}/${MAPBOX_TRAIL_DATASET}/features` +
    `?access_token=${mapboxgl.accessToken}`
  );
}

function addExistingTrail(map) {
  if (map.getSource("existing-trail_source")) return;

  // Satellite raster layer — hidden by default, toggled via hamburger checkbox
  if (!map.getSource("mapbox-satellite-source")) {
    map.addSource("mapbox-satellite-source", {
      type: "raster",
      url: "mapbox://mapbox.satellite",
      tileSize: 256
    });
    map.addLayer({
      id: "mapbox-satellite",
      type: "raster",
      source: "mapbox-satellite-source",
      layout: { visibility: "none" }
    });
    // Trail line is added next so it renders on top of satellite
  }

  map.addSource("existing-trail_source", {
    type: "geojson",
    data: getExistingTrailUrl()
  });

  map.addLayer({
    id: "existing-trail_layer",
    type: "line",
    source: "existing-trail_source",
    layout: {
      "line-join": "round",
      "line-cap": "round"
    },
    paint: {
      "line-color": "#118452",
      "line-width": 2
    }
  });
}

/* ----------------------------
   Public entrypoint
   ---------------------------- */

function initializeDataPipeline(map) {
  mapRef = map;

  addExistingTrail(map);

  fetchOverlayState(true);
  fetchNoMowZones();

  startPolling();
}

/* ----------------------------
   Fetch helper
   ---------------------------- */

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    DATA_CONFIG.fetchTimeoutMs
  );

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// For stable/rarely-changing data — allows browser and CDN caching
async function fetchJsonStable(url) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    DATA_CONFIG.fetchTimeoutMs
  );

  try {
    const res = await fetch(url, {
      signal: controller.signal
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/* ----------------------------
   Sheep / Herd data
   ---------------------------- */

let _currentHerdLocation = null;

function setCurrentHerdLocation(lat, lng) {
  if (typeof lat === "number" && typeof lng === "number") {
    _currentHerdLocation = { lat, lng };
  }
}

function getCurrentHerdLocation() {
  return _currentHerdLocation;
}

async function fetchSheepData() {
  if (!pageVisible || !grazingActive) return;

  try {
    const data = await fetchJson(`${CDN_BASE}/sheep-locations.v2026.geojson`);
    lastSheepFetch = Date.now();

    if (typeof renderAllHerds === "function") {
      renderAllHerds(data, mapRef);
    }
  } catch (err) {
    logCaughtError("fetchSheepData", err, { phase: "sheep fetch" });
    scheduleRetry("sheep", fetchSheepData);
  }
}

/* ----------------------------
   No-mow zones (load once)
   ---------------------------- */

async function fetchNoMowZones() {
  try {
    const geojson = await fetchJsonStable(`${CDN_BASE}/no-mow-zones.v2026.geojson`);

    if (typeof updateNoMowLayers === "function") {
      updateNoMowLayers(mapRef, geojson);
    }
  } catch (err) {
    logCaughtError("fetchNoMowZones", err, { phase: "no mow zone fetch" });
    console.warn("No-mow fetch failed:", err.message);
  }
}

/* ----------------------------
   Overlay / state machine
   ---------------------------- */

async function fetchOverlayState(isInitial = false) {
  if (!pageVisible) return;

  try {
    const overlay = await fetchJson(`${CDN_BASE}/overlay-state.v2026.json`);
    lastOverlayFetch = Date.now();

    if (!overlay || !overlay.state) return;

    if (overlay.state !== lastOverlayState) {
      handleOverlayTransition(overlay.state);
      lastOverlayState = overlay.state;
    }

    if (typeof updateOverlayState === "function") {
      updateOverlayState(overlay);
    }

  } catch (err) {
    logCaughtError("fetchOverlayState", err, { phase: "overlay fetch" });
    scheduleRetry("overlay", fetchOverlayState);
  }
}

function handleOverlayTransition(state) {
  if (state === "grazing" || state === "active") {
    grazingActive = true;

    // immediate render
    fetchSheepData();
    showSheepUI();

  } else {
    grazingActive = false;

    clearAllHerds();
    hideSheepUI();
  }
}

/* ----------------------------
   Polling control
   ---------------------------- */

function startPolling() {
  stopPolling();

  timers.sheep = setInterval(fetchSheepData, DATA_CONFIG.sheepPollMs);
  timers.overlay = setInterval(fetchOverlayState, DATA_CONFIG.overlayPollMs);
}

function stopPolling() {
  Object.values(timers).forEach(t => t && clearInterval(t));
  timers.sheep = null;
  timers.overlay = null;
}

/* ----------------------------
   Retry logic
   ---------------------------- */

function scheduleRetry(key, fn) {
  if (!pageVisible) return;

  if (timers[key]) clearTimeout(timers[key]);

  timers[key] = setTimeout(fn, DATA_CONFIG.errorBackoffMs);
}

/* ----------------------------
   Visibility handling
   ---------------------------- */

function handlePageVisibility(isVisible) {
  pageVisible = isVisible;

  if (isVisible) {
    fetchOverlayState();
    if (grazingActive) fetchSheepData();
    startPolling();
  } else {
    stopPolling();
  }
}

/* ----------------------------
   Debug helpers
   ---------------------------- */

function getLastFetchTimes() {
  return {
    sheep: lastSheepFetch,
    overlay: lastOverlayFetch
  };
}

function clearAllHerds() {
  if (!mapRef) return;
  // ---- Remove herd markers ----
  Object.values(herdMarkers).forEach(marker => {
    try {
      marker.remove();
    } catch (e) {
      console.warn("clearAllHerds: marker removal failed:", e);
      logCaughtError?.("clearAllHerds", e);
    }
  });
  herdMarkers = {};

  // ---- Remove herd history layers & sources ----
  Object.keys(herdHistorySources).forEach(herdCode => {
    const sourceId = herdHistorySources[herdCode];
    const lineLayerId = `herd-${herdCode}-history-line`;

    if (map.getLayer(lineLayerId)) {
      map.removeLayer(lineLayerId);
    }

    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }
  });
  herdHistorySources = {};

  // ---- Close any open popups ----
  closeAllPopups();
}

/* ----------------------------
   Public surface
   ---------------------------- */

window.initializeDataPipeline = initializeDataPipeline;
window.handlePageVisibility = handlePageVisibility;

window.TAILS_DATA = {
  getLastFetchTimes,
  getCurrentHerdLocation
};
