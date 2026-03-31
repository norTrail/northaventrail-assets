/* ============================================================
   Northaven TAILS — Data & State Pipeline
   ============================================================ */

/* ----------------------------
   Global dependencies
   The following are initialized by tails-init.v2026.v1.js and
   must be present before herd rendering functions are called:
     herdMarkers        {Object}   herd code → Mapbox Marker
     herdHistorySources {Object}   herd code → source ID string
     closeAllPopups     {Function} closes all open map popups
     logCaughtError     {Function} server-side error reporter
     renderAllHerds     {Function} renders herd markers on the map
     updateNoMowLayers  {Function} updates no-mow zone layers
     updateOverlayState {Function} updates overlay UI state
     showSheepUI        {Function} makes sheep UI visible
     hideSheepUI        {Function} hides sheep UI
   ---------------------------- */

/* ----------------------------
   Configuration
   ---------------------------- */

const DATA_CONFIG = {
  sheepPollMs: 5 * 60 * 1000,
  overlayPollMs: 60 * 1000,
  fetchTimeoutMs: 15 * 1000,
  errorBackoffMs: 30 * 1000,
  maxRetries: 5
};

const CDN_BASE = "https://assets.northaventrail.org/json";

/* Manifest URLs — clients fetch these first, then follow manifest.current */
const MANIFEST_SHEEP   = `${CDN_BASE}/sheep-locations.latest.json`;
const MANIFEST_NO_MOW  = `${CDN_BASE}/no-mow-zones.latest.json`;
const MANIFEST_OVERLAY = `${CDN_BASE}/overlay-state.latest.json`;

/* Last-known versioned URL per feed — skip data fetch when unchanged */
const _lastKnownVersion = {
  sheep:   null,
  noMow:   null,
  overlay: null
};

/* ----------------------------
   Internal state
   ---------------------------- */

let mapRef = null;
let pageVisible = true;

let timers = {
  sheep: null,
  overlay: null,
  sheepRetry: null,
  overlayRetry: null
};

const retryCounts = {
  sheep: 0,
  overlay: 0
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

let visibilityListenerBound = false;

function initializeDataPipeline(map, { skipExistingTrail = false } = {}) {
  mapRef = map;

  if (!skipExistingTrail) {
    addExistingTrail(map);
  }

  if (!visibilityListenerBound) {
    document.addEventListener("visibilitychange", onVisibilityChange);
    visibilityListenerBound = true;
  }

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
   Manifest resolver
   Fetches a *.latest.json manifest and returns the versioned data URL.
   Throws if the manifest is missing or malformed.
   ---------------------------- */

async function fetchManifest(manifestUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DATA_CONFIG.fetchTimeoutMs);
  try {
    const res = await fetch(manifestUrl, { signal: controller.signal });
    if (!res.ok) throw new Error(`Manifest HTTP ${res.status}: ${manifestUrl}`);
    const manifest = await res.json();
    if (!manifest || typeof manifest.current !== "string" || !manifest.current) {
      throw new Error(`Manifest missing "current" field: ${manifestUrl}`);
    }
    return manifest.current;
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
    const versionedUrl = await fetchManifest(MANIFEST_SHEEP);
    if (versionedUrl === _lastKnownVersion.sheep) return; // data unchanged

    const data = await fetchJson(versionedUrl);
    _lastKnownVersion.sheep = versionedUrl;
    lastSheepFetch = Date.now();
    retryCounts.sheep = 0;
    clearScheduledRetry("sheep");

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
    const versionedUrl = await fetchManifest(MANIFEST_NO_MOW);
    if (versionedUrl === _lastKnownVersion.noMow) return; // data unchanged

    const geojson = await fetchJsonStable(versionedUrl);
    _lastKnownVersion.noMow = versionedUrl;

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
    const versionedUrl = await fetchManifest(MANIFEST_OVERLAY);

    // Skip data fetch only on non-initial polls when version hasn't changed.
    // On initial load always fetch so the overlay state is applied.
    if (!isInitial && versionedUrl === _lastKnownVersion.overlay) return;

    const overlay = await fetchJson(versionedUrl);
    _lastKnownVersion.overlay = versionedUrl;
    lastOverlayFetch = Date.now();
    retryCounts.overlay = 0;
    clearScheduledRetry("overlay");

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
  clearScheduledRetry("sheep");
  clearScheduledRetry("overlay");

  timers.sheep = setInterval(fetchSheepData, DATA_CONFIG.sheepPollMs);
  timers.overlay = setInterval(fetchOverlayState, DATA_CONFIG.overlayPollMs);
}

function stopPolling() {
  Object.values(timers).forEach(t => t && clearTimeout(t));
  timers.sheep = null;
  timers.overlay = null;
  timers.sheepRetry = null;
  timers.overlayRetry = null;
}

/* ----------------------------
   Retry logic
   ---------------------------- */

function scheduleRetry(key, fn) {
  if (!pageVisible) return;

  if (retryCounts[key] >= DATA_CONFIG.maxRetries) {
    logCaughtError?.("scheduleRetry", new Error(`Max retries reached for ${key}`), { key, retries: retryCounts[key] });
    return;
  }

  clearScheduledRetry(key);
  retryCounts[key] += 1;
  timers[`${key}Retry`] = setTimeout(fn, DATA_CONFIG.errorBackoffMs);
}

function clearScheduledRetry(key) {
  const timerKey = `${key}Retry`;
  if (timers[timerKey]) {
    clearTimeout(timers[timerKey]);
    timers[timerKey] = null;
  }
}

/* ----------------------------
   Visibility handling
   ---------------------------- */

function handlePageVisibility(isVisible) {
  pageVisible = isVisible;

  if (isVisible) {
    retryCounts.sheep = 0;
    retryCounts.overlay = 0;
    fetchOverlayState();
    if (grazingActive) fetchSheepData();
    startPolling();
  } else {
    clearScheduledRetry("sheep");
    clearScheduledRetry("overlay");
    stopPolling();
  }
}

function onVisibilityChange() {
  handlePageVisibility(document.visibilityState === "visible");
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
  Object.values(herdMarkers || {}).forEach(marker => {
    try {
      marker.remove();
    } catch (e) {
      console.warn("clearAllHerds: marker removal failed:", e);
      logCaughtError?.("clearAllHerds", e);
    }
  });
  herdMarkers = {};

  // ---- Remove herd history layers & sources ----
  Object.keys(herdHistorySources || {}).forEach(herdCode => {
    const sourceId = herdHistorySources[herdCode];
    const lineLayerId = `herd-${herdCode}-history-line`;

    if (mapRef.getLayer(lineLayerId)) {
      mapRef.removeLayer(lineLayerId);
    }

    if (mapRef.getSource(sourceId)) {
      mapRef.removeSource(sourceId);
    }
  });
  herdHistorySources = {};

  // ---- Close any open popups ----
  if (typeof closeAllPopups === "function") closeAllPopups();
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
