const HOST_NAME = 'northaventrail.org'
const SHOW = 'Show';
const HIDE = 'Hide';
const VISIBLE = 'visible';

// Map
let map;
mapboxgl.accessToken = 'pk.eyJ1Ijoid2Rhd3NvIiwiYSI6ImNqb2c3MmJ5czAwbXYzd2xoN2o0cmFwZHYifQ.xhCPovJ-VNHHbVOrkjNdMA';

// Sales close
const SALES_DIV_ID = ['block-yui_3_17_2_1_1673283235024_2521','block-yui_3_17_2_1_1673289954674_3052','block-yui_3_17_2_1_1673896880328_4180','block-63c18efae56ef1315372db3a', 'block-yui_3_17_2_1_1673896880328_3826'];
const LAST_SALES_DATE = new Date(2026, 1, 5, 23, 59, 59);  // months are 0-11

const CLING_GEOJSON_URL = `https://assets.northaventrail.org/json/valinetine-cling.v2027.geojson`;

// POPUP
const markerHeight = 52;
const markerRadius = 16;
const linearOffset = 10;
const POP_UP_OFFSET = {
  'top': [0, 0],
  'top-left': [0, 0],
  'top-right': [0, 0],
  'bottom': [0, -markerHeight],
  'bottom-left': [linearOffset, (markerHeight - markerRadius + linearOffset) * -1],
  'bottom-right': [-linearOffset, (markerHeight - markerRadius + linearOffset) * -1],
  'left': [markerRadius, (markerHeight - markerRadius) * -1],
  'right': [-markerRadius, (markerHeight - markerRadius) * -1]
};
const POP_UP_MAX_WIDTH = "300px";

let scrollYModal;

// Map bounds
const MAP_BOUNDS = [
  [-96.75639, 32.91540],
  [-96.88808, 32.87847]
];

// Status values (as in your data)
const LOCATION_UNCLAIMED = 'Unclaimed';
const LOCATION_CLAIMED = 'Claimed';
const LOCATION_INSTALLED = 'Installed';

// Existing trail data
const urlExistingTrail = 'https://api.mapbox.com/datasets/v1/wdawso/cjok8y2it0b1x2vmhi8x52nfe/features?access_token=' + mapboxgl.accessToken;
// const ulrExpansionTrail = 'https://api.mapbox.com/datasets/v1/wdawso/cjokaqnst0d602vmhqyxb317i/features?access_token=' + mapboxgl.accessToken;

// -------------------- Refresh globals --------------------
let refreshInterval = null;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let zoomEndTimeout = null;
const ZOOM_DEBOUNCE_MS = 50;
let maxZoomRequired = 0;

// -------------------- GeoJSON state --------------------
let currentClingGeojson = null;                // last loaded FeatureCollection
let currentClingByLocationID = new Map();      // locationID -> feature
let currentClingByClingID = new Map();         // clingID -> feature
let activeFeatureId = null;                    // feature.id currently active
let activePopup = null;                        // mapbox Popup

// -------------------- Carousel globals --------------------
const CAROUSEL_MOUNT_ID = "valentine-carousel";
const CAROUSEL_SECTION_ID = "valentine-carousel-section";
const CAROUSEL_ROTATE_MS = 5000;

const carouselState = {
  items: [],
  index: 0,
  timer: null,
  paused: false,
  inited: false
};

const prefersReducedMotion =
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ================== CLING FILTERING ==================
/**
 * If empty → show all clings
 * If populated → ONLY clings whose locationID is NOT in this set will be shown
 */
const CLING_EXCLUDE_LOCATION_IDS = new Set([
  "07019",
  "01001",
  "04024",
  "02015"
]);

/**
 * Optional: inverse mode (whitelist instead of blacklist)
 * If true, ONLY IDs in CLING_INCLUDE_LOCATION_IDS are shown
 */
const CLING_FILTER_MODE = "exclude"; // "exclude" | "include"

const CLING_INCLUDE_LOCATION_IDS = new Set([
  // "JOES_CREEK_BRIDGE"
]);
// =====================================================

// ========= Helper functions ==========================
function hideById(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
}
function showById(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "";
}
// =====================================================

const BASE_PAGE_TITLE = document.title;

function clearUrlSelection() {
  try {
    const url = new URL(window.location.href);
    // adjust this param name to match your current scheme
    url.searchParams.delete('locationID');
    url.searchParams.delete('loc');     // safe extra cleanup if older param existed
    url.searchParams.delete('id');      // safe extra cleanup
    url.searchParams.delete('info');      // safe extra cleanup
    window.history.replaceState({}, '', url.toString());
  } catch {}
  try { document.title = BASE_PAGE_TITLE; } catch {}
}

// Check for mobile
const USE_BOTTOM_SHEET_ON_MOBILE = true;
const MOBILE_BREAKPOINT_PX = 768;
function isMobileUI() {
  return window.innerWidth < MOBILE_BREAKPOINT_PX;
}

// ---------------------------------------------------------------------
// Legend (key) click-to-filter (show/hide by status)
// ---------------------------------------------------------------------
const LEGEND_STORAGE_KEY    = 'valentines.legend.visibility.v1';
const SATELLITE_STORAGE_KEY = 'valentines.satellite.v1';

function saveSatelliteToStorage(isOn) {
  try {
    if (!window.localStorage) return;
    localStorage.setItem(SATELLITE_STORAGE_KEY, isOn ? '1' : '0');
  } catch { /* ignore */ }
}

function loadSatelliteFromStorage() {
  try {
    const val = window.localStorage ? localStorage.getItem(SATELLITE_STORAGE_KEY) : null;
    if (val === null) return false; // default off
    return val === '1';
  } catch { return false; }
}

const legendVisibility = {
  [LOCATION_UNCLAIMED]: true,
  [LOCATION_CLAIMED]: true,
  [LOCATION_INSTALLED]: true
};

function loadLegendVisibilityFromStorage() {
  try {
    const raw = window.localStorage ? localStorage.getItem(LEGEND_STORAGE_KEY) : null;
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return;

    [LOCATION_UNCLAIMED, LOCATION_CLAIMED, LOCATION_INSTALLED].forEach((k) => {
      if (typeof obj[k] === 'boolean') legendVisibility[k] = obj[k];
    });
  } catch { /* ignore */ }
}

function saveLegendVisibilityToStorage() {
  try {
    if (!window.localStorage) return;
    localStorage.setItem(LEGEND_STORAGE_KEY, JSON.stringify(legendVisibility));
  } catch { /* ignore */ }
}

function updateLegendKeyUI() {
  const mapKeyContainer = getElementById('mapKeyContainer');
  if (mapKeyContainer) mapKeyContainer.setAttribute('aria-label', 'Map legend filters');

  const keyMap = [
    { status: LOCATION_UNCLAIMED, elId: 'unclaimedKey', label: 'Available' },
    { status: LOCATION_CLAIMED,   elId: 'claimedKey',   label: 'Claimed' },
    { status: LOCATION_INSTALLED, elId: 'installedKey', label: 'Installed' }
  ];

  keyMap.forEach(({ status, elId, label }) => {
    const el = getElementById(elId);
    if (!el) return;

    const on = !!legendVisibility[status];
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.classList.toggle('is-off', !on);

    // Tooltip text (works with the CSS you added earlier)
    const tip = on ? `Click to hide ${label}` : `Click to show ${label}`;
    el.setAttribute('title', tip);
    el.setAttribute('aria-label', tip);
    el.setAttribute('data-tooltip', tip);
  });
}

function applyLegendVisibilityToMap() {
  if (!map) return;

  const statusToLayer = {
    [LOCATION_UNCLAIMED]: LAYER_IDS.unclaimed,
    [LOCATION_CLAIMED]:   LAYER_IDS.claimed,
    [LOCATION_INSTALLED]: LAYER_IDS.installed
  };

  Object.entries(statusToLayer).forEach(([status, layerId]) => {
    if (!map.getLayer(layerId)) return;
    const vis = legendVisibility[status] ? 'visible' : 'none';
    try { map.setLayoutProperty(layerId, 'visibility', vis); } catch {}
  });

  // If a popup is open for a now-hidden category, close it + clear URL/title
  try {
    if (activeFeatureId) {
      const f = currentClingByLocationID.get(String(activeFeatureId));
      const st = f && f.properties ? String(f.properties.status || '').trim() : '';
      if (st && legendVisibility[st] === false) {
        closeActivePopup();
        clearActiveFeatureState();
        clearUrlSelection();
      }
    }
  } catch {}
}

function toggleLegendStatus(status) {
  if (!status) return;
  legendVisibility[status] = !legendVisibility[status];
  saveLegendVisibilityToStorage();
  updateLegendKeyUI();
  applyLegendVisibilityToMap();
}

// Optional ripple hook: if you kept the ripple CSS but don’t have JS ripple,
// this is safe to omit. (If you want, I can wire it back too.)
function createLegendRipple_(el, evt) {
  try {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (evt && typeof evt.clientX === 'number') ? (evt.clientX - rect.left) : (rect.width / 2);
    const y = (evt && typeof evt.clientY === 'number') ? (evt.clientY - rect.top) : (rect.height / 2);
    const size = Math.max(rect.width, rect.height) * 2;

    const ripple = document.createElement('span');
    ripple.className = 'legend-ripple';
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (x - size / 2) + 'px';
    ripple.style.top = (y - size / 2) + 'px';

    el.appendChild(ripple);
    ripple.addEventListener('animationend', () => { try { ripple.remove(); } catch {} });
  } catch {}
}

function initLegendKeyHandlersOnce() {
  const keyMap = [
    { status: LOCATION_UNCLAIMED, elId: 'unclaimedKey' },
    { status: LOCATION_CLAIMED,   elId: 'claimedKey' },
    { status: LOCATION_INSTALLED, elId: 'installedKey' }
  ];

  keyMap.forEach(({ status, elId }) => {
    const el = getElementById(elId);
    if (!el || el._legendBound) return;
    el._legendBound = true;

    const onActivate = (e) => {
      e.preventDefault();
      createLegendRipple_(el, e);
      toggleLegendStatus(status);
    };

    el.addEventListener('click', onActivate);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') onActivate(e);
    });
  });
}

// ---------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------
function getElementById(id) {
  return id ? document.getElementById(id) : null;
}

// Alias (correct spelling) for readability in new code.
function getElementByIdSafe(id) {
  return getElementById(id);
}

function querySelectorSingle(sel, root = document) {
  try { return root.querySelector(sel); } catch { return null; }
}

function hideEl(el) {
  if (!el) return;
  el.style.display = 'none';
}

function showEl(el, displayValue = '') {
  if (!el) return;
  el.style.display = displayValue;
}

function toggleEl(el, shouldShow, displayValue = '') {
  if (!el) return;
  if (shouldShow) showEl(el, displayValue);
  else hideEl(el);
}

function setAttrSafe(el, name, value) {
  if (!el || !name) return;
  try { el.setAttribute(name, value); } catch { /* ignore */ }
}

function setTextSafe(el, text) {
  if (!el) return;
  el.textContent = text ?? '';
}

async function fetchJson(url) {
  const res = await fetch(url, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

function withCacheBust(url) {
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.set("_ts", String(Date.now()));
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}_ts=${Date.now()}`;
  }
}

// Hide sales areas after sales close
(function hideSalesAfterClose(){
  const currentHostName = window.location.hostname;
  if (currentHostName.toLowerCase() !== HOST_NAME.toLowerCase()) return;
  const today = new Date();
  if (today.getTime() <= LAST_SALES_DATE.getTime()) return;
  SALES_DIV_ID.forEach(divID => hideEl(getElementById(divID)));
})();

// ---------------------------------------------------------------------
// Carousel helpers
// ---------------------------------------------------------------------
function decodeClingTextSafe(s) {
  if (!s) return "";
  try {
    return decodeURIComponent(String(s))
      .replace(/%27/g, "'")
      .replace(/%22/g, '"');
  } catch {
    return String(s);
  }
}

function buildCarouselItemsFromGeojson(fc) {
  if (!fc || !Array.isArray(fc.features)) return [];
  return fc.features
    .map(f => f && f.properties ? f.properties : null)
    .filter(p => p && p.imageURL)
    .map(p => ({
      large: p.imageURL,
      alt: decodeClingTextSafe(p.clingText || "")
    }));
}

function stopCarousel() {
  if (carouselState.timer) clearInterval(carouselState.timer);
  carouselState.timer = null;
}

function startCarousel() {
  stopCarousel();
  if (prefersReducedMotion || carouselState.paused) return;
  if (!carouselState.items || carouselState.items.length < 2) return;

  carouselState.timer = setInterval(() => {
    carouselState.index = (carouselState.index + 1) % carouselState.items.length;
    renderCarousel();
  }, CAROUSEL_ROTATE_MS);
}

function renderCarousel() {
  const mount = document.getElementById(CAROUSEL_MOUNT_ID);
  if (!mount || !carouselState.items.length) return;

  const img = mount.querySelector(".val-carousel__img");
  const caption = mount.querySelector(".val-carousel__caption");
  const counter = mount.querySelector(".val-carousel__counter");
  if (!img || !caption || !counter) return;

  const item = carouselState.items[carouselState.index];
  img.src = item.large;
  img.setAttribute("src_large", item.large); // showModal reads this
  img.alt = item.alt || "Valentine cling image";
  caption.textContent = item.alt || "";
  counter.textContent = `${carouselState.index + 1} / ${carouselState.items.length}`;
}

function initCarouselUIOnce() {
  const mount = document.getElementById(CAROUSEL_MOUNT_ID);
  if (!mount || carouselState.inited) return;

  mount.innerHTML = `
    <div class="val-carousel__stage">
      <div class="val-carousel__nav">
        <button type="button" class="val-carousel__btn" data-dir="-1" aria-label="Previous image">‹</button>
        <button type="button" class="val-carousel__btn" data-dir="1" aria-label="Next image">›</button>
      </div>
      <div class="val-carousel__counter" aria-live="polite" aria-atomic="true"></div>
      <img class="val-carousel__img" alt="" />
    </div>
    <div class="val-carousel__caption" aria-live="polite"></div>
  `;

  const prevBtn = mount.querySelector('[data-dir="-1"]');
  const nextBtn = mount.querySelector('[data-dir="1"]');
  const img = mount.querySelector(".val-carousel__img");
  if (!prevBtn || !nextBtn || !img) return;

  function go(dir) {
    if (!carouselState.items.length) return;
    carouselState.index = (carouselState.index + dir + carouselState.items.length) % carouselState.items.length;
    renderCarousel();
    startCarousel();
  }

  prevBtn.addEventListener("click", () => go(-1), { passive: true });
  nextBtn.addEventListener("click", () => go(1), { passive: true });

  mount.tabIndex = 0;
  mount.setAttribute('role', 'region');
  mount.setAttribute('aria-label', 'Valentine cling image carousel');
  mount.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
  });

  img.addEventListener("click", () => {
    carouselState.paused = true;
    stopCarousel();
    if (typeof window.showModal === "function") window.showModal(img);
  });

  carouselState.inited = true;
}


function filterFeatureCollectionForCarousel(fc) {
  if (!fc || !Array.isArray(fc.features)) return fc;

  const includeList = Array.from(CLING_INCLUDE_LOCATION_IDS);
  const excludeList = Array.from(CLING_EXCLUDE_LOCATION_IDS);

  const out = fc.features.filter(f => {
    const id = f?.properties?.locationID;
    if (!id) return true;

    if (CLING_FILTER_MODE === "include" && includeList.length) return includeList.includes(id);
    if (CLING_FILTER_MODE === "exclude" && excludeList.length) return !excludeList.includes(id);
    return true;
  });

  return { ...fc, features: out };
}

function updateCarouselFromGeojson(fc) {
  const mount = document.getElementById(CAROUSEL_MOUNT_ID);
  if (!mount) return;

  const carouselFc = filterFeatureCollectionForCarousel(fc);
  const newItems = buildCarouselItemsFromGeojson(carouselFc);

  // ZERO images → hide the entire section
  if (!newItems || newItems.length === 0) {
    stopCarousel();
    carouselState.items = [];
    carouselState.index = 0;

    // clear mount so it can’t “half-render”
    mount.innerHTML = "";
    carouselState.inited = false;

    hideById(CAROUSEL_SECTION_ID);
    return;
  }

  // Has images → show section + render carousel
  showById(CAROUSEL_SECTION_ID);

  initCarouselUIOnce();       // your existing UI builder for the carousel controls/img
  carouselState.items = newItems;
  if (carouselState.index >= newItems.length) carouselState.index = 0;

  renderCarousel();
  startCarousel();
}

// ---------------------------------------------------------------------
// Popup HTML builders (match your previous look)
// ---------------------------------------------------------------------
function buildPopupHTMLFromProps(props) {
  if (!props) return '';

  const status = String(props.status || '').trim();
  const locId = String(props.locationID || '').trim();

  //const smallURL = String(props.smallImageURL || '').trim();
  const bigURL   = String(props.imageURL || '').trim();
  const clingText = decodeClingTextSafe(props.clingText || '');

  const hasImage = !!bigURL;

  // ----------------------------
  // CASE 1: Available / Unclaimed
  // ----------------------------
  if (status === LOCATION_UNCLAIMED) {
    return `
      <div class="popupWrapper">
        <div class="popupHeading">
          Valentine Cling Location
        </div>
        <div class="tooltip">
          <a onclick="copyID('${locId}')" onmouseout="outFunc()">
            <span class="locationID">#${locId}</span>
            <span class="tooltiptext" id="myTooltip">Click to Copy Location #</span>
            <svg class="copyIcon"><use href="#copy-icon"></use></svg>
          </a>
        </div>
      </div>
    `;
  }

  // ----------------------------
  // CASE 2: Claimed or Installed
  // ----------------------------
  if (status === LOCATION_CLAIMED || status === LOCATION_INSTALLED) {

    if (hasImage) {
      return `
        <div class="popupWrapper">
          <img
            alt="${clingText}"
            class="popUpClingImage"
            src="${bigURL}"
            src_large="${bigURL}"
            onclick="showModal(this)">
        </div>
      `;
    }

    // No image fallback
    return `
      <div class="popupWrapper">
        <div class="clingText">
          Covering the Trail in Love
        </div>
      </div>
    `;
  }

  // Safety fallback
  return `
    <div class="popupWrapper">
      <div class="clingText">
        Covering the Trail in Love
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------
// Mapbox: load marker icons into the style
// ---------------------------------------------------------------------
const ICONS = {
  unclaimed: { name: 'val-marker-unclaimed', url: '/s/purple_marker_active_2x.png' },
  claimed:   { name: 'val-marker-claimed',   url: '/s/pink_marker_active_2x.png'   },
  installed: { name: 'val-marker-installed', url: '/s/red_marker_active_2x.png'    }
};

function loadMapIcons() {
  return new Promise((resolve) => {
    if (!map) return resolve();

    const entries = Object.values(ICONS);
    let remaining = entries.length;

    function doneOne() {
      remaining -= 1;
      if (remaining <= 0) resolve();
    }

    entries.forEach(({ name, url }) => {
      if (map.hasImage && map.hasImage(name)) return doneOne();

      map.loadImage(url, (err, img) => {
        if (!err && img) {
          try {
            map.addImage(name, img, {
              sdf: false,
              pixelRatio: 2
            });
          } catch {
            // ignore duplicate add
          }
        } else {
          console.warn("Could not load marker icon:", url, err);
        }
        doneOne();
      });
    });
  });
}

// ---------------------------------------------------------------------
// Mapbox: source + layers for clings
// ---------------------------------------------------------------------
const CLING_SOURCE_ID = 'val-clings';
const LAYER_IDS = {
  unclaimed: 'val-clings-unclaimed',
  claimed: 'val-clings-claimed',
  installed: 'val-clings-installed'
};

function getFilterForBaseVisibility() {
  // Zoom gating: we update this on zoomend by replacing the numeric constant
  const z = map ? map.getZoom() : 0;
  const zoomFilter = ['any',
    ['!', ['has', 'zoomLevel']],
    ['==', ['get','zoomLevel'], ''],
    ['<', ['to-number', ['get','zoomLevel']], z]
  ];

  return ['all', zoomFilter];
}

function addClingSourceIfMissing(initialFc) {
  if (!map || map.getSource(CLING_SOURCE_ID)) return;

  map.addSource(CLING_SOURCE_ID, {
    type: 'geojson',
    data: initialFc || { type: 'FeatureCollection', features: [] }
  });
}

function addClingLayersIfMissing() {
  if (!map) return;

  const baseFilter = getFilterForBaseVisibility();

  const iconSizeExpr = [
    'case',
    ['boolean', ['feature-state', 'active'], false], 1.45,
    1.0
  ];

  function addLayer(id, statusValue, iconName) {
    if (map.getLayer(id)) return;

    map.addLayer({
      id,
      type: 'symbol',
      source: CLING_SOURCE_ID,
      filter: ['all', baseFilter, ['==', ['get','status'], statusValue]],
      layout: {
        'icon-image': iconName,
        'icon-size': 0.4,
        'icon-anchor': 'bottom',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true
      }
    });
  }

  addLayer(LAYER_IDS.installed, LOCATION_INSTALLED, ICONS.installed.name);
  addLayer(LAYER_IDS.claimed,   LOCATION_CLAIMED,   ICONS.claimed.name);
  addLayer(LAYER_IDS.unclaimed, LOCATION_UNCLAIMED, ICONS.unclaimed.name);

  // Pointer cursor on hover for any cling layer
  [LAYER_IDS.unclaimed, LAYER_IDS.claimed, LAYER_IDS.installed].forEach((lid) => {
    map.on('mouseenter', lid, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', lid, () => { map.getCanvas().style.cursor = ''; });
  });
}

function setClingLayerFiltersForZoom() {
  if (!map) return;
  const base = getFilterForBaseVisibility();

  function setForLayer(layerId, statusValue) {
    if (!map.getLayer(layerId)) return;
    map.setFilter(layerId, ['all', base, ['==', ['get','status'], statusValue]]);
  }

  setForLayer(LAYER_IDS.unclaimed, LOCATION_UNCLAIMED);
  setForLayer(LAYER_IDS.claimed,   LOCATION_CLAIMED);
  setForLayer(LAYER_IDS.installed, LOCATION_INSTALLED);
}

// ---------------------------------------------------------------------
// GeoJSON normalization + indexing
// ---------------------------------------------------------------------
function normalizeFeatureCollection(fc) {
  // Backend now provides feature.id = properties.locationID (or another stable unique id).
  // We keep this function only to validate shape and avoid runtime errors.
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    return { type: 'FeatureCollection', features: [] };
  }

  // Ensure each feature has a stable id for feature-state. If not, we do NOT invent one here;
  // we just warn, because missing ids will break feature-state highlighting.
  for (const f of fc.features) {
    if (!f) continue;
    if (f.id === undefined || f.id === null || f.id === '') {
      const lid = f.properties && f.properties.locationID ? String(f.properties.locationID) : '';
      if (lid) {
        // If your backend always sets id, you should not hit this.
        console.warn("Feature missing id; backend should set feature.id. locationID:", lid);
      } else {
        console.warn("Feature missing id and locationID; feature-state will not work for this feature.");
      }
    } else {
      f.id = String(f.id);
    }
  }

  return fc;
}

function indexFeatures(fc) {
  currentClingByLocationID = new Map();
  currentClingByClingID = new Map();
  maxZoomRequired = 0;

  if (!fc || !Array.isArray(fc.features)) return;

  // legend key trackers
  let claimedKeySeen = false;
  let installedKeySeen = false;
  let unclaimedKeySeen = false;

  for (const f of fc.features) {
    const p = f && f.properties ? f.properties : null;
    if (!p) continue;

    const loc = p.locationID ? String(p.locationID) : '';
    const cid = p.clingID ? String(p.clingID) : '';
    if (loc) currentClingByLocationID.set(loc, f);
    if (cid) currentClingByClingID.set(cid, f);

    // max zoom required
    const z = (p.zoomLevel === '' || p.zoomLevel === null || p.zoomLevel === undefined) ? null : Number(p.zoomLevel);
    if (z !== null && !Number.isNaN(z) && z > maxZoomRequired) maxZoomRequired = z;

    if (p.status === LOCATION_CLAIMED) claimedKeySeen = true;
    if (p.status === LOCATION_INSTALLED) installedKeySeen = true;
    if (p.status === LOCATION_UNCLAIMED) unclaimedKeySeen = true;
  }

  // Toggle legend keys
  toggleEl(getElementById('claimedKey'), claimedKeySeen);
  toggleEl(getElementById('installedKey'), installedKeySeen);
  toggleEl(getElementById('unclaimedKey'), true);

  // Zoom hint text
  updateZoomHintText();

  initLegendKeyHandlersOnce();
  updateLegendKeyUI();
  applyLegendVisibilityToMap();
}

function updateZoomHintText() {
  if (!map) return;
  const mapZoom = map.getZoom();
  if (mapZoom > maxZoomRequired) {
    hideEl(getElementById('moreClings'));
    showEl(getElementById('allClings'));
  } else {
    hideEl(getElementById('allClings'));
    showEl(getElementById('moreClings'));
  }
}

// ---------------------------------------------------------------------
// Active selection + URL/popup handling
// ---------------------------------------------------------------------
function clearActiveFeatureState() {
  if (!map || !activeFeatureId) return;
  try {
    map.setFeatureState({ source: CLING_SOURCE_ID, id: activeFeatureId }, { active: false });
  } catch { /* ignore */ }
  activeFeatureId = null;
}

function setActiveFeatureState(featureId) {
  if (!map || featureId === null || featureId === undefined) return;
  clearActiveFeatureState();
  activeFeatureId = String(featureId);
  try {
    map.setFeatureState({ source: CLING_SOURCE_ID, id: activeFeatureId }, { active: true });
  } catch { /* ignore */ }
}

function closeActivePopup() {
  if (activePopup) {
    try { activePopup.remove(); } catch {}
    activePopup = null;
  }
}

function openPopupForFeature(feature, lngLat, verboseFlag) {
  if (!map || !feature || !feature.properties) return;

  let html = buildPopupHTMLFromProps(feature.properties);
  if (verboseFlag === 'yes' && typeof buildVerbosePopupHTMLFromProps === 'function') {
    html = `${html}${buildVerbosePopupHTMLFromProps(feature.properties)}`;
  }

  // Mobile: bottom sheet (no floating popup)
  if (USE_BOTTOM_SHEET_ON_MOBILE && isMobileUI()) {
    openBottomSheet(html);           // you’ll add this function below
    // keep URL/title behavior consistent:
    return;
  }

  // Close open popups
  closeActivePopup();

  // Nudge the map do deal with the controls
  let center;

  if (Array.isArray(lngLat)) {
    center = lngLat;
  } else if (lngLat && typeof lngLat.lng === 'number' && typeof lngLat.lat === 'number') {
    center = [lngLat.lng, lngLat.lat];
  } else {
    console.warn("Invalid lngLat passed to openPopupForFeature:", lngLat);
    return;
  }

  map.easeTo({
    center,
    padding: { top: 80, bottom: 120, left: 20, right: 20 },
    duration: 250
  });

  activePopup = new mapboxgl.Popup({
      maxWidth: POP_UP_MAX_WIDTH,
      offset: 8,          // tiny spacing above the pin tip
      closeButton: true,
      closeOnClick: true
    })
    .setLngLat(center)
    .setHTML(html)
    .addTo(map)
    .on('close', () => {
      try { clearActiveFeatureState(); } catch {}
      try { setHighlightFeature?.(null); } catch {}
      clearUrlSelection();
    });
}

function getVerboseFlagFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const v = params.get('verbose');
  return v ? decodeURI(v).toLowerCase() : '';
}

function pushUrlForFeature(feature) {
  if (!feature || !feature.properties) return;

  const params = new URLSearchParams(window.location.search);
  const hasMarkerParam = params.get('marker');

  const baseTitle = "Valentine Clings - Friends of Northaven Trail";
  let newTitle = baseTitle;
  let newURL = location.pathname;

  if (hasMarkerParam) {
    const markerID = feature.properties.locationID;
    if (markerID) {
      newTitle = `Marker: ${markerID} - ${baseTitle}`;
      newURL += `?marker=${encodeURIComponent(markerID)}`;
    }
  } else {
    const clingID = feature.properties.clingID;
    if (clingID) {
      newTitle = `Cling: ${clingID} - ${baseTitle}`;
      newURL += `?info=${encodeURIComponent(clingID)}`;
    }
  }

  const verboseFlag = getVerboseFlagFromUrl();
  if (verboseFlag === 'yes') {
    newURL += (newURL.includes('?') ? '&' : '?') + 'verbose=yes';
  }

  document.title = newTitle;
  window.history.pushState(null, '', newURL);
}

function getFeatureLngLat(feature, fallbackLngLat) {
  try {
    if (feature?.geometry?.type === 'Point' && Array.isArray(feature.geometry.coordinates)) {
      const c = feature.geometry.coordinates;
      return { lng: c[0], lat: c[1] };
    }
  } catch {}
  return fallbackLngLat; // last resort
}

function wireClingLayerClickHandlers() {
  if (!map) return;

  const handler = (e) => {
    if (!e || !e.features || !e.features.length) return;
    const feature = e.features[0];
    if (!feature) return;

    const fid = feature.id ?? (feature.properties && feature.properties.locationID);
    if (fid) setActiveFeatureState(fid);

    const verboseFlag = getVerboseFlagFromUrl();
    const lngLat = getFeatureLngLat(feature, e.lngLat);

    openPopupForFeature(feature, lngLat, verboseFlag);
    pushUrlForFeature(feature);

    // Set share attrs to be safe (optional)
    setShareButton();
  };

  [LAYER_IDS.unclaimed, LAYER_IDS.claimed, LAYER_IDS.installed].forEach((lid) => {
    map.on('click', lid, handler);
  });
}

// Fly to feature based on URL params (info=clingID or marker=locationID)
function goToParamFeature() {
  if (!map || !currentClingGeojson) return;

  const params = new URLSearchParams(window.location.search);
  const info = params.get('info');
  const marker = params.get('marker');

  let feature = null;
  if (info) feature = currentClingByClingID.get(decodeURI(info));
  else if (marker) feature = currentClingByLocationID.get(decodeURI(marker));

  if (!feature) return;

  const coords = feature.geometry && feature.geometry.type === 'Point' ? feature.geometry.coordinates : null;
  if (!coords || coords.length < 2) return;

  const fid = feature.id ?? (feature.properties && feature.properties.locationID);
  if (fid) setActiveFeatureState(fid);

  map.flyTo({
    center: coords,
    zoom: 16,
    speed: 0.9,
    curve: 1,
    easing(t) { return t; }
  });

  const verboseFlag = getVerboseFlagFromUrl();
  openPopupForFeature(feature, coords, verboseFlag);
}

// ---------------------------------------------------------------------
// Refresh: fetch GeoJSON once, update source + carousel + indexes
// ---------------------------------------------------------------------
async function refreshClingData() {
  const fc = normalizeFeatureCollection(await fetchJson(CLING_GEOJSON_URL));
  currentClingGeojson = fc;
  indexFeatures(fc);

  // Source update (most efficient)
  const src = map && map.getSource ? map.getSource(CLING_SOURCE_ID) : null;
  if (src && typeof src.setData === 'function') {
    src.setData(fc);
  } else {
    addClingSourceIfMissing(fc);
    addClingLayersIfMissing();
    initLegendKeyHandlersOnce();
    updateLegendKeyUI();
    applyLegendVisibilityToMap();
    setClingLayerFiltersForZoom();
  }

  updateCarouselFromGeojson(fc);
  goToParamFeature();
}

function startClingRefresh() {
  if (document.visibilityState !== 'visible' || refreshInterval !== null) return;

  refreshClingData().catch((err) => console.error('Fetch Error during refresh:', err));

  refreshInterval = setInterval(() => {
    refreshClingData().catch((err) => console.error('Fetch Error during refresh:', err));
  }, REFRESH_INTERVAL_MS);
}

function stopClingRefresh() {
  if (!refreshInterval) return;
  clearInterval(refreshInterval);
  refreshInterval = null;
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') stopClingRefresh();
  else startClingRefresh();
}

// ---------------------------------------------------------------------
// Share button (native)
// ---------------------------------------------------------------------
function setShareButton(title, text, url){
  if (!title || title ===''){ title = "Northaven Trail Valentines Clings"};
  if (!text || text ===''){ text = "Northaven Trail Valentines Clings"};
  if (!url || url === ''){ url = window.location.href};
  const shareBtn = getElementById('share-button');
  setAttrSafe(shareBtn, 'share-title', title);
  setAttrSafe(shareBtn, 'share-text', text);
  setAttrSafe(shareBtn, 'share-url', url);
}

// ---------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------

function initModalHandlers() {
  const modal = getElementById('myModal');
  if (!modal) return;

  const closeBtn = querySelectorSingle('.close', modal);
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal();
    });
  }

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

function showModal(element){
  const scrollY = window.scrollY;
  scrollYModal = scrollY;

  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;   // <-- important
  document.body.style.left = '0';
  document.body.style.right = '0';

  showEl(getElementById('myModal'), 'block');  // <-- force visibility

  const modalImg = getElementById('img01');
  if (modalImg) modalImg.src = element.getAttribute('src_large') || '';

  const captionText = decodeClingTextSafe(element.alt || '');
  setTextSafe(getElementById('caption'), captionText);
}

function closeModal(){
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';

  hideEl(getElementById('myModal'));

  window.scrollTo(0, parseInt(scrollYModal || '0', 10));
}

// ---------------------------------------------------------------------
// Mobile Bottom Sheet - replacing popups
// ---------------------------------------------------------------------
function ensureBottomSheet() {
  let el = document.getElementById('val-bottom-sheet');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'val-bottom-sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Marker details');
  el.style.cssText = `
    position: fixed;
    left: 0; right: 0; bottom: 0;
    max-height: 70vh;
    overflow: auto;
    background: #fff;
    border-top-left-radius: 16px;
    border-top-right-radius: 16px;
    box-shadow: 0 -10px 30px rgba(0,0,0,0.25);
    transform: translateY(110%);
    transition: transform 180ms ease;
    z-index: 8888;
    padding: 12px 14px 18px;
  `;

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
      <div style="width:40px;height:4px;border-radius:999px;background:#ccc;margin:6px auto;"></div>
      <button type="button" id="val-bottom-sheet-close"
        aria-label="Close details"
        style="border:0;background:transparent;font-size:22px;line-height:1;cursor:pointer;">×</button>
    </div>
    <div id="val-bottom-sheet-body"></div>
  `;

  document.body.appendChild(el);

  const closeBtn = document.getElementById('val-bottom-sheet-close');
  closeBtn?.addEventListener('click', () => closeBottomSheet());

  // Escape closes
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeBottomSheet();
  });

  return el;
}

function openBottomSheet(html) {
  const sheet = ensureBottomSheet();
  const body = document.getElementById('val-bottom-sheet-body');
  if (body) body.innerHTML = html;

  sheet.style.transform = 'translateY(0)';
}

function closeBottomSheet() {
  const sheet = document.getElementById('val-bottom-sheet');
  if (!sheet) return;
  sheet.style.transform = 'translateY(110%)';

  // mirror popup close behavior
  try { clearActiveFeatureState(); } catch {}
  clearUrlSelection();
}

// ---------------------------------------------------------------------
// Map setup
// ---------------------------------------------------------------------
function loadWindow() {
  map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/wdawso/cjok8zmkc2mld2tlkh2qvbuej',
    bounds: MAP_BOUNDS
  });

  map.on('load', async function() {
    // Trail line
    map.addSource('existing_trail_source', { type: 'geojson', data: urlExistingTrail });
    map.addLayer({
      id: "existing_trail",
      type: "line",
      source: "existing_trail_source",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#118452", "line-width": 2 }
    });

    map.addControl(new mapboxgl.NavigationControl());
    map.addControl(new mapboxgl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserHeading: true
    }));

    // ---------------- Shared Trail Map Utilities ----------------

    // Ensure gesture tip element exists (gesture-control.js expects it)
    (function ensureGestureTip() {
      if (document.getElementById('gesture-tip')) return;
      const tip = document.createElement('div');
      tip.id = 'gesture-tip';
      tip.setAttribute('role', 'status');
      tip.setAttribute('aria-live', 'polite');
      tip.textContent = '';
      const mapEl = document.getElementById('map');
      const host = (mapEl && mapEl.parentElement) ? mapEl.parentElement : mapEl;
      if (host) {
        host.style.position = host.style.position || 'relative';
        host.appendChild(tip);
      } else {
        document.body.appendChild(tip);
      }
    })();

    // Error logging
    if (window.TrailmapError?.attachErrorLogging) {
      window.TrailmapError.attachErrorLogging(map, {
        appName: 'valentines-map',
        endpoint: window.TRAILMAP_ERROR_ENDPOINT || ''
      });
    }

    // Gesture control
    if (typeof initGestureControl === 'function') {
      initGestureControl(map);
    }

    // Fullscreen control
    if (window.TrailmapFullscreen?.FullscreenMapControl) {
      map.addControl(
        new window.TrailmapFullscreen.FullscreenMapControl({
          appRootId: 'valentines-map',
          mapViewId: 'mapView',
          bodyClass: 'is-map-fullscreen',
          fullscreenClass: 'is-fullscreen',
          onToggle: () => {
            // Mapbox needs this when the container changes size
            try { map.resize(); } catch {}
          }
        }),
        'top-right'
      );
    }

    // Home button — resets map to full trail bounds
    class HomeControl {
      onAdd(m) {
        this._map = m;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
        const btn = document.createElement('button');
        btn.className = 'mapboxgl-ctrl-home';
        btn.type = 'button';
        btn.title = 'Reset map view';
        btn.setAttribute('aria-label', 'Reset map view');
        btn.style.cssText = 'display:flex;align-items:center;justify-content:center';
        btn.innerHTML = `<svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#555"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
        btn.onclick = () => {
          if (typeof closeActivePopup === 'function') closeActivePopup();
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
    map.addControl(new HomeControl(), 'top-right');

    // Load icons, then add source/layers, then wire clicks
    await loadMapIcons();
    addClingSourceIfMissing({ type:'FeatureCollection', features: [] });
    addClingLayersIfMissing();
    wireClingLayerClickHandlers();

    // Initial data load + start refresh based on visibility
    handleVisibilityChange();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Zoom behavior: update filters (and the "zoom in" message)
    map.on('zoomend', () => {
      if (zoomEndTimeout) clearTimeout(zoomEndTimeout);
      zoomEndTimeout = setTimeout(() => {
        updateZoomHintText();
        setClingLayerFiltersForZoom();
      }, ZOOM_DEBOUNCE_MS);
    });

    // Initial zoom hint text
    updateZoomHintText();
  });

  // Satellite toggle control (unchanged)
  class SatelliteCustomControl {
    onAdd(map) {
      this.map = map;
      this.container = document.createElement('div');
      this.container.className = 'satellite-custom-control';
      const button = this._createButton('monitor_button');
      this.container.appendChild(button);
      return this.container;
    };
    onRemove() {
      this.container.parentNode.removeChild(this.container);
      this.map = undefined;
    };
    _createButton(className) {
      const el = window.document.createElement('img');
      el.src = 'https://assets.northaventrail.org/img/SatelliteOn.avif';
      el.className = "satellite-custom-control";
      el.alt = "Toggle Satellite View";
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          el.click();
        }
      });
      el.addEventListener('click', () => {
        const visibility = map.getLayoutProperty('mapbox-satellite', 'visibility');
        if (visibility === VISIBLE) {
          map.setLayoutProperty('mapbox-satellite', 'visibility', 'none');
          el.src = 'https://assets.northaventrail.org/img/SatelliteOn.avif';
          saveSatelliteToStorage(false);
        } else {
          map.setLayoutProperty('mapbox-satellite', 'visibility', VISIBLE);
          el.src = 'https://assets.northaventrail.org/img/SatelliteOff.avif';
          saveSatelliteToStorage(true);
        }
      }, false);

      el.addEventListener("mouseover", () => {
        const visibility = map.getLayoutProperty('mapbox-satellite', 'visibility');
        el.src = (visibility === VISIBLE) ? 'https://assets.northaventrail.org/img/SatelliteOffMouseOver.avif' : 'https://assets.northaventrail.org/img/SatelliteOnMouseOver.avif';
      }, false);

      el.addEventListener("mouseout", () => {
        const visibility = map.getLayoutProperty('mapbox-satellite', 'visibility');
        el.src = (visibility === VISIBLE) ? 'https://assets.northaventrail.org/img/SatelliteOff.avif' : 'https://assets.northaventrail.org/img/SatelliteOn.avif';
      }, false);

      return el;
    };
  };

  map.addControl(new SatelliteCustomControl(), 'top-left');

  // Share button (native)
  const shareBtn = getElementById('share-button');
  const shareContainer = getElementById('shareButtonContainer');
  const shareButtonWrapper = getElementById('shareButton');

  if (navigator.share && shareBtn) {
    shareBtn.addEventListener('click', () => {
      if (!navigator.share) {
        hideEl(shareButtonWrapper);
        hideEl(shareContainer);
        return;
      }

      const title = shareBtn.getAttribute('share-title') || '';
      const text = shareBtn.getAttribute('share-text') || '';
      const url = shareBtn.getAttribute('share-url') || window.location.href;

      navigator.share({ title, text, url }).catch((error) => {
        if (error && error.name !== 'AbortError') console.log('Error sharing', error);
      });
    }, { passive: true });

    showEl(shareContainer);
    showEl(shareButtonWrapper);
  } else {
    hideEl(shareContainer);
    hideEl(shareButtonWrapper);
  }

  loadSvgSpriteOnce();

  setShareButton();

  initModalHandlers();

  // --- Hamburger menu ---
  (function initHamburger() {
    const mapEl = document.getElementById('map');
    const host = mapEl?.parentElement || document.body;
    if (host && !host.style.position) host.style.position = 'relative';

    const btn = document.createElement('button');
    btn.id = 'val-hamburger';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Map menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'val-hamburger-controls');
    btn.title = 'Map menu';
    btn.textContent = '☰';

    const panel = document.createElement('div');
    panel.id = 'val-hamburger-controls';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Map menu');
    panel.innerHTML = `
      <p class="val-menu-section-title">Filter Locations</p>
      <label class="val-menu-label"><input type="checkbox" id="val-filter-unclaimed" checked> <svg width="14" height="20" aria-hidden="true" style="vertical-align:middle;margin-right:4px"><use href="#val-marker-purple"></use></svg> <span style="color:#7e3af2;font-weight:500">Available</span></label>
      <label class="val-menu-label"><input type="checkbox" id="val-filter-claimed" checked> <svg width="14" height="20" aria-hidden="true" style="vertical-align:middle;margin-right:4px"><use href="#val-marker-pink"></use></svg> <span style="color:#db2777;font-weight:500">Claimed</span></label>
      <label class="val-menu-label"><input type="checkbox" id="val-filter-installed" checked> <svg width="14" height="20" aria-hidden="true" style="vertical-align:middle;margin-right:4px"><use href="#val-marker-red"></use></svg> <span style="color:#dc2626;font-weight:500">Installed</span></label>
      <hr style="margin:8px 0;border:none;border-top:1px solid rgba(0,0,0,0.12)">
      <p class="val-menu-section-title">Map View</p>
      <label class="val-menu-label"><input type="checkbox" id="val-satellite-toggle"> Satellite</label>
    `;

    if (host) {
      host.appendChild(btn);
      host.appendChild(panel);
    }

    btn.addEventListener('click', () => {
      const open = panel.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', String(open));
      if (open) syncHamburgerCheckboxes();
      const firstFocusable = panel.querySelector('button,a[href],input');
      if (open && firstFocusable) firstFocusable.focus();
    });

    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && panel.classList.contains('is-open')) {
        panel.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
        btn.focus();
      }
    });

    document.addEventListener('click', ev => {
      if (
        panel.classList.contains('is-open') &&
        !panel.contains(ev.target) &&
        !btn.contains(ev.target)
      ) {
        panel.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });

    const filterMap = [
      { id: 'val-filter-unclaimed', status: LOCATION_UNCLAIMED },
      { id: 'val-filter-claimed',   status: LOCATION_CLAIMED },
      { id: 'val-filter-installed', status: LOCATION_INSTALLED }
    ];
    filterMap.forEach(({ id, status }) => {
      const cb = panel.querySelector('#' + id);
      if (!cb) return;
      cb.addEventListener('change', () => toggleLegendStatus(status));
    });

    const satCb = panel.querySelector('#val-satellite-toggle');
    if (satCb) {
      satCb.addEventListener('change', () => {
        try {
          const visibility = map.getLayoutProperty('mapbox-satellite', 'visibility');
          const newVis = visibility === 'visible' ? 'none' : 'visible';
          map.setLayoutProperty('mapbox-satellite', 'visibility', newVis);
          saveSatelliteToStorage(newVis === 'visible');
        } catch {}
      });
    }
  })();

  // Restore satellite state from previous session
  try {
    if (loadSatelliteFromStorage()) {
      map.setLayoutProperty('mapbox-satellite', 'visibility', 'visible');
    }
  } catch { /* ignore */ }

  injectFindNearestButton();
}

function syncHamburgerCheckboxes() {
  const filterMap = [
    { id: 'val-filter-unclaimed', status: LOCATION_UNCLAIMED },
    { id: 'val-filter-claimed',   status: LOCATION_CLAIMED },
    { id: 'val-filter-installed', status: LOCATION_INSTALLED }
  ];
  filterMap.forEach(({ id, status }) => {
    const cb = document.getElementById(id);
    if (cb) cb.checked = !!legendVisibility[status];
  });
  const satCb = document.getElementById('val-satellite-toggle');
  if (satCb && map) {
    try {
      satCb.checked = map.getLayoutProperty('mapbox-satellite', 'visibility') === 'visible';
    } catch {}
  }
}

function injectFindNearestButton() {
  const mapEl = document.getElementById('map');
  if (!mapEl) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'val-find-nearest-wrap';

  const btn = document.createElement('button');
  btn.id = 'val-find-nearest-btn';
  btn.type = 'button';
  btn.textContent = '📍 Find Locations Near Me';
  btn.setAttribute('aria-label', 'Find cling locations near your current location');

  wrapper.appendChild(btn);
  mapEl.insertAdjacentElement('afterend', wrapper);

  btn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    btn.disabled = true;
    btn.textContent = '⏳ Finding your location…';

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const userLng = pos.coords.longitude;
        const userLat = pos.coords.latitude;
        const features = currentClingGeojson?.features ?? [];

        btn.disabled = false;
        btn.textContent = '📍 Find Locations Near Me';

        if (!features.length) {
          alert('Map data not yet loaded. Please wait and try again.');
          return;
        }

        function haversine(lat1, lon1, lat2, lon2) {
          const R = 6371;
          const dLat = (lat2 - lat1) * Math.PI / 180;
          const dLon = (lon2 - lon1) * Math.PI / 180;
          const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
          return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }

        const sorted = features
          .filter(f => f.geometry?.type === 'Point')
          .map(f => ({
            f,
            dist: haversine(userLat, userLng, f.geometry.coordinates[1], f.geometry.coordinates[0])
          }))
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 5);

        if (!sorted.length) return;

        const lngs = sorted.map(x => x.f.geometry.coordinates[0]);
        const lats = sorted.map(x => x.f.geometry.coordinates[1]);
        lngs.push(userLng);
        lats.push(userLat);

        map.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 80, maxZoom: 16 }
        );
      },
      (err) => {
        btn.disabled = false;
        btn.textContent = '📍 Find Locations Near Me';
        if (err.code !== err.PERMISSION_DENIED) {
          console.warn('Geolocation error', err);
          alert('Could not get your location. Please ensure location access is enabled.');
        }
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  });
}

// ---------------------------------------------------------------------
// Popstate: clear active + popup, then re-open based on URL
// ---------------------------------------------------------------------
window.addEventListener('popstate', () => {
  clearActiveFeatureState();
  closeActivePopup();
  goToParamFeature();
}, { passive: true });

// Clipboard tooltip helpers (unchanged)
function copyID(copyID) {
  navigator.clipboard.writeText(copyID);
  const tooltip = document.getElementById('myTooltip');
  if (tooltip) tooltip.innerHTML = 'Copied: ' + copyID;
}

function outFunc() {
  const tooltip = document.getElementById('myTooltip');
  if (tooltip) tooltip.innerHTML = 'Click to Copy Location #';
}

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
    .catch(err => console.warn("Could not load SVG sprite:", err));
}

// Filters for legend
loadLegendVisibilityFromStorage();
// Boot
loadWindow();
