/* ============================================================
   northaven-card.v1.js
   Shared map POI card — bottom sheet on mobile, Mapbox popup on desktop
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
  const PEEK_HERO_PREVIEW  = 56;
  const MID_VIEWPORT_RATIO = 0.5;
  const FULL_VIEWPORT_RATIO = 0.9;
  const SHEET_STATE_INITIAL = 'initial';
  const SHEET_STATE_MID = 'mid';
  const SHEET_STATE_FULL = 'full';
  const SHEET_STATES = [SHEET_STATE_INITIAL, SHEET_STATE_MID, SHEET_STATE_FULL];
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
    const raw = String(iconValue || '').trim();
    if (!u || !raw) return '';

    if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('/')) {
      return raw;
    }

    if (/\.[a-z0-9]+$/i.test(raw)) {
      return u.normalizeSquarespaceAssetUrl(raw);
    }

    return u.normalizeSquarespaceAssetUrl(raw + '.svg');
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

  function _lbKeydown(e) {
    if (e.key !== 'Escape' || !_lightbox) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closeLightbox();
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
    <a class="nc-hero-link" href="${esc(MAPILLARY_VIEW + mId)}" target="_blank" rel="noopener noreferrer" aria-label="View street-level photo on Mapillary">
      <img class="nc-hero-img" alt="Street-level photo">
    </a>
    <span class="nc-hero-badge">Street View</span>
  </div>` : '';

    // ── Thumbnail ─────────────────────────────────────────────
    const thumbHtml = imgUrl ? `
      <div class="nc-thumb-wrap"${imgHiresUrl ? ` data-hires="${esc(imgHiresUrl)}"` : ''}>
        <img class="nc-thumb" src="${esc(imgUrl)}" alt="" aria-hidden="true"
             width="72" height="72" loading="lazy"
             onerror="this.closest('.nc-thumb-wrap').remove()">
      </div>` : '';

    // ── Category row: legend icon + badge ─────────────────────
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
    const footerBtns = [
      resolvedCta && ctaLabel && `<a class="nc-action nc-cta" href="${esc(resolvedCta)}"><span class="nc-action-label">${ctaLabel}</span></a>`,
      directionsHref && `<a class="nc-action" href="${directionsHref}" target="_blank" rel="noopener noreferrer" aria-label="Get directions in Google Maps">
        <svg class="nc-action-icon" aria-hidden="true"><use href="#google-logo"></use></svg>
        <span class="nc-action-label">Directions</span>
      </a>`,
      `<button class="nc-action nc-action-share" type="button" aria-label="Share this point of interest">
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
  // States: 'hidden' | 'initial' | 'mid' | 'full'
  //
  // Initial shows the handle bar + header + a sliver of the Mapillary image.
  // Mid opens to roughly half the viewport. Full opens to roughly 90%.
  // The initial offset is computed from live DOM after each card is injected.
  //
  // All transforms are managed via inline style so drag updates are
  // immediate. The base .nc-sheet CSS provides the transition timing.

  let _sheetState = 'hidden';
  let _peekY      = 0;
  let _dragData   = null;  // { startY, startTime, startPx, h, pointerId }

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

  function _stepState(state, direction) {
    var index = SHEET_STATES.indexOf(state);
    if (index === -1) return SHEET_STATE_INITIAL;
    var next = Math.max(0, Math.min(SHEET_STATES.length - 1, index + direction));
    return SHEET_STATES[next];
  }

  function _closestState(y, h) {
    var closest = SHEET_STATE_INITIAL;
    var closestDist = Infinity;
    SHEET_STATES.forEach(function(state) {
      var dist = Math.abs(_stateY(state, h) - y);
      if (dist < closestDist) {
        closest = state;
        closestDist = dist;
      }
    });
    return closest;
  }

  function _stateY(state, h) {
    if (state === SHEET_STATE_FULL) {
      return Math.max(0, h - Math.min(h, window.innerHeight * FULL_VIEWPORT_RATIO));
    }
    if (state === SHEET_STATE_MID) {
      return Math.max(0, h - Math.min(h, window.innerHeight * MID_VIEWPORT_RATIO));
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
    if (_sheetState === 'hidden' || typeof clientY !== 'number') return;
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
    var currentY = Math.max(0, Math.min(_dragData.startPx + dy, h + 30));
    _dragData = null;

    var target;
    if (vel > 0.25 || dy > 60) {
      target = _stepState(_sheetState, -1);
    } else if (vel < -0.25 || dy < -60) {
      target = _stepState(_sheetState, 1);
    } else {
      target = _closestState(currentY, h);
    }

    _animate(el, _stateY(target, h), '300ms cubic-bezier(0.32, 0.72, 0, 1)');
    _sheetState = target;
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
    el.innerHTML =
      '<div class="nc-sheet-handle-row" aria-hidden="true">' +
        '<div class="nc-sheet-handle"></div>' +
      '</div>' +
      '<div id="' + SHEET_BODY_ID + '" class="nc-sheet-body"></div>';
    document.body.appendChild(el);

    var handleRow = el.querySelector('.nc-sheet-handle-row');

    el.style.transition = 'none';
    el.style.transform  = 'translateY(' + (window.innerHeight + 30) + 'px)';

    // ── Click delegation ──────────────────────────────────────
    el.addEventListener('click', function(e) {
      var tw = e.target.closest('.nc-thumb-wrap[data-hires]');
      if (tw)                                { openLightbox(tw.dataset.hires); return; }
      if (e.target.closest('.nc-close-btn')) { hide();                         return; }
      if (e.target.closest('.nc-action-share') || e.target.closest('.nc-share-btn')) { _opts && _opts.onShare && _opts.onShare(); return; }
    });

    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Escape' || _lightbox) return;
      if (_sheetState !== 'hidden' || _popup) hide();
    });

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

    if (handleRow) {
      handleRow.addEventListener('pointerdown', function(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        _beginDrag(el, _dragPointY(e), e.pointerId);
      });

      handleRow.addEventListener('click', function() {
        if (_dragData || _sheetState === 'hidden') return;
        var target = _sheetState === SHEET_STATE_INITIAL
          ? SHEET_STATE_MID
          : _stepState(_sheetState, -1);
        _animate(el, _stateY(target, el.offsetHeight), '300ms cubic-bezier(0.32, 0.72, 0, 1)');
        _sheetState = target;
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
    _sheetState = 'hidden';

    // Step 4 — animate to peek after two frames so the slide-up is always seen.
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        _animate(sheet, _peekY, '350ms cubic-bezier(0.32, 0.72, 0, 1)');
        _sheetState = SHEET_STATE_INITIAL;
      });
    });
  }

  function hideSheet() {
    var el = _sheetEl();
    if (!el || _sheetState === 'hidden') return;
    _animate(el, el.offsetHeight + 30, '220ms ease');
    _sheetState = 'hidden';
  }

  // ── State ─────────────────────────────────────────────────────

  var _opts       = null;
  var _popup      = null;
  var _silentHide = false;

  // ── Public API ────────────────────────────────────────────────

  function show(feature, poiData, map, opts) {
    _opts = opts || {};
    var p   = feature.properties || {};
    var mId = normalizeMid(p.m_id);
    var html = buildHTML(feature, poiData);

    if (isMobile()) {
      if (_popup) { _popup.remove(); _popup = null; }
      showSheet(html);
      if (isValidMid(mId)) {
        loadMapillaryHero(mId, document.getElementById(SHEET_BODY_ID));
      }
    } else {
      hideSheet();
      if (_popup) { _popup.remove(); _popup = null; }

      var coords = feature.geometry && feature.geometry.coordinates;
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

      var popupEl = _popup.getElement();

      if (popupEl) {
        popupEl.addEventListener('click', function(e) {
          var tw = e.target.closest('.nc-thumb-wrap[data-hires]');
          if (tw)                                { openLightbox(tw.dataset.hires); return; }
          if (e.target.closest('.nc-close-btn')) { hide();                         return; }
          if (e.target.closest('.nc-action-share') || e.target.closest('.nc-share-btn')) { _opts && _opts.onShare && _opts.onShare(); return; }
        });

        if (isValidMid(mId)) {
          loadMapillaryHero(mId, popupEl);
        }
      }

      _popup.on('close', function() {
        _popup = null;
        if (!_silentHide && _opts && _opts.onClose) _opts.onClose();
      });

      map.easeTo({
        center:  coords,
        padding: { top: 80, bottom: 120, left: 20, right: 20 },
        duration: 250,
      });
    }
  }

  function hide(opts) {
    var silent = opts && opts.silent ? true : false;
    _silentHide = silent;
    hideSheet();
    if (_popup) { _popup.remove(); _popup = null; }
    _silentHide = false;
    if (!silent && _opts && _opts.onClose) _opts.onClose();
    _opts = null;
  }

  window.NorthavenCard = { show: show, hide: hide };
})();
