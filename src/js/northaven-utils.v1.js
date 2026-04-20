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
      const parsedUrl = new URL(value, window.location.href);
      const allowedProtocols = new Set(["http:", "https:", "mailto:", "tel:"]);
      return allowedProtocols.has(parsedUrl.protocol) ? parsedUrl.toString() : "";
    } catch {
      return "";
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
    // New POI feeds may store repo image filenames in `m` instead of Drive IDs.
    if (/[./\s]/.test(value) && !/^(https?:)?\/\//i.test(value)) {
      return normalizeSquarespaceAssetUrl(value);
    }
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

        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, "image/svg+xml");
        const svgElement = doc.querySelector("svg");

        if (!svgElement) throw new Error("Could not parse SVG content");
        if (svgElement.querySelector("script")) throw new Error("Malicious script detected in SVG");

        const wrapper = document.createElement("div");
        wrapper.id = id;
        wrapper.setAttribute("aria-hidden", "true");
        wrapper.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
        wrapper.appendChild(svgElement);
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

  function replaceObserver(target, key, setup) {
    if (!target || !window.MutationObserver) return null;
    try {
      target[key]?.disconnect?.();
    } catch (_) { }
    const observer = setup();
    target[key] = observer;
    return observer;
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
        replaceObserver(mount, "__ntSkipLinkObserver", () => {
          const observer = new MutationObserver(ensureInDom);
          observer.observe(mount, { childList: true });
          return observer;
        });
      }
    });
  }

  function patchSquarespaceA11y() {
    withBody(() => {
      function deriveRegionLabel(container, fallbackLabel) {
        const heading = container?.querySelector?.("h1, h2, h3, h4, h5, h6");
        const text = String(heading?.textContent || "").trim();
        return text || fallbackLabel;
      }

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
        if (skipMain && !skipMain.parentElement?.hasAttribute("data-nt-skip-main-wrapper")) {
          const wrapper = document.createElement("div");
          wrapper.setAttribute("data-nt-skip-main-wrapper", "true");
          skipMain.parentNode.insertBefore(wrapper, skipMain);
          wrapper.appendChild(skipMain);
        }

        const main = document.querySelector("main, [role='main']");
        if (!main) {
          const content = document.getElementById("content");
          if (content) content.setAttribute("role", "main");
        }

        const backToTopNav = document.querySelector(".back-to-top-nav > nav");
        if (backToTopNav && !backToTopNav.getAttribute("aria-label")) {
          backToTopNav.setAttribute("aria-label", "Back to top");
        }

        const content = document.getElementById("content");
        if (content && !content.hasAttribute("aria-label")) {
          content.setAttribute("aria-label", deriveRegionLabel(content, "Page content"));
        }
        if (content && !content.hasAttribute("role")) {
          content.setAttribute("role", "region");
        }

        document.querySelectorAll("#content > .sqs-layout, main[role='main'] > .sqs-layout").forEach((section, index) => {
          if (!section.hasAttribute("role")) {
            section.setAttribute("role", "region");
          }
          if (!section.hasAttribute("aria-label")) {
            section.setAttribute("aria-label", deriveRegionLabel(section, `Content section ${index + 1}`));
          }
        });

        document.querySelectorAll(".skip-main").forEach((link) => {
          link.classList.add("skip-link");
        });

        document.querySelectorAll(".sr-only-map-image[aria-hidden='true']").forEach((el) => {
          el.removeAttribute("aria-hidden");
        });
      }

      applyPatches();
      if (window.MutationObserver) {
        replaceObserver(document.body, "__ntSquarespaceA11yObserver", () => {
          const observer = new MutationObserver(applyPatches);
          observer.observe(document.body, { childList: true, subtree: false });
          return observer;
        });
      }
    });
  }

  function fixNewWindowAriaLabels() {
    withBody(() => {
      function patchLinks() {
        document.querySelectorAll('a[aria-label="Link opens in a new window"]').forEach((anchor) => {
          const label = anchor.textContent.trim();
          if (label) {
            anchor.setAttribute("aria-label", `${label} (opens in a new window)`);
          } else {
            anchor.removeAttribute("aria-label");
          }
        });
      }
      patchLinks();
      if (window.MutationObserver) {
        replaceObserver(document.body, "__ntNewWindowAriaObserver", () => {
          const observer = new MutationObserver(patchLinks);
          observer.observe(document.body, { childList: true, subtree: true });
          return observer;
        });
      }
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

  function isApple() {
    // navigator.platform is deprecated; prefer userAgentData when available.
    const platform = navigator.userAgentData?.platform || navigator.platform || "";
    return /(Mac|iPhone|iPad|iPod)/i.test(platform) ||
      /(Mac|iPhone|iPad|iPod)/i.test(navigator.userAgent);
  }

  function isMobile() {
    return /(iPhone|Android|BlackBerry|Windows Phone)/i.test(navigator.userAgent);
  }

  function fetchJson(url, options = {}) {
    const { cache = "default", signal = null } = options;
    return fetch(url, { cache, signal }).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
      return res.json();
    });
  }

  function normalizeSquarespaceAssetUrl(url) {
    const s = String(url || "").trim();
    if (!s) return "";
    if (/^(https?:)?\/\//i.test(s) || s.startsWith("/")) return s;
    return new URL(`img/${s}`, "https://assets.northaventrail.org/").toString();
  }

  // Returns the ordered, deduplicated set of data URLs from a manifest object.
  // Tries manifest.current → manifest.fallback → manifest.previous.
  // Used by page scripts that fetch versioned trail-poi / tails data files.
  function getManifestDataUrls(manifest) {
    return [...new Set(
      [manifest?.current, manifest?.fallback, manifest?.previous]
        .map((v) => String(v || "").trim())
        .filter(Boolean)
    )];
  }

  // Returns a logClientEvent function scoped to the given app name.
  // Usage: const logClientEvent = NorthavenUtils.makeLogClientEvent("adoptgarden");
  function makeLogClientEvent(appName) {
    return function (kind, err, details) {
      window.TrailmapError?.logClientEvent?.({
        kind,
        app: appName,
        message: String(err?.message || err || ""),
        stack: err?.stack || null,
        ...details
      });
    };
  }

  function formatDateISO(iso, options) {
    if (!iso) return "";
    try {
      const [y, m, d] = iso.split("-").map(Number);
      return new Date(y, m - 1, d).toLocaleDateString("en-US", options);
    } catch {
      return "";
    }
  }

  function formatDateISOLong(iso) {
    return formatDateISO(iso, { weekday: "long", month: "long", day: "numeric" });
  }

  function to12Hour(h) {
    const n = Number(h) % 12;
    return n === 0 ? 12 : n;
  }

  function amPm(h) {
    return Number(h) >= 12 ? "pm" : "am";
  }

  function clickShare(options = {}) {
    const {
      title = "Northaven Trail",
      text = "",
      url = window.location.href
    } = options;

    if (!navigator.share) return;
    navigator.share({
      title: String(title),
      text: String(text),
      url: String(url)
    }).catch((err) => {
      if (err.name !== "AbortError") {
        console.warn("Share failed:", err);
      }
    });
  }

  const focusModality = {
    keyboardAt: 0,
    pointerAt: 0
  };

  const _navigationKeys = new Set([
    "Tab", "Enter", " ", "Spacebar",
    "ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"
  ]);

  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.altKey || event.ctrlKey) return;
    if (_navigationKeys.has(event.key)) focusModality.keyboardAt = Date.now();
  }, true);

  ["pointerdown", "mousedown", "touchstart"].forEach((eventName) => {
    document.addEventListener(eventName, () => {
      focusModality.pointerAt = Date.now();
    }, true);
  });

  function shouldFocusPopupForA11y(options = {}) {
    const {
      pointerGraceMs = 700,
      keyboardGraceMs = 5000
    } = options;
    const now = Date.now();

    if (focusModality.keyboardAt > focusModality.pointerAt) {
      return now - focusModality.keyboardAt <= keyboardGraceMs;
    }

    return now - focusModality.pointerAt > pointerGraceMs;
  }

  function generate911SignSvg(ntCode) {
    const key = String(ntCode || "").trim();
    const label = escapeHtmlAttr(key);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="47" fill="white"/>
      <path d="M 3,50 A 47,47 0 0,1 97,50 Z" fill="#1a7a3a"/>
      <circle cx="50" cy="50" r="47" fill="none" stroke="#1a7a3a" stroke-width="4"/>
      <line x1="3" y1="50" x2="97" y2="50" stroke="#1a7a3a" stroke-width="2"/>
      <text x="50" y="20" text-anchor="middle" fill="white" font-family="Arial,Helvetica,sans-serif" font-size="11" font-weight="bold">Your</text>
      <text x="50" y="38" text-anchor="middle" fill="white" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="900">911</text>
      <text x="50" y="48" text-anchor="middle" fill="white" font-family="Arial,Helvetica,sans-serif" font-size="9.5">location is</text>
      <text x="50" y="76" text-anchor="middle" fill="#1a7a3a" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="bold">${label}</text>
    </svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function focusFirstPopupElement(popupOrElement, options = {}) {
    const {
      selector = ".mapboxgl-popup-close-button, a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])",
      preventScroll = true,
      delay = 50
    } = options;

    if (!shouldFocusPopupForA11y(options)) return;

    window.setTimeout(() => {
      const popupEl = typeof popupOrElement?.getElement === "function"
        ? popupOrElement.getElement()
        : popupOrElement;
      const focusTarget = popupEl?.querySelector?.(selector);
      focusTarget?.focus?.({ preventScroll });
    }, delay);
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
    ensureSrOnlyHeading,
    isApple,
    isMobile,
    fetchJson,
    normalizeSquarespaceAssetUrl,
    getManifestDataUrls,
    makeLogClientEvent,
    formatDateISO,
    formatDateISOLong,
    to12Hour,
    amPm,
    clickShare,
    shouldFocusPopupForA11y,
    generate911SignSvg,
    focusFirstPopupElement
  });
})(window, document);
