/* ============================================================
   trailmap-init.js
   - Constants + shared state
   - Map creation
   - Static sources/layers (trail lines)
   - Marker data fetch + layer creation
   ============================================================ */

/* ---------- Core constants ---------- */

const VISIBLE = 'visible';

// Manifest URL for trail POI data — resolved at runtime to the current versioned file
const URL_MARKER_MANIFEST = 'https://assets.northaventrail.org/json/trail-poi.latest.json';

const GOOGLE_MAP_URL = 'https://maps.google.com/maps?q=';
const APPLE_MAP_URL = 'https://maps.apple.com/?z=20&q=';

const PAGE_TITLE = 'Trail Map - Friends of Northaven Trail';
const LOCATION_PARM = 'loc';
const COORDINATES_PARM = 'cords';
const COORDINATES_PARM_ARRAY = 'cords_array';
const ZOOM_PARM = 'z';
const PAGE_TITLE_PARM = 'pt';
const BEARING_PARAM = 'b';
const PITCH_PARAM = 'pi';
const SATELLITE_PARAM = 'si';
const GROUP_FILTER_PARAM = 'f';
const URL_FIXED_NUMBER = 5;

const MARKER_HEIGHT = 25;
const MARKER_RADIUS = 10;
const LINEAR_OFFSET = 5;

const POP_UP_OFFSET = {
  top: [0, 0],
  'top-left': [0, 0],
  'top-right': [0, 0],
  bottom: [0, -MARKER_HEIGHT],
  'bottom-left': [LINEAR_OFFSET, (MARKER_HEIGHT - MARKER_RADIUS + LINEAR_OFFSET) * -1],
  'bottom-right': [-LINEAR_OFFSET, (MARKER_HEIGHT - MARKER_RADIUS + LINEAR_OFFSET) * -1],
  left: [MARKER_RADIUS, (MARKER_HEIGHT - MARKER_RADIUS) * -1],
  right: [-MARKER_RADIUS, (MARKER_HEIGHT - MARKER_RADIUS) * -1]
};

const POP_UP_MAX_WIDTH = '280px';

const MAP_LIGHT_BOX_ID = 'lightbox-map';
const MAP_LIGHT_BOX_CONTENT_ID = 'lightbox-content-map';

let suppressMapEvents = false;

let mapInitialIdleCompleted = false;

/* ---------- Mapbox config ---------- */

mapboxgl.accessToken =
  'pk.eyJ1Ijoid2Rhd3NvIiwiYSI6ImNqb2c3Mnp2ZDAxejUzcHFsZnd4dzBwdjEifQ.MkKU0IkjSftsGF7GjF7dXQ';

const URL_EXISTING_TRAIL =
  'https://api.mapbox.com/datasets/v1/wdawso/cjok8y2it0b1x2vmhi8x52nfe/features?access_token=' +
  mapboxgl.accessToken;

const URL_EXPANSION_TRAIL =
  'https://api.mapbox.com/datasets/v1/wdawso/cjokaqnst0d602vmhqyxb317i/features?access_token=' +
  mapboxgl.accessToken;

/* ---------- Shared mutable state ---------- */

let __rebuildInProgress = false;
let __onReinitRunning = false;

let map = null;

let poiData = null;

let startupFilter = null;

let DEFAULT_ZOOM = 12;
const DEFAULT_FLYTO_ZOOM = 16;

let DEFAULT_COORDS = [-96.822, 32.899];

const DEFAULT_BEARING = 0;
const DEFAULT_PITCH = 0;
const DEFAULT_SATELLITE = 'none';

const MAP_BOUNDS = [
  [-96.75639, 32.9154],
  [-96.88808, 32.87847]
];

let flyToFeature = null;
let popupFeature = null;
let activeFeatureID = null;
let dataFilter = null;

let backButton = false;
let forcedClosePopup = false;
let resetCoordinates = false;

/* ---------- Startup ---------- */

if (window.NorthavenUtils) {
  window.NorthavenUtils.ensureSkipLink({
    target: (typeof SKIP_LINK_TARGET !== 'undefined' ? SKIP_LINK_TARGET : null) || '#map',
    label: (typeof SKIP_LINK_LABEL !== 'undefined' ? SKIP_LINK_LABEL : null) || 'Skip to Map Content'
  });
  window.NorthavenUtils.patchSquarespaceA11y();
}

function bootWhenReady() {
  if (!window.TrailmapError) return setTimeout(bootWhenReady, 10);
  loadWindow();
}
bootWhenReady();

/* ============================================================
   loadWindow()
   - build legend UI
   - create map
   - add base trail sources/layers on load
   - fetch marker data (which adds marker layer + controls + events)
   ============================================================ */

function loadWindow() {
  // Making sure the map element is there
  if (!document.getElementById('map')) {
    console.warn('Trail map container not found — skipping init');
    return;
  }

  // Skip map init for crawlers — they can't render WebGL and generate noisy errors
  if (/bot|crawler|spider|headless|bingbot|bingpreview|facebookexternalhit|slurp|duckduckbot|yandex|semrush/i.test(navigator.userAgent)) {
    return;
  }

  // Create map
  let recovery = null;
  let mapLoadWatchdog = null;
  let watchdogCleanup_ = null;

  function clearMapFailureWatchdog_() {
    if (mapLoadWatchdog) {
      clearTimeout(mapLoadWatchdog);
      mapLoadWatchdog = null;
    }
    if (watchdogCleanup_) {
      watchdogCleanup_();
      watchdogCleanup_ = null;
    }
  }

  function showMapFallback_(reason = "map_unavailable") {
    clearMapFailureWatchdog_();

    const mapEl = document.getElementById("map");
    if (!mapEl) return;

    mapEl.replaceChildren();

    const wrapper = document.createElement("div");
    wrapper.className = "trailmap-fallback";
    wrapper.setAttribute("role", "status");
    wrapper.setAttribute("aria-live", "polite");
    wrapper.style.cssText = [
      "display:flex",
      "flex-direction:column",
      "justify-content:center",
      "align-items:flex-start",
      "gap:14px",
      "min-height:320px",
      "padding:24px",
      "border-radius:18px",
      "background:linear-gradient(135deg,#f5efe4 0%,#d8ead9 100%)",
      "box-sizing:border-box"
    ].join(";");

    wrapper.innerHTML = `
      <div style="max-width:30rem">
        <h2 style="margin:0 0 8px;font-size:1.35rem;line-height:1.2">Map unavailable right now</h2>
        <p style="margin:0 0 10px">The interactive map could not load, but trail information is still available below.</p>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px">
        <a href="https://northaventrail.org/trailmap" style="display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:999px;background:#118452;color:#fff;text-decoration:none;font-weight:600">Reload trail map</a>
        <a href="https://maps.google.com/maps?q=32.899,-96.822" style="display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:999px;border:1px solid #118452;color:#118452;background:#fff;text-decoration:none;font-weight:600">Open trail in Google Maps</a>
      </div>
    `;

    mapEl.appendChild(wrapper);
    window.TrailmapError?.logClientEvent?.({
      kind: "map_fallback_rendered",
      app: getAppNameFromUrl({ fallback: "northaven-trail" }),
      reason
    });
  }

  function buildMap() {
    function isMobileViewport() {
      return window.matchMedia('(max-width: 768px)').matches ||
        window.matchMedia('(pointer: coarse)').matches;
    }

    const el = document.getElementById("map");
    if (!(el instanceof HTMLElement)) {
      window.__trailCrumbs?.add("buildMap:no_container");
      window.TrailmapError?.logClientEvent?.({
        kind: "buildMap_no_container",
        message: "Map container missing"
      });
      return null;
    }

    el.replaceChildren(); // clears safely (modern browsers)

    const isMobile = isMobileViewport();

    let m = null;
    try {
      m = new mapboxgl.Map({
        container: el,
        style: "mapbox://styles/wdawso/clp9xd8ba002901qj95smdg2f",
        bounds: MAP_BOUNDS,
        maxTileCacheSize: isMobile ? 50 : 200,
        minTileCacheSize: isMobile ? 20 : 100
      });
    } catch (err) {
      window.TrailmapError?.logClientEvent?.({
        kind: "buildMap_failed",
        app: getAppNameFromUrl({ fallback: "northaven-trail" }),
        message: err?.message || String(err),
        stack: err?.stack || null
      });
      showMapFallback_("build_map_failed");
      return null;
    }

    if (window.TrailmapError?.attachErrorLogging) {
      window.TrailmapError.attachErrorLogging(m, {
        appName: getAppNameFromUrl({ fallback: "northaven-trail" }),
        endpoint: window.TRAILMAP_ERROR_ENDPOINT
      });
    }
    return m;
  }

  // Inject loading overlay — removed in map.once('idle') below
  (function injectMapLoadingOverlay_() {
    const mapEl = document.getElementById("map");
    if (!mapEl || document.getElementById("map-loading-overlay")) return;
    mapEl.insertAdjacentHTML("beforeend", `
      <div id="map-loading-overlay" class="map-loading-overlay" role="status" aria-label="Map loading">
        <div class="map-spinner" aria-hidden="true">
          <div class="rect1"></div>
          <div class="rect2"></div>
          <div class="rect3"></div>
          <div class="rect4"></div>
          <div class="rect5"></div>
        </div>
        <div class="map-loading-label">Loading map\u2026</div>
      </div>
    `);
  })();

  map = buildMap();
  if (!map) return;

  // Visibility-aware watchdog: only counts elapsed time while the page is visible.
  // Prevents false map_load_timeout fallbacks when iOS backgrounds the tab during load.
  (function installVisibilityWatchdog_() {
    const TIMEOUT_MS = 15000;
    let remaining = TIMEOUT_MS;
    let startedAt = null;
    let timer = null;

    function startTimer() {
      if (timer !== null) return;
      startedAt = Date.now();
      timer = setTimeout(() => {
        document.removeEventListener("visibilitychange", onVisChange);
        showMapFallback_("map_load_timeout");
      }, remaining);
      mapLoadWatchdog = timer;
    }

    function pauseTimer() {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
      mapLoadWatchdog = null;
      remaining -= (Date.now() - startedAt);
      if (remaining <= 0) {
        document.removeEventListener("visibilitychange", onVisChange);
        showMapFallback_("map_load_timeout");
      }
    }

    function onVisChange() {
      if (document.visibilityState === "hidden") {
        pauseTimer();
      } else {
        startTimer();
      }
    }

    watchdogCleanup_ = () => document.removeEventListener("visibilitychange", onVisChange);
    document.addEventListener("visibilitychange", onVisChange);

    if (document.visibilityState === "visible") {
      startTimer();
    }
  })();

  map.once("load", clearMapFailureWatchdog_);
  map.once("idle", clearMapFailureWatchdog_);
  map.on("error", (e) => {
    const msg = e?.error?.message || e?.message || "";
    if (/style|sprite|source|network|webgl/i.test(msg)) {
      showMapFallback_("map_error");
    }
  });

  function runWhenLoaded_(m, fn) {
    if (m?.loaded?.()) return fn();
    m?.once?.("load", fn);
  }

  function hardenLayerProperties(m) {
    try {
      const style = m.getStyle();
      if (!style?.layers) return;
      style.layers.forEach(l => {
        // Fix any property using ["get", "s"] for symbol-sort-key, or other common numeric props
        if (l.layout?.['symbol-sort-key']) {
          const val = l.layout['symbol-sort-key'];
          // If it's a direct ["get", "s"] or similar, wrap it
          if (Array.isArray(val) && val[0] === 'get' && val[1] === 's') {
            m.setLayoutProperty(l.id, 'symbol-sort-key', ["number", ["coalesce", ["get", "s"], 10], 10]);
          }
        }
        // Also icon-size can be problematic if data-driven
        if (l.layout?.['icon-size']) {
          const val = l.layout['icon-size'];
          if (Array.isArray(val) && val.includes('get')) {
            m.setLayoutProperty(l.id, 'icon-size', ["number", ["coalesce", val, 0.5], 0.5]);
          }
        }
      });
    } catch (err) {
      console.warn("[Trailmap] Global hardening failed:", err);
    }
  }

  window.onMapReinit = (newMap, info) => {
    try {
      window.__trailCrumbs?.add("map:reinit", info || {});

      map = newMap;

      runWhenLoaded_(newMap, () => {
        hardenLayerProperties(newMap);

        if (recovery?.attach) {
          recovery.attach(newMap);
        } else {
          addBaseTrailLayers_();
          wireBaseLayerHoverEvents_();

          if (typeof ISSUE_TRACKER_MODE !== 'undefined' && ISSUE_TRACKER_MODE) {
            installMapControls_();
            if (typeof initGestureControl === "function") initGestureControl(newMap);
            window.onIssueTrackerMapReady?.(newMap);
          } else {
            getMarkerData();
            if (typeof setShareButton === "function") setShareButton();
            if (typeof initGestureControl === "function") initGestureControl(newMap);
            if (typeof SHOW_MONARCH_WAY !== "undefined" && SHOW_MONARCH_WAY &&
              typeof window.initMonarchWayPopups === "function") {
              newMap.once("idle", () => window.initMonarchWayPopups(newMap));
            }
          }
        }
      });
    } catch (e) {
      window.__trailCrumbs?.add("reinit:fail", { msg: e?.message });
      window.TrailmapError?.logClientEvent?.({
        kind: "reinit_error",
        message: String(e?.message || e),
        stack: e?.stack,
        info
      });
    }
  };

  installSafariMapKeepAlive_(map, {
    rebuildMap: () => buildMap()
  });

  function setupDebug() {
    const DEBUG = new URLSearchParams(location.search).get("debug") === "1";

    if (DEBUG) {

      addDebugButtons_({
        onRebuild: () => {
          //console.log("[debug] rebuild clicked");
          if (__rebuildInProgress) {
            //console.log("[debug] rebuild already in progress — skipping");
            return;
          }

          __rebuildInProgress = true;
          try {
            if (typeof recovery?.recover === "function") {
              recovery.recover(map);
            } else {
              console.warn("[debug] recovery not available");
            }
          } catch (e) {
            console.warn("[debug] recovery error:", e);
          } finally {
            setTimeout(() => { __rebuildInProgress = false; }, 1500);
          }
        },

        onKeepAlive: () => {
          //console.log("[debug] keep-alive clicked");

          if (__rebuildInProgress) {
            //console.log("[debug] rebuild already in progress — skipping");
            return;
          }

          __rebuildInProgress = true;

          try {
            const c = map?.getCanvas?.();
            if (c) { c.width = 0; c.height = 0; }

            if (typeof window.__trailKeepAliveCheck === "function") {
              window.__trailKeepAliveCheck("debug-button");
            } else {
              console.warn("[debug] keep-alive hook not installed");
            }
          } finally {
            setTimeout(() => { __rebuildInProgress = false; }, 1500);
          }
        }
      });
    }
  }

  // install recovery once
  if (window.TrailmapError?.installWebglAutoRecovery) {
    recovery = window.TrailmapError.installWebglAutoRecovery({
      containerId: "map",
      buildMap,
      onReinit: (newMap) => {
        if (__onReinitRunning) return;
        __onReinitRunning = true;

        try {
          map = newMap;
          mapInitialIdleCompleted = false;

          recovery.attach(newMap);

          // Map is already loaded here (because recover() called onReinit inside load)
          hardenLayerProperties(newMap);
          addBaseTrailLayers_();
          wireBaseLayerHoverEvents_();

          if (typeof ISSUE_TRACKER_MODE !== 'undefined' && ISSUE_TRACKER_MODE) {
            installMapControls_();
            if (typeof initGestureControl === "function") initGestureControl(newMap);
            newMap.once("idle", () => { mapInitialIdleCompleted = true; });
            window.onIssueTrackerMapReady?.(newMap);
          } else {
            getMarkerData();
            setShareButton();
            newMap.once("idle", () => { mapInitialIdleCompleted = true; });
            if (typeof initGestureControl === "function") initGestureControl(newMap);
            // ✅ Re-init Monarch Way on rebuilt map
            if (typeof SHOW_MONARCH_WAY !== "undefined" && SHOW_MONARCH_WAY &&
              typeof window.initMonarchWayPopups === "function") {
              // style is loaded when onReinit fires, but idle is a safe "everything settled" moment
              setTimeout(() => window.initMonarchWayPopups(newMap), 0);
            }
          }

          /*if (typeof SHOW_LEGEND !== "undefined" && SHOW_LEGEND) {
            newMap.once("idle", () => {
              ensureLegendExists({ mountId: "mapView" });
              initLegendUI_();
              setupLegendClicked();
            });
          }*/
        } finally {
          setTimeout(() => { __onReinitRunning = false; }, 1500);
        }
      }
    });

    recovery.attach(map);
  }

  // set defaults derived from bounds-based init
  DEFAULT_ZOOM = Number(map.getZoom().toFixed(URL_FIXED_NUMBER));
  const latLng = map.getCenter();
  DEFAULT_COORDS = [
    Number(latLng.lng.toFixed(URL_FIXED_NUMBER)),
    Number(latLng.lat.toFixed(URL_FIXED_NUMBER))
  ];

  map.on('load', () => {
    // Improve the default Mapbox attribution toggle button label for screen readers.
    const attrBtn = document.querySelector('.mapboxgl-ctrl-attrib-button');
    if (attrBtn) attrBtn.setAttribute('aria-label', 'Toggle map attribution info');

    addBaseTrailLayers_();
    wireBaseLayerHoverEvents_();

    if (typeof ISSUE_TRACKER_MODE !== 'undefined' && ISSUE_TRACKER_MODE) {
      // Issue tracker mode: skip POI markers; install shared controls and hand off to issueTracker.js
      installMapControls_();
      if (typeof initGestureControl === "function") initGestureControl(map);
      map.once('idle', () => {
        document.getElementById("map-loading-overlay")?.remove();
        setupDebug();
        mapInitialIdleCompleted = true;
        window.onIssueTrackerMapReady?.(map);
      });
      return;
    }

    // (optional) community paths / wildflowers remain commented as you had them
    // addOptionalLayers_();

    getMarkerData(); // fetch + adds marker layer + then wires controls/events
    //setShareButton();

    if (typeof initGestureControl === "function") {
      initGestureControl(map);
    }


    map.once('idle', () => {
      document.getElementById("map-loading-overlay")?.remove();

      // Setup Monarch Way
      if (typeof SHOW_MONARCH_WAY !== "undefined" && SHOW_MONARCH_WAY &&
        typeof window.initMonarchWayPopups === "function") {
        window.initMonarchWayPopups(map);
      }

      // Setup the legend
      /*if (typeof SHOW_LEGEND !== 'undefined' && SHOW_LEGEND) {
        ensureLegendExists({ mountId: "mapView" });
        initLegendUI_();
        setupLegendClicked();
      }*/

      setupDebug();

      mapInitialIdleCompleted = true;
    });
  });

  // share button wiring (kept behavior)
  const shareBtn = document.getElementById('share-button');
  const shareWrap = document.getElementById('shareButton');

  if (shareBtn && shareWrap) {
    if (navigator.share) {
      shareBtn.addEventListener('click', () => {
        clickShare(
          shareBtn.getAttribute('share-title'),
          shareBtn.getAttribute('share-text'),
          shareBtn.getAttribute('share-url')
        );
      });
      shareWrap.style.display = '';
    } else {
      shareWrap.style.display = 'none';
    }
  }
}

/* ---------- Base trail layers ---------- */

function addBaseTrailLayers_() {
  // Existing trail line
  if (!map.getSource("existing_trail_source")) {
    map.addSource('existing_trail_source', {
      type: 'geojson',
      data: URL_EXISTING_TRAIL
    });
  }

  if (!map.getLayer("existing_trail")) {
    map.addLayer({
      id: 'existing_trail',
      type: 'line',
      source: 'existing_trail_source',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#118452', 'line-width': 5 }
    });
  }

  // Expansion trail line
  if (!map.getSource("expansion_trail_source")) {
    map.addSource('expansion_trail_source', {
      type: 'geojson',
      data: URL_EXPANSION_TRAIL
    });
  }

  if (!map.getLayer("future_expansions")) {
    map.addLayer({
      id: 'future_expansions',
      type: 'line',
      source: 'expansion_trail_source',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#dd7c1a',
        'line-width': 5,
        'line-dasharray': [0.1, 1.8]
      }
    });
  }

}

function wireBaseLayerHoverEvents_() {
  map.on('mouseenter', 'future_expansions', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'future_expansions', () => {
    map.getCanvas().style.cursor = '';
  });
}

/* ============================================================
   Marker fetch + layer creation
   ============================================================ */


function typeKeysForIcons_(payload, icons) {
  const iconSet = new Set(
    (icons || [])
      .map(s => String(s).trim().toLowerCase())
      .filter(Boolean)
  );

  const out = [];
  const types = payload?.defs?.types || {};

  for (const [tKey, def] of Object.entries(types)) {
    const icon = String(def?.i || "").trim().toLowerCase();
    if (icon && iconSet.has(icon)) out.push(tKey);
  }
  return out;
}

let __markerReqId = 0;
let __markerManifestCurrent = null; // last-known versioned URL from manifest

function getMarkerData() {
  const reqId = ++__markerReqId;
  const mapAtStart = map; // capture current instance

  // Resolve the manifest to find one or more versioned data URLs,
  // then fetch only if the selected version has changed (or on first load).
  const manifestController = new AbortController();
  const manifestTimeout = setTimeout(() => manifestController.abort(), 15000);

  fetch(URL_MARKER_MANIFEST, { signal: manifestController.signal })
    .then((r) => { clearTimeout(manifestTimeout); return r.json(); })
    .then((manifest) => {
      if (reqId !== __markerReqId) return;
      const currentUrl = String(manifest?.current || "").trim();
      const candidateUrls = window.NorthavenUtils.getManifestDataUrls(manifest);
      if (!candidateUrls.length) throw new Error("Manifest missing current POI URL");

      if (poiData && currentUrl && __markerManifestCurrent === currentUrl) return;

      return _fetchAndApplyMarkerData(reqId, mapAtStart, candidateUrls, 0);
    })
    .catch((err) => {
      clearTimeout(manifestTimeout);
      if (reqId !== __markerReqId || poiData) return;
      console.error("Marker manifest fetch failed:", err);
    });
}

function _fetchAndApplyMarkerData(reqId, mapAtStart, dataUrls, index = 0) {
  const dataUrl = Array.isArray(dataUrls) ? dataUrls[index] : dataUrls;
  if (!dataUrl) return Promise.reject(new Error("No marker data URL available"));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  // Use a cache-buster during this optimization rollout to ensure fresh data.
  const fetchUrl = dataUrl + (dataUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
  return fetch(fetchUrl, { signal: controller.signal })
    .then((r) => { clearTimeout(timeoutId); return r.json(); })
    .then((payload) => {
      if (reqId !== __markerReqId) return;
      if (!mapAtStart || map !== mapAtStart) return;
      if (mapAtStart._removed) return;

      if (!mapAtStart.isStyleLoaded || !mapAtStart.isStyleLoaded()) {
        mapAtStart.once("idle", () => {
          if (reqId !== __markerReqId) return;
          if (!mapAtStart || map !== mapAtStart || mapAtStart._removed) return;
          applyMarkerPayload_(mapAtStart, payload);
        });
        return;
      }

      applyMarkerPayload_(mapAtStart, payload);
      __markerManifestCurrent = dataUrl;
    })
    .catch((err) => {
      clearTimeout(timeoutId);
      if (Array.isArray(dataUrls) && index + 1 < dataUrls.length) {
        return _fetchAndApplyMarkerData(reqId, mapAtStart, dataUrls, index + 1);
      }
      console.error("Marker fetch failed:", err);
      window.__trailCrumbs?.add("markers:fetch_fail", { msg: err?.message });
      window.TrailmapError?.logClientEvent?.({
        kind: "marker_fetch_error",
        message: String(err?.message || err),
        stack: err?.stack,
        app: getAppNameFromUrl({ fallback: "northaven-trail" }),
        page: window.location?.pathname,
        ua: navigator?.userAgent
      });
      // Retry once after 8s (guards against stale map instance)
      setTimeout(() => {
        if (reqId === __markerReqId) getMarkerData();
      }, 8000);
      throw err;
    });
}

function applyMarkerPayload_(m, payload) {
  // payload = { type, name, v, scriptVersion, defs:{types:{}}, features:[...] }
  poiData = payload;
  const types = payload?.defs?.types || {};

  console.log(`[Trailmap] Optimization v5.1 Active. Data Version: ${payload?.scriptVersion || "legacy"}`);

  // Re-hydrate features: individual feature properties override type-level defaults.
  // This ensures that deduplicated JSON remains small over the wire while 
  // Mapbox expressions (using ["get", "i"] etc.) find all necessary styling data.
  const rehydratedFeatures = (payload?.features || []).map((f) => {
    const tKey = f.properties?.t;
    const typeDef = types[tKey] || {};

    // 1. Prepare defaults: Bridge 'l' to 'b'
    const defaults = Object.assign({ b: typeDef.l }, typeDef);

    // 2. Merge: Feature properties override type defaults
    const combined = Object.assign({}, defaults, f.properties);
    const clean = {};

    // 3. Final pass: Clean up values and normalize icons
    Object.keys(combined).forEach((k) => {
      let v = combined[k];
      if (v === null || v === undefined || v === "") return;

      // Force numeric types for keys Mapbox expects as numbers
      if (k === "s" || k === "s2") {
        const n = Number(v);
        v = Number.isFinite(n) ? n : 10;
      }

      // Force all icon names to be extensionless for Mapbox sprite compatibility
      if (k === "i") {
        v = String(v).replace(/\.svg$/i, "");
      }

      clean[k] = v;
    });

    return { ...f, properties: clean };
  });

  const geojson = {
    type: "FeatureCollection",
    name: payload?.name || "Markers",
    features: rehydratedFeatures
  };

  // Create/update the GeoJSON source
  const existingSrc = m.getSource("trail_markers_source");
  if (!existingSrc) {
    m.addSource("trail_markers_source", {
      type: "geojson",
      data: geojson
    });
  } else {
    // if you ever re-call getMarkerData(), keep source current
    existingSrc.setData(geojson);
  }

  const effLabel = ["coalesce", ["get", "b"], "Marker"];
  const effIcon = ["coalesce", ["get", "i"], "road"];
  const effColor = ["coalesce", ["get", "c"], "#1f7291"];

  // Add the markers layer once
  if (!m.getLayer("trail_markers")) {
    m.addLayer({
      id: "trail_markers",
      type: "symbol",
      source: "trail_markers_source",
      layout: {
        // label now comes from defs.types via properties.t
        "text-field": effLabel,
        "text-variable-anchor": ["top", "bottom-right", "bottom-left"],
        "text-justify": "auto",

        // icon now comes from defs.types via properties.t
        "icon-image": effIcon,

        "icon-offset": [0, -23],
        "text-offset": [0.5, -0.25],
        "icon-padding": 1.1,
        "icon-size": 0.5,

        // sortKey now comes from defs.types via properties.t
        "symbol-sort-key": ["number", ["coalesce", ["get", "s"], 10], 10]
      },
      paint: {
        "text-color": effColor,
        "text-opacity": [
          "case",
          ["boolean", ["feature-state", "active"], false],
          1,
          0.85
        ],
        "text-halo-color": [
          "case",
          ["boolean", ["feature-state", "active"], false],
          effColor,
          "white"
        ],
        "text-halo-width": [
          "case",
          ["boolean", ["feature-state", "active"], false],
          0.35,
          2
        ],
        "text-halo-blur": [
          "case",
          ["boolean", ["feature-state", "active"], false],
          0,
          2
        ]
      }
    });
  }

  // Filtering (unchanged), BUT your filterData() must now use properties.n (name)
  const params = (typeof getURLParams === 'function') ? getURLParams() : {};

  if (typeof ONLY_SHOW_LIST !== "undefined" && ONLY_SHOW_LIST !== null) {
    const onlyShow = normalizeOnlyShowListLabels_(ONLY_SHOW_LIST);

    if (onlyShow?.length) {
      // ONLY_SHOW_LIST contains type labels like "Parking Lot" / "Garden"
      const matchingTypeKeys = typeKeysForLabels_(poiData, onlyShow);

      if (matchingTypeKeys.length) {
        startupFilter = ["in", ["coalesce", ["get", "t"], ""], ["literal", matchingTypeKeys]];
        m.setFilter("trail_markers", startupFilter);
      } else {
        // nothing matches -> hide all
        startupFilter = ["==", ["get", "t"], "__no_match__"];
        m.setFilter("trail_markers", startupFilter);
      }
    } else {
      m.setFilter("trail_markers", null);
    }
  } else {
    filterData(params[GROUP_FILTER_PARAM]);
  }

  forcedClosePopup = true;
  goToElement();
  forcedClosePopup = false;

  installMapControls_();
  wireMapEventsAfterMarkers_();
  wireCustomSearchUI_();
  wirePopupEscapeOnce?.();

  m.once("idle", () => {
    buildSearchIndex_(poiData);
  });

  loadSvgSpriteOnce();

  setShareButton();
}

/* ---------- Controls: kept (and only added after marker load like your original) ---------- */

const __controls = new Map(); // key -> control instance

function addControlOnce(map, key, makeControl, position) {
  const prev = __controls.get(key);
  if (prev) {
    try { map.removeControl(prev); } catch { }
  }

  const control = makeControl();
  __controls.set(key, control);

  if (position) map.addControl(control, position);
  else map.addControl(control);

  return control;
}

function addFullscreenOnce(map) {
  const FS = window.TrailmapFullscreen;

  // If our custom fullscreen control isn't available, silently skip (or fallback)
  if (!FS?.FullscreenMapControl) {
    // Optional fallback:
    // addControlOnce(map, "fullscreen", () => new mapboxgl.FullscreenControl(), "top-right");
    return;
  }

  addControlOnce(
    map,
    "fullscreen",
    () => new FS.FullscreenMapControl({
      mapViewId: "mapView",
      tableViewId: null,
      appRootId: (typeof FULLSCREEN_APP_ROOT_ID !== 'undefined' ? FULLSCREEN_APP_ROOT_ID : null) || "map-app",
      onToggle: (isFs) => window.setMapFullscreenMode?.(isFs)
    }),
    "top-right"
  );
}


function installMapControls_() {
  // Navigation
  addControlOnce(map, "nav", () => new mapboxgl.NavigationControl());

  // Reset Map (Home) Control
  class HomeControl {
    onAdd(map) {
      this.map = map;
      this.container = document.createElement('div');
      this.container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
      this.button = document.createElement('button');
      this.button.className = 'mapboxgl-ctrl-home';
      this.button.type = 'button';
      this.button.title = 'Reset Map View';
      this.button.setAttribute('aria-label', 'Reset Map View');
      this.button.style.cssText = "display:flex;align-items:center;justify-content:center";
      this.button.innerHTML = '<svg aria-hidden="true" focusable="false" width="18" height="18" style="color:#555"><use href="#icon-home"/></svg>';

      this.button.onclick = () => {
        // Suppress zoomend/moveend URL updates during the fitBounds animation,
        // then replace the URL with a clean pathname once the animation settles.
        suppressMapEvents = true;
        this.map.fitBounds(MAP_BOUNDS, { padding: 40 });
        if (typeof forceClosePopups === 'function') forceClosePopups();
        if (typeof clearSelection_ === 'function') clearSelection_();
        this.map.once("moveend", () => {
          history.replaceState(null, document.title, location.pathname);
          suppressMapEvents = false;
        });
      };

      this.container.appendChild(this.button);
      return this.container;
    }
    onRemove() {
      this.container.parentNode.removeChild(this.container);
      this.map = undefined;
    }
  }
  addControlOnce(map, "home", () => new HomeControl(), "top-right");

  // Geolocate
  addControlOnce(map, "geo", () => new mapboxgl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
    showUserHeading: true
  }));

  // Search control only if location list exists and not in issue tracker mode (which has its own search)
  if (typeof window.initTrailmapSearch === "function" &&
    !(typeof ISSUE_TRACKER_MODE !== 'undefined' && ISSUE_TRACKER_MODE)) {
    window.initTrailmapSearch(map);
  }

  // Add legend control
  if (typeof SHOW_LEGEND !== "undefined" && SHOW_LEGEND) {
    addControlOnce(map, "legend", () => new LegendControl(), "bottom-right");
  }

  // Full Screen Controls
  addFullscreenOnce(map);

  // Satellite toggle (your custom control)
  const SATELLITE_ICON_ON = "https://assets.northaventrail.org/img/SatelliteOn.avif";
  const SATELLITE_ICON_OFF = "https://assets.northaventrail.org/img/SatelliteOff.avif";

  class SatelliteCustomControl {
    onAdd(mapInstance) {
      this.map = mapInstance;
      this.container = document.createElement('div');
      this.container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group satellite-custom-control';

      this.button = document.createElement('button');
      this.button.className = 'mapboxgl-ctrl-satellite';
      this.button.type = 'button';
      this.button.title = 'Turn on satellite imagery';
      this.button.setAttribute('aria-label', 'Turn on satellite imagery');

      // Span icon layer
      this.iconSpan = document.createElement('span');
      this.iconSpan.className = 'mapboxgl-ctrl-icon';
      this.iconSpan.setAttribute('aria-hidden', 'true');
      this.iconSpan.style.backgroundImage = `url("${SATELLITE_ICON_ON}")`;
      this.iconSpan.style.backgroundSize = 'contain';
      this.iconSpan.style.backgroundPosition = 'center';
      this.iconSpan.style.backgroundRepeat = 'no-repeat';
      this.iconSpan.style.mixBlendMode = 'multiply';

      this.button.appendChild(this.iconSpan);
      this.container.appendChild(this.button);

      this.button.addEventListener('click', () => {
        const visibility = this.map.getLayoutProperty('mapbox-satellite', 'visibility');

        if (visibility === VISIBLE) {
          this.map.setLayoutProperty('mapbox-satellite', 'visibility', 'none');
          this.iconSpan.style.backgroundImage = `url("${SATELLITE_ICON_ON}")`;
          this.button.title = 'Turn on satellite imagery';
          this.button.setAttribute('aria-label', 'Turn on satellite imagery');
        } else {
          this.map.setLayoutProperty('mapbox-satellite', 'visibility', VISIBLE);
          this.iconSpan.style.backgroundImage = `url("${SATELLITE_ICON_OFF}")`;
          this.button.title = 'Turn off satellite imagery';
          this.button.setAttribute('aria-label', 'Turn off satellite imagery');
        }
        updatePageDetails();
      });

      return this.container;
    }

    onRemove() {
      this.container.parentNode.removeChild(this.container);
      this.map = undefined;
    }
  }

  // Satellite custom control
  addControlOnce(map, "satellite", () => new SatelliteCustomControl(), "bottom-left");
}

function loadSvgSpriteOnce() {
  window.NorthavenUtils.loadSvgSpriteOnce();
}

function getAppNameFromUrl({ fallback = "trail-map" } = {}) {
  try {
    const { pathname } = window.location;
    if (!pathname) return fallback;

    // Normalize: remove leading/trailing slashes
    const clean = pathname.replace(/^\/+|\/+$/g, "");
    if (!clean) return fallback;

    // Use the last path segment
    let segment = clean.split("/").pop();

    // Safety: lowercase, allow only url-safe chars
    segment = segment
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "");

    return segment || fallback;
  } catch {
    return fallback;
  }
}
