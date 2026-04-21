/* ============================================================
   trailmap-ui-sidecar.v1.js
   trailmap-live overrides for desktop sidecar behavior
   ============================================================ */
(function () {
  'use strict';

  const ACTIVE_MARKER_LAYER_ID   = 'trail_markers_active';
  const TRAIL_MARKERS_LAYER_ID   = 'trail_markers';
  const TRAIL_MARKERS_SOURCE_ID  = 'trail_markers_source';
  const MONARCH_WAY_LAYER_ID     = 'monarch_way';
  const MAPBOX_POPUP_CLASS       = 'mapboxgl-popup';
  const ACTIVE_MARKER_BASE_SIZE  = 0.68;
  const ACTIVE_MARKER_BASE_OFFSET = [0, -23];
  const ACTIVE_MARKER_BOUNCE_MS  = 520;
  const DESKTOP_SIDECAR_WIDTH_FALLBACK = 400;
  const DESKTOP_SIDECAR_INSET_FALLBACK = 12;
  let activeMarkerBounceFrame = null;

  function setActiveLayerLayout(size, offsetY) {
    if (!map?.getLayer?.(ACTIVE_MARKER_LAYER_ID)) return;
    map.setLayoutProperty(ACTIVE_MARKER_LAYER_ID, 'icon-size', size);
    map.setLayoutProperty(ACTIVE_MARKER_LAYER_ID, 'icon-offset', [0, offsetY]);
  }

  function resetActiveMarkerAnimation() {
    if (activeMarkerBounceFrame) {
      cancelAnimationFrame(activeMarkerBounceFrame);
      activeMarkerBounceFrame = null;
    }
    setActiveLayerLayout(ACTIVE_MARKER_BASE_SIZE, ACTIVE_MARKER_BASE_OFFSET[1]);
  }

  function animateActiveMarkerBounce() {
    resetActiveMarkerAnimation();
    if (!map?.getLayer?.(ACTIVE_MARKER_LAYER_ID)) return;

    const start = performance.now();

    function frame(now) {
      const elapsed = now - start;
      const t = Math.min(elapsed / ACTIVE_MARKER_BOUNCE_MS, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const wobble = Math.sin(eased * Math.PI * 2.15) * (1 - eased);
      const size = ACTIVE_MARKER_BASE_SIZE + wobble * 0.16;
      const offsetY = ACTIVE_MARKER_BASE_OFFSET[1] - wobble * 12;

      setActiveLayerLayout(size, offsetY);

      if (t < 1) {
        activeMarkerBounceFrame = requestAnimationFrame(frame);
      } else {
        activeMarkerBounceFrame = null;
        setActiveLayerLayout(ACTIVE_MARKER_BASE_SIZE, ACTIVE_MARKER_BASE_OFFSET[1]);
      }
    }

    activeMarkerBounceFrame = requestAnimationFrame(frame);
  }

  function flyToMarkerForDesktopSidecar(currentFeature, zoomLevel, coords, options = {}) {
    forceClosePopups();
    clearFlyToPopupFallback_();

    let zl = zoomLevel;
    if (!zl) {
      zl = Number(map.getZoom().toFixed(URL_FIXED_NUMBER));
      if (zl < DEFAULT_FLYTO_ZOOM) zl = DEFAULT_FLYTO_ZOOM;
    }

    if (activeFeatureID) {
      map.setFeatureState({ source: TRAIL_MARKERS_SOURCE_ID, id: activeFeatureID }, { active: false });
      activeFeatureID = null;
    }

    if (currentFeature?.id) {
      map.setFeatureState({ source: TRAIL_MARKERS_SOURCE_ID, id: currentFeature.id }, { active: true });
    }

    flyToFeature = currentFeature;
    activeFeatureID = currentFeature.id;

    const flyToCoords = coords || currentFeature.geometry.coordinates;
    const mapHost = document.getElementById('mapView') || document.getElementById('map');
    const computed = mapHost ? getComputedStyle(mapHost) : null;
    const sidecarWidth = computed
      ? parseFloat(computed.getPropertyValue('--nc-sidecar-width')) || DESKTOP_SIDECAR_WIDTH_FALLBACK
      : DESKTOP_SIDECAR_WIDTH_FALLBACK;
    const sidecarInset = computed
      ? parseFloat(computed.getPropertyValue('--nc-sidecar-inset')) || DESKTOP_SIDECAR_INSET_FALLBACK
      : DESKTOP_SIDECAR_INSET_FALLBACK;
    const offsetX = Math.round((sidecarWidth + sidecarInset) / 2);

    const jump = options.immediate === true;
    const method = jump ? 'jumpTo' : 'flyTo';

    map[method]({
      center: flyToCoords,
      zoom: zl,
      offset: [offsetX, 0],
      speed: 0.9,
      curve: 1,
      easing(t) { return t; }
    });

    scheduleFlyToPopupFallback_(currentFeature);
  }

  const baseFlyToMarker_ = typeof flyToMarker === 'function' ? flyToMarker : null;
  flyToMarker = function flyToMarkerSidecarAware_(currentFeature, zoomLevel, coords, options = {}) {
    if (window.innerWidth >= 768) {
      flyToMarkerForDesktopSidecar(currentFeature, zoomLevel, coords, options);
      return;
    }

    // Mobile — URL load (immediate): jump directly to the correct zoom level so
    // the marker is on screen, then let NorthavenCard.show()'s easeTo handle the
    // final vertical offset (keeping the marker above the peeked bottom sheet).
    // Doing a full flyTo here would conflict with the card's own pan animation.
    if (options.immediate === true) {
      forceClosePopups();
      clearFlyToPopupFallback_();

      let zl = zoomLevel;
      if (!zl) {
        zl = Number(map.getZoom().toFixed(URL_FIXED_NUMBER));
        if (zl < DEFAULT_FLYTO_ZOOM) zl = DEFAULT_FLYTO_ZOOM;
      }

      if (activeFeatureID) {
        map.setFeatureState({ source: 'trail_markers_source', id: activeFeatureID }, { active: false });
        activeFeatureID = null;
      }
      if (currentFeature?.id) {
        map.setFeatureState({ source: 'trail_markers_source', id: currentFeature.id }, { active: true });
      }

      flyToFeature = currentFeature;
      activeFeatureID = currentFeature.id;

      const flyToCoords = coords || currentFeature.geometry.coordinates;
      map.jumpTo({ center: flyToCoords, zoom: zl });
      // No scheduleFlyToPopupFallback_ — createPopUp fires immediately after this.
      return;
    }

    if (baseFlyToMarker_) {
      baseFlyToMarker_(currentFeature, zoomLevel, coords, options);
    }
  };

  function resolveFeature(currentFeature) {
    const idStr = String(currentFeature?.id ?? '');
    const fullFeature =
      idStr && Array.isArray(poiData?.features)
        ? poiData.features.find((f) => String(f.id) === idStr) || currentFeature
        : currentFeature;
    return {
      id: idStr,
      feature: fullFeature,
    };
  }

  function clearListingSelection() {
    removeActive();
    window.TrailmapListing?.clearActiveFeature?.();
  }

  function highlightListing(featureId) {
    if (!featureId) return;
    const listing = document.getElementById(`listing-${featureId}`);
    if (listing) listing.classList.add('activeOption');
    window.TrailmapListing?.highlightFeature?.(featureId);
  }

  window.NorthavenSidecarOpenFromSearch = function openFromSearchSidecar_(featureId) {
    if (window.innerWidth < 768) return false;
    if (!featureId || !Array.isArray(poiData?.features)) return false;

    const fullFeature = poiData.features.find((f) => String(f?.id ?? '') === String(featureId));
    if (!fullFeature?.geometry?.coordinates) return false;

    resetCoordinates = true;
    flyToMarkerForDesktopSidecar(fullFeature);
    updatePageDetails(fullFeature);
    createPopUp(fullFeature);
    resetCoordinates = false;
    return true;
  };

  function clearActiveMarkerState() {
    resetActiveMarkerAnimation();
    if (activeFeatureID && map?.getSource?.(TRAIL_MARKERS_SOURCE_ID)) {
      map.setFeatureState(
        { source: TRAIL_MARKERS_SOURCE_ID, id: activeFeatureID },
        { active: false }
      );
    }
    activeFeatureID = null;
  }

  function setActiveMarkerState(featureId) {
    if (!featureId || !map?.getSource?.(TRAIL_MARKERS_SOURCE_ID)) return;
    map.setFeatureState(
      { source: TRAIL_MARKERS_SOURCE_ID, id: featureId },
      { active: true }
    );
    activeFeatureID = featureId;
    animateActiveMarkerBounce();
  }

  createPopUp = function createPopUpSidecar_(currentFeature) {
    forceClosePopups();
    popupFeature = currentFeature;

    const { id: idStr, feature: fullFeature } = resolveFeature(currentFeature);
    const coords = fullFeature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length !== 2) return;

    const p = fullFeature.properties || {};
    const title = String(p.l || p.n || '').trim();

    setActiveMarkerState(fullFeature.id);
    highlightListing(idStr);

    window.NorthavenCard.show(fullFeature, poiData, map, {
      onShare: () => {
        clickShare(
          'Northaven Trail Map',
          title ? `${title} on the Northaven Trail` : 'Northaven Trail Map',
          buildURL({ markerID: idStr, markerTitle: title }, true)
        );
      },
      onClose: () => {
        clearActiveMarkerState();
        popupFeature = null;
        clearListingSelection();
        if (!forcedClosePopup) resetPageDetails();
      },
    });
  };

  clearSelection_ = function clearSelectionSidecar_() {
    if (window.NorthavenCard?.getActiveFeatureId?.()) {
      window.NorthavenCard.hide();
      return;
    }

    const popUps = document.getElementsByClassName(MAPBOX_POPUP_CLASS);
    if (popUps[0]) popUps[0].remove();
    popupFeature = null;
    clearListingSelection();
    clearActiveMarkerState();
  };

  forceClosePopups = function forceClosePopupsSidecar_() {
    clearFlyToPopupFallback_();
    window.NorthavenCard?.hide?.({ silent: true });

    const popups = document.getElementsByClassName(MAPBOX_POPUP_CLASS);
    while (popups.length) {
      forcedClosePopup = true;
      popups[0].remove();
      forcedClosePopup = false;
    }

    popupFeature = null;
    clearListingSelection();
    clearActiveMarkerState();
  };

  onMapClick_ = function onMapClickSidecar_(event) {
    closeSearchControl();

    if (map?.getLayer?.(MONARCH_WAY_LAYER_ID)) {
      const monarchHit = map.queryRenderedFeatures(event.point, {
        layers: [MONARCH_WAY_LAYER_ID]
      });
      if (monarchHit.length) return;
    }

    if (!map.getLayer(TRAIL_MARKERS_LAYER_ID)) {
      clearSelection_();
      return;
    }

    const features = map.queryRenderedFeatures(event.point, {
      layers: [TRAIL_MARKERS_LAYER_ID]
    });

    if (!features.length) {
      clearSelection_();
      return;
    }

    const clickedPoint = features[0];
    const clickedId = String(clickedPoint?.id ?? '');
    const activeCardId = String(window.NorthavenCard?.getActiveFeatureId?.() ?? '');
    const desktopCard = document.getElementById('nc-desktop-card');
    const isCollapsed = Boolean(desktopCard && desktopCard.classList.contains('is-collapsed'));

    if (
      clickedId &&
      String(activeFeatureID ?? '') === clickedId &&
      activeCardId === clickedId
    ) {
      if (isCollapsed && window.innerWidth >= 768) {
        window.NorthavenCard?.expand?.();
      }
      return;
    }

    resetCoordinates = true;

    const { feature: fullFeature } = resolveFeature(clickedPoint);

    if (window.innerWidth >= 768) {
      flyToMarkerForDesktopSidecar(fullFeature);
    } else {
      flyToMarker(fullFeature);
    }
    updatePageDetails(fullFeature);

    resetCoordinates = false;

    removeActive();
    highlightListing(clickedId);
  };
})();
