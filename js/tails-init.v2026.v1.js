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
const WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbzZl6YsZZCYpm2K5R9O4y9FP_WkgPSBtE3cJ99IyGu7Cab5wK48bC4qP8vKt_vTkYJC9Q/exec";

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
    return;
  }

  if (!window.mapboxgl) {
    console.error("TAILS init: Mapbox GL JS not loaded");
    return;
  }

  if (!MAPBOX_TOKEN && !mapboxgl.accessToken) {
    console.error("TAILS init: Mapbox access token missing");
    return;
  }

  // Prefer explicit token if supplied
  if (MAPBOX_TOKEN) {
    mapboxgl.accessToken = MAPBOX_TOKEN;
  }

  initMap(mapEl);
  wireUIControls();
  wireVisibilityHandling();
}


/* ----------------------------
   Map creation
   ---------------------------- */

function initMap(container) {
  map = new mapboxgl.Map({
    container,
    style: MAP_STYLE,
    bounds: MAP_BOUNDS,
    antialias: false,
    attributionControl: true
  });



  map.addControl(new mapboxgl.NavigationControl(), "top-right");

  map.on("load", () => {
    mapReady = true;

    initGestureControl(map);

    if (typeof FullscreenIframeControl === "function") {
      map.addControl(new FullscreenIframeControl(), "top-right");
    }


    map.once("idle", () => {
      // Load the map data
      if (typeof addExistingTrail === "function") {
        addExistingTrail(map);
      }

      // Hand off to data + UI layers
      if (typeof initializeDataPipeline === "function") {
        initializeDataPipeline(map);
      }
    });


    // Get zoom & Center to use with Zoom Out Button
    fit_to_bounds_zoom = map.getZoom();
    const center = map.getCenter();
    fit_to_bounds_lng = center.lng;
    fit_to_bounds_lat = center.lat;

    // Wire controls
    wireHistoryToggle(map);
    wireNoMowToggle(map);
  });


}

/* ----------------------------
   UI wiring for controls check boxes
   ---------------------------- */

function wireHistoryToggle(map) {
 const checkbox = document.getElementById("showHistory");
 if (!checkbox) return;

 checkbox.addEventListener("change", () => {
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

  checkbox.addEventListener("change", () => {
    const show = checkbox.checked;
    const visibility = show ? "visible" : "none";

    // Polygon layers
    if (map.getLayer("nomow-fill")) {
      map.setLayoutProperty("nomow-fill", "visibility", visibility);
    }
    if (map.getLayer("nomow-outline")) {
      map.setLayoutProperty("nomow-outline", "visibility", visibility);
    }

    // Emoji markers
    Object.values(noMowZoneMarkers || {}).forEach(obj => {
      if (obj?.element) {
        obj.element.style.display = show ? "inline-flex" : "none";
      }
    });
  });
}


/* ----------------------------
   UI wiring
   ---------------------------- */

function wireUIControls() {
  // Hamburger menu
  const hamburger = document.getElementById("hamburger");
  const controls = document.getElementById("controls");

  if (hamburger && controls) {
    hamburger.addEventListener("click", () => {
      const open = controls.classList.toggle("show");
      hamburger.setAttribute("aria-expanded", String(open));
    });
  }


  // Zoom buttons
  const zoomSheepBtn = document.getElementById("zoom-sheep-btn");
  const zoomOutBtn = document.getElementById("zoom-out-btn");

  if (zoomSheepBtn) {
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
   Public accessors (used by other files)
   ---------------------------- */

function getMapInstance() {
  return mapReady ? map : null;
}

/* ----------------------------
   Logging of Client Side Errors
   ---------------------------- */


   function logClientError(fn, message, details) {
     try {
       const params = new URLSearchParams({
         action: "logClientError",
         fn,
         message,
         details: typeof details === "string"
           ? details
           : JSON.stringify(details)
       });

       // fire-and-forget
       fetch(`${WEBAPP_URL}?${params.toString()}`, {
         method: "GET",
         keepalive: true
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


window.addEventListener("error", (event) => {
  if (String(e.reason).includes("logClientError")) return;
  logClientError(
    "window.onerror",
    event.message,
    {
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error?.stack || null
    }
  );
});

window.addEventListener("unhandledrejection", (event) => {
  if (String(event.reason).includes("logClientError")) return;
  logClientError(
    "unhandledrejection",
    event.reason?.message || String(event.reason),
    {
      stack: event.reason?.stack || null
    }
  );
});

// Expose minimal globals intentionally
window.TAILS = {
  getMap: getMapInstance
};
