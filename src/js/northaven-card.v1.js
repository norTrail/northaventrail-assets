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

  function resolveImage(p, td) {
    const u = window.NorthavenUtils;
    if (!u) return '';
    return u.normalizeSquarespaceAssetUrl(p.u)
        || u.driveThumbFromId(p.m, 200)
        || u.driveThumbFromId(td?.m, 200)
        || u.normalizeSquarespaceAssetUrl(td?.u)
        || '';
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
    const mapQuery  = lat && lng ? `${lat},${lng}` : '';
    const googleHref = mapQuery ? esc(GOOGLE_MAP_URL + mapQuery) : '';
    const appleHref  = mapQuery ? esc(APPLE_MAP_URL  + mapQuery) : '';

    const imgUrl = resolveImage(p, td);

    // Thumbnail (left of header)
    const thumbHtml = imgUrl ? `
      <div class="nc-thumb-wrap">
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

  // ── Bottom sheet ──────────────────────────────────────────────

  let _sheetEventsWired = false;

  function ensureSheet() {
    let el = document.getElementById(SHEET_ID);
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

    // Event delegation — wired once on the sheet element
    el.addEventListener('click', (e) => {
      if (e.target.closest('.nc-close-btn'))  { hide();                    return; }
      if (e.target.closest('.nc-share-btn'))  { _opts?.onShare?.();        return; }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.classList.contains('nc-sheet--open')) hide();
    });

    return el;
  }

  function showSheet(html) {
    const sheet = ensureSheet();
    document.getElementById(SHEET_BODY_ID).innerHTML = html;
    sheet.classList.add('nc-sheet--open');
    sheet.querySelector('.nc-name')?.focus?.();
  }

  function hideSheet() {
    document.getElementById(SHEET_ID)?.classList.remove('nc-sheet--open');
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
        closeButton:   false,
        closeOnClick:  false,
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
        if (e.target.closest('.nc-close-btn')) { hide(); return; }
        if (e.target.closest('.nc-share-btn')) { _opts?.onShare?.(); }
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
