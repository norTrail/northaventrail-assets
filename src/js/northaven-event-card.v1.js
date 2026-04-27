/* ============================================================
   northaven-event-card.v1.js
   Shared event card shell — bottom sheet (mobile) + desktop sidecar
   ============================================================ */
(function () {
  'use strict';

  const MOBILE_BREAKPOINT = 768;
  const SHEET_ID = 'nc-bottom-sheet';
  const SHEET_BODY_ID = 'nc-sheet-body';
  const DESKTOP_CARD_ID = 'nc-desktop-card';
  const DESKTOP_CARD_BODY_ID = 'nc-desktop-card-body';
  const DESKTOP_CARD_WIDTH = 400;
  const DESKTOP_CARD_GAP = 16;
  const FULL_VIEWPORT_RATIO = 0.9;
  const PEEK_HERO_PREVIEW = 56;

  const SHEET_STATE_HIDDEN = 'hidden';
  const SHEET_STATE_INITIAL = 'initial';
  const SHEET_STATE_FULL = 'full';

  const MAPILLARY_TOKEN = 'MLY|26456749190653210|c432ace1542e35cd80e00c3f15daccb8';
  const MAPILLARY_API = 'https://graph.mapillary.com/';
  const MAPILLARY_VIEW = 'https://www.mapillary.com/app/?pKey=';
  const MAPILLARY_JS_URL = 'https://unpkg.com/mapillary-js@4.1.2/dist/mapillary.js';
  const MAPILLARY_CSS_URL = 'https://unpkg.com/mapillary-js@4.1.2/dist/mapillary.css';
  const MAPILLARY_MODAL_ID = 'nc-mapillary-modal';
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
  const INVALID_MIDS = new Set([
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

  let _opts = null;
  let _sheetState = SHEET_STATE_HIDDEN;
  let _peekY = 0;
  let _dragData = null;
  let _suppressHandleClickUntil = 0;
  let _dragMoveListenerActive = false;
  let _lightbox = null;
  let _mapillaryAssetPromise = null;
  let _mapillaryHeroCache = new Map();
  let _mapillaryModal = null;
  let _mapillaryViewer = null;
  let _mapillaryOpenToken = 0;
  let _mapillaryStatusTimer = null;
  let _mapillaryFocusReturn = null;
  let _mapillaryHeroAbortController = null;
  let _mapillaryLoadToken = 0;
  let _desktopPanToken = 0;
  let _desktopPanFrameA = null;
  let _desktopPanFrameB = null;
  let _desktopPanTimeout = null;
  let _desktopPanMoveEndTimeout = null;
  let _resizeTick = null;
  let _lastMobileMode = isMobile();
  let _responsiveSyncBound = false;
  let _sheetBodyTouchStartY = null;

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

  function _sheetEl() {
    return document.getElementById(SHEET_ID);
  }

  function easeMapSilently(map, options) {
    if (!map || !options) return;

    if (typeof suppressMapEvents !== 'undefined') {
      suppressMapEvents = true;
    }

    map.easeTo(options);

    if (typeof map.once === 'function') {
      map.once('moveend', function () {
        if (typeof suppressMapEvents !== 'undefined') {
          suppressMapEvents = false;
        }
      });
    }

    window.setTimeout(function () {
      if (typeof suppressMapEvents !== 'undefined') {
        suppressMapEvents = false;
      }
    }, (Number(options.duration) || 0) + 120);
  }

  function panMobileSheetIntoView(map, coords, duration) {
    if (!map || !coords) return;

    const sheet = _sheetEl();
    const cardVisible = sheet ? (sheet.offsetHeight - _peekY) : 180;
    const point = map.project(coords);
    const viewportHeight = map.getCanvas().clientHeight;
    const safeBottom = viewportHeight - cardVisible - 20;
    const targetY = Math.max(60, Math.min(safeBottom, point.y));
    const offsetY = targetY - (viewportHeight / 2);

    easeMapSilently(map, {
      center: coords,
      offset: [0, offsetY],
      duration: duration,
      essential: true,
    });
  }

  function _lbKeydown(e) {
    if (e.key !== 'Escape' || !_lightbox) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closeLightbox();
  }

  function openLightbox(src) {
    if (!src) return;
    if (_lightbox) {
      _lightbox.remove();
      _lightbox = null;
    }

    const el = document.createElement('div');
    el.className = 'nc-lightbox';
    el.innerHTML =
      '<img class="nc-lightbox-img" src="' + esc(src) + '" alt="">' +
      '<button class="nc-lightbox-close" aria-label="Close">&#x2715;</button>';
    el.addEventListener('click', function (e) {
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
    const existing = document.querySelector('link[data-nc-ext-style="' + href + '"]');
    if (existing) return Promise.resolve();

    return new Promise(function (resolve, reject) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute('data-nc-ext-style', href);
      link.onload = function () { resolve(); };
      link.onerror = function () { reject(new Error('Failed to load stylesheet')); };
      document.head.appendChild(link);
    });
  }

  function ensureScriptOnce(src) {
    if (!src) return Promise.resolve();
    const existing = document.querySelector('script[data-nc-ext-script="' + src + '"]');
    if (existing) {
      if (existing.getAttribute('data-loaded') === 'true') return Promise.resolve();
      return new Promise(function (resolve, reject) {
        existing.addEventListener('load', function () { resolve(); }, { once: true });
        existing.addEventListener('error', function () { reject(new Error('Failed to load script')); }, { once: true });
      });
    }

    return new Promise(function (resolve, reject) {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.setAttribute('data-nc-ext-script', src);
      script.onload = function () {
        script.setAttribute('data-loaded', 'true');
        resolve();
      };
      script.onerror = function () { reject(new Error('Failed to load script')); };
      document.head.appendChild(script);
    });
  }

  function ensureMapillaryAssets() {
    if (window.mapillary && window.mapillary.Viewer) return Promise.resolve(window.mapillary);
    if (_mapillaryAssetPromise) return _mapillaryAssetPromise;

    _mapillaryAssetPromise = Promise.all([
      ensureStylesheetOnce(MAPILLARY_CSS_URL),
      ensureScriptOnce(MAPILLARY_JS_URL),
    ]).then(function () {
      if (!window.mapillary || !window.mapillary.Viewer) {
        throw new Error('Mapillary viewer unavailable');
      }
      return window.mapillary;
    }).catch(function (err) {
      _mapillaryAssetPromise = null;
      throw err;
    });

    return _mapillaryAssetPromise;
  }

  function _mapillaryKeydown(e) {
    if (e.key !== 'Escape' || !_mapillaryModal || _mapillaryModal.hidden) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closeMapillaryModal();
  }

  function removeMapillaryViewer() {
    if (_mapillaryViewer && typeof _mapillaryViewer.remove === 'function') {
      try { _mapillaryViewer.remove(); } catch (_err) { }
    }
    _mapillaryViewer = null;
  }

  function ensureMapillaryModal() {
    if (_mapillaryModal) return _mapillaryModal;

    const modal = document.createElement('div');
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

    function handleClose(e) {
      e.preventDefault();
      e.stopPropagation();
      closeMapillaryModal();
    }

    modal.querySelector('.nc-mapillary-close')?.addEventListener('click', handleClose);
    modal.querySelector('.nc-mapillary-close')?.addEventListener('touchend', handleClose);
    modal.querySelector('.nc-mapillary-backdrop')?.addEventListener('click', handleClose);
    modal.querySelector('.nc-mapillary-backdrop')?.addEventListener('touchend', handleClose);

    document.body.appendChild(modal);
    _mapillaryModal = modal;
    return modal;
  }

  function setMapillaryStatus(text, isError) {
    const modal = ensureMapillaryModal();
    const statusEl = modal.querySelector('.nc-mapillary-status');
    const viewerEl = modal.querySelector('.nc-mapillary-viewer');

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

  function hideMapillarySpinner() {
    if (!_mapillaryModal) return;
    _mapillaryModal.querySelector('.nc-mapillary-loading')?.remove();
  }

  function closeMapillaryModal() {
    if (!_mapillaryModal || _mapillaryModal.hidden) return;
    _mapillaryOpenToken += 1;
    if (_mapillaryStatusTimer) {
      window.clearTimeout(_mapillaryStatusTimer);
      _mapillaryStatusTimer = null;
    }
    removeMapillaryViewer();
    const viewerEl = _mapillaryModal.querySelector('.nc-mapillary-viewer');
    if (viewerEl) viewerEl.innerHTML = '';
    _mapillaryModal.hidden = true;
    document.body.classList.remove('nc-mapillary-open');
    document.removeEventListener('keydown', _mapillaryKeydown, true);
    if (_mapillaryFocusReturn) {
      try { _mapillaryFocusReturn.focus({ preventScroll: true }); } catch (_err) { }
      _mapillaryFocusReturn = null;
    }
  }

  function openMapillaryModal(mid) {
    const normalizedMid = normalizeMid(mid);
    if (!normalizedMid) return;

    const modal = ensureMapillaryModal();
    const viewerEl = modal.querySelector('.nc-mapillary-viewer');
    const openLink = modal.querySelector('.nc-mapillary-link');
    const token = ++_mapillaryOpenToken;

    removeMapillaryViewer();
    if (viewerEl) viewerEl.innerHTML = MAPILLARY_SPINNER_HTML;
    if (openLink) {
      openLink.href = MAPILLARY_VIEW + normalizedMid;
      openLink.hidden = false;
    }

    _mapillaryFocusReturn = document.activeElement || null;
    modal.hidden = false;
    document.body.classList.add('nc-mapillary-open');
    document.addEventListener('keydown', _mapillaryKeydown, true);
    setMapillaryStatus('', false);
    modal.querySelector('.nc-mapillary-close')?.focus({ preventScroll: true });

    ensureMapillaryAssets()
      .then(function (mapillaryLib) {
        if (token !== _mapillaryOpenToken || !_mapillaryModal || _mapillaryModal.hidden || !viewerEl) return;
        let ready = false;
        const supported = typeof mapillaryLib.isSupported === 'function' ? mapillaryLib.isSupported() : null;
        const fallbackSupported = typeof mapillaryLib.isFallbackSupported === 'function' ? mapillaryLib.isFallbackSupported() : null;

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
          modal.querySelector('.nc-mapillary-link')?.setAttribute('hidden', 'hidden');
        }

        _mapillaryStatusTimer = window.setTimeout(function () {
          if (token !== _mapillaryOpenToken || ready) return;
          hideMapillarySpinner();
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

          _mapillaryViewer.on('load', markReady);
          _mapillaryViewer.on('image', markReady);
        } catch (_err) {
          if (_mapillaryStatusTimer) {
            window.clearTimeout(_mapillaryStatusTimer);
            _mapillaryStatusTimer = null;
          }
          hideMapillarySpinner();
          removeMapillaryViewer();
          setMapillaryStatus('Unable to open the street-level viewer here. ' + describeMapillaryError(_err) + '. Use the link above to open Mapillary directly.', true);
        }
      })
      .catch(function (err) {
        if (token !== _mapillaryOpenToken) return;
        hideMapillarySpinner();
        removeMapillaryViewer();
        setMapillaryStatus('Unable to load the street-level viewer right now. ' + describeMapillaryError(err) + '. Use the link above to open Mapillary directly.', true);
      });
  }

  function syncPeekStateIfNeeded(scope) {
    const sheet = _sheetEl();
    if (!sheet || _sheetState !== SHEET_STATE_INITIAL || !scope || !sheet.contains(scope)) return;
    _peekY = _computePeekY(sheet);
    sheet.style.transition = 'transform 180ms ease';
    sheet.style.transform = 'translateY(' + _peekY + 'px)';
  }

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

    function applyHeroSrc(src) {
      if (!src) {
        heroEl.remove();
        syncPeekStateIfNeeded(scope);
        return;
      }
      const img = heroEl.querySelector('.nc-hero-img');
      if (!img) return;
      img.src = src;
      img.onload = function () {
        if (loadToken !== _mapillaryLoadToken || !heroEl.isConnected) return;
        heroEl.classList.add('nc-hero--loaded');
      };
      img.onerror = function () {
        heroEl.remove();
        syncPeekStateIfNeeded(scope);
      };
    }

    if (_mapillaryHeroCache.has(normalizedMid)) {
      applyHeroSrc(_mapillaryHeroCache.get(normalizedMid));
      return;
    }

    const tok = MAPILLARY_TOKEN.replace(/\|/g, '%7C');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    _mapillaryHeroAbortController = controller;

    fetch(
      MAPILLARY_API + encodeURIComponent(normalizedMid) + '?fields=thumb_1024_url&access_token=' + tok,
      controller ? { signal: controller.signal } : undefined
    )
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then(function (data) {
        if (controller && controller.signal.aborted) return;
        if (loadToken !== _mapillaryLoadToken || !heroEl.isConnected) return;
        if (_mapillaryHeroAbortController === controller) _mapillaryHeroAbortController = null;
        const src = data && data.thumb_1024_url;
        _mapillaryHeroCache.set(normalizedMid, src || null);
        applyHeroSrc(src);
      })
      .catch(function (err) {
        if (controller && controller.signal.aborted) return;
        if (err && err.name === 'AbortError') return;
        if (loadToken !== _mapillaryLoadToken || !heroEl.isConnected) return;
        if (_mapillaryHeroAbortController === controller) _mapillaryHeroAbortController = null;
        heroEl.remove();
        syncPeekStateIfNeeded(scope);
      });
  }

  function _computePeekY(el) {
    const divider = el.querySelector('.nc-divider');
    const sr = el.getBoundingClientRect();
    const hero = el.querySelector('.nc-hero');

    if (hero) {
      const hr = hero.getBoundingClientRect();
      const heroVisible = Math.min(hero.offsetHeight, PEEK_HERO_PREVIEW);
      const heroBottom = hr.top - sr.top + heroVisible;
      return Math.max(el.offsetHeight - heroBottom, 60);
    }

    if (!divider) return Math.max(el.offsetHeight - 180, 60);
    const dr = divider.getBoundingClientRect();
    const distFromTop = dr.top - sr.top;
    const visible = distFromTop + divider.offsetHeight + 4;
    return Math.max(el.offsetHeight - visible, 60);
  }

  function _stateY(state, h) {
    if (state === SHEET_STATE_FULL) {
      return Math.max(0, h - Math.min(h, window.innerHeight * FULL_VIEWPORT_RATIO));
    }
    if (state === SHEET_STATE_INITIAL) return _peekY;
    return h + 30;
  }

  function _animate(el, y, easing) {
    el.style.transition = 'transform ' + (easing || '220ms ease');
    el.style.transform = 'translateY(' + y + 'px)';
  }

  function _setSheetState(el, target, easing) {
    if (!el || !target || _sheetState === SHEET_STATE_HIDDEN && target === SHEET_STATE_HIDDEN) return;
    _animate(el, _stateY(target, el.offsetHeight), easing || '300ms cubic-bezier(0.32, 0.72, 0, 1)');
    _sheetState = target;
  }

  function _sheetBodyEl() {
    return document.getElementById(SHEET_BODY_ID);
  }

  function _sheetHasHiddenScrollableContent() {
    const sheet = _sheetEl();
    const body = _sheetBodyEl();
    if (!sheet || !body || _sheetState !== SHEET_STATE_INITIAL) return false;

    const visibleHeight = Math.max(0, sheet.offsetHeight - _peekY - body.offsetTop);
    if (visibleHeight <= 0) return false;
    return body.scrollHeight > visibleHeight + 12;
  }

  function _promoteSheetForContentScroll() {
    const sheet = _sheetEl();
    if (!sheet || !_sheetHasHiddenScrollableContent()) return false;
    _setSheetState(sheet, SHEET_STATE_FULL);
    return true;
  }

  function _sheetCanCollapseFromBodyScroll() {
    const body = _sheetBodyEl();
    return _sheetState === SHEET_STATE_FULL && body && body.scrollTop <= 0;
  }

  function _collapseSheetFromContentScroll() {
    const sheet = _sheetEl();
    if (!sheet || !_sheetCanCollapseFromBodyScroll()) return false;
    _setSheetState(sheet, SHEET_STATE_INITIAL);
    return true;
  }

  function _dragPointY(e) {
    if (typeof e.clientY === 'number') return e.clientY;
    if (e.touches && e.touches[0]) return e.touches[0].clientY;
    if (e.changedTouches && e.changedTouches[0]) return e.changedTouches[0].clientY;
    return null;
  }

  function _beginDrag(el, clientY, pointerId) {
    if (_sheetState === SHEET_STATE_HIDDEN || typeof clientY !== 'number') return;
    const h = el.offsetHeight;
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
    const dy = clientY - _dragData.startY;
    const newY = Math.max(0, Math.min(_dragData.startPx + dy, _dragData.h + 30));
    el.style.transform = 'translateY(' + newY + 'px)';
  }

  function _endDrag(el, clientY) {
    if (!_dragData || typeof clientY !== 'number') return;
    const dy = clientY - _dragData.startY;
    const vel = dy / Math.max(1, Date.now() - _dragData.startTime);
    const h = _dragData.h;
    const moved = Math.abs(dy);
    _dragData = null;

    let target;
    if (dy < -10 || vel < -0.15) {
      target = SHEET_STATE_FULL;
    } else if (dy > 10 || vel > 0.15) {
      target = (_sheetState === SHEET_STATE_INITIAL && dy > 40) ? SHEET_STATE_HIDDEN : SHEET_STATE_INITIAL;
    } else {
      target = _sheetState;
    }

    _setSheetState(el, target, '300ms cubic-bezier(0.32, 0.72, 0, 1)');

    if (target === SHEET_STATE_HIDDEN) {
      hide();
      return;
    }

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
    const el = _sheetEl();
    if (!_dragData || !el) {
      _removeDragListeners();
      return;
    }
    if (_dragData.pointerId != null && e.pointerId !== _dragData.pointerId) return;
    e.preventDefault();
    _moveDrag(el, _dragPointY(e));
  }

  function _onSheetPointerEnd(e) {
    const el = _sheetEl();
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
    let el = _sheetEl();
    if (el) return el;

    el = document.createElement('div');
    el.id = SHEET_ID;
    el.className = 'nc-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Map details');
    el.setAttribute('tabindex', '-1');
    el.innerHTML =
      '<div class="nc-sheet-handle-row">' +
        '<div class="nc-handle-track" role="button" tabindex="0" aria-label="Expand or collapse details">' +
          '<div class="nc-sheet-handle"></div>' +
        '</div>' +
        '<div class="nc-sheet-btns">' +
          '<button class="nc-btn nc-share-btn" type="button" aria-label="Share" title="Share">' +
            '<svg class="nc-btn-icon" aria-hidden="true"><use href="#share-icon"></use></svg>' +
          '</button>' +
          '<button class="nc-btn nc-close-btn" type="button" aria-label="Close" title="Close">' +
            '<svg class="nc-btn-icon" aria-hidden="true"><use href="#closeX"></use></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div id="' + SHEET_BODY_ID + '" class="nc-sheet-body"></div>';

    document.body.appendChild(el);

    const handleTrack = el.querySelector('.nc-handle-track');
    const sheetBody = el.querySelector('.nc-sheet-body');

    el.style.transition = 'none';
    el.style.transform = 'translateY(' + (window.innerHeight + 30) + 'px)';

    el.addEventListener('click', function (e) {
      const tw = e.target.closest('.nc-thumb-wrap[data-hires]');
      if (tw) { openLightbox(tw.dataset.hires); return; }
      const heroLink = e.target.closest('.nc-hero-link[data-mid]');
      if (heroLink) {
        e.preventDefault();
        openMapillaryModal(heroLink.getAttribute('data-mid'));
        return;
      }
      if (e.target.closest('.nc-close-btn')) { hide(); return; }
      if (e.target.closest('.nc-action-share') || e.target.closest('.nc-share-btn')) {
        _opts?.onShare?.();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || _lightbox) return;
      if (_mapillaryModal && !_mapillaryModal.hidden) return;
      if (_sheetState !== SHEET_STATE_HIDDEN) {
        e.stopImmediatePropagation();
        hide();
      }
    }, true);

    if (handleTrack) {
      handleTrack.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        _beginDrag(el, _dragPointY(e), e.pointerId);
        _addDragListeners();
      });

      function toggleExpand() {
        if (_dragData || _sheetState === SHEET_STATE_HIDDEN) return;
        if (Date.now() < _suppressHandleClickUntil) return;
        const target = _sheetState === SHEET_STATE_INITIAL ? SHEET_STATE_FULL : SHEET_STATE_INITIAL;
        _setSheetState(el, target, '300ms cubic-bezier(0.32, 0.72, 0, 1)');
      }

      handleTrack.addEventListener('click', toggleExpand);
      handleTrack.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleExpand();
        }
      });
    }

    if (sheetBody) {
      sheetBody.addEventListener('wheel', function (e) {
        if (e.deltaY > 6) {
          _promoteSheetForContentScroll();
          return;
        }
        if (e.deltaY < -6) _collapseSheetFromContentScroll();
      }, { passive: true });

      sheetBody.addEventListener('touchstart', function (e) {
        _sheetBodyTouchStartY = _dragPointY(e);
      }, { passive: true });

      sheetBody.addEventListener('touchmove', function (e) {
        const nextY = _dragPointY(e);
        if (typeof _sheetBodyTouchStartY !== 'number' || typeof nextY !== 'number') return;
        if (_sheetBodyTouchStartY - nextY > 12) {
          _promoteSheetForContentScroll();
          return;
        }
        if (nextY - _sheetBodyTouchStartY > 12) _collapseSheetFromContentScroll();
      }, { passive: true });

      sheetBody.addEventListener('touchend', function () {
        _sheetBodyTouchStartY = null;
      }, { passive: true });

      sheetBody.addEventListener('touchcancel', function () {
        _sheetBodyTouchStartY = null;
      }, { passive: true });
    }

    return el;
  }

  function showSheet(html) {
    const sheet = ensureSheet();
    document.getElementById(SHEET_BODY_ID).innerHTML = html;

    sheet.style.transition = 'none';
    sheet.style.transform = 'translateY(0px)';
    sheet.offsetHeight;

    _peekY = _computePeekY(sheet);
    sheet.style.transform = 'translateY(' + (window.innerHeight + 30) + 'px)';
    sheet.offsetHeight;
    _sheetState = SHEET_STATE_HIDDEN;

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        _animate(sheet, _peekY, '350ms cubic-bezier(0.32, 0.72, 0, 1)');
        _sheetState = SHEET_STATE_INITIAL;
        sheet.focus({ preventScroll: true });
      });
    });
  }

  function hideSheet() {
    const el = _sheetEl();
    if (!el || _sheetState === SHEET_STATE_HIDDEN) return;
    _dragData = null;
    _removeDragListeners();
    _animate(el, el.offsetHeight + 30, '220ms ease');
    _sheetState = SHEET_STATE_HIDDEN;
  }

  function syncDesktopHostClasses(isOpen, isCollapsed) {
    [getMapViewEl(), getMapEl()].forEach(function (el) {
      if (!el) return;
      el.classList.toggle('nc-sidecar-open', Boolean(isOpen));
      el.classList.toggle('nc-sidecar-collapsed', Boolean(isOpen && isCollapsed));
      el.style.setProperty('--nc-sidecar-width', DESKTOP_CARD_WIDTH + 'px');
    });
  }

  function updateDesktopToggleLabels(btn, isCollapsed) {
    if (!btn) return;
    const label = isCollapsed ? 'Expand details panel' : 'Collapse details panel';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
    btn.setAttribute('aria-expanded', String(!isCollapsed));
  }

  function setDesktopCardCollapsed(shell, isCollapsed, opts) {
    if (!shell) return;
    const toggle = shell.querySelector('.nc-desktop-card__toggle');
    shell.classList.toggle('is-collapsed', Boolean(isCollapsed));
    syncDesktopHostClasses(true, Boolean(isCollapsed));
    updateDesktopToggleLabels(toggle, Boolean(isCollapsed));
    if (opts && opts.focusToggle && !shell.hidden) toggle?.focus({ preventScroll: true });
  }

  function ensureDesktopCard() {
    let shell = getDesktopCardEl();
    if (shell) return shell;

    const host = getMapViewEl();
    if (!host) return null;

    shell = document.createElement('aside');
    shell.id = DESKTOP_CARD_ID;
    shell.className = 'nc-desktop-card';
    shell.hidden = true;
    shell.setAttribute('aria-label', 'Map details');
    shell.innerHTML =
      '<div class="nc-desktop-card__panel" tabindex="-1">' +
        '<div id="' + DESKTOP_CARD_BODY_ID + '" class="nc-desktop-card__body"></div>' +
      '</div>' +
      '<button class="nc-desktop-card__toggle" type="button">' +
        '<span class="nc-desktop-card__chevron" aria-hidden="true">&#10094;</span>' +
      '</button>';

    const toggle = shell.querySelector('.nc-desktop-card__toggle');
    updateDesktopToggleLabels(toggle, false);

    shell.addEventListener('click', function (e) {
      const tw = e.target.closest('.nc-thumb-wrap[data-hires]');
      if (tw) { openLightbox(tw.dataset.hires); return; }
      const heroLink = e.target.closest('.nc-hero-link[data-mid]');
      if (heroLink) {
        e.preventDefault();
        openMapillaryModal(heroLink.getAttribute('data-mid'));
        return;
      }
      if (e.target.closest('.nc-action-share') || e.target.closest('.nc-share-btn')) {
        _opts?.onShare?.();
      }
    });

    toggle.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (shell.classList.contains('is-collapsed')) {
        setDesktopCardCollapsed(shell, false, { focusToggle: true });
      } else {
        setDesktopCardCollapsed(shell, true, { focusToggle: true });
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || isMobile()) return;
      if (_mapillaryModal && !_mapillaryModal.hidden) return;
      if (_lightbox) return;
      if (!_opts) return;
      e.preventDefault();
        hide();
    }, true);

    function trapDesktopWheel(e) {
      const body = shell.querySelector('.nc-desktop-card__body');
      if (!body || shell.hidden || !shell.contains(e.target)) return;

      const deltaY = Number(e.deltaY) || 0;
      if (!deltaY) {
        e.preventDefault();
        return;
      }

      const maxScroll = body.scrollHeight - body.clientHeight;
      if (maxScroll <= 0) {
        e.preventDefault();
        return;
      }

      body.scrollTop = Math.max(0, Math.min(maxScroll, body.scrollTop + deltaY));
      e.stopPropagation();
      e.preventDefault();
    }

    shell.addEventListener('wheel', trapDesktopWheel, { passive: false });
    shell.querySelector('.nc-desktop-card__panel')?.addEventListener('wheel', trapDesktopWheel, { passive: false });
    shell.querySelector('.nc-desktop-card__body')?.addEventListener('wheel', trapDesktopWheel, { passive: false });

    host.appendChild(shell);
    return shell;
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

  function panDesktopCardIntoView(map, coords) {
    const shell = getDesktopCardEl();
    if (!map || !coords || !shell || shell.hidden || shell.classList.contains('is-collapsed')) return;

    const point = map.project(coords);
    const canvas = map.getCanvas();
    if (!canvas) return;

    const visibleLeft = Math.min(canvas.clientWidth - 96, DESKTOP_CARD_WIDTH + DESKTOP_CARD_GAP + 16);
    const visibleWidth = Math.max(96, canvas.clientWidth - visibleLeft - 24);
    const targetX = visibleLeft + (visibleWidth / 2);
    if (Math.abs(point.x - targetX) < 20) return;

    const offsetX = targetX - (canvas.clientWidth / 2);
    const clampedY = Math.max(72, Math.min(canvas.clientHeight - 72, point.y));
    const offsetY = clampedY - (canvas.clientHeight / 2);

    easeMapSilently(map, {
      center: coords,
      offset: [offsetX, offsetY],
      duration: 280,
      essential: true,
    });
  }

  function scheduleDesktopPan(map, coords) {
    if (!map || !coords) return;
    const token = ++_desktopPanToken;

    cancelDesktopPanSchedule();
    _desktopPanToken = token;

    _desktopPanFrameA = requestAnimationFrame(function () {
      _desktopPanFrameA = null;
      _desktopPanFrameB = requestAnimationFrame(function () {
        _desktopPanFrameB = null;
        if (token !== _desktopPanToken) return;
        panDesktopCardIntoView(map, coords);
      });
    });

    _desktopPanTimeout = window.setTimeout(function () {
      _desktopPanTimeout = null;
      if (token !== _desktopPanToken) return;
      panDesktopCardIntoView(map, coords);
    }, 240);

    if (typeof map.once === 'function') {
      map.once('moveend', function () {
        if (token !== _desktopPanToken) return;
        _desktopPanMoveEndTimeout = window.setTimeout(function () {
          _desktopPanMoveEndTimeout = null;
          if (token !== _desktopPanToken) return;
          panDesktopCardIntoView(map, coords);
        }, 40);
      });
    }
  }

  function showDesktopCard(html, map, coords, mapillaryId) {
    const shell = ensureDesktopCard();
    if (!shell) return;
    cancelDesktopPanSchedule();

    const body = shell.querySelector('#' + DESKTOP_CARD_BODY_ID);
    if (!body) return;

    body.innerHTML = html;
    body.scrollTop = 0;
    shell.hidden = false;
    setDesktopCardCollapsed(shell, false);

    if (isValidMid(mapillaryId)) {
      loadMapillaryHero(mapillaryId, body);
    }

    requestAnimationFrame(function () {
      shell.querySelector('.nc-desktop-card__panel')?.focus?.({ preventScroll: true });
      scheduleDesktopPan(map, coords);
    });
  }

  function hideDesktopCard() {
    const shell = getDesktopCardEl();
    cancelDesktopPanSchedule();
    if (!shell) return;
    setDesktopCardCollapsed(shell, false);
    shell.hidden = true;
    shell.querySelector('.nc-desktop-card__body')?.replaceChildren();
    syncDesktopHostClasses(false, false);
  }

  function ensureResponsiveSync() {
    if (_responsiveSyncBound) return;
    _responsiveSyncBound = true;

    window.addEventListener('resize', function () {
      if (_resizeTick) window.clearTimeout(_resizeTick);
      _resizeTick = window.setTimeout(function () {
        _resizeTick = null;
        const nextMobile = isMobile();
        if (nextMobile === _lastMobileMode) return;
        _lastMobileMode = nextMobile;

        if (!_opts || !_opts.map) return;
        const cfg = Object.assign({}, _opts);
        hide({ silent: true });
        show(cfg);
      }, 140);
    });
  }

  function hydrateVisibleShell(cfg) {
    if (!_opts || !_opts.map) return;
    if (isMobile()) {
      const bodyEl = document.getElementById(SHEET_BODY_ID);
      if (bodyEl) {
        bodyEl.innerHTML = cfg.html;
        if (isValidMid(cfg.mapillaryId)) loadMapillaryHero(cfg.mapillaryId, bodyEl);
      }
      panMobileSheetIntoView(cfg.map, cfg.coords, 350);
      return;
    }

    const shell = ensureDesktopCard();
    const body = shell?.querySelector('#' + DESKTOP_CARD_BODY_ID);
    if (!body) return;
    body.innerHTML = cfg.html;
    body.scrollTop = 0;
    shell.hidden = false;
    if (isValidMid(cfg.mapillaryId)) loadMapillaryHero(cfg.mapillaryId, body);
    requestAnimationFrame(function () {
      shell.querySelector('.nc-desktop-card__panel')?.focus?.({ preventScroll: true });
      scheduleDesktopPan(cfg.map, cfg.coords);
    });
  }

  function show(cfg) {
    if (!cfg || !cfg.map) return;
    _opts = Object.assign({}, cfg);
    _lastMobileMode = isMobile();
    ensureResponsiveSync();

    hide({ silent: true });
    _opts = Object.assign({}, cfg);

    if (isMobile()) {
      showSheet(cfg.html || '');
      if (isValidMid(cfg.mapillaryId)) {
        loadMapillaryHero(cfg.mapillaryId, document.getElementById(SHEET_BODY_ID));
      }
      panMobileSheetIntoView(cfg.map, cfg.coords, 400);
      return;
    }

    showDesktopCard(cfg.html || '', cfg.map, cfg.coords, cfg.mapillaryId);
  }

  function updateInPlace(cfg) {
    if (!_opts || !cfg || !cfg.map) {
      show(cfg);
      return;
    }

    _opts = Object.assign({}, cfg);
    _lastMobileMode = isMobile();
    ensureResponsiveSync();

    if (_sheetState === SHEET_STATE_HIDDEN && (!getDesktopCardEl() || getDesktopCardEl().hidden)) {
      show(cfg);
      return;
    }

    hydrateVisibleShell(cfg);
  }

  function hide(options) {
    const silent = options && options.silent ? true : false;
    const onClose = _opts && _opts.onClose;

    closeMapillaryModal();
    if (_mapillaryHeroAbortController) {
      _mapillaryHeroAbortController.abort();
      _mapillaryHeroAbortController = null;
    }
    hideSheet();
    hideDesktopCard();
    _opts = null;

    if (!silent && typeof onClose === 'function') {
      onClose();
    }
  }

  function isVisible() {
    if (_sheetState !== SHEET_STATE_HIDDEN) return true;
    const desktop = getDesktopCardEl();
    return Boolean(desktop && !desktop.hidden);
  }

  window.NorthavenEventCard = {
    show: show,
    updateInPlace: updateInPlace,
    hide: hide,
    isVisible: isVisible,
    normalizeMid: normalizeMid,
  };
})();
