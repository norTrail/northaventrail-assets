/* ============================================================
   trail-captains.v1.js
   Fetches trail-captains.latest.json manifest, loads the
   versioned data file, and renders one table per section
   into matching .tc-section[data-section] containers.

   Used on: northaventrail.org/trail-captains
   ============================================================ */

(function () {
  "use strict";

  // Dedup guard — safe when all three SquareSpace Code Blocks include this script
  if (window._tcInit) return;
  window._tcInit = true;

  var MANIFEST_URL =
    "https://assets.northaventrail.org/json/trail-captains.latest.json";
  var SIGNUP_EMAIL = "trailcaptainsignup@northaventrail.org";
  var SIGNUP_SUBJECT = "I would like to learn more about being a trail captain";

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
      '<p class="' + (isError ? "tc-error" : "tc-loading") + '" role="status" aria-live="polite">' +
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
  // Build mailto href with pre-filled subject and body
  // ------------------------------------------------------------------

  function buildMailtoHref(sectionLabel) {
    var body =
      "I would like to learn more about being the trail captain for the " +
      sectionLabel +
      " section of the trail.";
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
  // Render one table into a container element
  // ------------------------------------------------------------------

  function renderTable(container, sectionData) {
    var label    = sectionData.label || "";
    var range    = sectionData.range || "";
    var segments = Array.isArray(sectionData.segments) ? sectionData.segments : [];
    var mailtoHref = buildMailtoHref(label);

    var captionText =
      escHtml(label) +
      (range ? " \u2014 " + escHtml(range) : "");

    var rows = segments.map(function (seg) {
      var segName  = String(seg.segment || "");
      var captains = Array.isArray(seg.captains) ? seg.captains : [];
      var isVacant = captains.length === 0;

      if (isVacant) {
        return (
          '<tr class="tc-vacant">' +
          '<td data-label="Trail Segment">' + escHtml(segName) + "</td>" +
          "<td>" +
          '<span class="tc-vacant-label">Captain Needed</span>' +
          '<br><a class="tc-signup-link"' +
          ' href="' + escHtml(mailtoHref) + '"' +
          ' aria-label="Sign up to be Trail Captain for ' + escHtml(segName) + '">' +
          "Sign up to be a Trail Captain</a>" +
          "</td>" +
          "</tr>"
        );
      }

      var captainLabel = captains.length === 1 ? "Trail Captain" : "Trail Captains";
      var captainHtml  = captains.length === 1
        ? escHtml(captains[0])
        : '<ul class="tc-captain-list">' +
          captains.map(function (name) {
            return "<li>" + escHtml(name) + "</li>";
          }).join("") +
          "</ul>";

      return (
        "<tr>" +
        '<td data-label="Trail Segment">' + escHtml(segName) + "</td>" +
        '<td data-label="' + captainLabel + '">' + captainHtml + "</td>" +
        "</tr>"
      );
    });

    container.innerHTML =
      '<div class="tc-wrap">' +
      '<table class="tc-table" aria-label="' + escHtml(label) + ' Trail Captains">' +
      // Visually hidden <caption> kept for screen readers / SEO
      '<caption class="tc-sr-only">' + captionText + "</caption>" +
      "<thead>" +
      // Caption row — sticks together with the column header row as one unit
      '<tr class="tc-caption-row">' +
      '<th colspan="2" class="tc-caption-cell">' + captionText + "</th>" +
      "</tr>" +
      "<tr>" +
      '<th scope="col">Trail Segment</th>' +
      '<th scope="col">Trail Captain(s)</th>' +
      "</tr>" +
      "</thead>" +
      "<tbody>" +
      rows.join("") +
      "</tbody>" +
      "</table>" +
      "</div>";
  }

  // ------------------------------------------------------------------
  // Main: fetch manifest → data → render all section containers
  // ------------------------------------------------------------------

  function init() {
    var containers = document.querySelectorAll(".tc-section[data-section]");
    if (!containers.length) return;

    containers.forEach(function (el) {
      setStatus(el, "Loading trail captains\u2026", false);
    });

    fetchJson(MANIFEST_URL, "no-store")
      .then(function (manifest) {
        var dataUrl = String((manifest && manifest.current) || "").trim();
        if (!dataUrl) throw new Error("Manifest missing 'current' URL.");
        return fetchJson(dataUrl, "default");
      })
      .then(function (data) {
        var sections = (data && data.sections) || {};

        containers.forEach(function (el) {
          var key         = el.getAttribute("data-section");
          var sectionData = sections[key];

          if (!sectionData) {
            setStatus(
              el,
              "Trail captain information is not available for this section right now.",
              true
            );
            return;
          }

          renderTable(el, sectionData);
        });
      })
      .catch(function (err) {
        console.error("[trail-captains]", err);
        containers.forEach(function (el) {
          if (el.querySelector(".tc-loading")) {
            setStatus(
              el,
              "Unable to load trail captain information at this time. Please try again later.",
              true
            );
          }
        });
      });
  }

  safeOnReady(init);
})();
