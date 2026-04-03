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
  // Optionally segment-specific when segmentName is provided
  // ------------------------------------------------------------------

  function buildMailtoHref(sectionLabel, segmentName) {
    var body = segmentName
      ? "I would like to adopt the " + segmentName + " segment in the " + sectionLabel + " section of the trail."
      : "I would like to learn more about becoming a trail captain for the Northaven Trail.";
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
  // Count total and vacant segments across all sections
  // ------------------------------------------------------------------

  function countVacancies(sections) {
    var total = 0, vacant = 0;
    Object.keys(sections).forEach(function (key) {
      var segs = Array.isArray(sections[key].segments) ? sections[key].segments : [];
      total += segs.length;
      segs.forEach(function (seg) {
        if (!seg.captains || seg.captains.length === 0) vacant++;
      });
    });
    return { total: total, vacant: vacant };
  }

  // ------------------------------------------------------------------
  // Render the header block: vacancy summary + CTA + section jump nav
  // Injected into .tc-header if present on the page
  // ------------------------------------------------------------------

  function renderHeader(headerEl, sections, sectionOrder) {
    var counts = countVacancies(sections);

    var summaryHtml = counts.vacant === 0
      ? "All <strong>" + counts.total + "</strong> trail segments are currently staffed."
      : "<strong>" + counts.vacant + "</strong> of " + counts.total + " trail segments need a captain.";

    var navLinks = sectionOrder.map(function (key) {
      var s = sections[key];
      if (!s) return "";
      var segs = Array.isArray(s.segments) ? s.segments : [];
      var hasVacancy = segs.some(function (seg) {
        return !seg.captains || seg.captains.length === 0;
      });
      return (
        '<a class="tc-nav-link' + (hasVacancy ? " tc-nav-link--vacant" : "") + '" href="#tc-' + escHtml(key) + '">' +
        escHtml(s.label) +
        "</a>"
      );
    }).join("");

    headerEl.innerHTML =
      '<div class="tc-header-bar">' +
        '<p class="tc-summary-text">' + summaryHtml + "</p>" +
        '<a class="tc-cta-btn" href="' + escHtml(buildMailtoHref()) + '">Volunteer for a segment \u2192</a>' +
      "</div>" +
      '<nav class="tc-section-nav" aria-label="Jump to trail section">' +
        navLinks +
      "</nav>";
  }

  // ------------------------------------------------------------------
  // Render one table into a container element
  // ------------------------------------------------------------------

  function renderTable(container, sectionData) {
    var label    = sectionData.label || "";
    var range    = sectionData.range || "";
    var segments = Array.isArray(sectionData.segments) ? sectionData.segments : [];

    // Count vacancies for this section
    var vacantCount = segments.filter(function (s) {
      return !s.captains || s.captains.length === 0;
    }).length;

    var captionText =
      escHtml(label) +
      (range ? " \u2014 " + escHtml(range) : "");

    var vacancyBadge = vacantCount > 0
      ? " \u00b7 <span class='tc-vacancy-count'>" + vacantCount + (vacantCount === 1 ? " vacancy" : " vacancies") + "</span>"
      : " \u00b7 <span class='tc-fully-staffed'>Fully staffed</span>";

    var rows = segments.map(function (seg) {
      var segName  = String(seg.segment || "");
      var captains = Array.isArray(seg.captains) ? seg.captains : [];
      var isVacant = captains.length === 0;

      if (isVacant) {
        var mailtoHref = buildMailtoHref(label, segName);
        return (
          '<tr class="tc-vacant">' +
          '<td data-label="Trail Segment">' + escHtml(segName) + "</td>" +
          "<td>" +
          '<span class="tc-vacant-label">Captain Needed</span>' +
          '<br><a class="tc-signup-link"' +
          ' href="' + escHtml(mailtoHref) + '"' +
          ' aria-label="Adopt the ' + escHtml(segName) + ' segment as Trail Captain">' +
          "Adopt this segment \u2192</a>" +
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
      '<th colspan="2" class="tc-caption-cell">' + captionText + vacancyBadge + "</th>" +
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

        // Collect section order from DOM for the jump nav
        var sectionOrder = [];
        containers.forEach(function (el) {
          var key = el.getAttribute("data-section");
          if (key) sectionOrder.push(key);
        });

        // Render header block (summary + CTA + jump nav) if present
        var headerEl = document.querySelector(".tc-header");
        if (headerEl) {
          renderHeader(headerEl, sections, sectionOrder);
        }

        // Render each section table and set anchor ID for jump nav
        containers.forEach(function (el) {
          var key         = el.getAttribute("data-section");
          var sectionData = sections[key];

          // Add anchor ID to the preceding H2 so jump nav lands above the table.
          // The .tc-section is nested inside a Squarespace .sqs-block wrapper, so
          // walk up to that block first, then search preceding sibling blocks for an H2.
          var anchorTarget = el;
          var blockAncestor = el.parentElement;
          while (blockAncestor && !blockAncestor.classList.contains("sqs-block")) {
            blockAncestor = blockAncestor.parentElement;
          }
          if (blockAncestor) {
            var prev = blockAncestor.previousElementSibling;
            while (prev) {
              var h2 = prev.tagName === "H2" ? prev : prev.querySelector("h2");
              if (h2) {
                anchorTarget = h2;
                break;
              }
              prev = prev.previousElementSibling;
            }
          }
          anchorTarget.id = "tc-" + key;

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

        // If the URL has a hash, the browser already tried to scroll before IDs
        // were assigned. Now that all anchor IDs are in place, scroll there manually.
        if (window.location.hash) {
          var hashTarget = document.getElementById(window.location.hash.slice(1));
          if (hashTarget) {
            hashTarget.scrollIntoView();
          }
        }
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
