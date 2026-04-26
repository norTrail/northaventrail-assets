/* ============================================================
   Northaven TAILS — Initialization
   Native Squarespace Version
   ============================================================ */

/* ----------------------------
   Global configuration
   ---------------------------- */

// These are injected server-side in the old embed.
// For native use, define explicitly here.

const MAPBOX_TOKEN = "pk.eyJ1Ijoid2Rhd3NvIiwiYSI6ImNqb2c3MmJ5czAwbXYzd2xoN2o0cmFwZHYifQ.xhCPovJ-VNHHbVOrkjNdMA";

// Map defaults
const MAP_STYLE = "mapbox://styles/mapbox/streets-v11";
const MAP_BOUNDS = [
      [-96.88808, 32.87847], /* SW */
      [-96.75639, 32.91540]  /* NE */
    ];
const CENTER_TRAIL_LONGITUDE = -96.82124972833499;
const CENTER_TRAIL_LATITUDE  = 32.897175135881554;
const DEFAULT_TRAIL_ZOOM     = 12.7;
let fit_to_bounds_zoom = DEFAULT_TRAIL_ZOOM;
let fit_to_bounds_lng;
let fit_to_bounds_lat;


/* ----------------------------
   Shared state
   ---------------------------- */

let map = null;
let mapReady = false;
let appInitialized = false;
let mapInteractionLoading = true;


/* ----------------------------
   Entry point
   ---------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  bootstrapTailsApp();
});


/* ----------------------------
   Bootstrap sequence
   ---------------------------- */

async function bootstrapTailsApp() {
  if (appInitialized) return;
  appInitialized = true;

  // Basic DOM sanity check
  const mapEl = document.getElementById("map");
  if (!mapEl) {
    console.error("TAILS init: #map element not found");
    logClientError("bootstrapTailsApp", "TAILS init: #map element not found");
    return;
  }

  if (!window.mapboxgl) {
    console.error("TAILS init: Mapbox GL JS not loaded");
    logClientError("bootstrapTailsApp", "TAILS init: Mapbox GL JS not loaded");
    return;
  }

  if (!MAPBOX_TOKEN && !mapboxgl.accessToken) {
    console.error("TAILS init: Mapbox access token missing");
    logClientError("bootstrapTailsApp", "TAILS init: Mapbox access token missing");
    return;
  }

  // Prefer explicit token if supplied
  if (MAPBOX_TOKEN) {
    mapboxgl.accessToken = MAPBOX_TOKEN;
  }

  // ADA bar short text: announce state changes to screen readers
  const adaShortText = document.getElementById("ada-short-text");
  if (adaShortText) {
    adaShortText.setAttribute("aria-live", "polite");
    adaShortText.setAttribute("aria-atomic", "true");
  }

  // Inject "Finding the Flock..." loading overlay
  const mapView = document.getElementById("mapView");
  if (mapView && !document.getElementById("flock-loader")) {
    const loader = document.createElement("div");
    loader.id = "flock-loader";
    loader.className = "flock-loader";
    loader.setAttribute("role", "status");          // screen reader announces when injected
    loader.setAttribute("aria-live", "polite");
    loader.setAttribute("aria-label", "Finding the herd location. Please wait.");
    loader.innerHTML = `
      <div class="flock-loader-inner">
        <div class="flock-loader-pin">
          <svg viewBox="0 0 54 72" aria-hidden="true" style="color:#66BB66">
            <use href="#icon-sheep-pin"/>
          </svg>
          <span class="flock-loader-emoji" aria-hidden="true">🐑</span>
        </div>
        <div class="flock-loader-shadow"></div>
        <p class="flock-loader-text">Finding the Flock…</p>
      </div>
    `;
    mapView.appendChild(loader);
    mapView.setAttribute("aria-busy", "true");
  }

  // Inject page heading and skip link for screen readers / keyboard users
  // (WCAG 2.1 A — page titled; 2.4.1 — bypass blocks)
  if (window.NorthavenUtils) {
    window.NorthavenUtils.ensureSkipLink({
      id: "tails-skip-link",
      target: "#map",
      label: "Skip to map",
      container: "#tails-app"
    });
    window.NorthavenUtils.ensureSrOnlyHeading({
      text: "Northaven TAILS - Herd Grazing Map",
      container: "#tails-app"
    });
  }

  loadSvgSpriteOnce();  // load shared icon sprite from assets.northaventrail.org
  initMap(mapEl);
  wireUIControls();
  if (window.TAILS_SHARE?.getCurrentShareUrl) {
    const shareBtn = document.getElementById("share-button");
    if (shareBtn) {
      shareBtn.setAttribute("share-url", window.TAILS_SHARE.getCurrentShareUrl());
    }
  }
  window.NorthavenUtils?.labelUntitledIframes();
  window.NorthavenUtils?.fixNewWindowAriaLabels();
}


/* ----------------------------
   Map creation
   ---------------------------- */

function initMap(container) {
  // Label the map region for screen readers (WCAG 2.1 A — landmarks & labels)
  container.setAttribute("role", "region");
  container.setAttribute("aria-label", "Northaven Trail interactive map");

  map = new mapboxgl.Map({
    container,
    style: MAP_STYLE,
    bounds: MAP_BOUNDS,
    antialias: false,
    attributionControl: true
  });

  window.TrailmapError?.attachErrorLogging?.(map, {
    appName: "tails-2026",
    endpoint: window.TRAILMAP_ERROR_ENDPOINT || ""
  });

  map.addControl(new mapboxgl.NavigationControl(), "top-right");
  map.addControl(
    new mapboxgl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: false,
      showUserHeading: true
    }),
    "top-right"
  );

  // Home / Reset View control — returns map to default trail bounds
  class HomeControl {
    onAdd(m) {
      this._map = m;
      this._container = document.createElement("div");
      this._container.className = "mapboxgl-ctrl mapboxgl-ctrl-group";

      const btn = document.createElement("button");
      btn.className = "mapboxgl-ctrl-home";
      btn.type = "button";
      btn.title = "Reset map view";
      btn.setAttribute("aria-label", "Reset map view");
      btn.style.cssText = "display:flex;align-items:center;justify-content:center";
      // Icon from shared sprite (assets.northaventrail.org/img/icons.svg)
      btn.innerHTML = `<svg aria-hidden="true" focusable="false"
        width="18" height="18" style="color:#555">
        <use href="#icon-home"/>
      </svg>`;

      btn.onclick = () => {
        if (typeof closeAllPopups === "function") closeAllPopups();
        m.fitBounds(MAP_BOUNDS, { padding: 40 });
      };

      this._container.appendChild(btn);
      return this._container;
    }
    onRemove() {
      this._container.parentNode?.removeChild(this._container);
      this._map = undefined;
    }
  }
  map.addControl(new HomeControl(), "top-right");

  // -------------------------------------------------------------------
  // No-Mow Zone Legend — always-visible map control (like the trailmap)
  // Shown/hidden by wireNoMowToggle when the toggle changes.
  // -------------------------------------------------------------------
  class NoMowLegendControl {
    onAdd() {
      this._container = document.createElement("div");
      this._container.className = "mapboxgl-ctrl nomow-legend-ctrl";
      this._container.setAttribute("role", "region");
      this._container.setAttribute("aria-label", "Grazing area map key");

      this._container.innerHTML = `
        <p class="nomow-legend-title">Grazing Area Key</p>
        <div class="legend-item">
          <span class="legend-swatch" style="background:rgb(150,75,0)" aria-hidden="true"></span>
          <span class="legend-emoji" aria-hidden="true">🌱</span>
          <span class="legend-label">Grazed / finished</span>
        </div>
        <div class="legend-item">
          <span class="legend-swatch" style="background:rgb(95,160,219)" aria-hidden="true"></span>
          <span class="legend-emoji" aria-hidden="true">🐐</span>
          <span class="legend-label">Grazing now</span>
        </div>
        <div class="legend-item">
          <span class="legend-swatch" style="background:rgb(102,187,102)" aria-hidden="true"></span>
          <span class="legend-emoji" aria-hidden="true">🌼</span>
          <span class="legend-label">Coming up</span>
        </div>
      `;
      return this._container;
    }
    onRemove() {
      this._container.parentNode?.removeChild(this._container);
    }
  }

  map.on("load", () => {
    mapReady = true;

    // Improve the default Mapbox attribution toggle button label for screen readers.
    const attrBtn = document.querySelector('.mapboxgl-ctrl-attrib-button');
    if (attrBtn) attrBtn.setAttribute('aria-label', 'Toggle map attribution info');

    map.__gestureControlLoadingLocked = true;
    initGestureControl(map);
    setMapInteractionLoadingState(true);

    if (window.TrailmapFullscreen?.FullscreenMapControl) {
      map.addControl(new TrailmapFullscreen.FullscreenMapControl({
        appRootId: "tails-app",
        tableViewId: "tableView",
        onToggle: (isFs) => {
          if (typeof setMapFullscreenMode === "function") setMapFullscreenMode(isFs);
        }
      }), "top-right");
    }

    map.once("idle", () => {
      const initTasks = [];

      if (typeof addExistingTrail === "function") {
        initTasks.push(Promise.resolve().then(() => addExistingTrail(map)));
      }

      if (typeof initializeDataPipeline === "function") {
        initTasks.push(
          Promise.resolve().then(() => initializeDataPipeline(map, { skipExistingTrail: true }))
        );
      }

      Promise.all(initTasks).catch(err => {
        logClientError("tailsInit.mapIdle", err?.message || String(err), { stack: err?.stack || null });
      });
    });


    // Get zoom & Center to use with Zoom Out Button
    fit_to_bounds_zoom = map.getZoom();
    const center = map.getCenter();
    fit_to_bounds_lng = center.lng;
    fit_to_bounds_lat = center.lat;

    // Wire controls
    wireHistoryToggle(map);
    wireNoMowToggle(map);
    wireSatelliteToggle(map);

    // Add legend as a visible Mapbox control on the map itself
    map.addControl(new NoMowLegendControl(), "bottom-left");

    window.NorthavenUtils?.labelUntitledIframes();
  });


}

function setMapInteractionLoadingState(isLoading) {
  mapInteractionLoading = !!isLoading;

  if (map?.setInteractionLoadingState) {
    map.setInteractionLoadingState(mapInteractionLoading);
  } else if (map) {
    map.__gestureControlLoadingLocked = mapInteractionLoading;
  }

  const mapView = document.getElementById("mapView");
  if (mapView) {
    mapView.setAttribute("aria-busy", mapInteractionLoading ? "true" : "false");
  }
}

/* ----------------------------
   UI wiring for controls check boxes
   ---------------------------- */

function wireHistoryToggle(map) {
  const checkbox = document.getElementById("showHistory");
  if (!checkbox) return;

  // Restore saved preference; default to ON (checked)
  const saved = localStorage.getItem("tails-pref-showHistory");
  checkbox.checked = saved === null ? true : saved === "true";

  checkbox.addEventListener("change", () => {
    localStorage.setItem("tails-pref-showHistory", String(checkbox.checked));
    const visible = checkbox.checked ? "visible" : "none";

    // Toggle all herd history layers
    Object.keys(herdHistorySources || {}).forEach(herdCode => {
      const layerId = `herd-${herdCode}-history-line`;
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", visible);
      }
    });
  });
}

function wireNoMowToggle(map) {
  const checkbox = document.getElementById("showNoMow");
  if (!checkbox) return;

  closeAllPopups();

  // Restore saved preference; default to ON (checked)
  const saved = localStorage.getItem("tails-pref-showNoMow");
  checkbox.checked = saved === null ? true : saved === "true";
  // Mark initialized so updateNoMowLayers won't override this preference
  checkbox.dataset.initialized = "1";

  const syncLegendCtrl = (show) => {
    const ctrl = document.querySelector(".nomow-legend-ctrl");
    if (ctrl) ctrl.style.display = show ? "" : "none";
  };

  checkbox.addEventListener("change", () => {
    localStorage.setItem("tails-pref-showNoMow", String(checkbox.checked));
    const show = checkbox.checked;
    const visibility = show ? "visible" : "none";

    if (!show && typeof closeAllPopups === "function") {
      closeAllPopups();
    }

    // Polygon layer
    if (map.getLayer("no-mow-zones-layer")) {
      map.setLayoutProperty("no-mow-zones-layer", "visibility", visibility);
    }

    // Emoji markers
    Object.values(noMowZoneMarkers || {}).forEach(obj => {
      if (obj?.element) {
        obj.element.style.display = show ? "inline-flex" : "none";
      }
    });

    // Show/hide the map legend control to match
    syncLegendCtrl(show);
  });

  // Sync legend visibility with saved initial state
  syncLegendCtrl(checkbox.checked);
}


/* ----------------------------
   UI wiring
   ---------------------------- */

function wireUIControls() {
  // Hamburger menu
  const hamburger = document.getElementById("hamburger");
  const controls = document.getElementById("controls");

  if (hamburger && controls) {
    hamburger.title = "Map options";
    hamburger.setAttribute("aria-label", hamburger.getAttribute("aria-label") || "Map options");
    hamburger.setAttribute("aria-controls", "controls");

    hamburger.addEventListener("click", () => {
      const open = controls.classList.toggle("show");
      hamburger.setAttribute("aria-expanded", String(open));
      if (open) {
        // Move focus to first interactive element in the menu
        const firstFocusable = controls.querySelector("input, button, a[href]");
        if (firstFocusable) firstFocusable.focus();
      }
    });

    // Dismiss menu with Escape key and return focus to trigger (WCAG 2.1 A)
    document.addEventListener("keydown", ev => {
      if (ev.key === "Escape" && controls.classList.contains("show")) {
        controls.classList.remove("show");
        hamburger.setAttribute("aria-expanded", "false");
        hamburger.focus();
      }
    });

    // Dismiss menu when clicking outside of it
    document.addEventListener("click", ev => {
      if (
        controls.classList.contains("show") &&
        !controls.contains(ev.target) &&
        !hamburger.contains(ev.target)
      ) {
        controls.classList.remove("show");
        hamburger.setAttribute("aria-expanded", "false");
      }
    });
  }


  // Replace the ← arrow in the Back to Map button with the map sprite icon + label
  const backToMapBtn = document.getElementById("backToMapBtn");
  if (backToMapBtn) {
    backToMapBtn.style.display      = "inline-flex";
    backToMapBtn.style.alignItems   = "center";
    backToMapBtn.style.gap          = "6px";
    backToMapBtn.innerHTML =
      `<svg aria-hidden="true" focusable="false" width="22" height="22" style="flex-shrink:0">` +
        `<use href="#icon-map"/>` +
      `</svg>` +
      `<span class="btn-label">Back to Map</span>`;
    backToMapBtn.setAttribute("aria-label", "Back to map view");
    backToMapBtn.title = "Back to map view";
  }

  // Zoom buttons
  const zoomSheepBtn = document.getElementById("zoom-sheep-btn");
  const zoomOutBtn = document.getElementById("zoom-out-btn");

  if (zoomSheepBtn) {
    zoomSheepBtn.title = "Zoom to herd location";
    zoomSheepBtn.setAttribute("aria-label", zoomSheepBtn.getAttribute("aria-label") || "Zoom to herd location");
    zoomSheepBtn.addEventListener("click", () => {
      isZoomedToHerd = true;

      zoomSheepBtn.style.display = "none";
      zoomOutBtn.style.display = "block";
      updateBottomUiState();
      if (typeof zoomToHerd === "function") {
        zoomToHerd(map);
      }
    });
  }

  if (zoomOutBtn) {
    zoomOutBtn.title = "Zoom to full trail";
    zoomOutBtn.setAttribute("aria-label", zoomOutBtn.getAttribute("aria-label") || "Zoom to full trail");
    zoomOutBtn.addEventListener("click", () => {
      if (!map) return;
      isZoomedToHerd = false;
      zoomSheepBtn.style.display = "block";
      zoomOutBtn.style.display = "none";
      updateBottomUiState();
      const lng  = fit_to_bounds_lng || CENTER_TRAIL_LONGITUDE;
      const lat = fit_to_bounds_lat || CENTER_TRAIL_LATITUDE;
      map.flyTo({
        center: [lng, lat],
        zoom: fit_to_bounds_zoom,
        speed: 1.0
      });
    });
  }
}


/* ----------------------------
   Page visibility handling
   ---------------------------- */

function wireVisibilityHandling() {
  document.addEventListener("visibilitychange", () => {
    const visible = document.visibilityState === "visible";

    if (typeof handlePageVisibility === "function") {
      handlePageVisibility(visible);
    }
  });
}


/* ----------------------------
   Satellite toggle
   ---------------------------- */

function wireSatelliteToggle(map) {
  // Inject checkbox into #controls if not already in HTML
  let cb = document.getElementById("showSatellite");
  if (!cb) {
    const controls = document.getElementById("controls");
    if (controls) {
      const label = document.createElement("label");
      label.className = "control-item";
      label.innerHTML = `<input type="checkbox" id="showSatellite"> Satellite View`;
      controls.appendChild(label);
      cb = label.querySelector("input");
    }
  }
  if (!cb) return;

  cb.addEventListener("change", () => {
    if (!map.getLayer("mapbox-satellite")) return;
    map.setLayoutProperty(
      "mapbox-satellite",
      "visibility",
      cb.checked ? "visible" : "none"
    );
  });
}


/* ----------------------------
   Shared SVG sprite loader
   (mirrors loadSvgSpriteOnce in trailmap-init.v1.js)
   ---------------------------- */

function loadSvgSpriteOnce() {
  window.NorthavenUtils.loadSvgSpriteOnce({
    onError: (err) => {
      logClientError("loadSvgSpriteOnce", err?.message || String(err), { stack: err?.stack || null });
    }
  });
}


/* ----------------------------
   Public accessors (used by other files)
   ---------------------------- */

function getMapInstance() {
  return mapReady ? map : null;
}

/* ----------------------------
   Logging of Client Side Errors
   ---------------------------- */

function logClientError(fn, message, details = {}) {
  try {
    window.TrailmapError?.logClientEvent?.({
      kind: "tails_client_error",
      app: "tails-2026",
      phase: fn,
      message: String(message || ""),
      stack: details?.stack || null,
      details
    });
  } catch (_) {
    // never throw from logging
  }
}

function logCaughtError(fn, err, extra = {}) {
  logClientError(fn, err?.message || String(err), {
    stack: err?.stack || null,
    ...extra
  });
}

// Expose minimal globals intentionally
window.TAILS = {
  getMap: getMapInstance,
  setLoadingState: setMapInteractionLoadingState,
  isLoading: () => mapInteractionLoading
};
