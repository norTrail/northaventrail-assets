/* ============================================================
   northaven-card-sidecar.v1.js
   Shared map POI card — bottom sheet on mobile, sidecar on desktop
   ============================================================ */
(function () {
  'use strict';

  const MOBILE_BREAKPOINT  = 768;
  const SHEET_ID           = 'nc-bottom-sheet';
  const SHEET_BODY_ID      = 'nc-sheet-body';
  const GOOGLE_DIR_URL     = 'https://www.google.com/maps/dir/?api=1&destination=';

  // Mapillary Graph API — client token, read-only
  const MAPILLARY_TOKEN    = 'MLY|26456749190653210|c432ace1542e35cd80e00c3f15daccb8';
  const MAPILLARY_API      = 'https://graph.mapillary.com/';
  const MAPILLARY_VIEW     = 'https://www.mapillary.com/app/?pKey=';
  const MAPILLARY_JS_URL   = 'https://unpkg.com/mapillary-js@4.1.2/dist/mapillary.js';
  const MAPILLARY_CSS_URL  = 'https://unpkg.com/mapillary-js@4.1.2/dist/mapillary.css';
  const PEEK_HERO_PREVIEW  = 56;
  const FULL_VIEWPORT_RATIO = 0.9;
  const SHEET_STATE_HIDDEN  = 'hidden';
  const SHEET_STATE_INITIAL = 'initial';
  const SHEET_STATE_FULL    = 'full';
  const DESKTOP_CARD_ID     = 'nc-desktop-card';
  const DESKTOP_CARD_BODY_ID = 'nc-desktop-card-body';
  const DESKTOP_CARD_WIDTH  = 400;
  const DESKTOP_CARD_GAP    = 16;
  const MAPILLARY_MODAL_ID  = 'nc-mapillary-modal';
  const MAPILLARY_VIEWER_ID = 'nc-mapillary-viewer';
  const MAPILLARY_SPINNER_HTML =
    '<div class="nc-mapillary-loading" aria-hidden="true">' +
      '<div class="nc-spinner">' +
        '<div class="nc-rect1"></div>' +
        '<div class="nc-rect2"></div>' +
        '<div class="nc-rect3"></div>' +
        '<div class="nc-rect4"></div>' +
        '<div class="nc-rect5"></div>' +
      '</div>' +
    '</div>';
  const INVALID_MIDS       = new Set([
    'NONE',
    'NULL',
    'N/A',
    'NA',
    'NO',
    'NOID',
    'NOTAVAILABLE',
    'NOT_APPLICABLE',
    'TBD',
    'UNKNOWN',
    'UNSET',
  ]);

  const AMENITY_LABELS = {
    'water-human':         'Drinking Water',
    'water-dog':           'Dog Water',
    'bike-repair':         'Bike Repair',
    'bench':               'Seating',
    'picnic':              'Picnic Table',
    'picnic-table':        'Picnic Table',
    'parking':             'Parking',
    'shade':               'Shade',
    'bike-rack':           'Bike Rack',
    'kiosk':               'Info Kiosk',
    'water-bottle-refill': 'Bottle Refill',
    'garden':              'Garden',
  };

  function getAmenityLabelsText(amenities) {
    return String(amenities || '')
      .split(/[\s,]+/)
      .filter(function(token) { return token && AMENITY_LABELS[token]; })
      .map(function(token) { return AMENITY_LABELS[token]; })
      .join(', ');
  }

  // ── Helpers ──────────────────────────────────────────────────

  function isMobile() {
    return window.innerWidth < MOBILE_BREAKPOINT;
  }

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function resolveImage(p, td, size) {
    const u = window.NorthavenUtils;
    if (!u) return '';
    const sz = size || 200;
    return u.normalizeSquarespaceAssetUrl(p.u)
        || u.driveThumbFromId(p.m, sz)
        || u.driveThumbFromId(td?.m, sz)
        || u.normalizeSquarespaceAssetUrl(td?.u)
        || '';
  }

  function resolveLegendIcon(iconValue) {
    const u = window.NorthavenUtils;
    if (!u) return '';
    return u.resolveIconUrl(iconValue);
  }

  function buildFeatureLookupMap_(poiData) {
    const lookup = new Map();
    const features = Array.isArray(poiData && poiData.features) ? poiData.features : [];
    for (let i = 0; i < features.length; i += 1) {
      const candidate = features[i];
      if (!candidate || candidate.id == null) continue;
      lookup.set(String(candidate.id), candidate);
    }
    return lookup;
  }

  function normalizeRelatedFeatureId_(value) {
    if (Array.isArray(value)) {
      value = value.length ? value[0] : '';
    }

    const normalized = String(value == null ? '' : value).trim();
    if (!normalized) return null;
    const parts = normalized.split(',');
    for (let i = 0; i < parts.length; i += 1) {
      const part = String(parts[i] || '').trim();
      if (part) return part;
    }
    return null;
  }

  function normalizeRelatedFeatureIds_(value) {
    const rawValues = Array.isArray(value) ? value : String(value == null ? '' : value).split(',');
    const seen = new Set();
    const normalized = [];

    for (let i = 0; i < rawValues.length; i += 1) {
      const id = String(rawValues[i] == null ? '' : rawValues[i]).trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      normalized.push(id);
    }

    return normalized;
  }

  function resolveFeatureById_(featureId, featureById) {
    if (!featureId || !featureById) return null;
    return featureById.get(String(featureId)) || null;
  }

  function normalizeFlagValue_(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;

    const normalized = String(value == null ? '' : value).trim().toLowerCase();
    if (!normalized) return null;
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
    return null;
  }

  function readNoIssueTrackerFlag_(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (Object.prototype.hasOwnProperty.call(obj, 'ni')) return normalizeFlagValue_(obj.ni);
    if (Object.prototype.hasOwnProperty.call(obj, 'NI')) return normalizeFlagValue_(obj.NI);
    return null;
  }

  function shouldShowReportIssueCta_(feature, poiData) {
    const p = feature && feature.properties ? feature.properties : {};
    const td = poiData && poiData.defs && poiData.defs.types && poiData.defs.types[p.t]
      ? poiData.defs.types[p.t]
      : null;

    const featureNi = readNoIssueTrackerFlag_(p);
    if (featureNi === false) return false;
    if (featureNi === true) return true;

    const typeNi = readNoIssueTrackerFlag_(td);
    if (typeNi === false) return false;
    if (typeNi === true) return true;
    return true;
  }

  function buildReportIssueHref_(feature) {
    const featureId = feature && feature.id != null ? String(feature.id).trim() : '';
    if (!featureId) return '';
    return '/report-trail-issue?id=' + encodeURIComponent(featureId);
  }

  function isParkingFeature_(feature) {
    const typeKey = String(feature?.properties?.t || '').trim().toLowerCase();
    return typeKey === 'pl';
  }

  function getFeatureDisplayLabel_(feature, poiData) {
    if (!feature) return 'Point of Interest';
    const p = feature.properties || {};
    const td = poiData && poiData.defs && poiData.defs.types && poiData.defs.types[p.t]
      ? poiData.defs.types[p.t]
      : null;
    return String(p.l || p.n || (td && td.l) || 'Point of Interest').trim();
  }

  function renderClosestParkingRow_(feature, poiData, featureById) {
    if (!feature || isParkingFeature_(feature)) return '';

    const parkingId = normalizeRelatedFeatureId_(feature.properties && feature.properties.cp);
    const relatedFeature = resolveFeatureById_(parkingId, featureById);
    if (!relatedFeature || String(relatedFeature.id) === String(feature.id)) return '';

    const parkingLabel = esc(getFeatureDisplayLabel_(relatedFeature, poiData));
    const parkingIcon = resolveLegendIcon(
      poiData && poiData.defs && poiData.defs.types && poiData.defs.types.pl
        ? poiData.defs.types.pl.i
        : 'parking.svg'
    );

    return `
    <div class="nc-related-group">
      <div class="nc-related-label">Closest Parking</div>
      <button class="nc-related-row nc-related-button" type="button" data-related-feature-id="${esc(String(relatedFeature.id))}" data-related-kind="cp" aria-label="View closest parking: ${parkingLabel}">
        <span class="nc-related-row-icon" aria-hidden="true">${parkingIcon ? `<img src="${esc(parkingIcon)}" alt="" class="nc-related-icon-img" onerror="this.remove()">` : ''}</span>
        <span class="nc-related-row-text">
          <span class="nc-related-row-meta">Closest Parking</span>
          <span class="nc-related-row-title">${parkingLabel}</span>
        </span>
        <span class="nc-related-chevron" aria-hidden="true">&#8250;</span>
      </button>
    </div>`;
  }

  function renderNearbyAmenitiesRow_(feature, poiData, featureById) {
    const rawIds = normalizeRelatedFeatureIds_(feature?.properties?.nf);
    if (!rawIds.length) return '';

    const buttons = [];
    const seen = new Set();

    for (let i = 0; i < rawIds.length; i += 1) {
      const id = rawIds[i];
      if (!id || seen.has(id) || String(id) === String(feature.id)) continue;
      const relatedFeature = resolveFeatureById_(id, featureById);
      if (!relatedFeature) continue;
      seen.add(id);

      const relatedLabel = esc(getFeatureDisplayLabel_(relatedFeature, poiData));
      buttons.push(
        `<button class="nc-related-chip nc-related-button" type="button" data-related-feature-id="${esc(String(id))}" data-related-kind="nf" aria-label="View nearby amenity: ${relatedLabel}">${relatedLabel}</button>`
      );
    }

    if (!buttons.length) return '';

    return `
    <div class="nc-related-group">
      <div class="nc-related-label">Nearby Amenities</div>
      <div class="nc-related-chip-list">
        ${buttons.join('')}
      </div>
    </div>`;
  }

  function renderRelatedFeatureBlock_(feature, poiData, featureById) {
    const closestParkingHtml = renderClosestParkingRow_(feature, poiData, featureById);
    const nearbyAmenitiesHtml = renderNearbyAmenitiesRow_(feature, poiData, featureById);
    if (!closestParkingHtml && !nearbyAmenitiesHtml) return '';

    return `
  <div class="nc-related" aria-label="Related places">
    ${closestParkingHtml}
    ${nearbyAmenitiesHtml}
  </div>`;
  }

  function readHoursField(source, keys) {
    if (!source || !Array.isArray(keys)) return '';
    for (var i = 0; i < keys.length; i += 1) {
      var value = source[keys[i]];
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
    return '';
  }

  function getFeatureContext(feature, poiData) {
    var properties = feature.properties || {};
    var featureById = buildFeatureLookupMap_(poiData);
    return {
      properties: properties,
      mapillaryId: normalizeMid(properties.m_id),
      html: buildHTML(feature, poiData, featureById),
      coords: feature.geometry && feature.geometry.coordinates,
    };
  }

  let _silentMobilePanToken = 0;

  function easeMapSilently(map, options) {
    if (!map || !options) return;

    var token = ++_silentMobilePanToken;
    var duration = Number(options.duration) || 0;

    if (typeof suppressMapEvents !== 'undefined') {
      suppressMapEvents = true;
    }

    map.easeTo(options);

    if (typeof map.once === 'function') {
      map.once('moveend', function() {
        if (token !== _silentMobilePanToken) return;
        if (typeof suppressMapEvents !== 'undefined') {
          suppressMapEvents = false;
        }
      });
    }

    window.setTimeout(function() {
      if (token !== _silentMobilePanToken) return;
      if (typeof suppressMapEvents !== 'undefined') {
        suppressMapEvents = false;
      }
    }, duration + 120);
  }

  function panMobileSheetIntoView(map, coords, duration) {
    if (!map || !coords) return;

    var sheet = _sheetEl();
    var cardVisible = sheet ? (sheet.offsetHeight - _peekY) : 180;
    var point = map.project(coords);
    var viewportHeight = map.getCanvas().clientHeight;
    var safeBottom = viewportHeight - cardVisible - 20;
    var targetY = Math.max(60, Math.min(safeBottom, point.y));
    var offsetY = targetY - (viewportHeight / 2);

    easeMapSilently(map, {
      center: coords,
      offset: [0, offsetY],
      duration: duration,
      essential: true,
    });
  }

  // ── Lightbox ──────────────────────────────────────────────────

  let _lightbox = null;
  let _mapillaryAssetPromise = null;
  let _mapillaryModal = null;
  let _mapillaryViewer = null;
  let _mapillaryOpenToken = 0;
  let _mapillaryStatusTimer = null;
  let _mapillaryFocusReturn = null;
  let _mapillaryHeroAbortController = null;
  let _desktopPanToken = 0;
  let _desktopPanFrameA = null;
  let _desktopPanFrameB = null;
  let _desktopPanTimeout = null;
  let _desktopPanMoveEndTimeout = null;

  function openLightbox(src) {
    if (_lightbox) { _lightbox.remove(); _lightbox = null; }
    const el = document.createElement('div');
    el.className = 'nc-lightbox';
    el.innerHTML = `
      <img class="nc-lightbox-img" src="${esc(src)}" alt="">
      <button class="nc-lightbox-close" aria-label="Close">&#x2715;</button>`;
    el.addEventListener('click', (e) => {
      if (!e.target.closest('.nc-lightbox-img')) closeLightbox();
    });
    document.addEventListener('keydown', _lbKeydown, true);
    document.body.appendChild(el);
    _lightbox = el;
  }

  function closeLightbox() {
    if (!_lightbox) return;
    _lightbox.remove();
    _lightbox = null;
    document.removeEventListener('keydown', _lbKeydown, true);
  }

  function ensureStylesheetOnce(href) {
    if (!href) return Promise.resolve();
    var existing = document.querySelector('link[data-nc-ext-style="' + href + '"]');
    if (existing) return Promise.resolve();

    return new Promise(function(resolve, reject) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute('data-nc-ext-style', href);
      link.onload = function() { resolve(); };
      link.onerror = function() { reject(new Error('Failed to load stylesheet')); };
      document.head.appendChild(link);
    });
  }

  function ensureScriptOnce(src) {
    if (!src) return Promise.resolve();
    var existing = document.querySelector('script[data-nc-ext-script="' + src + '"]');
    if (existing) {
      if (existing.getAttribute('data-loaded') === 'true') return Promise.resolve();
      return new Promise(function(resolve, reject) {
        existing.addEventListener('load', function() { resolve(); }, { once: true });
        existing.addEventListener('error', function() { reject(new Error('Failed to load script')); }, { once: true });
      });
    }

    return new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.setAttribute('data-nc-ext-script', src);
      script.onload = function() {
        script.setAttribute('data-loaded', 'true');
        resolve();
      };
      script.onerror = function() { reject(new Error('Failed to load script')); };
      document.head.appendChild(script);
    });
  }

  function ensureMapillaryAssets() {
    if (window.mapillary && window.mapillary.Viewer) return Promise.resolve(window.mapillary);
    if (_mapillaryAssetPromise) return _mapillaryAssetPromise;

    _mapillaryAssetPromise = Promise.all([
      ensureStylesheetOnce(MAPILLARY_CSS_URL),
      ensureScriptOnce(MAPILLARY_JS_URL),
    ]).then(function() {
      if (!window.mapillary || !window.mapillary.Viewer) {
        throw new Error('Mapillary viewer unavailable');
      }
      return window.mapillary;
    }).catch(function(err) {
      _mapillaryAssetPromise = null;
      throw err;
    });

    return _mapillaryAssetPromise;
  }

  function _lbKeydown(e) {
    if (e.key !== 'Escape' || !_lightbox) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closeLightbox();
  }

  function _mapillaryKeydown(e) {
    if (e.key !== 'Escape' || !_mapillaryModal || _mapillaryModal.hidden) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closeMapillaryModal();
  }

  // ── Mapillary ─────────────────────────────────────────────────

  let _mapillaryLoadToken = 0;

  function normalizeMid(mid) {
    const raw = String(mid || '').trim().replace(/^['"]+|['"]+$/g, '');
    if (!raw) return '';

    const pKeyMatch = raw.match(/[?&]pKey=([^&#]+)/i);
    const normalized = pKeyMatch ? decodeURIComponent(pKeyMatch[1]) : raw;
    const upper = normalized.replace(/\s+/g, '').toUpperCase();

    if (!normalized || INVALID_MIDS.has(upper)) return '';
    if (!/^\d+$/.test(normalized)) return '';
    return normalized;
  }

  function isValidMid(mid) {
    return Boolean(normalizeMid(mid));
  }

  function removeMapillaryViewer() {
    if (_mapillaryViewer && typeof _mapillaryViewer.remove === 'function') {
      try { _mapillaryViewer.remove(); } catch (e) { /* ignore viewer teardown errors */ }
    }
    _mapillaryViewer = null;
  }

  function ensureMapillaryModal() {
    if (_mapillaryModal) return _mapillaryModal;

    var modal = document.createElement('div');
    modal.id = MAPILLARY_MODAL_ID;
    modal.className = 'nc-mapillary-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Street-level viewer');
    modal.hidden = true;
    modal.innerHTML =
      '<div class="nc-mapillary-backdrop" data-mapillary-close="true"></div>' +
      '<div class="nc-mapillary-panel">' +
        '<div class="nc-mapillary-bar">' +
          '<div class="nc-mapillary-title">Street View</div>' +
          '<div class="nc-mapillary-actions">' +
            '<button class="nc-btn nc-mapillary-close" type="button" aria-label="Close street-level viewer" title="Close">' +
              '<svg class="nc-btn-icon" aria-hidden="true"><use href="#closeX"></use></svg>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<a class="nc-mapillary-link" href="#" target="_blank" rel="noopener noreferrer">Open in Mapillary</a>' +
        '<div class="nc-mapillary-status" aria-live="polite">Loading street-level view...</div>' +
        '<div id="' + MAPILLARY_VIEWER_ID + '" class="nc-mapillary-viewer" aria-hidden="true"></div>' +
      '</div>';

    var closeBtn = modal.querySelector('.nc-mapillary-close');
    var backdrop = modal.querySelector('.nc-mapillary-backdrop');

    function _handleClose(e) {
      e.preventDefault();
      e.stopPropagation();
      closeMapillaryModal();
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', _handleClose);
      closeBtn.addEventListener('touchend', _handleClose);
    }

    if (backdrop) {
      backdrop.addEventListener('click', _handleClose);
      backdrop.addEventListener('touchend', _handleClose);
    }

    document.body.appendChild(modal);
    _mapillaryModal = modal;
    return modal;
  }

  function setMapillaryStatus(text, isError) {
    var modal = ensureMapillaryModal();
    var statusEl = modal.querySelector('.nc-mapillary-status');
    var viewerEl = modal.querySelector('.nc-mapillary-viewer');

    if (statusEl) {
      statusEl.textContent = text || '';
      statusEl.hidden = !text;
      statusEl.classList.toggle('is-error', Boolean(isError));
    }

    if (viewerEl) {
      viewerEl.setAttribute('aria-hidden', text ? 'true' : 'false');
    }
  }

  function describeMapillaryError(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    return String(err.message || err.name || err);
  }

  function closeMapillaryModal() {
    if (!_mapillaryModal || _mapillaryModal.hidden) return;
    _mapillaryOpenToken += 1;
    if (_mapillaryStatusTimer) {
      window.clearTimeout(_mapillaryStatusTimer);
      _mapillaryStatusTimer = null;
    }
    removeMapillaryViewer();
    var viewerEl = _mapillaryModal.querySelector('.nc-mapillary-viewer');
    if (viewerEl) viewerEl.innerHTML = '';
    _mapillaryModal.hidden = true;
    document.body.classList.remove('nc-mapillary-open');
    document.removeEventListener('keydown', _mapillaryKeydown, true);
    if (_mapillaryFocusReturn) {
      try { _mapillaryFocusReturn.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      _mapillaryFocusReturn = null;
    }
  }

  function openMapillaryModal(mid) {
    var normalizedMid = normalizeMid(mid);
    if (!normalizedMid) return;

    var modal = ensureMapillaryModal();
    var viewerEl = modal.querySelector('.nc-mapillary-viewer');
    var openLink = modal.querySelector('.nc-mapillary-link');
    var token = ++_mapillaryOpenToken;

    removeMapillaryViewer();
    if (viewerEl) viewerEl.innerHTML = MAPILLARY_SPINNER_HTML;
    if (openLink) { openLink.href = MAPILLARY_VIEW + normalizedMid; openLink.hidden = false; }

    _mapillaryFocusReturn = document.activeElement || null;
    modal.hidden = false;
    document.body.classList.add('nc-mapillary-open');
    document.addEventListener('keydown', _mapillaryKeydown, true);
    setMapillaryStatus('', false);
    modal.querySelector('.nc-mapillary-close')?.focus({ preventScroll: true });

    ensureMapillaryAssets()
      .then(function(mapillaryLib) {
        if (token !== _mapillaryOpenToken || !_mapillaryModal || _mapillaryModal.hidden || !viewerEl) return;
        var ready = false;
        var supported = typeof mapillaryLib.isSupported === 'function' ? mapillaryLib.isSupported() : null;
        var fallbackSupported = typeof mapillaryLib.isFallbackSupported === 'function' ? mapillaryLib.isFallbackSupported() : null;

        if (supported === false && fallbackSupported === false) {
          hideMapillarySpinner();
          setMapillaryStatus('Street-level viewer is not supported in this browser. Use the link above to open Mapillary directly.', true);
          return;
        }

        function markReady() {
          if (ready || token !== _mapillaryOpenToken) return;
          ready = true;
          if (_mapillaryStatusTimer) {
            window.clearTimeout(_mapillaryStatusTimer);
            _mapillaryStatusTimer = null;
          }
          hideMapillarySpinner();
          setMapillaryStatus('', false);
          var link = modal.querySelector('.nc-mapillary-link');
          if (link) link.hidden = true;
        }

        _mapillaryStatusTimer = window.setTimeout(function() {
          if (token !== _mapillaryOpenToken || ready) return;
          hideMapillarySpinner();
          // Destroy the viewer so its canvas stops intercepting pointer events,
          // which otherwise prevents the close button from working.
          removeMapillaryViewer();
          if (viewerEl) viewerEl.innerHTML = '';
          setMapillaryStatus('Street view is temporarily unavailable. Use the link above to open Mapillary directly.', true);
        }, 8000);

        try {
          _mapillaryViewer = new mapillaryLib.Viewer({
            accessToken: MAPILLARY_TOKEN,
            container: viewerEl,
            imageId: normalizedMid,
            component: {
              cover: false,
              fallback: {
                image: true,
                navigation: true,
              },
            },
          });
          console.info('Mapillary viewer init', {
            imageId: normalizedMid,
            supported: supported,
            fallbackSupported: fallbackSupported,
          });

          _mapillaryViewer.on('load', function() {
            markReady();
          });

          _mapillaryViewer.on('image', function() {
            markReady();
          });

          // Intentionally not using 'dataloading' as a ready signal: when the
          // Mapillary API returns 500s, dataloading fires with loading:false
          // (batch "finished" despite failing), which would trigger markReady()
          // prematurely — hiding the status and leaving a black canvas that
          // intercepts pointer events and breaks the close button.
        } catch (_err) {
          console.warn('Mapillary viewer init failed', _err);
          if (_mapillaryStatusTimer) {
            window.clearTimeout(_mapillaryStatusTimer);
            _mapillaryStatusTimer = null;
          }
          hideMapillarySpinner();
          removeMapillaryViewer();
          setMapillaryStatus('Unable to open the street-level viewer here. ' + describeMapillaryError(_err) + '. Use the link above to open Mapillary directly.', true);
        }
      })
      .catch(function(err) {
        console.warn('Mapillary assets failed to load', err);
        if (token !== _mapillaryOpenToken) return;
        hideMapillarySpinner();
        removeMapillaryViewer();
        setMapillaryStatus('Unable to load the street-level viewer right now. ' + describeMapillaryError(err) + '. Use the link above to open Mapillary directly.', true);
      });
  }

  function hideMapillarySpinner() {
    if (!_mapillaryModal) return;
    var el = _mapillaryModal.querySelector('.nc-mapillary-loading');
    if (el) el.remove();
  }

  function getMapViewEl() {
    return document.getElementById('mapView')
      || document.getElementById('map')?.parentElement
      || null;
  }

  function getMapEl() {
    return document.getElementById('map');
  }

  function getDesktopCardEl() {
    return document.getElementById(DESKTOP_CARD_ID);
  }

  function syncDesktopHostClasses(isOpen, isCollapsed) {
    [getMapViewEl(), getMapEl()].forEach(function(el) {
      if (!el) return;
      el.classList.toggle('nc-sidecar-open', Boolean(isOpen));
      el.classList.toggle('nc-sidecar-collapsed', Boolean(isOpen && isCollapsed));
      el.style.setProperty('--nc-sidecar-width', DESKTOP_CARD_WIDTH + 'px');
    });
  }

  function updateDesktopToggleLabels(btn, isCollapsed) {
    if (!btn) return;
    var label = isCollapsed ? 'Expand details panel' : 'Collapse details panel';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
    btn.setAttribute('aria-expanded', String(!isCollapsed));
  }

  function setDesktopCardCollapsed(shell, isCollapsed, opts) {
    if (!shell) return;
    var toggle = shell.querySelector('.nc-desktop-card__toggle');
    shell.classList.toggle('is-collapsed', Boolean(isCollapsed));
    syncDesktopHostClasses(true, Boolean(isCollapsed));
    updateDesktopToggleLabels(toggle, Boolean(isCollapsed));
    if (opts && opts.focusToggle && !shell.hidden) toggle?.focus({ preventScroll: true });
  }

  function ensureDesktopCard() {
    var shell = getDesktopCardEl();
    if (shell) return shell;

    var host = getMapViewEl();
    if (!host) return null;

    shell = document.createElement('aside');
    shell.id = DESKTOP_CARD_ID;
    shell.className = 'nc-desktop-card';
    shell.hidden = true;
    shell.setAttribute('aria-label', 'Point of interest details');
    shell.innerHTML =
      '<div class="nc-desktop-card__panel" tabindex="-1">' +
        '<div id="' + DESKTOP_CARD_BODY_ID + '" class="nc-desktop-card__body"></div>' +
      '</div>' +
      '<button class="nc-desktop-card__toggle" type="button">' +
        '<span class="nc-desktop-card__chevron" aria-hidden="true">&#10094;</span>' +
      '</button>';

    var toggle = shell.querySelector('.nc-desktop-card__toggle');
    updateDesktopToggleLabels(toggle, false);

    shell.addEventListener('click', function(e) {
      var tw = e.target.closest('.nc-thumb-wrap[data-hires]');
      if (tw)                                { openLightbox(tw.dataset.hires); return; }
      var heroLink = e.target.closest('.nc-hero-link[data-mid]');
      if (heroLink) {
        e.preventDefault();
        openMapillaryModal(heroLink.getAttribute('data-mid'));
        return;
      }
      var relatedButton = e.target.closest('[data-related-feature-id]');
      if (relatedButton) {
        e.preventDefault();
        e.stopPropagation();
        if (_opts && typeof _opts.onSelectRelatedFeature === 'function') {
          _opts.onSelectRelatedFeature(relatedButton.getAttribute('data-related-feature-id'));
        }
        return;
      }
      if (e.target.closest('.nc-action-share') || e.target.closest('.nc-share-btn')) {
        _opts && _opts.onShare && _opts.onShare();
      }
    });

    toggle.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (shell.classList.contains('is-collapsed')) {
        expandDesktopCard({ focusToggle: true });
      } else {
        collapseDesktopCard({ focusToggle: true });
      }
    });

    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Escape' || isMobile()) return;
      if (_mapillaryModal && !_mapillaryModal.hidden) return;
      if (_lightbox) return;
      if (!_activeFeatureId) return;
      e.preventDefault();
      hide();
    }, true);

    host.appendChild(shell);
    return shell;
  }

  function collapseDesktopCard(opts) {
    var shell = getDesktopCardEl();
    setDesktopCardCollapsed(shell, true, opts);
  }

  function expandDesktopCard(opts) {
    var shell = getDesktopCardEl();
    setDesktopCardCollapsed(shell, false, opts);
  }

  function hideDesktopCard() {
    var shell = getDesktopCardEl();
    cancelDesktopPanSchedule();
    if (!shell) return;
    setDesktopCardCollapsed(shell, false);
    shell.hidden = true;
    shell.querySelector('.nc-desktop-card__body')?.replaceChildren();
    syncDesktopHostClasses(false, false);
  }

  function panDesktopCardIntoView(map, coords) {
    var shell = getDesktopCardEl();
    if (!map || !coords || !shell || shell.hidden || shell.classList.contains('is-collapsed')) return;

    var point = map.project(coords);
    var canvas = map.getCanvas();
    if (!canvas) return;

    var minVisibleX = Math.min(canvas.clientWidth - 64, DESKTOP_CARD_WIDTH + DESKTOP_CARD_GAP + 16);
    if (point.x >= minVisibleX) return;

    var targetX = minVisibleX;
    var offsetX = targetX - (canvas.clientWidth / 2);
    var clampedY = Math.max(72, Math.min(canvas.clientHeight - 72, point.y));
    var offsetY = clampedY - (canvas.clientHeight / 2);

    if (typeof suppressMapEvents !== 'undefined') {
      suppressMapEvents = true;
    }

    map.easeTo({
      center: coords,
      offset: [offsetX, offsetY],
      duration: 280,
      essential: true,
    });

    if (typeof map.once === 'function') {
      map.once('moveend', function() {
        if (typeof suppressMapEvents !== 'undefined') {
          suppressMapEvents = false;
        }
      });
    }
  }

  function scheduleDesktopPan(map, coords) {
    if (!map || !coords) return;
    var token = ++_desktopPanToken;

    if (_desktopPanFrameA != null) {
      window.cancelAnimationFrame(_desktopPanFrameA);
      _desktopPanFrameA = null;
    }
    if (_desktopPanFrameB != null) {
      window.cancelAnimationFrame(_desktopPanFrameB);
      _desktopPanFrameB = null;
    }
    if (_desktopPanTimeout != null) {
      window.clearTimeout(_desktopPanTimeout);
      _desktopPanTimeout = null;
    }
    if (_desktopPanMoveEndTimeout != null) {
      window.clearTimeout(_desktopPanMoveEndTimeout);
      _desktopPanMoveEndTimeout = null;
    }

    _desktopPanFrameA = requestAnimationFrame(function() {
      _desktopPanFrameA = null;
      _desktopPanFrameB = requestAnimationFrame(function() {
        _desktopPanFrameB = null;
        if (token !== _desktopPanToken) return;
        panDesktopCardIntoView(map, coords);
      });
    });

    _desktopPanTimeout = window.setTimeout(function() {
      _desktopPanTimeout = null;
      if (token !== _desktopPanToken) return;
      panDesktopCardIntoView(map, coords);
    }, 240);

    if (typeof map.once === 'function') {
      map.once('moveend', function() {
        if (token !== _desktopPanToken) return;
        _desktopPanMoveEndTimeout = window.setTimeout(function() {
          _desktopPanMoveEndTimeout = null;
          if (token !== _desktopPanToken) return;
          panDesktopCardIntoView(map, coords);
        }, 40);
      });
    }
  }

  function cancelDesktopPanSchedule() {
    _desktopPanToken += 1;
    if (_desktopPanFrameA != null) {
      window.cancelAnimationFrame(_desktopPanFrameA);
      _desktopPanFrameA = null;
    }
    if (_desktopPanFrameB != null) {
      window.cancelAnimationFrame(_desktopPanFrameB);
      _desktopPanFrameB = null;
    }
    if (_desktopPanTimeout != null) {
      window.clearTimeout(_desktopPanTimeout);
      _desktopPanTimeout = null;
    }
    if (_desktopPanMoveEndTimeout != null) {
      window.clearTimeout(_desktopPanMoveEndTimeout);
      _desktopPanMoveEndTimeout = null;
    }
  }

  function showDesktopCard(html, map, coords, mId) {
    var shell = ensureDesktopCard();
    if (!shell) return;
    cancelDesktopPanSchedule();

    var body = shell.querySelector('#' + DESKTOP_CARD_BODY_ID);
    if (!body) return;

    body.innerHTML = html;
    body.scrollTop = 0;
    shell.hidden = false;
    setDesktopCardCollapsed(shell, false);

    if (isValidMid(mId)) {
      loadMapillaryHero(mId, body);
    }

    requestAnimationFrame(function() {
      shell.querySelector('.nc-desktop-card__panel')?.focus?.({ preventScroll: true });
      scheduleDesktopPan(map, coords);
    });
  }

  function syncPeekStateIfNeeded(scope) {
    const sheet = _sheetEl();
    if (!sheet || _sheetState !== SHEET_STATE_INITIAL || !scope || !sheet.contains(scope)) return;
    _peekY = _computePeekY(sheet);
    sheet.style.transition = 'transform 180ms ease';
    sheet.style.transform = 'translateY(' + _peekY + 'px)';
  }

  // Lazily fetch the Mapillary thumbnail URL and reveal the hero slot.
  // Called after card HTML is in the DOM.
  function loadMapillaryHero(mId, scope) {
    const heroEl = scope && scope.querySelector('.nc-hero');
    if (!heroEl) return;
    const normalizedMid = normalizeMid(mId);
    if (_mapillaryHeroAbortController) {
      _mapillaryHeroAbortController.abort();
      _mapillaryHeroAbortController = null;
    }
    if (!normalizedMid) {
      heroEl.remove();
      syncPeekStateIfNeeded(scope);
      return;
    }

    const loadToken = ++_mapillaryLoadToken;
    const heroLink = heroEl.querySelector('.nc-hero-link');
    if (heroLink) heroLink.href = MAPILLARY_VIEW + normalizedMid;

    const tok = MAPILLARY_TOKEN.replace(/\|/g, '%7C');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    _mapillaryHeroAbortController = controller;
    fetch(`${MAPILLARY_API}${encodeURIComponent(normalizedMid)}?fields=thumb_1024_url&access_token=${tok}`, controller ? { signal: controller.signal } : undefined)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(data => {
        if (controller && controller.signal.aborted) return;
        if (loadToken !== _mapillaryLoadToken || !heroEl.isConnected) return;
        if (_mapillaryHeroAbortController === controller) _mapillaryHeroAbortController = null;
        const src = data && data.thumb_1024_url;
        if (!src) {
          heroEl.remove();
          syncPeekStateIfNeeded(scope);
          return;
        }
        const img = heroEl.querySelector('.nc-hero-img');
        if (img) {
          img.src = src;
          img.onload = () => {
            if (loadToken !== _mapillaryLoadToken || !heroEl.isConnected) return;
            heroEl.classList.add('nc-hero--loaded');
          };
          img.onerror = () => {
            heroEl.remove();
            syncPeekStateIfNeeded(scope);
          };
        }
      })
      .catch((err) => {
        if (controller && controller.signal.aborted) return;
        if (err && err.name === 'AbortError') return;
        if (loadToken !== _mapillaryLoadToken || !heroEl.isConnected) return;
        if (_mapillaryHeroAbortController === controller) _mapillaryHeroAbortController = null;
        heroEl.remove();
        syncPeekStateIfNeeded(scope);
      });
  }

  // ── Hours open/closed status ──────────────────────────────────

  // Parse an ISO timestamp from GAS (e.g. "1899-12-30T11:00:00.000Z") into
  // total minutes using local time so comparison works in the visitor's timezone.
  function formatMinutesDisplay(totalMinutes) {
    if (totalMinutes === null || totalMinutes === undefined) return null;
    var h = Math.floor(totalMinutes / 60) % 24;
    var min = totalMinutes % 60;
    var ampm = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 || 12;
    return h12 + ':' + (min < 10 ? '0' : '') + min + ' ' + ampm;
  }

  function parseClockValue(rawValue) {
    if (!rawValue) return null;
    var value = String(rawValue).trim();
    if (!value) return null;

    var d = new Date(value);
    if (!isNaN(d)) {
      return {
        mins: d.getHours() * 60 + d.getMinutes(),
        display: formatMinutesDisplay(d.getHours() * 60 + d.getMinutes()),
      };
    }

    var match = value.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
    if (match) {
      var hours = Number(match[1]);
      var minutes = Number(match[2] || '0');
      var suffix = match[3].toUpperCase();
      if (hours >= 1 && hours <= 12 && minutes >= 0 && minutes < 60) {
        var hour24 = hours % 12;
        if (suffix === 'PM') hour24 += 12;
        var total = hour24 * 60 + minutes;
        return {
          mins: total,
          display: formatMinutesDisplay(total),
        };
      }
    }

    match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (match) {
      var hour24Only = Number(match[1]);
      var minute24Only = Number(match[2]);
      if (hour24Only >= 0 && hour24Only < 24 && minute24Only >= 0 && minute24Only < 60) {
        var total24 = hour24Only * 60 + minute24Only;
        return {
          mins: total24,
          display: formatMinutesDisplay(total24),
        };
      }
    }

    return {
      mins: null,
      display: value,
    };
  }

  function parseLegacyHoursRange(rawHours) {
    var value = String(rawHours || '').trim();
    if (!value) return null;

    var parts = value.split(/\s*[-–—]\s*/);
    if (parts.length < 2) return null;

    var openRaw = String(parts[0] || '').trim();
    var closeRaw = String(parts.slice(1).join(' - ') || '').trim();
    if (!openRaw || !closeRaw) return null;

    return {
      open: openRaw,
      close: closeRaw,
    };
  }

  // Build the "5:00 AM - 11:00 PM" display string from the two ISO fields.
  function buildHoursDisplay(hrOpen, hrClose) {
    var openInfo = parseClockValue(hrOpen);
    var closeInfo = parseClockValue(hrClose);
    var o = openInfo && openInfo.display;
    var c = closeInfo && closeInfo.display;
    if (!o && !c) return '';
    if (o && c) return o + ' \u2013 ' + c;
    return o || c;
  }

  // Return 'open' or 'closed' by comparing current local time to the two ISO fields.
  function hoursStatus(hrOpen, hrClose) {
    var openInfo = parseClockValue(hrOpen);
    var closeInfo = parseClockValue(hrClose);
    var start = openInfo ? openInfo.mins : null;
    var end = closeInfo ? closeInfo.mins : null;
    if (start === null || end === null) return null;
    var now = new Date();
    var cur = now.getHours() * 60 + now.getMinutes();
    var open = end > start ? (cur >= start && cur < end) : (cur >= start || cur < end);
    return open ? 'open' : 'closed';
  }

  // ── Card HTML ─────────────────────────────────────────────────

  function buildHTML(feature, poiData, featureById) {
    const p  = feature.properties || {};
    const td = poiData && poiData.defs && poiData.defs.types && poiData.defs.types[p.t]
             ? poiData.defs.types[p.t]
             : null;
    const u  = window.NorthavenUtils;

    const name      = esc(String(p.l   || (td && td.l)  || '').trim());
    const near      = esc(String(p.r   || '').trim());
    const rawHours   = String(p.hr || (td && td.hr) || '').trim();
    const legacyRange = parseLegacyHoursRange(rawHours);
    const hrOpen    = readHoursField(p, ['hr_open']) || readHoursField(td, ['hr_open']) || legacyRange?.open || '';
    const hrClose   = readHoursField(p, ['hr_close', 'hr_closed']) || readHoursField(td, ['hr_close', 'hr_closed']) || legacyRange?.close || '';
    const hours     = buildHoursDisplay(hrOpen, hrClose) || rawHours;
    const category  = esc(String(p.b   || (td && td.l)  || '').trim());
    const desc      =     String(p.d   || (td && td.d)  || '').trim();
    const linkText  = esc(String(p.e   || (td && td.e)  || '').trim());
    const linkUrl   =     String(p.f   || (td && td.f)  || '').trim();
    const ctaLabel  = esc(String((p.cta_label) || '').trim());
    const ctaUrl    =     String((p.cta_url)   || '').trim();
    const amenities =     String(p.am  || (td && td.am) || '').trim();
    const amenityLabels = getAmenityLabelsText(amenities);
    const mId       =     normalizeMid(p.m_id);

    // Legend icon — shown next to the category badge (not as thumbnail)
    const iconRaw   = td && td.i ? String(td.i).trim() : '';
    const iconUrl   = resolveLegendIcon(iconRaw);

    const resolvedLink = u ? u.normalizeAbsUrl(linkUrl) : linkUrl;
    const resolvedCta  = u ? u.normalizeAbsUrl(ctaUrl)  : ctaUrl;
    const reportIssueHref = shouldShowReportIssueCta_(feature, poiData)
      ? (u ? u.normalizeAbsUrl(buildReportIssueHref_(feature)) : buildReportIssueHref_(feature))
      : '';

    const coords = feature.geometry && feature.geometry.coordinates;
    const lat = coords && coords[1];
    const lng = coords && coords[0];
    const mapQuery   = lat && lng ? `${lat},${lng}` : '';
    const directionsHref = mapQuery ? esc(GOOGLE_DIR_URL + mapQuery) : '';

    const imgUrl      = resolveImage(p, td, 200);
    const imgHiresUrl = resolveImage(p, td, 1200);

    // ── Mapillary hero ────────────────────────────────────────
    const heroTitle = isMobile() ? 'Tap to open Street View' : 'Click to open Street View';
    const heroHtml = mId ? `
  <div class="nc-hero">
    <a class="nc-hero-link" href="${esc(MAPILLARY_VIEW + mId)}" target="_blank" rel="noopener noreferrer" aria-label="Open Street View for this point of interest" title="${heroTitle}" data-mid="${esc(mId)}">
      <img class="nc-hero-img" alt="Street-level photo" title="${heroTitle}">
      <span class="nc-hero-cta" aria-hidden="true">${heroTitle}</span>
    </a>
    <span class="nc-hero-badge">Street View</span>
  </div>` : '';

    // ── Thumbnail ─────────────────────────────────────────────
    // For 911 markers (type 'em'), prioritize the generated sign
    let effectiveImg = imgUrl;
    let hiresAttr = imgHiresUrl ? ` data-hires="${esc(imgHiresUrl)}"` : '';

    if (p.t === 'em' && u?.generate911SignSvg) {
      effectiveImg = u.generate911SignSvg(p.l);
      hiresAttr = ''; // no hires for SVG
    }

    const thumbHtml = effectiveImg ? `
      <div class="nc-thumb-wrap"${hiresAttr}>
        <img class="nc-thumb" src="${esc(effectiveImg)}" alt="" aria-hidden="true"
             width="72" height="72" loading="lazy"
             onerror="this.closest('.nc-thumb-wrap').remove()">
      </div>` : '';

    // ── Category row: legend icon inside the badge pill ───────
    const categoryHtml = category ? `
    <div class="nc-category-row">
      <span class="nc-badge">
        ${iconUrl ? `<img class="nc-category-icon" src="${esc(iconUrl)}" alt="" aria-hidden="true" onerror="this.remove()">` : ''}
        <span class="nc-badge-label">${category}</span>
      </span>
    </div>` : '';

    // ── Amenity pills ─────────────────────────────────────────
    const pills = amenities
      .split(/[\s,]+/)
      .filter(function(t) { return t && AMENITY_LABELS[t]; })
      .map(function(t)    { return `<span class="nc-tag">${esc(AMENITY_LABELS[t])}</span>`; })
      .join('');
    const amenityHtml = pills ? `<div class="nc-amenities" aria-label="${esc(amenityLabels)}">${pills}</div>` : '';

    // ── Footer actions ────────────────────────────────────────
    const ctaExternal = resolvedCta && u?.isExternalDomain ? u.isExternalDomain(resolvedCta) : false;
    const ctaTarget = ctaExternal ? ' target="_blank" rel="noopener noreferrer"' : '';

    const footerBtns = [
      resolvedCta && ctaLabel && `<a class="nc-action nc-cta" href="${esc(resolvedCta)}" title="${ctaLabel}" aria-label="${ctaLabel}"${ctaTarget}><span class="nc-action-label">${ctaLabel}</span></a>`,
      reportIssueHref && `<a class="nc-action" href="${esc(reportIssueHref)}" title="Report an issue at this location" aria-label="Report an issue at this location">
        <span class="nc-action-label">Report Issue</span>
      </a>`,
      directionsHref && `<a class="nc-action" href="${directionsHref}" target="_blank" rel="noopener noreferrer" aria-label="Get directions in Google Maps" title="Get directions in Google Maps">
        <svg class="nc-action-icon" aria-hidden="true"><use href="#google-logo"></use></svg>
        <span class="nc-action-label">Directions</span>
      </a>`,
      `<button class="nc-action nc-action-share" type="button" aria-label="Share this point of interest" title="Share this point of interest">
        <svg class="nc-action-icon" aria-hidden="true"><use href="#share-icon"></use></svg>
        <span class="nc-action-label">Share</span>
      </button>`,
    ].filter(Boolean).join('');
    const relatedHtml = renderRelatedFeatureBlock_(feature, poiData, featureById);

    return `
<div class="nc-card">
  <div class="nc-header">
    ${thumbHtml}
    <div class="nc-header-text">
      <div class="nc-name-row">
        <h2 class="nc-name">${name}</h2>
      </div>
      ${near  ? `<div class="nc-near">Near ${near}</div>`  : ''}
      ${hours ? `<div class="nc-hours">${(function(){ var s = hoursStatus(hrOpen, hrClose); return s ? `<strong class="nc-hours-status nc-hours-${s}">${s === 'open' ? 'Open' : 'Closed'}</strong> ` : ''; })()}${esc(hours)}</div>` : ''}
    </div>
  </div>

  <hr class="nc-divider">

  ${footerBtns ? `<div class="nc-actions">${footerBtns}</div>` : ''}

  ${relatedHtml}

  ${heroHtml}

  <div class="nc-body">
    ${categoryHtml}
    ${amenityHtml}
    ${desc        ? `<div class="nc-desc">${desc}</div>`                   : ''}
    ${resolvedLink && linkText
        ? `<a class="nc-link" href="${esc(resolvedLink)}">${linkText}</a>` : ''}
  </div>
</div>`;
  }

  // ── Bottom sheet ──────────────────────────────────────────────
  //
  // States: 'hidden' | 'initial' | 'full'
  //
  // Initial shows the handle bar + header (up to the first <hr>).
  // Full opens to 90% of the viewport.
  // Any upward drag → full. Any downward drag → initial.
  //
  // All transforms are managed via inline style so drag updates are
  // immediate. The base .nc-sheet CSS provides the transition timing.

  let _sheetState = SHEET_STATE_HIDDEN;
  let _peekY      = 0;
  let _dragData   = null;  // { startY, startTime, startPx, h, pointerId }
  let _suppressHandleClickUntil = 0;
  let _dragMoveListenerActive = false;

  function _sheetEl() {
    return document.getElementById(SHEET_ID);
  }

  // Must be called while the sheet has transform: translateY(0px) so that
  // getBoundingClientRect values are in natural (un-transformed) space.
  function _computePeekY(el) {
    var divider = el.querySelector('.nc-divider');
    var sr = el.getBoundingClientRect();
    var hero = el.querySelector('.nc-hero');

    if (hero) {
      var hr = hero.getBoundingClientRect();
      var heroVisible = Math.min(hero.offsetHeight, PEEK_HERO_PREVIEW);
      var heroBottom = hr.top - sr.top + heroVisible;
      return Math.max(el.offsetHeight - heroBottom, 60);
    }

    if (!divider) return Math.max(el.offsetHeight - 180, 60);
    var dr = divider.getBoundingClientRect();
    var distFromTop = dr.top - sr.top;
    var visible     = distFromTop + divider.offsetHeight + 4;
    return Math.max(el.offsetHeight - visible, 60);
  }

  function _animate(el, y, easing) {
    el.style.transition = 'transform ' + (easing || '220ms ease');
    el.style.transform  = 'translateY(' + y + 'px)';
  }

  function _stateY(state, h) {
    if (state === SHEET_STATE_FULL) {
      return Math.max(0, h - Math.min(h, window.innerHeight * FULL_VIEWPORT_RATIO));
    }
    if (state === SHEET_STATE_INITIAL) return _peekY;
    return h + 30;
  }

  function _dragPointY(e) {
    if (typeof e.clientY === 'number') return e.clientY;
    if (e.touches && e.touches[0]) return e.touches[0].clientY;
    if (e.changedTouches && e.changedTouches[0]) return e.changedTouches[0].clientY;
    return null;
  }

  function _beginDrag(el, clientY, pointerId) {
    if (_sheetState === SHEET_STATE_HIDDEN || typeof clientY !== 'number') return;
    var h = el.offsetHeight;
    _dragData = {
      startY: clientY,
      startTime: Date.now(),
      startPx: _stateY(_sheetState, h),
      h: h,
      pointerId: pointerId,
    };
    el.style.transition = 'none';
    el.style.transform = 'translateY(' + _dragData.startPx + 'px)';
  }

  function _moveDrag(el, clientY) {
    if (!_dragData || typeof clientY !== 'number') return;
    var dy = clientY - _dragData.startY;
    var newY = Math.max(0, Math.min(_dragData.startPx + dy, _dragData.h + 30));
    el.style.transform = 'translateY(' + newY + 'px)';
  }

  function _endDrag(el, clientY) {
    if (!_dragData || typeof clientY !== 'number') return;
    var dy  = clientY - _dragData.startY;
    var vel = dy / Math.max(1, Date.now() - _dragData.startTime);
    var h   = _dragData.h;
    var moved = Math.abs(dy);
    _dragData = null;

    // Any upward drag or flick → full. Any downward drag or flick → initial.
    var target;
    if (dy < -10 || vel < -0.15) {
      target = SHEET_STATE_FULL;
    } else if (dy > 10 || vel > 0.15) {
      // If we are at peek (initial) and drag down significantly -> hide.
      // Otherwise returning to initial (peek).
      target = (_sheetState === SHEET_STATE_INITIAL && dy > 40) ? SHEET_STATE_HIDDEN : SHEET_STATE_INITIAL;
    } else {
      target = _sheetState; // tiny movement — stay put
    }

    _animate(el, _stateY(target, h), '300ms cubic-bezier(0.32, 0.72, 0, 1)');
    _sheetState = target;

    if (moved > 6) {
      _suppressHandleClickUntil = Date.now() + 400;
    }
  }

  function _removeDragListeners() {
    if (!_dragMoveListenerActive) return;
    window.removeEventListener('pointermove', _onSheetPointerMove, { passive: false });
    window.removeEventListener('pointerup', _onSheetPointerEnd, { passive: false });
    window.removeEventListener('pointercancel', _onSheetPointerEnd, { passive: false });
    _dragMoveListenerActive = false;
  }

  function _onSheetPointerMove(e) {
    var el = _sheetEl();
    if (!_dragData || !el) {
      _removeDragListeners();
      return;
    }
    if (_dragData.pointerId != null && e.pointerId !== _dragData.pointerId) return;
    e.preventDefault();
    _moveDrag(el, _dragPointY(e));
  }

  function _onSheetPointerEnd(e) {
    var el = _sheetEl();
    if (!_dragData || !el) {
      _removeDragListeners();
      return;
    }
    if (_dragData.pointerId != null && e.pointerId !== _dragData.pointerId) return;
    e.preventDefault();
    _endDrag(el, _dragPointY(e));
    _removeDragListeners();
  }

  function _addDragListeners() {
    if (_dragMoveListenerActive) return;
    window.addEventListener('pointermove', _onSheetPointerMove, { passive: false });
    window.addEventListener('pointerup', _onSheetPointerEnd, { passive: false });
    window.addEventListener('pointercancel', _onSheetPointerEnd, { passive: false });
    _dragMoveListenerActive = true;
  }

  function ensureSheet() {
    var el = _sheetEl();
    if (el) return el;

    el = document.createElement('div');
    el.id = SHEET_ID;
    el.className = 'nc-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Point of interest details');
    el.setAttribute('tabindex', '-1'); // Allow programmatic focus
    el.innerHTML =
      '<div class="nc-sheet-handle-row">' +
        '<div class="nc-handle-track" role="button" tabindex="0" aria-label="Expand or collapse details">' +
          '<div class="nc-sheet-handle"></div>' +
        '</div>' +
        '<div class="nc-sheet-btns">' +
          '<button class="nc-btn nc-share-btn" type="button" aria-label="Share" title="Share this point of interest">' +
            '<svg class="nc-btn-icon" aria-hidden="true"><use href="#share-icon"></use></svg>' +
          '</button>' +
          '<button class="nc-btn nc-close-btn" type="button" aria-label="Close" title="Close">' +
            '<svg class="nc-btn-icon" aria-hidden="true"><use href="#closeX"></use></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div id="' + SHEET_BODY_ID + '" class="nc-sheet-body"></div>';
    document.body.appendChild(el);

    var handleTrack = el.querySelector('.nc-handle-track');

    el.style.transition = 'none';
    el.style.transform  = 'translateY(' + (window.innerHeight + 30) + 'px)';

    // ── Click delegation ──────────────────────────────────────
    el.addEventListener('click', function(e) {
      var tw = e.target.closest('.nc-thumb-wrap[data-hires]');
      if (tw)                                { openLightbox(tw.dataset.hires); return; }
      var heroLink = e.target.closest('.nc-hero-link[data-mid]');
      if (heroLink) {
        e.preventDefault();
        openMapillaryModal(heroLink.getAttribute('data-mid'));
        return;
      }
      var relatedButton = e.target.closest('[data-related-feature-id]');
      if (relatedButton) {
        e.preventDefault();
        e.stopPropagation();
        if (_opts && typeof _opts.onSelectRelatedFeature === 'function') {
          _opts.onSelectRelatedFeature(relatedButton.getAttribute('data-related-feature-id'));
        }
        return;
      }
      if (e.target.closest('.nc-close-btn')) { hide();                         return; }
      if (e.target.closest('.nc-action-share') || e.target.closest('.nc-share-btn')) { _opts && _opts.onShare && _opts.onShare(); return; }
    });

    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Escape' || _lightbox) return;
      if (_mapillaryModal && !_mapillaryModal.hidden) return; // let _mapillaryKeydown handle ESC first
      if (_sheetState !== SHEET_STATE_HIDDEN) {
        e.stopImmediatePropagation();
        hide();
      }
    }, true);

    if (handleTrack) {
      handleTrack.addEventListener('pointerdown', function(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        _beginDrag(el, _dragPointY(e), e.pointerId);
        _addDragListeners();
      });

      function toggleExpand() {
        if (_dragData || _sheetState === SHEET_STATE_HIDDEN) return;
        if (Date.now() < _suppressHandleClickUntil) return;
        var target = _sheetState === SHEET_STATE_INITIAL
          ? SHEET_STATE_FULL
          : SHEET_STATE_INITIAL;
        _animate(el, _stateY(target, el.offsetHeight), '300ms cubic-bezier(0.32, 0.72, 0, 1)');
        _sheetState = target;
      }
      handleTrack.addEventListener('click', toggleExpand);
      handleTrack.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleExpand();
        }
      });
    }

    return el;
  }

  function showSheet(html) {
    var sheet = ensureSheet();
    document.getElementById(SHEET_BODY_ID).innerHTML = html;

    // Step 1 — place at natural position so getBoundingClientRect is accurate.
    sheet.style.transition = 'none';
    sheet.style.transform  = 'translateY(0px)';
    sheet.offsetHeight;                        // force reflow

    // Step 2 — measure where the divider lands → peek position.
    _peekY = _computePeekY(sheet);

    // Step 3 — jump below screen (no visible flash; browser hasn't painted yet).
    sheet.style.transform = 'translateY(' + (window.innerHeight + 30) + 'px)';
    sheet.offsetHeight;                        // force reflow
    _sheetState = SHEET_STATE_HIDDEN;

    // Step 4 — animate to peek after two frames so the slide-up is always seen.
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        _animate(sheet, _peekY, '350ms cubic-bezier(0.32, 0.72, 0, 1)');
        _sheetState = SHEET_STATE_INITIAL;
        // Move focus to the sheet so screen readers announce it.
        sheet.focus({ preventScroll: true });
      });
    });
  }

  function hideSheet() {
    var el = _sheetEl();
    if (!el || _sheetState === SHEET_STATE_HIDDEN) return;
    _dragData = null;
    _removeDragListeners();
    _animate(el, el.offsetHeight + 30, '220ms ease');
    _sheetState = SHEET_STATE_HIDDEN;
  }

  // ── State ─────────────────────────────────────────────────────

  var _opts            = null;
  var _silentHide      = false;
  var _activeFeatureId = null;
  var _activeFeature   = null;
  var _activePoiData   = null;
  var _lastMobileMode  = isMobile();
  var _resizeTick      = null;

  function ensureResponsiveSync() {
    if (window.__ncSidecarResizeWired) return;
    window.__ncSidecarResizeWired = true;

    window.addEventListener('resize', function() {
      if (_resizeTick) window.clearTimeout(_resizeTick);
      _resizeTick = window.setTimeout(function() {
        _resizeTick = null;
        var nextMobile = isMobile();
        if (nextMobile === _lastMobileMode) return;
        _lastMobileMode = nextMobile;

        if (!_activeFeature || !_opts?.map) return;

        var feature = _activeFeature;
        var data = _activePoiData;
        var map = _opts.map;
        var opts = _opts;

        _silentHide = true;
        hideSheet();
        hideDesktopCard();
        _silentHide = false;

        show(feature, data, map, opts);
      }, 140);
    });
  }

  // ── Public API ────────────────────────────────────────────────

  function show(feature, poiData, map, opts) {
    _opts = Object.assign({}, opts || {}, { map: map });
    _activeFeatureId = feature.id;
    _activeFeature = feature;
    _activePoiData = poiData;
    _lastMobileMode = isMobile();
    ensureResponsiveSync();

    var context = getFeatureContext(feature, poiData);
    var html = context.html;
    var coords = context.coords;

    _silentHide = true;
    hideSheet();
    hideDesktopCard();
    _silentHide = false;

    if (isMobile()) {
      showSheet(html);
      if (isValidMid(context.mapillaryId)) {
        loadMapillaryHero(context.mapillaryId, document.getElementById(SHEET_BODY_ID));
      }
      // Pan so the tapped marker stays visible above the peeked card.
      // _peekY is set synchronously by showSheet(), so we can read it now.
      panMobileSheetIntoView(map, coords, 400);
    } else {
      if (!coords) return;
      showDesktopCard(html, map, coords, context.mapillaryId);
    }
  }

  function hide(opts) {
    var silent = opts && opts.silent ? true : false;
    _silentHide = silent;
    closeMapillaryModal();
    if (_mapillaryHeroAbortController) {
      _mapillaryHeroAbortController.abort();
      _mapillaryHeroAbortController = null;
    }
    hideSheet();
    hideDesktopCard();
    cancelDesktopPanSchedule();

    _silentHide = false;
    _activeFeatureId = null;
    _activeFeature = null;
    _activePoiData = null;
    if (!silent && _opts && _opts.onClose) _opts.onClose();
    _opts = null;
  }

  function updateInPlace(feature, poiData, map, opts) {
    if (_sheetState === SHEET_STATE_HIDDEN || !_sheetEl()) {
      show(feature, poiData, map, opts);
      return;
    }

    _opts = Object.assign({}, opts || {}, { map: map });
    _activeFeatureId = feature.id;
    _activeFeature = feature;
    _activePoiData = poiData;
    _lastMobileMode = true;
    ensureResponsiveSync();

    var context = getFeatureContext(feature, poiData);
    var coords = context.coords;
    var bodyEl = document.getElementById(SHEET_BODY_ID);

    if (bodyEl) bodyEl.innerHTML = context.html;
    if (isValidMid(context.mapillaryId)) {
      loadMapillaryHero(context.mapillaryId, bodyEl);
    }

    panMobileSheetIntoView(map, coords, 350);
  }

  function isSheetVisible() {
    return _sheetState !== SHEET_STATE_HIDDEN;
  }

  function getActiveFeatureId() {
    if (_sheetState !== SHEET_STATE_HIDDEN) return _activeFeatureId;
    if (getDesktopCardEl() && !getDesktopCardEl().hidden) return _activeFeatureId;
    return null;
  }

  window.NorthavenCard = {
    show: show,
    hide: hide,
    updateInPlace: updateInPlace,
    isSheetVisible: isSheetVisible,
    expand: expandDesktopCard,
    collapse: collapseDesktopCard,
    getActiveFeatureId: getActiveFeatureId
  };
})();
