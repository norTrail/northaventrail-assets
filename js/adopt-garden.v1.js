/* ============================================================
   adopt-garden.v1.js
   Fetches trail-poi.latest.json manifest, loads the versioned
   data file, filters garden features, and renders a header
   (vacancy count + CTA) and a table of all gardens into
   matching .ag-header and .ag-section containers.

   Used on: northaventrail.org/adoptgarden
   ============================================================ */

(function () {
  "use strict";

  // Dedup guard — safe when multiple Squarespace Code Blocks include this script
  if (window._agInit) return;
  window._agInit = true;

  const MANIFEST_URL   = "https://assets.northaventrail.org/json/trail-poi.latest.json";
  const SIGNUP_EMAIL   = "adoptagarden@northaventrail.org";
  const SIGNUP_SUBJECT = "I would like to adopt a garden on the Northaven Trail";
  const FETCH_TIMEOUT_MS = 15000;

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  const escHtml     = (s) => window.NorthavenUtils.escapeHtml(s);
  const safeOnReady = (fn) => window.NorthavenUtils.onReady(fn);
  const fetchJson   = (url, mode, sig) => window.NorthavenUtils.fetchJson(url, { cache: mode, signal: sig });
  const normalizeAbsUrl = (url) => window.NorthavenUtils.normalizeAbsUrl(url);
  const logClientEvent = (kind, err, details) => {
    window.TrailmapError?.logClientEvent?.({
      kind,
      app: "adoptgarden",
      message: String(err?.message || err || ""),
      stack: err?.stack || null,
      ...details
    });
  };

  function setStatus(el, msg, isError) {
    el.innerHTML =
      '<p class="' + (isError ? "ag-error" : "ag-loading") + '" role="status" aria-live="polite">' +
      escHtml(msg) + "</p>";
  }


  // ------------------------------------------------------------------
  // Resolve garden display name — features use "l" or "n" interchangeably
  // ------------------------------------------------------------------

  function gardenName(props) {
    return String(props.l || props.n || "");
  }

  // ------------------------------------------------------------------
  // Build mailto href with pre-filled subject and body
  // Optionally garden-specific when name is provided
  // ------------------------------------------------------------------

  function buildMailtoHref(name) {
    const body = name
      ? "I am interested in adopting the " + name + " garden on the Northaven Trail."
      : "I am interested in adopting a garden on the Northaven Trail.";
    return (
      "mailto:" +
      encodeURIComponent(SIGNUP_EMAIL) +
      "?subject=" +
      encodeURIComponent(SIGNUP_SUBJECT) +
      "&body=" +
      encodeURIComponent(body)
    );
  }

  // ------------------------------------------------------------------
  // Extract garden features from the full trail-poi features array
  // Returns { unclaimed: [...], claimed: [...] }
  // ------------------------------------------------------------------

  function extractGardens(features) {
    const unclaimed = [];
    const claimed   = [];

    (features || []).forEach(function (feature) {
      const props = (feature && feature.properties) || {};
      const type  = String(props.t || "");

      if (type !== "gv" && type !== "gc") return;

      const garden = {
        id:   String(feature.id || ""),
        name: gardenName(props),
        road: String(props.r || ""),
        desc: String(props.d || ""),
        link: String(props.f || "")
      };

      if (type === "gv") {
        unclaimed.push(garden);
      } else {
        claimed.push(garden);
      }
    });

    return { unclaimed: unclaimed, claimed: claimed };
  }

  // ------------------------------------------------------------------
  // Render the header block: vacancy summary + CTA button
  // Injected into .ag-header if present on the page
  // ------------------------------------------------------------------

  function renderHeader(headerEl, unclaimedCount, total) {
    const summaryHtml = unclaimedCount === 0
      ? "All <strong>" + total + "</strong> gardens are currently maintained."
      : "<strong>" + unclaimedCount + "</strong> of " + total + " gardens need adoption.";

    headerEl.innerHTML =
      '<div class="ag-header-bar">' +
        '<p class="ag-summary-text">' + summaryHtml + "</p>" +
        '<a class="nt-cta-btn" href="' + escHtml(buildMailtoHref()) + '">Adopt a Garden \u2192</a>' +
      "</div>";
  }

  // ------------------------------------------------------------------
  // Render garden table into container
  // Unclaimed rows first (red highlight), then claimed rows
  // ------------------------------------------------------------------

  function renderTable(container, unclaimed, claimed) {
    const total        = unclaimed.length + claimed.length;
    const unclaimedCnt = unclaimed.length;

    const vacancyBadge = unclaimedCnt > 0
      ? " \u00b7 <span class='ag-vacancy-count'>" +
        unclaimedCnt + (unclaimedCnt === 1 ? " needs adoption" : " need adoption") +
        "</span>"
      : " \u00b7 <span class='ag-fully-planted'>All maintained</span>";

    // Build unclaimed rows
    const unclaimedRows = unclaimed.map(function (g) {
      const mailtoHref = buildMailtoHref(g.name);
      const nameHtml   = escHtml(g.name);
      const roadHtml   = g.road ? "<span class='ag-garden-road'>" + escHtml(g.road) + "</span>" : "";

      return (
        '<tr class="ag-vacant">' +
        '<td data-label="Garden">' +
          "<span class='ag-garden-name'>" + nameHtml + "</span>" +
          roadHtml +
        "</td>" +
        "<td>" +
          "<span class='ag-vacant-label'>Needs Adoption</span>" +
          "<br>" +
          '<a class="ag-signup-link"' +
          ' href="' + escHtml(mailtoHref) + '"' +
          ' aria-label="Adopt the ' + nameHtml + ' garden">' +
          "Sign up to adopt \u2192</a>" +
        "</td>" +
        "</tr>"
      );
    });

    // Build claimed rows
    const claimedRows = claimed.map(function (g) {
      const nameHtml = escHtml(g.name);
      const roadHtml = g.road ? "<span class='ag-garden-road'>" + escHtml(g.road) + "</span>" : "";

      let statusHtml;
      const safeLink = normalizeAbsUrl(g.link);

      if (g.desc && safeLink) {
        statusHtml =
          '<a href="' + escHtml(safeLink) + '" target="_blank" rel="noopener">' +
          escHtml(g.desc) +
          "</a>";
      } else if (g.desc) {
        statusHtml = escHtml(g.desc);
      } else {
        statusHtml = "Maintained";
      }

      return (
        "<tr>" +
        '<td data-label="Garden">' +
          "<span class='ag-garden-name'>" + nameHtml + "</span>" +
          roadHtml +
        "</td>" +
        '<td data-label="Status">' + statusHtml + "</td>" +
        "</tr>"
      );
    });

    container.innerHTML =
      '<div class="ag-wrap">' +
      '<table class="ag-table" aria-label="Northaven Trail Adopt A Garden">' +
      '<caption class="sr-only">Northaven Trail Gardens</caption>' +
      "<thead>" +
      '<tr class="ag-caption-row">' +
      '<th colspan="2" class="ag-caption-cell">' +
        "Gardens \u2014 " + total + " total" + vacancyBadge +
      "</th>" +
      "</tr>" +
      "<tr>" +
      '<th scope="col">Garden</th>' +
      '<th scope="col">Status</th>' +
      "</tr>" +
      "</thead>" +
      "<tbody>" +
      unclaimedRows.join("") +
      claimedRows.join("") +
      "</tbody>" +
      "</table>" +
      "</div>";
  }

  // ------------------------------------------------------------------
  // Main: fetch manifest → data → render header and table
  // ------------------------------------------------------------------

  function init() {
    const containers = document.querySelectorAll(".ag-section");
    const headerEls = document.querySelectorAll(".ag-header");
    if (!containers.length && !headerEls.length) return;

    containers.forEach(function (el) {
      setStatus(el, "Loading garden information\u2026", false);
    });

    const controller = new AbortController();
    const timeoutId  = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);

    fetchJson(MANIFEST_URL, "no-store", controller.signal)
      .then(function (manifest) {
        const dataUrl = String((manifest && manifest.current) || "").trim();
        if (!dataUrl) throw new Error("Manifest missing 'current' URL.");
        return fetchJson(dataUrl, "default", controller.signal);
      })
      .then(function (data) {
        clearTimeout(timeoutId);
        const features = (data && data.features) || [];
        const gardens  = extractGardens(features);
        const total    = gardens.unclaimed.length + gardens.claimed.length;

        // Render header block (summary + CTA) into each matching container.
        headerEls.forEach(function (headerEl) {
          renderHeader(headerEl, gardens.unclaimed.length, total);
        });

        // Render garden table into first .ag-section container when present.
        if (containers[0]) {
          renderTable(containers[0], gardens.unclaimed, gardens.claimed);
        }
      })
      .catch(function (err) {
        clearTimeout(timeoutId);
        if (err.name === "AbortError") {
          logClientEvent("adopt_garden_fetch_timeout", err, {
            phase: "garden_data_fetch",
            manifestUrl: MANIFEST_URL
          });
          containers.forEach(function (el) {
            setStatus(el, "Garden information took too long to load. Please refresh the page to try again.", true);
          });
          return;
        }
        logClientEvent("adopt_garden_fetch_error", err, {
          phase: "garden_data_fetch",
          manifestUrl: MANIFEST_URL
        });
        console.error("[adopt-garden]", err);
        containers.forEach(function (el) {
          if (el.querySelector(".ag-loading")) {
            setStatus(
              el,
              "Unable to load garden information at this time. Please try again later.",
              true
            );
          }
        });
      });
  }

  safeOnReady(init);
})();
