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


/* ============================================================
   OVERLAY STATE RENDERING
   ============================================================ */

function updateOverlayState(state) {
  if (!state || !state.state) return;

  currentState = state;

  clearCountdown();
  hideFlockLoader();

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
      UI.statusPill.dataset.state = "coming";
      UI.statusPill.style.display = "block";

      UI.overlayImage.src = state.image || "";
      UI.overlayImage.alt = "The sheep and goats are coming to the Northaven Trail.";
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
      UI.overlayImage.alt = "The herd is resting overnight off the trail.";

      // Update the Status Pill
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

      // Update the Status Pill
      UI.statusPill.innerText = "Finished";
      UI.statusPill.dataset.state = "history";
      UI.statusPill.style.display = "block";

      break;

    /* ---------------- ACTIVE / GRAZING ---------------- */
    default:
      hideBanner();
      UI.controls.style.display = "";

      // Update the Status Pill
      UI.statusPill.innerText = "Grazing";
      UI.statusPill.dataset.state = "grazing";
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
    console.warn(`No Sheep Data for Herd ${herdCode}: ${JSON.stringify(herdObj)}`);
    logCaughtError?.("updateMarker", new Error(`No sheep data for herd ${herdCode}`), { herdCode });
    return;
  }

  const [lng, lat] = feature.geometry.coordinates;

  setCurrentHerdLocation(lat, lng);
  hideFlockLoader();

  // Show zoom ONLY once we have a valid herd location
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
  el.setAttribute("aria-label", `${herdName}: open details`);
  el.setAttribute("role", "button");
  el.setAttribute("aria-pressed", "false");
  el.setAttribute("aria-expanded", "false");

  el.addEventListener("mouseenter", () => el.classList.add("is-hover"));
  el.addEventListener("mouseleave", () => el.classList.remove("is-hover"));
  el.addEventListener('focus', () => el.classList.add('is-hover'));
  el.addEventListener('blur', () => el.classList.remove('is-hover'));

  el.addEventListener("click", e => {
    e.stopPropagation();

    closeAllPopups();
    el.setAttribute("aria-pressed", "true");
    el.setAttribute("aria-expanded", "true");

    const shareText = trailSectionShort
      ? `${herdName} is currently grazing at ${trailSectionShort}`
      : `${herdName} is out grazing on the Northaven Trail`;

    const popupHTML = `
    <h3>${escapeHtml(herdName)}</h3>
    <p>${escapeHtml(sheepInfo)}</p>
    ${buildPopupNavIcons(lat, lng, shareText)}
  `;
    const popup = new mapboxgl.Popup({ offset: [0, -76] })
      .setLngLat([lng, lat])
      .setHTML(popupHTML)
      .addTo(map);
    wirePopupShare(popup);
    // Move focus into popup for keyboard/screen-reader users
    setTimeout(() => {
      const popupEl = popup.getElement();
      const focusTarget = popupEl?.querySelector(".mapboxgl-popup-close-button, a[href], button");
      if (focusTarget) focusTarget.focus();
    }, 50);
    openPopups.push(popup);
    popup.on("close", () => {
      el.setAttribute("aria-pressed", "false"); // reset toggle state when popup closes
      el.setAttribute("aria-expanded", "false");
      el.focus();                                // return focus to the marker button
      const i = openPopups.indexOf(popup);
      if (i !== -1) openPopups.splice(i, 1);
    });
    currentFullPopup = popup;
  });

  herdMarkers[herdCode] = new mapboxgl.Marker({
    element: el,
    anchor: "bottom"
  })
    .setLngLat([lng, lat])
    .addTo(map);


  // Show the hamburger
  const hamburgerElement = document.getElementById("hamburger");
  if (hamburgerElement) { hamburgerElement.style.display = "block"; }

  // Updating the google map button and location text
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
  const showHistory = document.getElementById('showHistory')?.checked ?? false;
  // -------------------------------------------
  // 3. Visibility logic ONLY (no adding/removing)
  // -------------------------------------------
  const visible = showHistory;

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

function openNoMowZonePopup_(zoneCode, markerEl) {
  const obj = noMowZoneMarkers?.[zoneCode];
  const map = window.TAILS?.getMap?.() || window.TAILS_DATA?.getMap?.() || getMapInstance?.();
  if (!obj || !obj.feature || !markerEl || !map) return;

  const props = obj.feature.properties || {};
  const center =
    props.center ||
    featureCenter(obj.feature.geometry) ||
    [props.centerLng, props.centerLat];
  if (!center) return;

  const [lng, lat] = center;
  const name = (props.zoneName || "No-Mow Zone")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const desc = String(props.description || "");

  closeAllPopups();
  selectedZoneCode = zoneCode;

  const noMowShareText = desc
    ? `${name} — ${desc}`
    : `${name} on the Northaven Trail`;

  const popupHTML = `
        <div class="popup-container">
          <h3>${escapeHtml(name)}</h3>
          <p>${escapeHtml(desc)}</p>
          ${buildPopupNavIcons(lat, lng, noMowShareText)}
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

  markerEl.setAttribute("aria-expanded", "true");
  wirePopupShare(popup);
  popup.on("close", () => {
    selectedZoneCode = null;
    markerEl.setAttribute("aria-expanded", "false");
    const i = openPopups.indexOf(popup);
    if (i !== -1) openPopups.splice(i, 1);
    pruneOpenPopups();
  });

  pruneOpenPopups();
  openPopups.push(popup);
  currentFullPopup = popup;
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
    if (!markerEl || !mapContainer.contains(markerEl)) return;

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

    el.setAttribute("aria-label", `${name}: open details`);
    el.setAttribute("aria-expanded", "false");
    el.dataset.zoneCode = code;

    const marker = new mapboxgl.Marker(el, { anchor: "center" })
      .setLngLat(center)
      .addTo(map);
    el.removeAttribute("role"); // MapboxGL may inject role="img"; remove it — <button> has implicit role

    noMowZoneMarkers[code] = { marker, element: el, feature };
  });

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
      <td>${escapeHtml(zone.name)}</td>
      <td class="status-cell">${escapeHtml(zone.status)}</td>
      <td class="map-icons">
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
  if (UI.overlayBanner) UI.overlayBanner.style.display = "block";
  if (UI.statusPill) UI.statusPill.style.display = "none";
}

function hideBanner() {
  UI.overlayBanner.style.display = "none";
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
  if (UI.countdown) UI.countdown.innerText = "";
}

/* ----------------------------
   Flock loader
   ---------------------------- */
function hideFlockLoader() {
  const el = document.getElementById("flock-loader");
  if (!el) return;
  el.classList.add("flock-loader--hidden");
  el.addEventListener("transitionend", () => el.remove(), { once: true });
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
const isApple = () => /(Mac|iPhone|iPad|iPod)/i.test(navigator.platform);

/**
 * Trigger the OS-native share sheet via the Web Share API.
 * Safe to call — silently no-ops if navigator.share is unavailable.
 */
function clickShare(title, text, url) {
  if (!navigator.share) return;
  navigator.share({
    title: String(title || ""),
    text: String(text || ""),
    url: String(url || location.href)
  }).catch(err => console.log("Share dismissed:", err?.name));
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
            data-share-url="${escapeHtmlAttr(location.href)}">
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

// Format a "YYYY-MM-DD" ISO date string for display, avoiding UTC offset issues.
function formatDateISO(iso, opts) {
  if (!iso) return "";
  try {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", opts);
  } catch {
    return "";
  }
}
function formatDateISOLong(iso) {
  return formatDateISO(iso, { weekday: "long", month: "long", day: "numeric" });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

function escapeHtmlAttr(value) {
  return escapeHtml(value);
}

function to12Hour(h) {
  const n = h % 12;
  return n === 0 ? 12 : n;
}

function amPm(h) {
  return h >= 12 ? "pm" : "am";
}


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

function closeAllPopups() {
  try {
    pruneOpenPopups();
    while (openPopups.length) {
      openPopups.pop().remove();
    }
    selectedZoneCode = null;
    currentFullPopup = null;
  } catch (error) {
    console.warn("closeAllPopups error:", error);
    logCaughtError?.("closeAllPopups", error);
  }
}

function focusNoMowZone(zoneCode) {
  // Instant switch (no flip): user tapped a table row and expects immediate map response
  const tableView = document.getElementById("tableView");
  const mapView = document.getElementById("mapView");

  if (tableView) tableView.style.display = "none";
  if (mapView) mapView.style.display = "block";
  updateBottomUiState();

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
