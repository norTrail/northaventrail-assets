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

  function escapeHtml(value) {
    let str = String(value ?? "");
    // Treat literal &nbsp; as intended spacing before escaping the string.
    str = str.replace(/&nbsp;/g, "\u00A0");
    return str.replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function escapeHtmlAttr(value) {
    return escapeHtml(value);
  }

  function normalizeAbsUrl(url) {
    const value = String(url || "").trim();
    if (!value) return "";
    try {
      return new URL(value, window.location.href).toString();
    } catch {
      return value;
    }
  }

  function isSamePageUrl(url) {
    try {
      const parsedUrl = new URL(String(url || ""), window.location.href);
      const currentUrl = new URL(window.location.href);
      return (
        parsedUrl.origin === currentUrl.origin &&
        parsedUrl.pathname.replace(/\/+$/, "") === currentUrl.pathname.replace(/\/+$/, "")
      );
    } catch {
      return false;
    }
  }

  function isExternalDomain(url) {
    try {
      const parsedUrl = new URL(String(url || ""), window.location.href);
      return parsedUrl.origin !== window.location.origin;
    } catch {
      return false;
    }
  }

  function driveThumbFromId(id, width = 400) {
    const value = String(id || "").trim();
    if (!value) return "";
    const match =
      value.match(/(?:id=)([a-zA-Z0-9_-]{10,})/) ||
      value.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    const driveId = match ? match[1] : value;
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveId)}&sz=w${Number(width) || 400}`;
  }

  function loadSvgSpriteOnce(options = {}) {
    const {
      url = "https://assets.northaventrail.org/img/icons.svg",
      id = "svg-sprite-inline",
      onError = null
    } = options;

    if (document.getElementById(id)) return Promise.resolve();
    if (!document.body) {
      return new Promise((resolve) => {
        withBody(() => resolve(loadSvgSpriteOnce(options)));
      });
    }

    return fetch(url, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`SVG sprite fetch failed: ${response.status}`);
        return response.text();
      })
      .then((svgText) => {
        if (document.getElementById(id)) return;
        const wrapper = document.createElement("div");
        wrapper.id = id;
        wrapper.setAttribute("aria-hidden", "true");
        wrapper.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
        wrapper.innerHTML = svgText;
        document.body.insertAdjacentElement("afterbegin", wrapper);
      })
      .catch((error) => {
        console.warn("Could not load SVG sprite:", error);
        if (typeof onError === "function") onError(error);
      });
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
    onReady,
    escapeHtml,
    escapeHtmlAttr,
    normalizeAbsUrl,
    isSamePageUrl,
    isExternalDomain,
    driveThumbFromId,
    loadSvgSpriteOnce,
    ensureSkipLink,
    patchSquarespaceA11y,
    fixNewWindowAriaLabels,
    labelUntitledIframes,
    ensureSrOnlyHeading
  });
})(window, document);
