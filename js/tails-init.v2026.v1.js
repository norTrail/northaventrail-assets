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

  // Inject sr-only page heading and skip link for screen readers / keyboard users
  // (WCAG 2.1 A — page titled; 2.4.1 — bypass blocks)
  const appRoot = document.getElementById("tails-app");
  if (appRoot && !document.getElementById("tails-skip-link")) {
    const skip = document.createElement("a");
    skip.id = "tails-skip-link";
    skip.href = "#map";
    skip.className = "sr-only";
    skip.textContent = "Skip to map";
    appRoot.prepend(skip);

    if (!document.querySelector('h1')) {
      const h1 = document.createElement("h1");
      h1.className = "sr-only";
      h1.textContent = "Northaven TAILS — Herd Grazing Map";
      appRoot.prepend(h1);
    }
  }

  injectDonateCta();
  loadSvgSpriteOnce();  // load shared icon sprite from assets.northaventrail.org
  initMap(mapEl);
  wireUIControls();
  labelUntiledIframes();
  
  // Fix Squarespace "Link opens in a new window" mismatch for ADA
  document.querySelectorAll('a[aria-label="Link opens in a new window"]').forEach(a => {
    if (a.textContent.trim()) {
      a.setAttribute('aria-label', a.textContent.trim() + ' (opens in a new window)');
    } else {
      a.removeAttribute('aria-label');
    }
  });
}


/* ----------------------------
   Donation CTA bar
   Injected above #ada-info, always visible across all overlay states.
   Fetches live raised/goal/matching data independently of donations.v1.js.
   ---------------------------- */

function injectDonateCta() {
  const appRoot = document.getElementById("tails-app");
  if (!appRoot || document.getElementById("tl-donate-bar")) return;

  const bar = document.createElement("div");
  bar.id = "tl-donate-bar";
  bar.className = "tl-donate-bar";
  bar.innerHTML = `
    <p class="tl-donate-headline">🐑 Support the TAILS Grazing Project</p>
    <div class="tl-donate-progress-row">
      <div class="tl-donate-track"
           role="progressbar" aria-valuemin="0" aria-valuemax="100"
           aria-valuenow="0" aria-label="Donation progress" id="tl-donate-track">
        <div class="tl-donate-fill" id="tl-donate-fill"></div>
      </div>
      <span class="tl-donate-pct" id="tl-donate-pct" aria-hidden="true">—</span>
    </div>
    <p class="tl-donate-status" id="tl-donate-status"></p>
    <p class="tl-donate-match" id="tl-donate-match"></p>
  `;

  // Insert before #ada-info so it appears at the top of the flex column
  const adaInfo = document.getElementById("ada-info");
  if (adaInfo) {
    appRoot.insertBefore(bar, adaInfo);
  } else {
    appRoot.prepend(bar);
  }

  fetchAndRenderDonations();

  // Refresh every 5 minutes (mirrors donations.v1.js interval)
  setInterval(fetchAndRenderDonations, 5 * 60 * 1000);
}

const DONATION_MANIFEST = "https://assets.northaventrail.org/json/tails-donations.v2026.latest.json";

async function fetchAndRenderDonations() {
  try {
    const manifest = await fetch(DONATION_MANIFEST, { cache: "no-store" }).then(r => r.json());
    const dataUrl = (manifest.current || manifest.fallback || "").trim();
    if (!dataUrl) return;
    const data = await fetch(dataUrl, { cache: "no-store" }).then(r => r.json());
    renderDonateCta(data);
  } catch (err) {
    // Keep existing UI on error; don't log — donation data is non-critical
  }
}

function renderDonateCta(data) {
  const sanitize = (v) => {
    if (v === "" || v == null) return NaN;
    if (typeof v === "number") return v;
    const s = String(v).replace(/[^0-9.\-]/g, "");
    return s ? parseFloat(s) : NaN;
  };
  const fmt = (n) => new Intl.NumberFormat(undefined, {
    style: "currency", currency: "USD", maximumFractionDigits: 0
  }).format(n);

  const raised    = sanitize(data.raised);
  const goal      = sanitize(data.goal);
  const matching  = sanitize(data.matchingFunds);
  const remaining = sanitize(data.remainingFunds ?? data.remainingFundsCell);

  const fill    = document.getElementById("tl-donate-fill");
  const track   = document.getElementById("tl-donate-track");
  const pct     = document.getElementById("tl-donate-pct");
  const status  = document.getElementById("tl-donate-status");
  const match   = document.getElementById("tl-donate-match");
  if (!fill) return;

  const pctVal = (goal > 0 && Number.isFinite(raised))
    ? Math.min(Math.round((raised / goal) * 100), 100) : 0;

  fill.style.width = pctVal + "%";
  if (track) {
    track.setAttribute("aria-valuenow", String(pctVal));
    track.setAttribute("aria-valuetext", `${pctVal}% of goal raised`);
  }
  if (pct) pct.textContent = pctVal + "%";

  if (status && Number.isFinite(raised) && Number.isFinite(goal)) {
    status.textContent = `We have raised ${fmt(raised)} of our ${fmt(goal)} goal so far. Thank you!`;
  }

  if (match) {
    if (Number.isFinite(remaining) && remaining > 0 && Number.isFinite(matching)) {
      match.hidden = false;
      match.innerHTML =
        `Double the baa-ng for your buck! Every $1 donated is matched.<br>` +
        `${fmt(matching)} in Matching Funds (${fmt(Math.max(0, remaining))} remaining) — your gift goes twice as far.`;
    } else {
      match.hidden = true;
      match.innerHTML = "";
    }
  }
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

  // Report Mapbox tile / style load errors to the remote logger
  map.on("error", (e) => {
    const msg = e?.error?.message || e?.message || "Mapbox map error";
    // Suppress noisy tile 403/404s to avoid flooding the log
    if (/\b(403|404)\b/.test(msg)) return;
    logClientError("mapbox.error", msg, {
      stack: e?.error?.stack || null,
      type: e?.type || null
    });
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
      this._container.setAttribute("aria-label", "No-mow zone map key");

      this._container.innerHTML = `
        <p class="nomow-legend-title">No-Mow Key</p>
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
        <div class="legend-item">
          <span class="legend-swatch" style="background:rgb(150,75,0)" aria-hidden="true"></span>
          <span class="legend-emoji" aria-hidden="true">🌱</span>
          <span class="legend-label">Grazed / finished</span>
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

    initGestureControl(map);

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

    labelUntiledIframes();
  });


}

/* ----------------------------
   Accessibility: title untitled iframes (Squarespace / Mapbox inject these)
   ---------------------------- */

function labelUntiledIframes() {
  const pageTitle = document.title || 'Northaven Trail';
  document.querySelectorAll('iframe:not([title])').forEach(f => {
    f.setAttribute('title', `${pageTitle} Video`);
  });
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
  if (document.getElementById("svg-sprite-inline")) return;
  fetch("https://assets.northaventrail.org/img/icons.svg", { cache: "force-cache" })
    .then(r => {
      if (!r.ok) throw new Error(`SVG sprite fetch failed: ${r.status}`);
      return r.text();
    })
    .then(svgText => {
      const wrap = document.createElement("div");
      wrap.id = "svg-sprite-inline";
      wrap.style.display = "none";
      wrap.innerHTML = svgText;
      document.body.prepend(wrap);
    })
    .catch(err => {
      console.warn("Could not load SVG sprite:", err);
      logClientError("loadSvgSpriteOnce", err?.message || String(err), { stack: err?.stack || null });
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
  if (String(event.message).includes("logClientError")) return;
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
