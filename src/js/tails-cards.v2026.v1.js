/* ============================================================
   Northaven TAILS — Event Cards
   ============================================================ */
(function () {
  'use strict';

  const GOOGLE_DIR_URL = 'https://www.google.com/maps/dir/?api=1&destination=';
  const GOOGLE_MAP_URL = 'https://www.google.com/maps?q=';
  const APPLE_MAP_URL = 'https://maps.apple.com/?z=20&q=';

  let activeMarkerEl = null;
  let activeKey = null;

  function esc(str) {
    return window.NorthavenUtils.escapeHtml(str);
  }

  function escAttr(str) {
    return window.NorthavenUtils.escapeHtmlAttr(str);
  }

  function isApple() {
    return window.NorthavenUtils.isApple();
  }

  function clickShare(title, text, url) {
    window.NorthavenUtils.clickShare({ title, text, url });
  }

  function formatDateISOLong(date) {
    return window.NorthavenUtils.formatDateISOLong(date);
  }

  function normalizeAbsUrl(url) {
    return window.NorthavenUtils?.normalizeAbsUrl?.(url) || String(url || '').trim();
  }

  function cleanZoneTitle(zoneName) {
    return String(zoneName || 'No-Mow Zone')
      .replace(/^Grazing Area<br>\s*/i, '')
      .replace(/^Grazing Area\s+/i, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanDescriptionHtml(html) {
    return String(html || '')
      .replace(/(?:<br\s*\/?>\s*){0,2}#zone[\w-]+\s*$/i, '')
      .trim();
  }

  function safeCoords(feature, fallbackLat, fallbackLng) {
    const coords = feature?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) return { lng: coords[0], lat: coords[1] };
    if (typeof fallbackLat === 'number' && typeof fallbackLng === 'number') {
      return { lat: fallbackLat, lng: fallbackLng };
    }
    return null;
  }

  function buildHeroHtml(mapillaryId) {
    const mId = window.NorthavenEventCard?.normalizeMid?.(mapillaryId);
    if (!mId) return '';
    const heroTitle = window.innerWidth < 768 ? 'Tap to open Street View' : 'Click to open Street View';
    return '' +
      '<div class="nc-hero">' +
        '<a class="nc-hero-link" href="' + escAttr('https://www.mapillary.com/app/?pKey=' + mId) + '" target="_blank" rel="noopener noreferrer" aria-label="Open Street View for this location" title="' + escAttr(heroTitle) + '" data-mid="' + escAttr(mId) + '">' +
          '<img class="nc-hero-img" alt="Street-level photo" title="' + escAttr(heroTitle) + '">' +
          '<span class="nc-hero-cta" aria-hidden="true">' + esc(heroTitle) + '</span>' +
        '</a>' +
        '<span class="nc-hero-badge">Street View</span>' +
      '</div>';
  }

  function buildThumbHtml(imageUrl, fallbackEmoji, hiresUrl) {
    const src = normalizeAbsUrl(imageUrl);
    if (src) {
      const hires = normalizeAbsUrl(hiresUrl || imageUrl);
      return '' +
        '<div class="nc-thumb-wrap"' + (hires ? ' data-hires="' + escAttr(hires) + '"' : '') + '>' +
          '<img class="nc-thumb" src="' + escAttr(src) + '" alt="" aria-hidden="true" width="72" height="72" loading="lazy" onerror="this.closest(\'.nc-thumb-wrap\').remove()">' +
        '</div>';
    }

    if (!fallbackEmoji) return '';
    return '' +
      '<div class="nc-thumb-wrap tc-thumb-fallback-wrap" aria-hidden="true">' +
        '<div class="tc-thumb-fallback">' + esc(fallbackEmoji) + '</div>' +
      '</div>';
  }

  function buildActionHtml(actions) {
    return '<div class="nc-actions">' + actions.filter(Boolean).join('') + '</div>';
  }

  function buildMapActions(lat, lng, shareTitle, shareText) {
    if (lat == null || lng == null) return [];
    const mapQuery = lat + ',' + lng;
    const googleHref = GOOGLE_DIR_URL + mapQuery;
    const appleHref = APPLE_MAP_URL + mapQuery;
    const shareUrl = location.href;

    const actions = [
      '<a class="nc-action" href="' + escAttr(googleHref) + '" target="_blank" rel="noopener noreferrer" aria-label="Get directions in Google Maps" title="Get directions in Google Maps">' +
        '<svg class="nc-action-icon" aria-hidden="true"><use href="#google-logo"></use></svg>' +
        '<span class="nc-action-label">Directions</span>' +
      '</a>'
    ];

    if (isApple()) {
      actions.push(
        '<a class="nc-action" href="' + escAttr(appleHref) + '" target="_blank" rel="noopener noreferrer" aria-label="Open in Apple Maps" title="Open in Apple Maps">' +
          '<svg class="nc-action-icon" aria-hidden="true"><use href="#apple-logo"></use></svg>' +
          '<span class="nc-action-label">Apple Maps</span>' +
        '</a>'
      );
    }

    actions.push(
      '<button class="nc-action nc-action-share" type="button" aria-label="Share this location" title="Share this location" data-share-title="' + escAttr(shareTitle) + '" data-share-text="' + escAttr(shareText) + '" data-share-url="' + escAttr(shareUrl) + '">' +
        '<svg class="nc-action-icon" aria-hidden="true"><use href="#share-icon"></use></svg>' +
        '<span class="nc-action-label">Share</span>' +
      '</button>'
    );

    return actions;
  }

  function renderStatusMeta(status, icon, dateText, zoneCode) {
    const safeStatus = String(status || '').trim();
    const safeDate = String(dateText || '').trim();
    const code = String(zoneCode || '').trim();
    return '' +
      '<div class="tc-meta-row">' +
        (safeStatus ? '<span class="tc-status-pill tc-status-pill--' + escAttr(safeStatus.toLowerCase().replace(/\s+/g, '-')) + '">' + (icon ? '<span class="tc-status-pill__icon" aria-hidden="true">' + esc(icon) + '</span>' : '') + '<span>' + esc(safeStatus) + '</span></span>' : '') +
        (safeDate ? '<span class="tc-date-pill">' + esc(safeDate) + '</span>' : '') +
        (code ? '<span class="tc-code-pill">' + esc(code) + '</span>' : '') +
      '</div>';
  }

  function renderNoMowZoneCard(feature) {
    const p = feature?.properties || {};
    const title = cleanZoneTitle(p.zoneName);
    const near = String(p.near || '').trim();
    const desc = cleanDescriptionHtml(p.description);
    const lat = Number(p.centerLat);
    const lng = Number(p.centerLng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
    const dateText = p.estimatedDate ? formatDateISOLong(p.estimatedDate) : '';
    const shareText = desc
      ? title + ' — ' + String(desc).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      : title + ' on the Northaven Trail';
    const actions = buildMapActions(hasCoords ? lat : null, hasCoords ? lng : null, title, shareText);

    return '' +
      '<div class="nc-card tc-card tc-card--zone">' +
        '<div class="nc-header">' +
          buildThumbHtml('', p.icon || '🌼', '') +
          '<div class="nc-header-text">' +
            '<div class="nc-name-row">' +
              '<h2 class="nc-name">' + esc(title) + '</h2>' +
            '</div>' +
            (near ? '<div class="nc-near">Near ' + esc(near) + '</div>' : '') +
            renderStatusMeta(p.status, p.icon, dateText, p.zoneCode) +
          '</div>' +
        '</div>' +
        '<hr class="nc-divider">' +
        buildActionHtml(actions) +
        buildHeroHtml(p.m_id) +
        '<div class="nc-body">' +
          '<div class="nc-category-row"><span class="nc-badge"><span class="nc-badge-label">No-Mow Zone</span></span></div>' +
          (desc ? '<div class="nc-desc">' + desc + '</div>' : '') +
          (hasCoords ? '<a class="nc-link" href="' + escAttr(GOOGLE_MAP_URL + lat + ',' + lng) + '" target="_blank" rel="noopener noreferrer">Open location in Google Maps</a>' : '') +
        '</div>' +
      '</div>';
  }

  function renderHerdCard(feature) {
    const p = feature?.properties || {};
    const coords = safeCoords(feature);
    const title = String(p.herdName || 'Northaven TAILS').trim();
    const near = String(p.near || '').trim() || String(p.trailSectionShort || '').replace(/🐑:/g, '').replace(/&nbsp;/g, ' ').trim();
    const shortLine = String(p.trailSectionShort || '').replace(/&nbsp;/g, ' ').trim();
    const longLine = String(p.trailSectionLong || '').replace(/&nbsp;/g, ' ').trim();
    const sheepInfo = String(p.sheepInfo || '').trim();
    const bodyText = longLine || sheepInfo;
    const shareText = shortLine
      ? title + ' is currently grazing at ' + shortLine
      : title + ' is currently grazing on the Northaven Trail';
    const actions = buildMapActions(coords?.lat, coords?.lng, title, shareText);

    return '' +
      '<div class="nc-card tc-card tc-card--herd">' +
        '<div class="nc-header">' +
          buildThumbHtml(p.sheepImage, '🐑', p.sheepImage) +
          '<div class="nc-header-text">' +
            '<div class="nc-name-row">' +
              '<h2 class="nc-name">' + esc(title) + '</h2>' +
            '</div>' +
            (near ? '<div class="nc-near">Near ' + esc(near) + '</div>' : '') +
            renderStatusMeta('Now Grazing', '🐑', '', '') +
          '</div>' +
        '</div>' +
        '<hr class="nc-divider">' +
        buildActionHtml(actions) +
        buildHeroHtml(p.m_id) +
        '<div class="nc-body">' +
          '<div class="nc-category-row"><span class="nc-badge"><span class="nc-badge-label">Herd Location</span></span></div>' +
          (shortLine ? '<div class="tc-location-line">' + esc(shortLine) + '</div>' : '') +
          (bodyText ? '<div class="nc-desc">' + esc(bodyText) + '</div>' : '') +
          (coords ? '<a class="nc-link" href="' + escAttr(GOOGLE_MAP_URL + coords.lat + ',' + coords.lng) + '" target="_blank" rel="noopener noreferrer">Open location in Google Maps</a>' : '') +
        '</div>' +
      '</div>';
  }

  function clearActiveMarker(restoreFocus) {
    if (!activeMarkerEl) return;
    activeMarkerEl.setAttribute('aria-pressed', 'false');
    activeMarkerEl.setAttribute('aria-expanded', 'false');
    if (restoreFocus && window.NorthavenUtils?.shouldFocusPopupForA11y?.()) {
      try { activeMarkerEl.focus({ preventScroll: true }); } catch (_err) { }
    }
    activeMarkerEl = null;
    activeKey = null;
  }

  function showCard(config) {
    const markerEl = config.markerEl;
    if (!markerEl || !config.map) return;

    const isSameCard = activeKey && activeKey === config.key && window.NorthavenEventCard?.isVisible?.();

    if (!isSameCard) {
      clearActiveMarker(false);
    }

    activeMarkerEl = markerEl;
    activeKey = config.key;
    markerEl.setAttribute('aria-pressed', 'true');
    markerEl.setAttribute('aria-expanded', 'true');

    const eventCardConfig = {
      key: config.key,
      html: config.html,
      coords: config.coords,
      map: config.map,
      mapillaryId: config.mapillaryId,
      onShare: function () {
        clickShare(config.shareTitle, config.shareText, location.href);
      },
      onClose: function () {
        clearActiveMarker(true);
        if (typeof config.onClose === 'function') {
          config.onClose();
        }
      }
    };

    if (window.NorthavenEventCard?.isVisible?.()) {
      window.NorthavenEventCard.updateInPlace(eventCardConfig);
    } else {
      window.NorthavenEventCard.show(eventCardConfig);
    }
  }

  function showNoMowZone(feature, markerEl, map, options) {
    const p = feature?.properties || {};
    const lat = Number(p.centerLat);
    const lng = Number(p.centerLng);
    const coords = {
      lng: Number.isFinite(lng) ? lng : feature?.geometry?.coordinates?.[0]?.[0]?.[0],
      lat: Number.isFinite(lat) ? lat : feature?.geometry?.coordinates?.[0]?.[0]?.[1]
    };
    const title = cleanZoneTitle(p.zoneName);
    const descText = cleanDescriptionHtml(p.description).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    showCard({
      key: 'zone:' + String(p.zoneCode || feature?.id || ''),
      markerEl: markerEl,
      map: map,
      coords: coords,
      mapillaryId: p.m_id,
      html: renderNoMowZoneCard(feature),
      shareTitle: title,
      shareText: descText ? title + ' — ' + descText : title + ' on the Northaven Trail',
      onClose: options && typeof options.onClose === 'function' ? options.onClose : null
    });
  }

  function showHerd(feature, markerEl, map) {
    const coords = safeCoords(feature);
    const p = feature?.properties || {};
    const title = String(p.herdName || 'Northaven TAILS').trim();
    const trailSectionShort = String(p.trailSectionShort || '').replace(/&nbsp;/g, ' ').trim();
    showCard({
      key: 'herd:' + title,
      markerEl: markerEl,
      map: map,
      coords: coords,
      mapillaryId: p.m_id,
      html: renderHerdCard(feature),
      shareTitle: title,
      shareText: trailSectionShort
        ? title + ' is currently grazing at ' + trailSectionShort
        : title + ' is currently grazing on the Northaven Trail'
    });
  }

  function hide() {
    window.NorthavenEventCard?.hide();
    clearActiveMarker(false);
  }

  window.TailsCards = {
    hide: hide,
    showNoMowZone: showNoMowZone,
    showHerd: showHerd,
    renderNoMowZoneCard: renderNoMowZoneCard,
    renderHerdCard: renderHerdCard,
  };
})();
