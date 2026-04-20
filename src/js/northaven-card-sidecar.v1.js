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
  const DESKTOP_CARD_INSET  = 12;
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

  // ── Lightbox ──────────────────────────────────────────────────

  let _lightbox = null;
  let _mapillaryAssetPromise = null;
  let _mapillaryModal = null;
  let _mapillaryViewer = null;
  let _mapillaryOpenToken = 0;
  let _mapillaryStatusTimer = null;
  let _mapillaryFocusReturn = null;

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
            '<a class="nc-mapillary-link" href="#" target="_blank" rel="noopener noreferrer">Open in Mapillary</a>' +
            '<button class="nc-btn nc-mapillary-close" type="button" aria-label="Close street-level viewer" title="Close">' +
              '<svg class="nc-btn-icon" aria-hidden="true"><use href="#closeX"></use></svg>' +
            '</button>' +
          '</div>' +
        '</div>' +
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
    if (!shell || shell.hidden) return;
    shell.classList.add('is-collapsed');
    syncDesktopHostClasses(true, true);
    updateDesktopToggleLabels(shell.querySelector('.nc-desktop-card__toggle'), true);
    if (opts && opts.focusToggle) {
      shell.querySelector('.nc-desktop-card__toggle')?.focus({ preventScroll: true });
    }
  }

  function expandDesktopCard(opts) {
    var shell = getDesktopCardEl();
    if (!shell || shell.hidden) return;
    shell.classList.remove('is-collapsed');
    syncDesktopHostClasses(true, false);
    updateDesktopToggleLabels(shell.querySelector('.nc-desktop-card__toggle'), false);
    if (opts && opts.focusToggle) {
      shell.querySelector('.nc-desktop-card__toggle')?.focus({ preventScroll: true });
    }
  }

  function hideDesktopCard() {
    var shell = getDesktopCardEl();
    if (!shell) return;
    shell.hidden = true;
    shell.classList.remove('is-collapsed');
    shell.querySelector('.nc-desktop-card__body')?.replaceChildren();
    syncDesktopHostClasses(false, false);
    updateDesktopToggleLabels(shell.querySelector('.nc-desktop-card__toggle'), false);
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

    map.easeTo({
      center: coords,
      offset: [offsetX, offsetY],
      duration: 280,
      essential: true,
    });
  }

  function showDesktopCard(html, map, coords, mId) {
    var shell = ensureDesktopCard();
    if (!shell) return;

    var body = shell.querySelector('#' + DESKTOP_CARD_BODY_ID);
    if (!body) return;

    body.innerHTML = html;
    body.scrollTop = 0;
    shell.hidden = false;
    expandDesktopCard();

    if (isValidMid(mId)) {
      loadMapillaryHero(mId, body);
    }

    requestAnimationFrame(function() {
      shell.querySelector('.nc-desktop-card__panel')?.focus?.({ preventScroll: true });
      panDesktopCardIntoView(map, coords);
    });

    if (map && typeof map.once === 'function' && (map.isMoving?.() || map.isEasing?.())) {
      map.once('moveend', function() {
        panDesktopCardIntoView(map, coords);
      });
    }
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
    if (!normalizedMid) {
      heroEl.remove();
      syncPeekStateIfNeeded(scope);
      return;
    }

    const loadToken = ++_mapillaryLoadToken;
    const heroLink = heroEl.querySelector('.nc-hero-link');
    if (heroLink) heroLink.href = MAPILLARY_VIEW + normalizedMid;

    const tok = MAPILLARY_TOKEN.replace(/\|/g, '%7C');
    fetch(`${MAPILLARY_API}${encodeURIComponent(normalizedMid)}?fields=thumb_1024_url&access_token=${tok}`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(data => {
        if (loadToken !== _mapillaryLoadToken || !heroEl.isConnected) return;
        const src = data && data.thumb_1024_url;
        if (!src) {
          heroEl.remove();
          syncPeekStateIfNeeded(scope);
          return;
        }
        const img = heroEl.querySelector('.nc-hero-img');
        if (img) {
          img.src     = src;
          img.onload  = () => heroEl.classList.add('nc-hero--loaded');
          img.onerror = () => {
            heroEl.remove();
            syncPeekStateIfNeeded(scope);
          };
        }
      })
      .catch(() => {
        if (loadToken !== _mapillaryLoadToken || !heroEl.isConnected) return;
        heroEl.remove();
        syncPeekStateIfNeeded(scope);
      });
  }

  // ── Card HTML ─────────────────────────────────────────────────

  function buildHTML(feature, poiData) {
    const p  = feature.properties || {};
    const td = poiData && poiData.defs && poiData.defs.types && poiData.defs.types[p.t]
             ? poiData.defs.types[p.t]
             : null;
    const u  = window.NorthavenUtils;

    const name      = esc(String(p.l   || (td && td.l)  || '').trim());
    const near      = esc(String(p.r   || '').trim());
    const hours     = esc(String(p.hr  || (td && td.hr) || '').trim());  // hr = hours
    const category  = esc(String(p.b   || (td && td.l)  || '').trim());
    const desc      =     String(p.d   || (td && td.d)  || '').trim();
    const linkText  = esc(String(p.e   || (td && td.e)  || '').trim());
    const linkUrl   =     String(p.f   || (td && td.f)  || '').trim();
    const ctaLabel  = esc(String((p.cta_label) || '').trim());
    const ctaUrl    =     String((p.cta_url)   || '').trim();
    const amenities =     String(p.am  || (td && td.am) || '').trim();
    const mId       =     normalizeMid(p.m_id);

    // Legend icon — shown next to the category badge (not as thumbnail)
    const iconRaw   = td && td.i ? String(td.i).trim() : '';
    const iconUrl   = resolveLegendIcon(iconRaw);

    const resolvedLink = u ? u.normalizeAbsUrl(linkUrl) : linkUrl;
    const resolvedCta  = u ? u.normalizeAbsUrl(ctaUrl)  : ctaUrl;

    const coords = feature.geometry && feature.geometry.coordinates;
    const lat = coords && coords[1];
    const lng = coords && coords[0];
    const mapQuery   = lat && lng ? `${lat},${lng}` : '';
    const directionsHref = mapQuery ? esc(GOOGLE_DIR_URL + mapQuery) : '';

    const imgUrl      = resolveImage(p, td, 200);
    const imgHiresUrl = resolveImage(p, td, 1200);

    // ── Mapillary hero ────────────────────────────────────────
    const heroHtml = mId ? `
  <div class="nc-hero">
    <a class="nc-hero-link" href="${esc(MAPILLARY_VIEW + mId)}" target="_blank" rel="noopener noreferrer" aria-label="Open interactive street-level viewer" data-mid="${esc(mId)}">
      <img class="nc-hero-img" alt="Street-level photo">
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

    // ── Category row: legend icon (outside) + badge pill ──────
    const categoryHtml = category ? `
    <div class="nc-category-row">
      ${iconUrl ? `<img class="nc-category-icon" src="${esc(iconUrl)}" alt="" aria-hidden="true" onerror="this.remove()">` : ''}
      <span class="nc-badge">${category}</span>
    </div>` : '';

    // ── Amenity pills ─────────────────────────────────────────
    const pills = amenities
      .split(/[\s,]+/)
      .filter(function(t) { return t && AMENITY_LABELS[t]; })
      .map(function(t)    { return `<span class="nc-tag">${esc(AMENITY_LABELS[t])}</span>`; })
      .join('');
    const amenityHtml = pills ? `<div class="nc-amenities">${pills}</div>` : '';

    // ── Footer actions ────────────────────────────────────────
    const ctaExternal = resolvedCta && u?.isExternalDomain ? u.isExternalDomain(resolvedCta) : false;
    const ctaTarget = ctaExternal ? ' target="_blank" rel="noopener noreferrer"' : '';

    const footerBtns = [
      resolvedCta && ctaLabel && `<a class="nc-action nc-cta" href="${esc(resolvedCta)}" title="${ctaLabel}" aria-label="${ctaLabel}"${ctaTarget}><span class="nc-action-label">${ctaLabel}</span></a>`,
      directionsHref && `<a class="nc-action" href="${directionsHref}" target="_blank" rel="noopener noreferrer" aria-label="Get directions in Google Maps" title="Get directions in Google Maps">
        <svg class="nc-action-icon" aria-hidden="true"><use href="#google-logo"></use></svg>
        <span class="nc-action-label">Directions</span>
      </a>`,
      `<button class="nc-action nc-action-share" type="button" aria-label="Share this point of interest" title="Share this point of interest">
        <svg class="nc-action-icon" aria-hidden="true"><use href="#share-icon"></use></svg>
        <span class="nc-action-label">Share</span>
      </button>`,
    ].filter(Boolean).join('');

    return `
<div class="nc-card">
  <div class="nc-header">
    ${thumbHtml}
    <div class="nc-header-text">
      <div class="nc-name-row">
        <h2 class="nc-name">${name}</h2>
      </div>
      ${near  ? `<div class="nc-near">Near ${near}</div>`  : ''}
      ${hours ? `<div class="nc-hours">${hours}</div>` : ''}
    </div>
  </div>

  <hr class="nc-divider">

  ${footerBtns ? `<div class="nc-actions">${footerBtns}</div>` : ''}

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
      if (e.target.closest('.nc-close-btn')) { hide();                         return; }
      if (e.target.closest('.nc-action-share') || e.target.closest('.nc-share-btn')) { _opts && _opts.onShare && _opts.onShare(); return; }
    });

    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Escape' || _lightbox) return;
      if (_mapillaryModal && !_mapillaryModal.hidden) return; // let _mapillaryKeydown handle ESC first
      if (_sheetState !== SHEET_STATE_HIDDEN || _popup) {
        e.stopImmediatePropagation();
        hide();
      }
    }, true);

    // ── Drag to expand / collapse ─────────────────────────────
    function onPointerMove(e) {
      if (!_dragData) return;
      if (_dragData.pointerId != null && e.pointerId !== _dragData.pointerId) return;
      e.preventDefault();
      _moveDrag(el, _dragPointY(e));
    }

    function onPointerEnd(e) {
      if (!_dragData) return;
      if (_dragData.pointerId != null && e.pointerId !== _dragData.pointerId) return;
      e.preventDefault();
      _endDrag(el, _dragPointY(e));
    }

    if (handleTrack) {
      handleTrack.addEventListener('pointerdown', function(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        _beginDrag(el, _dragPointY(e), e.pointerId);
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

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerEnd, { passive: false });
    window.addEventListener('pointercancel', onPointerEnd, { passive: false });

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
    _animate(el, el.offsetHeight + 30, '220ms ease');
    _sheetState = SHEET_STATE_HIDDEN;
  }

  // ── State ─────────────────────────────────────────────────────

  var _opts            = null;
  var _popup           = null;
  var _silentHide      = null;
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
        if (_popup) { _popup.remove(); _popup = null; }
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

    var p      = feature.properties || {};
    var mId    = normalizeMid(p.m_id);
    var html   = buildHTML(feature, poiData);
    var coords = feature.geometry && feature.geometry.coordinates;

    _silentHide = true;
    hideSheet();
    hideDesktopCard();
    if (_popup) { _popup.remove(); _popup = null; }
    _silentHide = false;

    if (isMobile()) {
      showSheet(html);
      if (isValidMid(mId)) {
        loadMapillaryHero(mId, document.getElementById(SHEET_BODY_ID));
      }
      // Pan so the tapped marker stays visible above the peeked card.
      // _peekY is set synchronously by showSheet(), so we can read it now.
      if (map && coords) {
        var sheet = _sheetEl();
        var cardVisible = sheet ? (sheet.offsetHeight - _peekY) : 180;
        var point = map.project(coords);
        var viewportHeight = map.getCanvas().clientHeight;
        var safeBottom = viewportHeight - cardVisible - 20;
        var safeTop = 60;
        var targetY = Math.max(safeTop, Math.min(safeBottom, point.y));
        var offsetY = targetY - (viewportHeight / 2);

        map.easeTo({
          center: coords,
          offset: [0, offsetY],
          duration: 400,
          essential: true,
        });
      }
    } else {
      if (!coords) return;
      showDesktopCard(html, map, coords, mId);
    }
  }

  function hide(opts) {
    var silent = opts && opts.silent ? true : false;
    _silentHide = silent;
    closeMapillaryModal();
    hideSheet();
    hideDesktopCard();
    if (_popup) { _popup.remove(); _popup = null; }

    _silentHide = false;
    _activeFeatureId = null;
    _activeFeature = null;
    _activePoiData = null;
    if (!silent && _opts && _opts.onClose) _opts.onClose();
    _opts = null;
  }

  function getActiveFeatureId() {
    if (_sheetState !== SHEET_STATE_HIDDEN) return _activeFeatureId;
    if (getDesktopCardEl() && !getDesktopCardEl().hidden) return _activeFeatureId;
    if (_popup) return _activeFeatureId;
    return null;
  }

  window.NorthavenCard = {
    show: show,
    hide: hide,
    expand: expandDesktopCard,
    collapse: collapseDesktopCard,
    getActiveFeatureId: getActiveFeatureId
  };
})();
