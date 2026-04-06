/* ============================================================
   adopt-garden.v1.js
   Fetches trail-poi.latest.json, renders the Adopt A Garden
   summary CTA, and decorates the existing trailmap-listing
   table so unclaimed gardens get stronger calls to action
   without losing row activation or Maps links.

   Used on: northaventrail.org/adoptgarden
   ============================================================ */

(function () {
  "use strict";

  if (window._agInit) return;
  window._agInit = true;

  var MANIFEST_URL = "https://assets.northaventrail.org/json/trail-poi.latest.json";
  var SIGNUP_EMAIL = "adoptagarden@northaventrail.org";
  var SIGNUP_SUBJECT = "I would like to adopt a garden on the Northaven Trail";
  var TABLE_SELECTOR = ".listing-table, .poi-table";
  var MAX_DECORATE_ATTEMPTS = 30;
  var DECORATE_RETRY_MS = 300;

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

  function fetchJson(url, cacheMode) {
    return fetch(url, { cache: cacheMode || "default" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status + " fetching " + url);
      return res.json();
    });
  }

  function gardenName(props) {
    return String(props.l || props.n || "");
  }

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

  function extractGardens(features) {
    var unclaimed = [];
    var claimed = [];

    (features || []).forEach(function (feature) {
      var props = (feature && feature.properties) || {};
      var type = String(props.t || "");
      if (type !== "gv" && type !== "gc") return;

      var garden = {
        id: String(feature.id || ""),
        type: type,
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

  function renderHeader(headerEl, unclaimed, total) {
    var summaryHtml = unclaimed === 0
      ? "All <strong>" + total + "</strong> gardens are currently maintained. Email us if you would like to help with future garden care."
      : "<strong>" + unclaimed + "</strong> " + (unclaimed === 1 ? "garden needs" : "gardens need") + " adoption. Pick a garden below or email us and we\u2019ll help match you.";

    headerEl.innerHTML =
      '<div class="ag-header-bar">' +
        '<p class="ag-summary-text">' + summaryHtml + "</p>" +
        '<a class="ag-cta-btn" href="' + escHtml(buildMailtoHref()) + '">Email us to adopt \u2192</a>' +
      "</div>";
  }

  function renderFallbackTable(container, unclaimed, claimed) {
    var total = unclaimed.length + claimed.length;
    var unclaimedCnt = unclaimed.length;

    var vacancyBadge = unclaimedCnt > 0
      ? " \u00b7 <span class='ag-vacancy-count'>" +
        unclaimedCnt + (unclaimedCnt === 1 ? " needs adoption" : " need adoption") +
        "</span>"
      : " \u00b7 <span class='ag-fully-planted'>All maintained</span>";

    var unclaimedRows = unclaimed.map(function (g) {
      var mailtoHref = buildMailtoHref(g.name);
      var nameHtml = escHtml(g.name);
      var roadHtml = g.road ? "<span class='ag-garden-road'>" + escHtml(g.road) + "</span>" : "";

      return (
        '<tr class="ag-vacant">' +
          '<td data-label="Garden">' +
            "<span class='ag-garden-name'>" + nameHtml + "</span>" +
            roadHtml +
          "</td>" +
          '<td data-label="Status">' +
            "<span class='ag-vacant-label'>Needs Adoption</span><br>" +
            '<a class="ag-signup-link" href="' + escHtml(mailtoHref) + '" aria-label="Adopt the ' + nameHtml + ' garden">' +
              "Sign up to adopt \u2192" +
            "</a>" +
          "</td>" +
        "</tr>"
      );
    });

    var claimedRows = claimed.map(function (g) {
      var nameHtml = escHtml(g.name);
      var roadHtml = g.road ? "<span class='ag-garden-road'>" + escHtml(g.road) + "</span>" : "";
      var statusHtml;

      if (g.desc && g.link) {
        statusHtml = '<a href="' + escHtml(g.link) + '" target="_blank" rel="noopener">' + escHtml(g.desc) + "</a>";
      } else if (g.desc) {
        statusHtml = escHtml(g.desc);
      } else {
        statusHtml = "Maintained";
      }

      return (
        '<tr class="ag-claimed">' +
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
              '<th colspan="2" class="ag-caption-cell">Gardens \u2014 ' + total + " total" + vacancyBadge + "</th>" +
            "</tr>" +
            "<tr><th scope='col'>Garden</th><th scope='col'>Status</th></tr>" +
          "</thead>" +
          "<tbody>" + unclaimedRows.join("") + claimedRows.join("") + "</tbody>" +
        "</table>" +
      "</div>";
  }

  function clearLegacyContainers() {
    Array.prototype.slice.call(document.querySelectorAll(".ag-section")).forEach(function (container) {
      if (container.querySelector(".ag-loading, .ag-error")) {
        container.innerHTML = "";
      }
    });
  }

  function findListingTable() {
    return document.querySelector(TABLE_SELECTOR);
  }

  function findListingRows(table) {
    return Array.prototype.slice.call(
      (table || document).querySelectorAll("tbody tr[data-feature-id]")
    );
  }

  function upsertTag(firstCell, className, text) {
    if (!firstCell) return;
    var classList = String(className || "").trim().split(/\s+/).filter(Boolean);
    var selector = classList.length ? "." + classList.join(".") : "";
    var tag = selector ? firstCell.querySelector(selector) : null;
    if (!tag) {
      tag = document.createElement("span");
      tag.className = className;
      firstCell.appendChild(tag);
    }
    tag.textContent = text;
  }

  function upsertRowCta(firstCell, garden) {
    if (!firstCell) return;
    var wrap = firstCell.querySelector(".ag-row-cta");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "ag-row-cta";
      firstCell.appendChild(wrap);
    }
    wrap.innerHTML =
      '<span class="ag-row-cta-copy">This garden is available now.</span>' +
      '<a class="ag-signup-link" href="' + escHtml(buildMailtoHref(garden.name)) + '" aria-label="Adopt the ' + escHtml(garden.name) + ' garden">Adopt this garden \u2192</a>';
  }

  function upsertClaimedNote(firstCell, garden) {
    if (!firstCell || !garden.desc) return;
    var note = firstCell.querySelector(".ag-row-note");
    if (!note) {
      note = document.createElement("div");
      note.className = "ag-row-note";
      firstCell.appendChild(note);
    }

    if (garden.link) {
      note.innerHTML = '<a href="' + escHtml(garden.link) + '" target="_blank" rel="noopener">' + escHtml(garden.desc) + "</a>";
    } else {
      note.textContent = garden.desc;
    }
  }

  function decorateListingTable(table, gardens) {
    if (!table) return false;

    var rows = findListingRows(table);
    if (!rows.length) return false;

    var byId = {};
    gardens.unclaimed.concat(gardens.claimed).forEach(function (garden) {
      if (garden.id) byId[garden.id] = garden;
    });

    var matchedCount = 0;
    rows.forEach(function (row) {
      var garden = byId[String(row.dataset.featureId || "")];
      if (!garden) return;

      matchedCount += 1;
      row.classList.add("ag-garden-row");
      row.classList.remove("ag-vacant", "ag-claimed");

      var firstCell = row.querySelector("td");
      if (!firstCell) return;

      if (garden.type === "gv") {
        row.classList.add("ag-vacant");
        upsertTag(firstCell, "ag-status-pill ag-status-pill--vacant", "Needs Adoption");
        upsertRowCta(firstCell, garden);
      } else {
        row.classList.add("ag-claimed");
        upsertTag(firstCell, "ag-status-pill ag-status-pill--claimed", "Maintained");
        upsertClaimedNote(firstCell, garden);
      }
    });

    return matchedCount > 0;
  }

  function decorateOrFallback(gardens, attempt) {
    var table = findListingTable();
    if (table && decorateListingTable(table, gardens)) {
      clearLegacyContainers();
      return;
    }

    if ((attempt || 0) < MAX_DECORATE_ATTEMPTS) {
      window.setTimeout(function () {
        decorateOrFallback(gardens, (attempt || 0) + 1);
      }, DECORATE_RETRY_MS);
      return;
    }

    var containers = document.querySelectorAll(".ag-section");
    if (containers.length) {
      renderFallbackTable(containers[0], gardens.unclaimed, gardens.claimed);
    }
  }

  function init() {
    var containers = document.querySelectorAll(".ag-section");
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
        var gardens = extractGardens(features);
        var total = gardens.unclaimed.length + gardens.claimed.length;

        var headerEl = document.querySelector(".ag-header");
        if (headerEl) {
          renderHeader(headerEl, gardens.unclaimed.length, total);
        }

        decorateOrFallback(gardens, 0);
      })
      .catch(function (err) {
        console.error("[adopt-garden]", err);
        containers.forEach(function (el) {
          if (el.querySelector(".ag-loading")) {
            setStatus(el, "Unable to load garden information at this time. Please try again later.", true);
          }
        });
      });
  }

  safeOnReady(init);
})();
