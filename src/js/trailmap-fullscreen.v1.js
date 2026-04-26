// trailmap-fullscreen.js
(function () {
  const safeViewportRuntime = window.__trailmapSafeViewportRuntime || {
    refCount: 0,
    attached: false,
    onOrientationChange: null
  };
  window.__trailmapSafeViewportRuntime = safeViewportRuntime;

  // -------- Safe viewport vars (iOS Safari friendly) --------
  function updateSafeViewport() {
    let safeBottom = 0;
    let safeTop = 0;
    let visibleHeightPx = window.innerHeight;

    if (window.visualViewport) {
      const vv = window.visualViewport;

      safeTop = Math.max(0, Math.round(vv.offsetTop));
      safeBottom = Math.max(
        0,
        Math.round(window.innerHeight - (vv.height + vv.offsetTop))
      );

      visibleHeightPx = Math.round(vv.height);
    }

    document.documentElement.style.setProperty("--safe-top", `${safeTop}px`);
    document.documentElement.style.setProperty("--safe-bottom", `${safeBottom}px`);
    document.documentElement.style.setProperty("--vvh", `${visibleHeightPx}px`);

    const topADAUiHeight =
      typeof FULL_SCREEN_TOP_ADA_TEXT === "boolean" && FULL_SCREEN_TOP_ADA_TEXT
        ? "56px"
        : "0px";
    document.documentElement.style.setProperty("--ada-height", topADAUiHeight);

    const bottomUiHeight =
      typeof FULL_SCREEN_BOTTOM_BUTTONS === "boolean" && FULL_SCREEN_BOTTOM_BUTTONS
        ? "70px"
        : "0px";
    document.documentElement.style.setProperty("--bottom-ui-height", bottomUiHeight);
  }

  function attachSafeViewportListenersOnce() {
    safeViewportRuntime.refCount += 1;
    if (safeViewportRuntime.attached) {
      updateSafeViewport();
      return;
    }
    safeViewportRuntime.attached = true;

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", updateSafeViewport, { passive: true });
      window.visualViewport.addEventListener("scroll", updateSafeViewport, { passive: true });
    }

    safeViewportRuntime.onOrientationChange = () => {
      setTimeout(updateSafeViewport, 300);
    };
    window.addEventListener("orientationchange", safeViewportRuntime.onOrientationChange);

    updateSafeViewport();
  }

  function detachSafeViewportListeners() {
    if (safeViewportRuntime.refCount > 0) {
      safeViewportRuntime.refCount -= 1;
    }
    if (safeViewportRuntime.refCount > 0 || !safeViewportRuntime.attached) return;

    if (window.visualViewport) {
      window.visualViewport.removeEventListener("resize", updateSafeViewport);
      window.visualViewport.removeEventListener("scroll", updateSafeViewport);
    }

    if (safeViewportRuntime.onOrientationChange) {
      window.removeEventListener("orientationchange", safeViewportRuntime.onOrientationChange);
      safeViewportRuntime.onOrientationChange = null;
    }

    safeViewportRuntime.attached = false;
  }

  // -------- Mapbox control: toggles CSS fullscreen --------
  class FullscreenMapControl {
    constructor(opts = {}) {
      this._map = null;
      this._container = null;
      this._btn = null;
      this._iconUse = null;
      this._isFullscreen = false;
      this._postToggleFrameA = null;
      this._postToggleFrameB = null;

      // configurable IDs/classes so this works across maps
      this._opts = {
        mapViewId: opts.mapViewId || "mapView",
        appRootId: opts.appRootId || "map-app", // can be overridden "tails-app"
        tableViewId: opts.tableViewId !== undefined ? opts.tableViewId : "tableView", // null = disabled, omit = default "tableView"
        bodyClass: opts.bodyClass || "is-map-fullscreen",
        fullscreenClass: opts.fullscreenClass || "is-fullscreen",

        // optional hook: integrate your gesture control rules, etc.
        onToggle: typeof opts.onToggle === "function" ? opts.onToggle : null,

        // optional: if you use SVG <use> icons like you do now
        iconEnter: opts.iconEnter || "#icon-fullscreen-enter",
        iconExit: opts.iconExit || "#icon-fullscreen-exit",

        ariaLabelEnter: opts.ariaLabelEnter || "Enter fullscreen",
        ariaLabelExit: opts.ariaLabelExit || "Exit fullscreen",
        titleEnter: opts.titleEnter || "Enter fullscreen",
        titleExit: opts.titleExit || "Exit fullscreen",
      };

      this._onKeyDown = this._onKeyDown.bind(this);
    }

    onAdd(map) {
      this._map = map;

      attachSafeViewportListenersOnce();

      this._container = document.createElement("div");
      this._container.className = "mapboxgl-ctrl mapboxgl-ctrl-group";

      this._btn = document.createElement("button");
      this._btn.type = "button";
      this._updateButtonLabels(false);
      this._mountIcon();
      this._renderIcon(false);

      this._btn.addEventListener("click", () => {
        this.setFullscreen(!this._isFullscreen);
      });

      this._container.appendChild(this._btn);

      document.addEventListener("keydown", this._onKeyDown);

      return this._container;
    }

    onRemove() {
      // If removed while fullscreen, clean up lingering CSS classes
      if (this._isFullscreen) {
        document.getElementById(this._opts.mapViewId)?.classList.remove(this._opts.fullscreenClass);
        document.getElementById(this._opts.appRootId)?.classList.remove(this._opts.fullscreenClass);
        if (this._opts.tableViewId) document.getElementById(this._opts.tableViewId)?.classList.remove(this._opts.fullscreenClass);
        document.body.classList.remove(this._opts.bodyClass);
        this._isFullscreen = false;
      }

      document.removeEventListener("keydown", this._onKeyDown);
      detachSafeViewportListeners();

      if (this._postToggleFrameA !== null) {
        cancelAnimationFrame(this._postToggleFrameA);
        this._postToggleFrameA = null;
      }
      if (this._postToggleFrameB !== null) {
        cancelAnimationFrame(this._postToggleFrameB);
        this._postToggleFrameB = null;
      }

      this._container?.remove();

      this._map = null;
    }

    _onKeyDown(e) {
      if (e.key === "Escape" && this._isFullscreen) {
        this.setFullscreen(false);
      }
    }

    _mountIcon() {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "22");
      svg.setAttribute("height", "22");
      svg.setAttribute("aria-hidden", "true");

      this._iconUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
      svg.appendChild(this._iconUse);
      this._btn.appendChild(svg);
    }

    _renderIcon(isFs) {
      const iconId = isFs ? this._opts.iconExit : this._opts.iconEnter;
      if (this._iconUse) {
        this._iconUse.setAttribute("href", iconId);
      }
    }

    _updateButtonLabels(isFs) {
      const label = isFs ? (this._opts.ariaLabelExit || "Exit fullscreen") : (this._opts.ariaLabelEnter || "Enter fullscreen");
      const title = isFs ? this._opts.titleExit : this._opts.titleEnter;

      // Tooltip
      this._btn.setAttribute("title", title);

      // Accessibility
      this._btn.setAttribute("aria-label", label);
      this._btn.setAttribute("aria-pressed", String(isFs));
    }

    setFullscreen(enable) {
      this._isFullscreen = Boolean(enable);

      const mapView = document.getElementById(this._opts.mapViewId);
      if (!mapView) return;

      const appRoot = document.getElementById(this._opts.appRootId);
      const tableView = this._opts.tableViewId
        ? document.getElementById(this._opts.tableViewId)
        : null;

      // toggle classes
      mapView.classList.toggle(this._opts.fullscreenClass, this._isFullscreen);
      if (tableView) tableView.classList.toggle(this._opts.fullscreenClass, this._isFullscreen);
      if (appRoot) appRoot.classList.toggle(this._opts.fullscreenClass, this._isFullscreen);
      document.body.classList.toggle(this._opts.bodyClass, this._isFullscreen);

      this._updateButtonLabels(this._isFullscreen);
      this._renderIcon(this._isFullscreen);

      if (this._postToggleFrameA !== null) {
        cancelAnimationFrame(this._postToggleFrameA);
        this._postToggleFrameA = null;
      }
      if (this._postToggleFrameB !== null) {
        cancelAnimationFrame(this._postToggleFrameB);
        this._postToggleFrameB = null;
      }

      // Let fullscreen class/style changes land, then update viewport vars,
      // then wait one more frame before any geometry reads.
      this._postToggleFrameA = requestAnimationFrame(() => {
        this._postToggleFrameA = null;
        updateSafeViewport();

        this._postToggleFrameB = requestAnimationFrame(() => {
          this._postToggleFrameB = null;

          if (this._opts.onToggle) {
            try { this._opts.onToggle(this._isFullscreen, this._map); } catch (e) { console.warn('FullscreenMapControl onToggle error:', e); }
          }

          this._map?.resize?.();
        });
      });
    }
  }

  // expose globals (no modules needed)
  window.TrailmapFullscreen = {
    FullscreenMapControl,
    updateSafeViewport,
    attachSafeViewportListenersOnce,
    detachSafeViewportListeners
  };
})();
