/* ============================================================
   northaven-card.v1.js
   Shared map POI card — bottom sheet on mobile, Mapbox popup on desktop
   ============================================================ */
(function () {
  'use strict';

  const MOBILE_BREAKPOINT = 768;
  const SHEET_ID          = 'nc-bottom-sheet';
  const SHEET_BODY_ID     = 'nc-sheet-body';
  const GOOGLE_MAP_URL    = 'https://www.google.com/maps/search/?api=1&query=';
  const APPLE_MAP_URL     = 'https://maps.apple.com/?q=';
  const PEEK_HEIGHT       = 36; // px of sheet visible in peek (handle bar only)

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

  // ── Lightbox ──────────────────────────────────────────────────

  let _lightbox = null;

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
    document.addEventListener('keydown', _lbKeydown);
    document.body.appendChild(el);
    _lightbox = el;
  }

  function closeLightbox() {
    if (!_lightbox) return;
    _lightbox.remove();
    _lightbox = null;
    document.removeEventListener('keydown', _lbKeydown);
  }

  function _lbKeydown(e) {
    if (e.key === 'Escape') closeLightbox();
  }

  // ── Card HTML ─────────────────────────────────────────────────

  function buildHTML(feature, poiData) {
    const p  = feature.properties || {};
    const td = poiData?.defs?.types?.[p.t] || null;
    const u  = window.NorthavenUtils;

    const name     = esc(String(p.l  || td?.l  || '').trim());
    const near     = esc(String(p.r  || '').trim());
    const hours    = esc(String(p.h  || td?.h  || '').trim());
    const category = esc(String(p.b  || td?.l  || '').trim());
    const desc     =     String(p.d  || td?.d  || '').trim();
    const linkText = esc(String(p.e  || td?.e  || '').trim());
    const linkUrl  =     String(p.f  || td?.f  || '').trim();
    const ctaLabel = esc(String(p.cta_label || '').trim());
    const ctaUrl   =     String(p.cta_url   || '').trim();
    const amenities =    String(p.am || td?.am || '').trim();

    const resolvedLink = u ? u.normalizeAbsUrl(linkUrl) : linkUrl;
    const resolvedCta  = u ? u.normalizeAbsUrl(ctaUrl)  : ctaUrl;

    const coords = feature.geometry?.coordinates;
    const lat = coords?.[1];
    const lng = coords?.[0];
    const mapQuery   = lat && lng ? `${lat},${lng}` : '';
    const googleHref = mapQuery ? esc(GOOGLE_MAP_URL + mapQuery) : '';
    const appleHref  = mapQuery ? esc(APPLE_MAP_URL  + mapQuery) : '';

    const imgUrl      = resolveImage(p, td, 200);
    const imgHiresUrl = resolveImage(p, td, 1200);

    // Thumbnail — data-hires triggers lightbox on click
    const thumbHtml = imgUrl ? `
      <div class="nc-thumb-wrap"${imgHiresUrl ? ` data-hires="${esc(imgHiresUrl)}"` : ''}>
        <img class="nc-thumb" src="${esc(imgUrl)}" alt="" aria-hidden="true"
             width="72" height="72" loading="lazy"
             onerror="this.closest('.nc-thumb-wrap').remove()">
      </div>` : '';

    // Amenity pills
    const pills = amenities
      .split(/[\s,]+/)
      .filter(t => t && AMENITY_LABELS[t])
      .map(t => `<span class="nc-tag">${esc(AMENITY_LABELS[t])}</span>`)
      .join('');
    const amenityHtml = pills ? `<div class="nc-amenities">${pills}</div>` : '';

    // Footer action buttons
    const footerBtns = [
      googleHref && `<a class="nc-action" href="${googleHref}" target="_blank" rel="noopener noreferrer" aria-label="Open in Google Maps">
        <svg class="nc-action-icon" aria-hidden="true"><use href="#google-logo"></use></svg>
        <span>Google</span>
      </a>`,
      appleHref && `<a class="nc-action" href="${appleHref}" target="_blank" rel="noopener noreferrer" aria-label="Open in Apple Maps">
        <svg class="nc-action-icon" aria-hidden="true"><use href="#apple-logo"></use></svg>
        <span>Apple</span>
      </a>`,
      resolvedCta && ctaLabel && `<a class="nc-action nc-cta" href="${esc(resolvedCta)}">${ctaLabel}</a>`,
    ].filter(Boolean).join('');

    return `
<div class="nc-card">

  <div class="nc-header">
    ${thumbHtml}
    <div class="nc-header-text">
      <div class="nc-name-row">
        <h2 class="nc-name">${name}</h2>
        <div class="nc-header-btns">
          <button class="nc-btn nc-share-btn" type="button" aria-label="Share">
            <svg class="nc-btn-icon" aria-hidden="true"><use href="#share-icon"></use></svg>
          </button>
          <button class="nc-btn nc-close-btn" type="button" aria-label="Close">
            <svg class="nc-btn-icon" aria-hidden="true"><use href="#closeX"></use></svg>
          </button>
        </div>
      </div>
      ${near  ? `<div class="nc-near">Near ${near}</div>`  : ''}
      ${hours ? `<div class="nc-hours">${hours}</div>` : ''}
    </div>
  </div>

  <hr class="nc-divider">

  <div class="nc-body">
    ${category    ? `<span class="nc-badge">${category}</span>`           : ''}
    ${amenityHtml}
    ${desc        ? `<div class="nc-desc">${desc}</div>`                  : ''}
    ${resolvedLink && linkText
        ? `<a class="nc-link" href="${esc(resolvedLink)}">${linkText}</a>` : ''}
  </div>

  ${footerBtns ? `<div class="nc-footer">${footerBtns}</div>` : ''}

</div>`;
  }

  // ── Bottom sheet state machine ────────────────────────────────
  // States: 'hidden' | 'peek' | 'open'
  // Transforms managed via inline style so drag feels instantaneous.

  let _sheetState = 'hidden';
  let _dragData   = null; // { startY, startTime, startPx }

  function _sheetEl() {
    return document.getElementById(SHEET_ID);
  }

  function _stateToY(state, h) {
    if (state === 'open') return 0;
    if (state === 'peek') return h - PEEK_HEIGHT;
    return h * 1.1; // hidden — fully below screen
  }

  function _animateTo(state) {
    const el = _sheetEl();
    if (!el) return;
    el.style.transition = 'transform 220ms ease';
    el.style.transform  = `translateY(${_stateToY(state, el.offsetHeight)}px)`;
    _sheetState = state;
  }

  function ensureSheet() {
    let el = _sheetEl();
    if (el) return el;

    el = document.createElement('div');
    el.id = SHEET_ID;
    el.className = 'nc-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Point of interest details');
    el.innerHTML = `
      <div class="nc-sheet-handle-row" aria-hidden="true">
        <div class="nc-sheet-handle"></div>
      </div>
      <div id="${SHEET_BODY_ID}" class="nc-sheet-body"></div>`;
    document.body.appendChild(el);

    // Start fully off-screen
    el.style.transition = 'none';
    el.style.transform  = 'translateY(110%)';

    // ── Click delegation ──────────────────────────────────────
    el.addEventListener('click', (e) => {
      const tw = e.target.closest('.nc-thumb-wrap[data-hires]');
      if (tw)                                  { openLightbox(tw.dataset.hires); return; }
      if (e.target.closest('.nc-close-btn'))   { hide();                         return; }
      if (e.target.closest('.nc-share-btn'))   { _opts?.onShare?.();             return; }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _sheetState !== 'hidden') hide();
    });

    // ── Drag to peek ↔ open ↔ dismiss ────────────────────────
    el.addEventListener('touchstart', (e) => {
      // When open, only begin drag from the handle row to avoid blocking body scroll
      const onHandle = !!e.target.closest('.nc-sheet-handle-row');
      if (_sheetState === 'open' && !onHandle) return;
      _dragData = {
        startY:  e.touches[0].clientY,
        startTime: Date.now(),
        startPx: _stateToY(_sheetState, el.offsetHeight),
      };
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      if (!_dragData) return;
      e.preventDefault();
      const dy   = e.touches[0].clientY - _dragData.startY;
      const newY = Math.max(0, _dragData.startPx + dy);
      el.style.transition = 'none';
      el.style.transform  = `translateY(${newY}px)`;
    }, { passive: false });

    el.addEventListener('touchend', (e) => {
      if (!_dragData) return;
      const dy  = e.changedTouches[0].clientY - _dragData.startY;
      const vel = dy / Math.max(1, Date.now() - _dragData.startTime); // px/ms, + = downward
      _dragData = null;

      let target;
      if (vel > 0.4 || dy > el.offsetHeight * 0.25) {
        // Swiped / dragged down
        target = _sheetState === 'open' ? 'peek' : 'hidden';
      } else if (vel < -0.4 || dy < -60) {
        // Swiped / dragged up
        target = 'open';
      } else {
        target = _sheetState; // snap back
      }

      _animateTo(target);
      if (target === 'hidden') {
        if (!_silentHide) _opts?.onClose?.();
        _opts = null;
      }
    });

    return el;
  }

  function showSheet(html) {
    const sheet = ensureSheet();
    document.getElementById(SHEET_BODY_ID).innerHTML = html;

    // Jump to below-screen position without animation, then animate to peek
    sheet.style.transition = 'none';
    sheet.style.transform  = `translateY(${sheet.offsetHeight * 1.1}px)`;
    sheet.offsetHeight; // force reflow so next transition fires
    _animateTo('peek');
  }

  function hideSheet() {
    if (_sheetState === 'hidden') return;
    _animateTo('hidden');
  }

  // ── State ─────────────────────────────────────────────────────

  let _opts       = null;
  let _popup      = null;
  let _silentHide = false;

  // ── Public API ────────────────────────────────────────────────

  function show(feature, poiData, map, opts) {
    _opts = opts || {};
    const html = buildHTML(feature, poiData);

    if (isMobile()) {
      if (_popup) { _popup.remove(); _popup = null; }
      showSheet(html);
    } else {
      hideSheet();
      if (_popup) { _popup.remove(); _popup = null; }

      const coords = feature.geometry?.coordinates;
      if (!coords) return;

      _popup = new mapboxgl.Popup({
        closeButton:    false,
        closeOnClick:   false,
        focusAfterOpen: false,
        offset:   8,
        maxWidth: '360px',
      })
      .setLngLat(coords)
      .setHTML(html)
      .addTo(map);

      // Event delegation on popup element
      const popupEl = _popup.getElement();
      popupEl?.addEventListener('click', (e) => {
        const tw = e.target.closest('.nc-thumb-wrap[data-hires]');
        if (tw)                                { openLightbox(tw.dataset.hires); return; }
        if (e.target.closest('.nc-close-btn')) { hide();                         return; }
        if (e.target.closest('.nc-share-btn')) { _opts?.onShare?.();             return; }
      });

      _popup.on('close', () => {
        _popup = null;
        if (!_silentHide) _opts?.onClose?.();
      });

      map.easeTo({
        center:  coords,
        padding: { top: 80, bottom: 120, left: 20, right: 20 },
        duration: 250,
      });
    }
  }

  function hide(opts) {
    const silent = opts?.silent || false;
    _silentHide = silent;
    hideSheet();
    if (_popup) { _popup.remove(); _popup = null; }
    _silentHide = false;
    if (!silent) _opts?.onClose?.();
    _opts = null;
  }

  window.NorthavenCard = { show, hide };
})();
