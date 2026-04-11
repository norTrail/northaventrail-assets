/* ============================================================
   Gesture Control — Mapbox
   - Embedded: block 1-finger pan / accidental scroll
   - Desktop: require Ctrl/⌘ for drag + zoom
   - Fullscreen: allow normal map interactions
   ============================================================ */

function initGestureControl(mapboxMap) {
  const isTouchDevice =
    window.matchMedia("(pointer: coarse)").matches ||
    "ontouchstart" in window;

  if (!mapboxMap || typeof mapboxMap.getCanvas !== "function") {
    console.error("initGestureControl: invalid Mapbox map instance", mapboxMap);
    return;
  }

  // Prevent double init
  if (typeof mapboxMap.__gestureControlDestroy === "function") {
    mapboxMap.__gestureControlDestroy();
  }
  if (mapboxMap.__gestureControlInitialized) return;
  mapboxMap.__gestureControlInitialized = true;

  const canvas = mapboxMap.getCanvas();
  const gestureTip = document.getElementById("gesture-tip");

  let tipTimeout = null;
  let wheelLockTimer = null;
  let isFullscreen = false;
  let ctrlUnlocked = false;

  let lastTipAt = 0;
  let lastTipMsg = "";

  if (gestureTip) {
    gestureTip.setAttribute("role", "status");
    gestureTip.setAttribute("aria-live", "polite");
  }

  function showTip(message = "Use two fingers to move the map") {
    if (!gestureTip) return;

    const msg = String(message);
    const now = Date.now();

    // Throttle only if the same message repeats
    if (msg === lastTipMsg && now - lastTipAt < 1500) return;

    lastTipMsg = msg;
    lastTipAt = now;

    gestureTip.textContent = msg;
    gestureTip.style.opacity = "1";
    clearTimeout(tipTimeout);
    tipTimeout = setTimeout(() => {
      gestureTip.style.opacity = "0";
    }, 1800);
  }

  function hideTip() {
    if (!gestureTip) return;
    gestureTip.style.opacity = "0";
    clearTimeout(tipTimeout);
  }

  function lockEmbeddedMode_() {
    ctrlUnlocked = false;
    mapboxMap.scrollZoom.disable();
    mapboxMap.dragPan.disable();
    mapboxMap.keyboard.disable();
    mapboxMap.touchZoomRotate.disable();
    mapboxMap.touchPitch.disable();
  }

  function unlockFullscreenMode_() {
    ctrlUnlocked = false;
    mapboxMap.scrollZoom.enable();
    mapboxMap.dragPan.enable();
    mapboxMap.touchZoomRotate.enable();
    mapboxMap.touchPitch.enable();
    mapboxMap.keyboard.enable();
  }

  // Initial safe defaults
  lockEmbeddedMode_();

  // Setup keyboard events (Ctrl/⌘ unlock)
  const removeCtrlDragUnlock = wireCtrlDragUnlock_(mapboxMap, () => isFullscreen, (unlocked) => {
    ctrlUnlocked = unlocked;
    if (unlocked) hideTip();
  });

  // ------------------------------------------------------------
  // Blur cleanup: prevents timers / states lingering after tab switch
  // ------------------------------------------------------------
  const onWindowBlur = () => {
    clearTimeout(wheelLockTimer);
    hideTip();

    if (isFullscreen) return;

    // If you tab away mid-gesture, re-lock for embedded mode
    if (!ctrlUnlocked) {
      mapboxMap.dragPan.disable();
      mapboxMap.scrollZoom.disable();
    }
  };
  window.addEventListener("blur", onWindowBlur, { passive: true });

  // ------------------------------------------------------------
  // Drag intent (mouse) — show tip if user tries to drag locked map
  // ------------------------------------------------------------
  let dragIntent = false;

  const onMouseDown = (e) => {
    if (isFullscreen || isTouchDevice) return;

    dragIntent = true;

    if (e.ctrlKey || e.metaKey) {
      hideTip();
      mapboxMap.dragPan.enable();
      return;
    }

    showTip("Hold Ctrl (or ⌘) and drag to move the map");
  };
  canvas.addEventListener("mousedown", onMouseDown, { passive: true });

  const onMouseMove = (e) => {
    if (!dragIntent || isFullscreen || isTouchDevice) return;

    // If user starts holding Ctrl mid-drag, unlock
    if (e.ctrlKey || e.metaKey) {
      hideTip();
      mapboxMap.dragPan.enable();
    }
  };
  canvas.addEventListener("mousemove", onMouseMove, { passive: true });


  const onTouchMove = (e) => {
    // Only interfere with two-finger gestures on the map
    if (!isFullscreen && e.touches && e.touches.length >= 2) {
      e.preventDefault(); // blocks page scroll / pinch-zoom
    }
  };
  canvas.addEventListener("touchmove", onTouchMove, { passive: false });

  const onMouseUp = (e) => {
    if (isTouchDevice) return;

    dragIntent = false;

    if (isFullscreen) return;

    // If they aren't holding Ctrl/⌘ and keyboard unlock isn't active, re-lock
    if (!(e.ctrlKey || e.metaKey) && !ctrlUnlocked) {
      mapboxMap.dragPan.disable();

      mapboxMap.scrollZoom.disable();
    }
  };
  window.addEventListener("mouseup", onMouseUp);

  // ------------------------------------------------------------
  // Desktop wheel handling (Ctrl/⌘ or pinch-to-zoom)
  // ------------------------------------------------------------

  // Non-passive listener: prevents the page from scrolling (or the browser
  // from zooming) at the same time the map is being intentionally zoomed.
  const onWheelPreventDefault = (e) => {
    if (!isFullscreen && (e.ctrlKey || e.metaKey || ctrlUnlocked)) {
      e.preventDefault();
    }
  };
  canvas.addEventListener("wheel", onWheelPreventDefault, { passive: false });

  // Logic listener (passive — no preventDefault needed here)
  const onWheel = (e) => {
    if (isFullscreen || isTouchDevice) return;

    const intentional = e.ctrlKey || e.metaKey || ctrlUnlocked;

    if (intentional) {
      mapboxMap.scrollZoom.enable();
      mapboxMap.dragPan.enable();
      hideTip();

      clearTimeout(wheelLockTimer);
      wheelLockTimer = setTimeout(() => {
        if (!isFullscreen && !ctrlUnlocked) {
          mapboxMap.scrollZoom.disable();
          mapboxMap.dragPan.disable();
        }
      }, 1500);
    } else {
      if (!ctrlUnlocked) {
        mapboxMap.scrollZoom.disable();
        mapboxMap.dragPan.disable();
      }
      showTip("Hold Ctrl (or ⌘) and scroll to zoom the map");
    }
  };
  canvas.addEventListener("wheel", onWheel, { passive: true });

  // ------------------------------------------------------------
  // Touch handling
  // ------------------------------------------------------------
  const onTouchStart = (e) => {
    if (isFullscreen) {
      mapboxMap.dragPan.enable();
      mapboxMap.touchZoomRotate.enable();
      hideTip();
      return;
    }

    if (e.touches.length === 1) {
      mapboxMap.dragPan.disable();
      showTip("Use two fingers to move the map");
    } else if (e.touches.length === 2) {
      mapboxMap.dragPan.enable();
      mapboxMap.touchZoomRotate.enable();
      hideTip();
    }
  };
  canvas.addEventListener("touchstart", onTouchStart, { passive: true });

  const onTouchEnd = () => {
    if (isFullscreen) return;
    mapboxMap.dragPan.disable();
    mapboxMap.touchZoomRotate.disable();
  };
  canvas.addEventListener("touchend", onTouchEnd, { passive: true });

  // ------------------------------------------------------------
  // Fullscreen toggle hook
  // ------------------------------------------------------------
  window.setMapFullscreenMode = function (enabled) {
    isFullscreen = !!enabled;
    clearTimeout(wheelLockTimer);

    if (isFullscreen) {
      unlockFullscreenMode_();
      hideTip();
    } else {
      lockEmbeddedMode_();
    }
  };

  function destroyGestureControl() {
    clearTimeout(tipTimeout);
    clearTimeout(wheelLockTimer);
    hideTip();
    removeCtrlDragUnlock?.();
    window.removeEventListener("blur", onWindowBlur);
    window.removeEventListener("mouseup", onMouseUp);
    canvas.removeEventListener("mousedown", onMouseDown);
    canvas.removeEventListener("mousemove", onMouseMove);
    canvas.removeEventListener("touchmove", onTouchMove);
    canvas.removeEventListener("wheel", onWheelPreventDefault);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("touchstart", onTouchStart);
    canvas.removeEventListener("touchend", onTouchEnd);
    mapboxMap.__gestureControlInitialized = false;
    mapboxMap.__gestureControlDestroy = null;
  }

  mapboxMap.__gestureControlDestroy = destroyGestureControl;
  mapboxMap.once?.("remove", destroyGestureControl);

}

function wireCtrlDragUnlock_(mapboxMap, isFullscreenRef, onStateChange) {
  const isUnlockKey = (e) => e.ctrlKey || e.metaKey;

  function setUnlocked_(unlocked) {
    if (unlocked) {
      mapboxMap.dragPan.enable();
      mapboxMap.scrollZoom.enable();
    } else {
      mapboxMap.dragPan.disable();
      mapboxMap.scrollZoom.disable();
    }
    if (typeof onStateChange === "function") onStateChange(unlocked);
  }

  function updateFromKeys_(e) {
    if (isFullscreenRef()) return;
    setUnlocked_(isUnlockKey(e));
  }

  window.addEventListener("keydown", updateFromKeys_, { passive: true });
  window.addEventListener("keyup", updateFromKeys_, { passive: true });

  // Keep this as a second line of defense for key states
  const onBlur = () => {
    if (isFullscreenRef()) return;
    setUnlocked_(false);
  };
  window.addEventListener("blur", onBlur, { passive: true });

  return function removeCtrlDragUnlock() {
    window.removeEventListener("keydown", updateFromKeys_);
    window.removeEventListener("keyup", updateFromKeys_);
    window.removeEventListener("blur", onBlur);
  };
}
