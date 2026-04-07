// trailmap-monarch.js
(function () {
  function initMonarchWayPopups(map) {
    if (!map || typeof map.on !== "function" || typeof map.getStyle !== "function") {
      console.warn("[MonarchWay] map missing / not Mapbox");
      return;
    }

    if (typeof SHOW_MONARCH_WAY === "undefined" || !SHOW_MONARCH_WAY) {
      return;
    }

    // Monarch Way
    const URL_MONARCH_WAY =
      'https://api.mapbox.com/datasets/v1/wdawso/cmjrr91ci3euv1pli54602esn/features?access_token=' +
      mapboxgl.accessToken;

    const monarchInfoPoint = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-96.8726, 32.8859] },
      properties: {
        title: "Monarch Way",
        body: "Restoring native prairie habitat along Northaven Trail."
      }
    };

    let activeMonarchPopup = null;

    const escapeHtml = (s = "") => window.NorthavenUtils.escapeHtml(s);

    function renderMonarchPopup({ title, body }) {
      const monarchPath = "/monarch-way";
      const isOnMonarchPage =
        window.location.pathname.replace(/\/$/, "") === monarchPath;

      const linkHtml = !isOnMonarchPage
        ? `
          <div class="map-popup-text">
            <div style="margin-top:6px">
              <a class="map-popup-link" href="https://northaventrail.org/monarch-way">
                Learn more about Monarch Way →
              </a>
            </div>
          </div>
        `
        : "";

      return `
        <div class="map-popup">
          <div class="map-popup-row">
            <div class="map-popup-image">
              <img
                src="/s/Monarch.png"
                width="64"
                height="64"
                alt="Monarch Way"
                loading="lazy"
              >
            </div>

            <div class="map-popup-body">
              ${title ? `<div class="map-popup-title">${escapeHtml(title)}</div>` : ""}
              ${body ? `<div class="map-popup-text">${escapeHtml(body)}</div>` : ""}
              ${linkHtml}
            </div>
          </div>
        </div>
      `;
    }

    function createMonarchPopup(lngLat, props = {}, options = {}) {
      const {
        closeButton = true,
        closeOnClick = true,
        focusAfterOpen = false,
        offset = 1
      } = options;

      const title = props.title || "Monarch Way";
      const body = props.body || "Restoring native prairie habitat along Northaven Trail.";

      activeMonarchPopup?.remove();

      // Close other popups 
      if (typeof forceClosePopups === "function") forceClosePopups();

      activeMonarchPopup = new mapboxgl.Popup({
        closeButton,
        closeOnClick,
        focusAfterOpen,
        offset
      })
        .setLngLat(lngLat)
        .setHTML(renderMonarchPopup({ title, body }))
        .addTo(map);

      window.NorthavenUtils?.focusFirstPopupElement?.(activeMonarchPopup);

      return activeMonarchPopup;
    }

    const onReady = () => {
      if (!map.getSource("monarch_way_source")) {
          map.addSource('monarch_way_source', {
            type: 'geojson',
            data: URL_MONARCH_WAY
          });
        }

        // Background to block out the trail and highlight the Way
        if (!map.getLayer("monarch_casing")) {
          map.addLayer({
            "id": "monarch_casing",
            "type": "line",
            "source": "monarch_way_source",
            "layout": {
              "line-cap": "round",
              "line-join": "round"
            },
            "paint": {
              "line-color": "#f5f5f5", // match map background
              "line-width": 10
            }
          });
        }

        // Draw the way
        if (!map.getLayer("monarch_way")) {
          map.addLayer({
            "id": "monarch_way",
            "type": "line",
            "source": "monarch_way_source",
            "layout": {
              "line-join": "round",
              "line-cap": "round"
            },
            "paint": {
              "line-color": "#551A8B",
              "line-width": 5
            }
          });
        }

        map.on("click", "monarch_way", (e) => {
          const props = e.features?.[0]?.properties || {};
          createMonarchPopup(e.lngLat, props);
        });

        map.on("mouseenter", "monarch_way", () => {
          map.getCanvas().style.cursor = "pointer";
        });

        map.on("mouseleave", "monarch_way", () => {
          map.getCanvas().style.cursor = "";
        });

        map.once('idle', () => {
          monarchSetBoundsReady();
        });

      function monarchSetBoundsReady() {
        if (!mapInitialIdleCompleted) {
          setTimeout(monarchSetBoundsReady, 10);
          return;
        }
        monarchSetBounds();
      }

      function monarchSetBounds() {
        if (typeof BOUNDARY_MONARCH_WAY !== "undefined" && BOUNDARY_MONARCH_WAY) {
          const MAP_BOUNDS_MONARCH_WAY = [
            [-96.87915140032769, 32.88123146436452],
            [-96.8649510903076, 32.88845242611296]
          ];

          flyToFeature = "Monarch Way";
          fitBoundsSilently(MAP_BOUNDS_MONARCH_WAY, { padding: 40 });
          flyToFeature = null;

          // initial info popup
          createMonarchPopup(
            monarchInfoPoint.geometry.coordinates,
            monarchInfoPoint.properties,
            { closeOnClick: false }
          );
        }
      }

    };

    if (map.loaded()) {
      onReady();
    } else {
      map.once("idle", onReady);
    }
  }

  // Expose globally for your main map file to call
  window.initMonarchWayPopups = initMonarchWayPopups;

})();
