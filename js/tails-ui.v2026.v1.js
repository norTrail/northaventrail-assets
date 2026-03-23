/* ============================================================
   Northaven TAILS — UI + State Rendering Layer
   ============================================================ */

/* ----------------------------
   Cached DOM references
   ---------------------------- */

const UI = {
  overlayBanner:  document.getElementById("overlay-banner"),
  overlayMessage: document.getElementById("overlayMessage"),
  overlayImage:   document.getElementById("overlayImage"),
  countdown:      document.getElementById("countdown"),

  controls:       document.getElementById("controls"),
  statusPill:     document.getElementById("status-pill"),

  tableBtn:       document.getElementById("toggleTableBtn"),
  zoomInBtn:      document.getElementById("zoom-sheep-btn"),
  zoomOutBtn:     document.getElementById("zoom-out-btn"),

  mapView:        document.getElementById("mapView"),
  tableView:      document.getElementById("tableView"),
  backToMapBtn:   document.getElementById("backToMapBtn"),

  openMapBtn:     document.getElementById("open-map-btn"),
  adaInfo:        document.getElementById("ada-info"),
  adaInfoLong:    document.getElementById("ada-long-text"),
  adaInfoShort:   document.getElementById("ada-short-text")
};


/* ----------------------------
   Internal UI state
   ---------------------------- */

let currentState = null;
let bannerCentered = false;
let countdownTimer = null;
let isZoomedToHerd = false;
let lastVisibleZoneCode = null;
let userHasScrolledTable = false;


/* ============================================================
   OVERLAY STATE RENDERING
   ============================================================ */

function updateOverlayState(state) {
  if (!state || !state.state) return;

  currentState = state;
  bannerCentered = false;

  clearCountdown();

  switch (state.state) {

    /* ---------------- COMING ---------------- */
    case "coming":
      showBanner();
      hideSheepUI();
      hideMapButtonAndLocation();
      UI.controls.style.display = "none";

      // Upddate the Overlay Message
      UI.overlayMessage.innerHTML =
        `The sheep and goats are coming!<br>${formatLongDate(state.startDate)}`;

      // Update the Status Pill
      UI.statusPill.innerText = "Coming";
      UI.statusPill.style.display = "block";

      UI.overlayImage.src = state.image || "";
      startCountdown(state.startDate);

      break;

    /* ---------------- SLEEPING ---------------- */
    case "sleeping":
      showBanner();
      hideSheepUI();
      hideMapButtonAndLocation();
      UI.controls.style.display = "none";

      UI.overlayMessage.innerHTML = "SHHHH!<br>The sheep and goats are sleeping!";
      UI.overlayImage.src = state.image || "";

      // Update the Status Pill
      UI.statusPill.innerText = "Sleeping";

      if (state.grazingStartHour) {
        /*UI.countdown.innerHTML =
          `The herd returns at ${to12Hour(state.grazingStartHour)}:00 ${amPm(state.grazingStartHour)}.`;*/
          const updateTextHour = `The herd returns at ${to12Hour(state.grazingStartHour)}:00 ${amPm(state.grazingStartHour)}.`;
          UI.adaInfoLong.innerHTML = updateTextHour;
          UI.adaInfoShort.innerHTML = updateTextHour;
      }

      break;

    /* ---------------- HISTORY ---------------- */
    case "history":
      showBanner();
      hideSheepUI();
      hideMapButtonAndLocation();
      UI.controls.style.display = "none";

      UI.overlayMessage.innerHTML =
        "They came, they nibbled, they frolicked.";
      UI.adaInfoLong.innerHTML = "Mission complete! Prairie restoration is underway.";
      UI.adaInfoShort.innerHTML = "Mission complete! Prairie restoration is underway.";
      /*UI.countdown.innerHTML =
        "Mission complete! Prairie restoration is underway.";*/


      UI.overlayImage.src = state.image || "";

      // Update the Status Pill
      UI.statusPill.innerText = "Finished";
      UI.statusPill.style.display = "block";

      break;

    /* ---------------- ACTIVE / GRAZING ---------------- */
    default:
      hideBanner();
      UI.controls.style.display = "";

      // Update the Status Pill
      UI.statusPill.innerText = "Grazing";
      UI.statusPill.style.display = "block";
      showSheepUI();
      break;
  }
}


/* ============================================================
   SHEEP MAP UI
   ============================================================ */

let herdMarkers = {};
let herdHistorySources = {};

function updateMarker(herdCode, herdObj, map) {
  const feature = herdObj.current?.features?.[0];
  if (!feature) {
   console.log(`No Sheep Data for Herd ${herdCode}: ${JSON.stringify(herdObj)}`);
   return;
 }

 const [lng, lat] = feature.geometry.coordinates;

 setCurrentHerdLocation(lat, lng);

// Show zoom ONLY once we have a valid herd location
if (UI.zoomInBtn && !isZoomedToHerd) {
  UI.zoomInBtn.style.display = "block";
  updateBottomUiState();
}

 const props = feature.properties;
 const color = herdObj.color || "#66BB66";
 const longText = props.trailSectionLong || "The herd is grazing on the trail."
 const shortText = feature.properties.trailSectionShort || "The herd is grazing on the trail."

 // Update existing marker
 if (herdMarkers[herdCode]) {
   herdMarkers[herdCode].setLngLat([lng, lat]);
   // Updating the google map button and location text
   showMapButtonAndLocation(lat, lng, shortText, longText)
   return;
 }

 // Create marker element
 const el = document.createElement("button");
 el.type = "button";
 el.className = "sheep-marker outlined-sheep-marker";
 el.innerHTML = `<span class="marker-inner">🐑</span>`;
 el.style.color = color;
 el.dataset.outline = color;
 el.title=`${props.herdName}`
 el.setAttribute('aria-label', `${props.herdName}: open details`);
 el.setAttribute("role","button");
 el.setAttribute("aria-pressed","false");

 el.addEventListener("mouseenter", () => el.classList.add("is-hover"));
 el.addEventListener("mouseleave", () => el.classList.remove("is-hover"));
 el.addEventListener('focus',      () => el.classList.add('is-hover'));
 el.addEventListener('blur',       () => el.classList.remove('is-hover'));

 el.addEventListener("click", e => {
   e.stopPropagation();

   closeAllPopups();
   el.setAttribute("aria-pressed","true");

   const popupHTML = `
     <h3>${props.herdName}</h3>
     <p>${props.sheepInfo}</p>
     <span
       class="gmaps-emoji"
       style="float:right;"
       onclick="openZoneGoogleMaps(${lat}, ${lng})"
       title="Open location in Google Maps"
     >
       <svg class="gmap-icon" width="22" height="22">
         <use href="#google-logo-color"></use>
       </svg>
     </span>
   `;
   const popup = new mapboxgl.Popup({ offset: 28 })
     .setLngLat([lng, lat])
     .setHTML(popupHTML)
     .addTo(map);
   openPopups.push(popup);
   popup.on("close", () => {
     const i = openPopups.indexOf(popup);
     if (i !== -1) openPopups.splice(i, 1);
   });
   currentFullPopup = popup;
 });

 herdMarkers[herdCode] = new mapboxgl.Marker({
   element: el,
   anchor: "center"
 })
   .setLngLat([lng, lat])
   .addTo(map);


// Show the hamburger
 const hamburgerElement = document.getElementById("hamburger");
 if (hamburgerElement) {hamburgerElement.style.display = "block";}

 // Updating the google map button and location text
 showMapButtonAndLocation(lat, lng, shortText, longText)
}

function updateHerdHistoryLine(herdCode, historyGeoJSON, color, map) {
  if (!historyGeoJSON || !historyGeoJSON.features?.length) {
    console.log(`No history data given: ${JSON.stringify(historyGeoJSON)}`)
    return;
  }

  const sourceId = `herd-${herdCode}-history-src`;
  const layerId  = `herd-${herdCode}-history-line`;

  // 🔑 RECORD THE SOURCE ID
  herdHistorySources[herdCode] = sourceId;

  // Update the existing line
  if (map.getSource(sourceId)) {
    map.getSource(sourceId).setData(historyGeoJSON);
    return;
  }

  // Create a new line
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

  // Determine if the line should be visible
  const showHistory = document.getElementById('showHistory').checked;
  /*const herdToggle = document.querySelector(`input[data-herd='${herdCode}']`);*/
  /*const herdVisible = herdToggle && herdToggle.checked;*/
  // -------------------------------------------
  // 3. Visibility logic ONLY (no adding/removing)
  // -------------------------------------------
  const visible = /*herdVisible &&*/ showHistory;

  map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
}

function renderAllHerds(data, map) {
  if (currentState?.state !== "active") {
    // Prevents this from being called before the OverlayState is returned
    return;
  }

  Object.entries(data).forEach(([herdCode, herdObj]) => {
    const feature = herdObj.current?.features?.[0];

    if (!feature) {
      console.log(`No data for herd ${herdCode}: ${JSON.stringify(herdObj)}`)
      return;
    }

    /*const checkbox = document.querySelector(
      `input[data-herd='${herdCode}']`
    );

    // Hide if unchecked
    if (checkbox && !checkbox.checked) {
      if (herdMarkers[herdCode]) {
        herdMarkers[herdCode].remove();
        delete herdMarkers[herdCode];
      }
      return;
    }*/

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
}


/* ============================================================
   NO-MOW ZONES (table lives elsewhere)
   ============================================================ */

const noMowZoneMarkers = {};
let selectedZoneCode = null;
let lastNoMowJSONString = null;

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

function updateNoMowLayers(map, geojson, force = false) {
  if (!map || !geojson || geojson.type !== "FeatureCollection") {
    UI.tableBtn.style.display = "none";
    return;
  }

  const jsonString = JSON.stringify(geojson);

  // Skip unchanged unless forced
  if (!force && jsonString === lastNoMowJSONString) return;
  lastNoMowJSONString = jsonString;

  // Show the table button
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

    const [lng, lat] = center;
    const code = props.zoneCode || props.zoneName || "zone";

    const el = document.createElement("button");
    el.type = "button";
    el.className = "no-mow-marker";
    el.innerHTML = `<span class="marker-inner">${props.icon || "🌼"}</span>`;
    el.title = props.zoneCode || "";

    const name = props.zoneName || "No-Mow Zone";
    const desc = props.description || "";

    el.setAttribute("aria-label", `${name}: open details`);

    el.addEventListener("keydown", ev => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        el.click();
      }
    });

    el.addEventListener("mouseenter", () => el.classList.add("is-hover"));
    el.addEventListener("mouseleave", () => el.classList.remove("is-hover"));
    el.addEventListener("focus", () => el.classList.add("is-hover"));
    el.addEventListener("blur", () => el.classList.remove("is-hover"));

    el.addEventListener("click", evt => {
      evt.stopPropagation();
      closeAllPopups();

      selectedZoneCode = code;

      const popupHTML = `
        <div class="popup-container">
          <h3>${name}</h3>
          <p>${desc}</p>

          <span
            class="gmaps-emoji popup-gmaps"
            onclick="openZoneGoogleMaps(${lat}, ${lng})"
            title="Open location in Google Maps">
            <svg class="gmap-icon" width="22" height="22">
              <use href="#google-logo-color"></use>
            </svg>
          </span>
        </div>
      `;

      const popup = new mapboxgl.Popup({
        closeButton: true,
        closeOnClick: true,
        offset: 15,
        className: props.popupClass || "custom-popup-brown"
      })
        .setLngLat(center)
        .setHTML(popupHTML)
        .addTo(map);
      popup.on("close", () => {
        selectedZoneCode = null;
        const i = openPopups.indexOf(popup);
        if (i !== -1) openPopups.splice(i, 1);
      });

      openPopups.push(popup);
      currentFullPopup = popup;
    });

    const marker = new mapboxgl.Marker(el, { anchor: "center" })
      .setLngLat(center)
      .addTo(map);

    noMowZoneMarkers[code] = { marker, element: el, feature };
  });

  /* ---------------------------
     Visibility toggle
     --------------------------- */

  const showNoMow = document.getElementById("showNoMow")?.checked;

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

  UI.tableBtn.style.display = showNoMow ? "block" : "none";
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
     grazeDateLong: f.properties.estimatedDateLong,
     grazeDateShort: f.properties.estimatedDateShort,
     code: f.properties.zoneCode,
     lng: f.properties.centerLng,
     lat: f.properties.centerLat,
     color: f.properties.color
   };
 });

 showTableView(zones);
}

UI.tableBtn?.addEventListener("click", () => {
  document.getElementById("mapView").style.display = "none";
  document.getElementById("tableView").style.display = "block";
  buildGrazingTable();
  updateBottomUiState();
});

UI.backToMapBtn?.addEventListener("click", () => {
  document.getElementById("tableView").style.display = "none";
  document.getElementById("mapView").style.display = "block";
  updateBottomUiState();
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
  table.innerHTML = "";

  // 1️⃣ Sort by date
  const sorted = [...zones].sort((a, b) => {
    return new Date(a.grazeDateLong) - new Date(b.grazeDateLong);
  });

  let lastDateLabel = "";

  sorted.forEach(zone => {
    const currentDate = zone.grazeDateLong;

    if (currentDate !== lastDateLabel) {
      const zonesForDate = sorted.filter(
        z => z.grazeDateLong === currentDate
      );
      const hasComing = zonesForDate.some(
        z => z.status === "Coming"
      );

      const headerTr = document.createElement("tr");
      headerTr.className = "date-header-row";
      headerTr.innerHTML = `
        <td colspan="3" class="date-header-cell">
          ${hasComing ? `${currentDate} – Estimated Date` : currentDate}
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

    tr.addEventListener("click", () => {
      selectedZoneCode = zone.code;
      focusNoMowZone(zone.code);
    });

    tr.innerHTML = `
      <td>${zone.name}</td>
      <td class="status-cell">${zone.status}</td>
      <td class="map-icons">
        <span class="status-emoji">${zone.statusIcon}</span>
        <span class="gmaps-emoji"
              onclick='event.stopPropagation();
                       openZoneGoogleMaps("${zone.lat}", "${zone.lng}")'>
          <svg class="gmap-icon" width="22" height="22">
            <use href="#google-logo-color"></use>
          </svg>
        </span>
      </td>
    `;

    table.appendChild(tr);
  });

  const targetCode = resolveInitialTableTarget(zones);

  requestAnimationFrame(() => {
    if (!targetCode) return;

    const container = document.getElementById("tableWrapper");
    const row = container?.querySelector(`tr[data-code="${targetCode}"]`);
    row?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "auto"
    });
  });
}

function resolveInitialTableTarget(zones) {
  // 1) Marker selection always wins
  if (selectedZoneCode) return selectedZoneCode;

  // 2) Restore only if the user actually scrolled before
  if (userHasScrolledTable && lastVisibleZoneCode) {
    return lastVisibleZoneCode;
  }

  // 3) First-time default behavior
  const now = zones.find(z => z.status === "Now Grazing");
  if (now) return now.code;

  const coming = zones.find(z => z.status === "Coming");
  if (coming) return coming.code;

  return null;
}

let tableScrollListenerAttached = false;

function attachTableScrollTrackingOnce() {
  if (tableScrollListenerAttached) return;

  const container = document.getElementById("tableWrapper");
  if (!container) return;

  container.addEventListener(
    "scroll",
    () => {
      userHasScrolledTable = true;
      lastVisibleZoneCode = getTopVisibleZoneCode();
    },
    { passive: true }
  );

  tableScrollListenerAttached = true;
}

document.addEventListener("DOMContentLoaded", () => {
  attachTableScrollTrackingOnce();
});


/* ============================================================
   UI HELPERS
   ============================================================ */


function showBanner() {
  UI.overlayBanner.style.display = "block";
  UI.statusPill.style.display = "none";
}

function hideBanner() {
  UI.overlayBanner.style.display = "none";
  bannerCentered = false;
}

function showSheepUI() {
  // Zoom button is data-driven, not state-driven
  updateBottomUiState();

  const hamburgerElement = document.getElementById("hamburger");
  if (hamburgerElement) { hamburgerElement.style.display = "block"; }
}

function hideSheepUI() {
  isZoomedToHerd = false;

  UI.zoomInBtn.style.display = "none";
  UI.zoomOutBtn.style.display = "none";
  updateBottomUiState();

  // hide the hamburger
   const hamburgerElement = document.getElementById("hamburger");
   if (hamburgerElement) {hamburgerElement.style.display = "none";}
}



/* ============================================================
   COUNTDOWN
   ============================================================ */

function startCountdown(startDate) {
  const start = new Date(startDate);

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
    if (d) parts.push(`${d} day${d !== 1 ? "s" : ""}`);
    if (h) parts.push(`${h} hour${h !== 1 ? "s" : ""}`);
    if (m) parts.push(`${m} minute${m !== 1 ? "s" : ""}`);

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
  UI.countdown.innerText = "";
}


/* ============================================================
   Google Map Button and Location Text Controls
   ============================================================ */

function showMapButtonAndLocation(lat, lng, shortText, longText) {
 if (!UI.openMapBtn || !UI.adaInfoLong || !UI.adaInfoShort) return;
 if (lat == null || lng == null) return;

 UI.openMapBtn.href = `https://www.google.com/maps?q=${lat},${lng}`;
 UI.openMapBtn.style.display = "inline-block";
 updateBottomUiState();

 UI.adaInfoLong.innerHTML = longText || "";
 UI.adaInfoShort.innerHTML = shortText || "";
}

function hideMapButtonAndLocation() {
  if (UI.openMapBtn) {
    UI.openMapBtn.style.display = "none";
    UI.openMapBtn.removeAttribute("href");
    updateBottomUiState();
  }

  if (UI.adaInfoLong) {
    UI.adaInfoLong.innerHTML = "";
  }
  if (UI.adaInfoShort) {
    UI.adaInfoShort.innerHTML = "";
  }
}


/* ============================================================
   UTILITIES
   ============================================================ */

function formatLongDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric"
    });
  } catch {
    return "";
  }
}

function to12Hour(h) {
  const n = h % 12;
  return n === 0 ? 12 : n;
}

function amPm(h) {
  return h >= 12 ? "pm" : "am";
}

/* FullscreenIframeControl removed — replaced by TrailmapFullscreen.FullscreenMapControl
   from trailmap-fullscreen.v1.js */

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

function closeAllPopups() {
  try {
    while (openPopups.length) {
      openPopups.pop().remove();
    }
    selectedZoneCode = null;
  } catch (error) {
    handleError?.(error.message, error.stack);
  }
}

function focusNoMowZone(zoneCode) {
  // Switch views
  const tableView = document.getElementById("tableView");
  const mapView   = document.getElementById("mapView");

  if (tableView) tableView.style.display = "none";
  if (mapView)   mapView.style.display = "block";

  const map = window.TAILS?.getMap?.();
  if (!map) {
    console.warn("focusNoMowZone: map not ready");
    return;
  }

  const obj = noMowZoneMarkers?.[zoneCode];
  if (!obj || !obj.feature) {
    console.warn("focusNoMowZone: zone not found", zoneCode);
    return;
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
    return;
  }

  // Open popup (same behavior as before)
  if (obj.element) {
    obj.element.click();
  }

  // Fly map
  map.flyTo({
    center,
    zoom: 15,
    essential: true
  });
}

function updateBottomUiState() {
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

/* updateSafeViewport and viewport listeners removed —
   owned by trailmap-fullscreen.v1.js via TrailmapFullscreen.attachSafeViewportListenersOnce() */

/* ============================================================
   PUBLIC API
   ============================================================ */

window.updateOverlayState = updateOverlayState;
window.renderAllHerds  = renderAllHerds;
window.updateNoMowLayers  = updateNoMowLayers;
window.zoomToHerd = zoomToHerd;
window.closeAllPopups = closeAllPopups;
window.showSheepUI = showSheepUI;
window.hideSheepUI = hideSheepUI;
window.updateBottomUiState = updateBottomUiState;
