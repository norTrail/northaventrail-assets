/* ============================================================
   northaven-utils.v1.js
   Shared accessibility and Squarespace helpers for Northaven Trail pages.
   Load this script before page-specific scripts that call NorthavenUtils.
   ============================================================ */

(function initNorthavenUtils(window, document) {
  "use strict";

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
      return;
    }
    callback();
  }

  function withBody(callback) {
    onReady(() => {
      if (document.body) {
        callback();
        return;
      }
      setTimeout(() => withBody(callback), 20);
    });
  }

  function ensureSkipLink(options = {}) {
    const {
      id = "nt-skip-link",
      target = "#main",
      label = "Skip to Main",
      className = "skip-link",
      container = "body",
      observe = true
    } = options;

    withBody(() => {
      const parent = typeof container === "string"
        ? document.querySelector(container)
        : container;
      const mount = parent || document.body;

      function ensureInDom() {
        let skipLink = document.getElementById(id);
        if (!skipLink) {
          skipLink =
            document.querySelector(`.${className}[data-nt-skip-link="true"]`) ||
            document.querySelector(`.${className}`);
        }

        if (!skipLink) {
          skipLink = document.createElement("a");
          skipLink.id = id;
          skipLink.className = className;
          skipLink.setAttribute("data-nt-skip-link", "true");
        }

        skipLink.href = target;
        skipLink.textContent = label;

        if (mount.firstElementChild !== skipLink) {
          mount.insertAdjacentElement("afterbegin", skipLink);
        }
      }

      ensureInDom();
      if (observe && window.MutationObserver) {
        const observer = new MutationObserver(ensureInDom);
        observer.observe(mount, { childList: true });
      }
    });
  }

  function patchSquarespaceA11y() {
    withBody(() => {
      function applyPatches() {
        const mainNav = document.querySelector("#mainNavigation");
        if (mainNav && !mainNav.getAttribute("aria-label")) {
          mainNav.setAttribute("aria-label", "Main navigation");
        }

        const iconNav = document.querySelector("nav.sqs-svg-icon--list");
        if (iconNav && !iconNav.getAttribute("aria-label")) {
          iconNav.setAttribute("aria-label", "Social links");
        }

        const skipMain = document.querySelector(".skip-main");
        if (skipMain && skipMain.parentElement?.tagName !== "HEADER") {
          const wrapper = document.createElement("header");
          wrapper.setAttribute("aria-label", "Skip navigation");
          skipMain.parentNode.insertBefore(wrapper, skipMain);
          wrapper.appendChild(skipMain);
        }

        if (!document.querySelector("main, [role='main']")) {
          const content = document.getElementById("content");
          if (content) content.setAttribute("role", "main");
        }

        document.querySelectorAll(".sr-only-map-image[aria-hidden='true']").forEach((el) => {
          el.removeAttribute("aria-hidden");
        });
      }

      applyPatches();
      if (window.MutationObserver) {
        const observer = new MutationObserver(applyPatches);
        observer.observe(document.body, { childList: true, subtree: false });
      }
    });
  }

  function fixNewWindowAriaLabels() {
    withBody(() => {
      document.querySelectorAll('a[aria-label="Link opens in a new window"]').forEach((anchor) => {
        const label = anchor.textContent.trim();
        if (label) {
          anchor.setAttribute("aria-label", `${label} (opens in a new window)`);
        } else {
          anchor.removeAttribute("aria-label");
        }
      });
    });
  }

  function labelUntitledIframes(options = {}) {
    const { suffix = "Video" } = options;
    const pageTitle = document.title || "Northaven Trail";
    document.querySelectorAll("iframe:not([title])").forEach((iframe) => {
      iframe.setAttribute("title", `${pageTitle} ${suffix}`);
    });
  }

  function ensureSrOnlyHeading(options = {}) {
    const {
      text,
      container = "body",
      selector = "h1",
      className = "sr-only"
    } = options;

    if (!text) return;
    withBody(() => {
      if (document.querySelector(selector)) return;
      const parent = typeof container === "string"
        ? document.querySelector(container)
        : container;
      const mount = parent || document.body;
      const heading = document.createElement("h1");
      heading.className = className;
      heading.textContent = text;
      mount.prepend(heading);
    });
  }

  window.NorthavenUtils = Object.assign(window.NorthavenUtils || {}, {
    ensureSkipLink,
    patchSquarespaceA11y,
    fixNewWindowAriaLabels,
    labelUntitledIframes,
    ensureSrOnlyHeading
  });
})(window, document);
