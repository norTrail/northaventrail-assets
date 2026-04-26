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

/* Manifest URLs — year-scoped so each grazing season has its own pointer.
   Update the year constant when rolling over to a new season. */
const TAILS_YEAR       = "v2026";
const MANIFEST_SHEEP   = `${CDN_BASE}/sheep-locations.${TAILS_YEAR}.latest.json`;
const MANIFEST_NO_MOW  = `${CDN_BASE}/no-mow-zones.${TAILS_YEAR}.latest.json`;
const MANIFEST_OVERLAY = `${CDN_BASE}/overlay-state.${TAILS_YEAR}.latest.json`;

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

const TAILS_DATA_TEST_DATE_PARAM = "tailsTestDate";
const TAILS_DATA_TEST_STATE_PARAM = "tailsTestState";
const TAILS_ACTIVE_STATES = new Set(["grazing", "active"]);
const TAILS_NON_ACTIVE_STATES = new Set(["coming", "sleeping", "history"]);

function getSearchParams_() {
  return new URLSearchParams(window.location.search || "");
}

function parseTestDateOverride_() {
  const raw = String(getSearchParams_().get(TAILS_DATA_TEST_DATE_PARAM) || "").trim();
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const parsed = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    12,
    0,
    0,
    0
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getTestStateOverride_() {
  const raw = String(getSearchParams_().get(TAILS_DATA_TEST_STATE_PARAM) || "")
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (TAILS_ACTIVE_STATES.has(raw) || TAILS_NON_ACTIVE_STATES.has(raw)) {
    return raw === "active" ? "grazing" : raw;
  }
  return null;
}

function getEffectiveNow_() {
  return parseTestDateOverride_() || new Date();
}

function parseOverlayDate_(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getOverlayEndDate_(overlay) {
  const candidates = [
    overlay?.endDate,
    overlay?.historyDate,
    overlay?.eventEndDate,
    overlay?.grazingEndDate,
    overlay?.lastDate
  ];

  for (const candidate of candidates) {
    const parsed = parseOverlayDate_(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function deriveOverlayState_(overlay) {
  const forcedState = getTestStateOverride_();
  if (forcedState) return forcedState;

  const testNow = parseTestDateOverride_();
  if (!testNow) return String(overlay?.state || "").trim().toLowerCase();

  const startDate = parseOverlayDate_(overlay?.startDate);
  if (!startDate) return String(overlay?.state || "").trim().toLowerCase();

  if (testNow < startDate) return "coming";

  const endDate = getOverlayEndDate_(overlay);
  if (endDate && testNow > endDate) return "history";

  const startHour = Number(overlay?.grazingStartHour);
  const endHour = Number(overlay?.grazingEndHour);
  const currentHour = testNow.getHours() + (testNow.getMinutes() / 60);

  if (Number.isFinite(startHour) && Number.isFinite(endHour)) {
    if (currentHour < startHour || currentHour >= endHour) return "sleeping";
  }

  return "grazing";
}

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

async function fetchManifestData(manifestUrl, fetcher, lastKnownVersion, { allowCached = true } = {}) {
  const manifest = await fetchJson(manifestUrl);
  const currentUrl = String(manifest?.current || "").trim();
  const candidateUrls = window.NorthavenUtils.getManifestDataUrls(manifest);
  if (!candidateUrls.length) {
    throw new Error(`Manifest missing "current" field: ${manifestUrl}`);
  }

  if (allowCached && lastKnownVersion && currentUrl && lastKnownVersion === currentUrl) {
    return { url: lastKnownVersion, data: null, unchanged: true };
  }

  let lastError = null;
  for (const candidateUrl of candidateUrls) {
    try {
      const data = await fetcher(candidateUrl);
      return { url: candidateUrl, data, unchanged: false };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error(`Unable to fetch manifest-backed data: ${manifestUrl}`);
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
    const result = await fetchManifestData(MANIFEST_SHEEP, fetchJson, _lastKnownVersion.sheep);
    if (result.unchanged) return;

    _lastKnownVersion.sheep = result.url;
    lastSheepFetch = Date.now();
    retryCounts.sheep = 0;
    clearScheduledRetry("sheep");

    if (typeof renderAllHerds === "function") {
      renderAllHerds(result.data, mapRef);
    }
  } catch (err) {
    logCaughtError("fetchSheepData", err, {
      phase: "sheep fetch",
      feed: "sheep",
      manifestUrl: MANIFEST_SHEEP
    });
    scheduleRetry("sheep", fetchSheepData);
  }
}

/* ----------------------------
   No-mow zones (load once)
   ---------------------------- */

async function fetchNoMowZones() {
  try {
    const result = await fetchManifestData(MANIFEST_NO_MOW, fetchJsonStable, _lastKnownVersion.noMow);
    if (result.unchanged) return;

    _lastKnownVersion.noMow = result.url;

    if (typeof updateNoMowLayers === "function") {
      updateNoMowLayers(mapRef, result.data);
    }
  } catch (err) {
    logCaughtError("fetchNoMowZones", err, {
      phase: "no mow zone fetch",
      feed: "no-mow",
      manifestUrl: MANIFEST_NO_MOW
    });
    console.warn("No-mow fetch failed:", err.message);
  }
}

/* ----------------------------
   Overlay / state machine
   ---------------------------- */

async function fetchOverlayState(isInitial = false) {
  if (!pageVisible) return;

  try {
    const result = await fetchManifestData(
      MANIFEST_OVERLAY,
      fetchJson,
      isInitial ? null : _lastKnownVersion.overlay,
      { allowCached: !isInitial }
    );
    if (result.unchanged) return;

    const overlay = result.data;
    const derivedState = deriveOverlayState_(overlay);
    const effectiveOverlay = {
      ...overlay,
      state: derivedState
    };
    _lastKnownVersion.overlay = result.url;
    lastOverlayFetch = Date.now();
    retryCounts.overlay = 0;
    clearScheduledRetry("overlay");

    if (!effectiveOverlay || !effectiveOverlay.state) return;

    if (effectiveOverlay.state !== lastOverlayState) {
      handleOverlayTransition(effectiveOverlay.state);
      lastOverlayState = effectiveOverlay.state;
    }

    if (typeof updateOverlayState === "function") {
      updateOverlayState(effectiveOverlay);
    }

  } catch (err) {
    logCaughtError("fetchOverlayState", err, {
      phase: "overlay fetch",
      feed: "overlay",
      manifestUrl: MANIFEST_OVERLAY
    });
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
  getEffectiveNow: getEffectiveNow_,
  getLastFetchTimes,
  getCurrentHerdLocation
};
