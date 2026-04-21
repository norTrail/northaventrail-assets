/* ============================================================
   trailmap-ui-sidecar.v1.js
   trailmap-live overrides for desktop sidecar behavior
   ============================================================ */
(function () {
  'use strict';

  const ACTIVE_MARKER_LAYER_ID = 'trail_markers_active';
  const ACTIVE_MARKER_BASE_SIZE = 0.68;
  const ACTIVE_MARKER_BASE_OFFSET = [0, -23];
  const ACTIVE_MARKER_BOUNCE_MS = 520;
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

  function clearActiveMarkerState() {
    resetActiveMarkerAnimation();
    if (activeFeatureID && map?.getSource?.('trail_markers_source')) {
      map.setFeatureState(
        { source: 'trail_markers_source', id: activeFeatureID },
        { active: false }
      );
    }
    activeFeatureID = null;
  }

  function setActiveMarkerState(featureId) {
    if (!featureId || !map?.getSource?.('trail_markers_source')) return;
    map.setFeatureState(
      { source: 'trail_markers_source', id: featureId },
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

    const popUps = document.getElementsByClassName('mapboxgl-popup');
    if (popUps[0]) popUps[0].remove();
    popupFeature = null;
    clearListingSelection();
    clearActiveMarkerState();
  };

  forceClosePopups = function forceClosePopupsSidecar_() {
    clearFlyToPopupFallback_();
    window.NorthavenCard?.hide?.({ silent: true });

    const popups = document.getElementsByClassName('mapboxgl-popup');
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

    if (map?.getLayer?.('monarch_way')) {
      const monarchHit = map.queryRenderedFeatures(event.point, {
        layers: ['monarch_way']
      });
      if (monarchHit.length) return;
    }

    if (!map.getLayer('trail_markers')) {
      clearSelection_();
      return;
    }

    const features = map.queryRenderedFeatures(event.point, {
      layers: ['trail_markers']
    });

    if (!features.length) {
      clearSelection_();
      return;
    }

    const clickedPoint = features[0];
    const clickedId = String(clickedPoint?.id ?? '');
    const activeCardId = String(window.NorthavenCard?.getActiveFeatureId?.() ?? '');

    if (
      clickedId &&
      String(activeFeatureID ?? '') === clickedId &&
      activeCardId === clickedId
    ) {
      return;
    }

    resetCoordinates = true;

    const { feature: fullFeature } = resolveFeature(clickedPoint);

    flyToMarker(fullFeature);
    updatePageDetails(fullFeature);

    resetCoordinates = false;

    removeActive();
    highlightListing(clickedId);
  };
})();
