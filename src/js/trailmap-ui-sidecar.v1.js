/* ============================================================
   trailmap-ui-sidecar.v1.js
   trailmap-live overrides for desktop sidecar behavior
   ============================================================ */
(function () {
  'use strict';

  function clearActiveMarkerState() {
    if (activeFeatureID && map?.getSource?.('trail_markers_source')) {
      map.setFeatureState(
        { source: 'trail_markers_source', id: activeFeatureID },
        { active: false }
      );
    }
    activeFeatureID = null;
  }

  clearSelection_ = function clearSelectionSidecar_() {
    if (window.NorthavenCard?.getActiveFeatureId?.()) {
      window.NorthavenCard.hide();
      return;
    }

    const popUps = document.getElementsByClassName('mapboxgl-popup');
    if (popUps[0]) popUps[0].remove();
    popupFeature = null;
    removeActive();
    clearActiveMarkerState();
    window.TrailmapListing?.clearActiveFeature?.();
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
    removeActive();
    clearActiveMarkerState();
    window.TrailmapListing?.clearActiveFeature?.();
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

    const fullFeature =
      clickedId && Array.isArray(poiData?.features)
        ? poiData.features.find((f) => String(f.id) === clickedId) || clickedPoint
        : clickedPoint;

    flyToMarker(fullFeature);
    updatePageDetails(fullFeature);

    resetCoordinates = false;

    removeActive();

    const listing = document.getElementById(`listing-${clickedId}`);
    if (listing) listing.classList.add('activeOption');

    if (window.TrailmapListing && window.TrailmapListing.highlightFeature) {
      window.TrailmapListing.highlightFeature(clickedId);
    }
  };
})();
