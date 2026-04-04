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

  var MANIFEST_URL =
    "https://assets.northaventrail.org/json/trail-poi.latest.json";
  var SIGNUP_EMAIL = "adoptagarden@northaventrail.org";
  var SIGNUP_SUBJECT = "I would like to adopt a garden on the Northaven Trail";

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function safeOnReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function setStatus(el, msg, isError) {
    el.innerHTML =
      '<p class="' + (isError ? "ag-error" : "ag-loading") + '" role="status" aria-live="polite">' +
      escHtml(msg) + "</p>";
  }

  // ------------------------------------------------------------------
  // Fetch helpers
  // ------------------------------------------------------------------

  function fetchJson(url, cacheMode) {
    return fetch(url, { cache: cacheMode || "default" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status + " fetching " + url);
      return res.json();
    });
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
    var body = name
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
    var unclaimed = [];
    var claimed   = [];

    (features || []).forEach(function (feature) {
      var props = (feature && feature.properties) || {};
      var type  = String(props.t || "");

      if (type !== "gv" && type !== "gc") return;

      var garden = {
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

  function renderHeader(headerEl, unclaimed, total) {
    var summaryHtml = unclaimed === 0
      ? "All <strong>" + total + "</strong> gardens are currently maintained."
      : "<strong>" + unclaimed + "</strong> of " + total + " gardens need adoption.";

    headerEl.innerHTML =
      '<div class="ag-header-bar">' +
        '<p class="ag-summary-text">' + summaryHtml + "</p>" +
        '<a class="ag-cta-btn" href="' + escHtml(buildMailtoHref()) + '">Adopt a Garden \u2192</a>' +
      "</div>";
  }

  // ------------------------------------------------------------------
  // Render garden table into container
  // Unclaimed rows first (red highlight), then claimed rows
  // ------------------------------------------------------------------

  function renderTable(container, unclaimed, claimed) {
    var total        = unclaimed.length + claimed.length;
    var unclaimedCnt = unclaimed.length;

    var vacancyBadge = unclaimedCnt > 0
      ? " \u00b7 <span class='ag-vacancy-count'>" +
        unclaimedCnt + (unclaimedCnt === 1 ? " needs adoption" : " need adoption") +
        "</span>"
      : " \u00b7 <span class='ag-fully-planted'>All maintained</span>";

    // Build unclaimed rows
    var unclaimedRows = unclaimed.map(function (g) {
      var mailtoHref = buildMailtoHref(g.name);
      var nameHtml   = escHtml(g.name);
      var roadHtml   = g.road ? "<span class='ag-garden-road'>" + escHtml(g.road) + "</span>" : "";

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
    var claimedRows = claimed.map(function (g) {
      var nameHtml = escHtml(g.name);
      var roadHtml = g.road ? "<span class='ag-garden-road'>" + escHtml(g.road) + "</span>" : "";

      var statusHtml;
      if (g.desc && g.link) {
        statusHtml =
          '<a href="' + escHtml(g.link) + '" target="_blank" rel="noopener">' +
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
      '<caption class="ag-sr-only">Northaven Trail Gardens</caption>' +
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
    var containers = document.querySelectorAll(".ag-section");
    if (!containers.length) return;

    containers.forEach(function (el) {
      setStatus(el, "Loading garden information\u2026", false);
    });

    fetchJson(MANIFEST_URL, "no-store")
      .then(function (manifest) {
        var dataUrl = String((manifest && manifest.current) || "").trim();
        if (!dataUrl) throw new Error("Manifest missing 'current' URL.");
        return fetchJson(dataUrl, "default");
      })
      .then(function (data) {
        var features = (data && data.features) || [];
        var gardens  = extractGardens(features);
        var total    = gardens.unclaimed.length + gardens.claimed.length;

        // Render header block (summary + CTA) if present
        var headerEl = document.querySelector(".ag-header");
        if (headerEl) {
          renderHeader(headerEl, gardens.unclaimed.length, total);
        }

        // Render garden table into first .ag-section container
        renderTable(containers[0], gardens.unclaimed, gardens.claimed);
      })
      .catch(function (err) {
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
