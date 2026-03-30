const TRAILMAP_ERROR_ENDPOINT = "https://northaventrail-gas-proxy.will-5e4.workers.dev/log"
window.TRAILMAP_ERROR_ENDPOINT = window.TRAILMAP_ERROR_ENDPOINT || TRAILMAP_ERROR_ENDPOINT;

const BREADCRUMB_LIMIT = 30;

/* ============================================================
   Error logging (drop-in)
   - Captures Mapbox 'error'
   - Captures window 'error' + 'unhandledrejection'
   - Captures WebGL context loss / restore
   - Adds lightweight breadcrumbs
   ============================================================ */

function isSquarespaceHost_() {
  const host = (window.location && window.location.hostname || "").toLowerCase();
  return host.endsWith(".squarespace.com");
}

function createBreadcrumbs(limit = 30) {
  const items = [];
  return {
    add(msg, data) {
      items.push({
        t: Date.now(),
        msg: String(msg).slice(0, 200),
        data: data ? safeJson(data, 800) : undefined
      });
      if (items.length > limit) items.shift();
    },
    list() {
      return items.slice();
    }
  };
}

function safeJson(obj, maxLen = 20000, context = {}) {
  const seen = new WeakSet();

  try {
    const s = JSON.stringify(obj, (k, v) => {
      try {
        // Drop Mapbox/DOM/event-y things that often cause cycles or huge logs
        if (k === "originalEvent") return undefined;
        if (k === "target" || k === "currentTarget") return undefined;
        if (k === "srcElement" || k === "view" || k === "path") return undefined;

        // Errors -> plain object
        if (v instanceof Error) {
          return { name: v.name, message: v.message, stack: String(v.stack || "") };
        }

        // Handle cycles and dangerous objects early
        if (v && typeof v === "object") {
          // Check for DOM nodes safely (Window doesn't have nodeType but has document/window)
          if (typeof v.nodeType === "number" && typeof v.nodeName === "string") {
            return `[DOMNode: ${v.nodeName}]`;
          }
          if (typeof Window !== "undefined" && v instanceof Window) return "[Window]";

          if (seen.has(v)) return "[circular]";
          seen.add(v);
        }

        // Trim huge strings
        if (typeof v === "string" && v.length > 5000) {
          return v.slice(0, 5000) + "…(truncated)";
        }

        return v;
      } catch (e) {
        // Handle cross-origin property access errors (Window, Location)
        return "[access denied]";
      }
    });

    return s.length > maxLen ? s.slice(0, maxLen) + "…(truncated)" : s;
  } catch (err) {
    const msg = String(err?.message || err);
    // When called without a payload context (e.g. crumb serialization), return a
    // simple sentinel string so the server doesn't log it as a top-level error event.
    if (!context || !context.kind) {
      return JSON.stringify("[serialize_error]");
    }
    const fallback = {
      kind: "client_encode_error",
      message: msg,
      ts: new Date().toISOString(),
      ...context
    };
    return JSON.stringify(fallback);
  }
}

function describeRejectionReason_(reason) {
  if (reason == null) return { type: "nullish", message: String(reason) };

  // Error / DOMException / Error-like
  const isErrorLike =
    reason instanceof Error ||
    (typeof reason === "object" && (reason.name || reason.message || reason.stack));

  if (isErrorLike) {
    return {
      type: reason.constructor?.name || "ErrorLike",
      name: reason.name || undefined,
      message: reason.message || String(reason),
      stack: reason.stack ? String(reason.stack) : undefined,
      code: reason.code || undefined,
    };
  }

  if (typeof reason === "string") return { type: "string", message: reason };
  if (typeof reason === "number" || typeof reason === "boolean")
    return { type: typeof reason, value: reason };

  // Plain object (best-effort preview)
  try {
    return {
      type: "object",
      keys: Object.keys(reason).slice(0, 30),
      preview: safeJson(reason, 2000),
    };
  } catch {
    return { type: "object", message: Object.prototype.toString.call(reason) };
  }
}

function normalizeUrl(u) {
  try {
    const url = new URL(u, location.href);
    // If you store sensitive params in URL, remove them here
    // Example:
    // url.searchParams.delete("token");
    // url.searchParams.delete("email");
    return url.toString();
  } catch {
    return String(u).slice(0, 300);
  }
}

function createRateLimiter({ maxPerMinute = 12 } = {}) {
  const bucket = [];
  return function allow() {
    const now = Date.now();
    const cutoff = now - 60_000;
    while (bucket.length && bucket[0] < cutoff) bucket.shift();
    if (bucket.length >= maxPerMinute) return false;
    bucket.push(now);
    return true;
  };
}

/**
 * Attach error logging to a Mapbox map instance.
 * @param {mapboxgl.Map} map
 * @param {object} opts
 * @param {string} opts.appName
 * @param {string} opts.endpoint - optional server logging endpoint
 * @param {function} opts.send - optional custom send(payload) => Promise|void
 */
function attachErrorLogging(map, opts = {}) {
  const {
    appName = "trail-map",
    endpoint = "",
    send = null
  } = opts;

  const crumbs = createBreadcrumbs(BREADCRUMB_LIMIT);
  const allow = createRateLimiter({ maxPerMinute: 12 });

  // Make breadcrumbs easy to add elsewhere in your code
  window.__trailCrumbs = crumbs;

  function buildBasePayload(kind) {
    const base = {
      kind,
      app: appName,
      ts: new Date().toISOString(),
      page: normalizeUrl(location.href),
      ref: normalizeUrl(document.referrer || ""),
      ua: navigator.userAgent,
      lang: navigator.language,
      vp: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      online: navigator.onLine,
      visibility: document.visibilityState,
      crumbs: crumbs.list()
    };

    // Map state (best effort)
    try {
      if (map && typeof map.getCenter === "function") {
        const c = map.getCenter();
        base.map = {
          center: [Number(c.lng.toFixed(6)), Number(c.lat.toFixed(6))],
          zoom: Number(map.getZoom().toFixed(2)),
          bearing: Number(map.getBearing().toFixed(2)),
          pitch: Number(map.getPitch().toFixed(2)),
          loaded: !!map.loaded?.(),
          styleLoaded: !!map.isStyleLoaded?.()
        };
      }
    } catch (e) {
      base.map = { note: "map state unavailable" };
    }
    return base;
  }

  async function defaultSend(payload) {
    if (!endpoint) return;

    const context = { kind: payload.kind, app: payload.app, page: payload.page };
    const json = safeJson(payload, 20000, context);

    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, new Blob([json], { type: "text/plain" }));
        return;
      }
      const resp = await fetch(endpoint, {
        method: "POST",
        cache: "no-store",
        keepalive: true,
        body: json,
        headers: { "Content-Type": "text/plain" }
      });
      if (!resp.ok) {
        console.warn(`log send failed (${resp.status})`);
      }
    } catch (e) {
      // last resort: don't throw
      console.warn("log send failed", e);
    }
  }

  function emit(payload) {
    // Skip server logging entirely on Squarespace editor/preview hosts
    if (isSquarespaceHost_()) return;

    if (!allow()) return;

    try {
      const p = (send ? send(payload) : defaultSend(payload));
      if (p && typeof p.then === "function") p.catch(() => { });
    } catch (_) { }
  }

  // Make the latest map/crumbs/emitter available to global handlers
  window.__trailErrorContext = {
    crumbs,
    buildBasePayload,
    emit
  };

  // ---- Mapbox error event
  if (map && typeof map.on === "function") {
    map.on("error", (e) => {
      console.log("MAPBOX_ERROR", e?.error?.message || e);
      crumbs.add("mapbox:error", {
        sourceId: e?.sourceId,
        tile: e?.tile,
        message: e?.error?.message
      });

      const payload = buildBasePayload("mapbox_error");
      payload.err = {
        message: e?.error?.message || "Mapbox error",
        stack: e?.error?.stack,
        sourceId: e?.sourceId,
        tile: e?.tile
      };
      emit(payload);
    });
  }

  function installGlobalHandlersOnce_() {
    if (window.__trailGlobalHandlersInstalled) return;
    window.__trailGlobalHandlersInstalled = true;

    // JS runtime errors
    window.addEventListener("error", (e) => {
      // Skip resource load errors — the second handler below captures those
      if (e.target && e.target !== window) return;
      // Skip cross-origin "Script error." noise (CORS masked)
      // Note: some browsers (e.g. Brave) populate e.filename even for cross-origin errors,
      // so we filter on message alone rather than requiring !e.filename
      if (e.message === "Script error.") return;

      const ctx = window.__trailErrorContext;
      if (!ctx) return;

      ctx.crumbs.add("window:error", {
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno
      });

      const payload = ctx.buildBasePayload("window_error");
      payload.err = {
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        stack: e.error?.stack
      };
      ctx.emit(payload);
    });

    // Resource load errors (script/css/img)
    window.addEventListener("error", (e) => {
      const ctx = window.__trailErrorContext;
      if (!ctx) return;

      const el = e.target;
      const isRes =
        el &&
        (el.tagName === "SCRIPT" ||
          el.tagName === "LINK" ||
          el.tagName === "IMG");

      if (!isRes) return;

      // ---- FILTER KNOWN TRACKER BLOCKS ----
      const url = el.src || el.href || "";
      const ignore = [
        "connect.facebook.net/",
        "www.googletagmanager.com/",
        "www.google-analytics.com/"
      ];

      if (ignore.some(s => url.includes(s))) return;
      // ------------------------------------

      const payload = ctx.buildBasePayload("resource_error");
      payload.err = {
        tag: el.tagName,
        url
      };

      ctx.emit(payload);
    }, true);

    // Unhandled promise rejections
    window.addEventListener("unhandledrejection", (e) => {
      const ctx = window.__trailErrorContext;
      if (!ctx) return;

      const detail = describeRejectionReason_(e.reason);

      ctx.crumbs.add("promise:rejection", {
        name: detail.name,
        message: String(detail.message || "").slice(0, 200)
      });

      const payload = ctx.buildBasePayload("unhandled_rejection");
      payload.err = {
        message: "Unhandled rejection",
        reason: detail
      };

      ctx.emit(payload);

      // Optional: reduce console noise if you’re confident your logger works
      // e.preventDefault();
    });
  }

  installGlobalHandlersOnce_();

  // ---- WebGL context loss / restore
  try {
    const canvas = map?.getCanvas?.();
    if (canvas && !canvas.__trailErrorListenerAttached) {
      canvas.__trailErrorListenerAttached = true;
      canvas.addEventListener("webglcontextlost", (e) => {
        // Prevent default so the browser can attempt restore
        e.preventDefault();
        crumbs.add("webgl:lost");

        const payload = buildBasePayload("webgl_context_lost");
        payload.err = { message: "WebGL context lost" };
        emit(payload);
      });

      canvas.addEventListener("webglcontextrestored", () => {
        crumbs.add("webgl:restored");

        const payload = buildBasePayload("webgl_context_restored");
        payload.err = { message: "WebGL context restored" };
        emit(payload);
      });
    }
  } catch (e) {
    // ignore
  }

  // Helpful breadcrumbs you can sprinkle in your app:
  crumbs.add("logger:attached");
  document.addEventListener("visibilitychange", () => crumbs.add("visibility", { state: document.visibilityState }));
  window.addEventListener("online", () => crumbs.add("net", { online: true }));
  window.addEventListener("offline", () => crumbs.add("net", { online: false }));

  // Remove
  //console.log("Error logging loaded")

  return { crumbs };
}

/* ============================================================
   Log the client side errors on the server

   logClientErrorToServer({
      kind: "manual_log",
      message: "Map init started",
      ts: new Date().toISOString()
    });
   ============================================================ */

function logClientErrorToServer(payloadObj, endpointOverride) {
  if (isSquarespaceHost_()) return; // don't log editor errors
  const endpoint = endpointOverride || window.TRAILMAP_ERROR_ENDPOINT;
  if (!endpoint) return;

  const finalPayload = {
    app: window.APP_NAME || "unknown",
    page: normalizeUrl(location.href),
    ua: navigator.userAgent,
    ts: new Date().toISOString(),
    ...payloadObj
  };

  const context = { kind: finalPayload.kind, app: finalPayload.app, page: finalPayload.page };
  const json = safeJson(finalPayload, 20000, context);

  return fetch(endpoint, {
    method: "POST",
    cache: "no-store",
    keepalive: true,
    body: json,
    headers: { "Content-Type": "text/plain" }
  }).then(r => {
    if (!r.ok) console.warn(`logClientError send failed (${r.status})`);
    return r;
  }).catch(() => { });
}

/* ============================================================
   WebGL auto-recovery (safe re-init)
   ============================================================ */

function installWebglAutoRecovery({
  containerId,
  buildMap,          // () => new mapboxgl.Map(initOptions)
  onReinit = null,   // (newMap) => void
  maxRetries = 3,
  cooldownMs = 8000
}) {
  let retries = 0;
  let lastAttempt = 0;
  let recovering = false;

  function snapshot(map) {
    try {
      const c = map.getCenter();
      return {
        center: [c.lng, c.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch()
      };
    } catch {
      return null;
    }
  }

  function applySnapshot(map, snap) {
    if (!snap) return;
    try {
      map.jumpTo({
        center: snap.center,
        zoom: snap.zoom,
        bearing: snap.bearing,
        pitch: snap.pitch
      });
    } catch { }
  }

  function safeRemove(map) {
    try { map.stop?.(); } catch { }
    try { map.remove(); } catch { }
  }

  function recover(oldMap) {
    const now = Date.now();
    if (recovering) return;
    if (retries >= maxRetries) return;
    if (now - lastAttempt < cooldownMs) return;

    recovering = true;
    lastAttempt = now;
    retries++;

    // Breadcrumb if logger present
    window.__trailCrumbs?.add("webgl:recover_attempt", { retries });

    const snap = snapshot(oldMap);

    // Remove old map
    safeRemove(oldMap);

    // Clear container (sometimes helps iOS Safari)
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = "";

    // Create a new map
    const newMap = buildMap();

    // When style loads, restore view and run your normal init hooks
    newMap.once("load", () => {
      applySnapshot(newMap, snap);
      window.__trailCrumbs?.add("webgl:recovered");
      if (typeof onReinit === "function") onReinit(newMap);
      recovering = false;
    });

    // If it errors immediately, allow another attempt later
    newMap.on("error", () => {
      recovering = false;
    });

    return newMap;
  }

  function attach(map) {
    const canvas = map.getCanvas();
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      recover(map);
    });
    return map;
  }

  //console.log("Crash recovery loaded")

  return { attach, recover };
}


function installSafariMapKeepAlive_(initialMap, { rebuildMap } = {}) {
  if (!initialMap || typeof initialMap.getCanvas !== "function") return;

  let currentMap = initialMap;
  let container = currentMap.getContainer();

  function isMapVisible_() {
    if (!container || !container.isConnected) return false;
    const r = container.getBoundingClientRect();
    return r.width > 40 && r.height > 40;
  }

  function canvasLooksAlive_() {
    const canvas = currentMap.getCanvas?.();
    if (!canvas || !canvas.isConnected) return false;
    return canvas.width > 0 && canvas.height > 0;
  }

  function softRecover_(reason) {
    try {
      currentMap.resize();
      currentMap.triggerRepaint?.();
    } catch { }
  }

  async function hardRecover_(reason) {
    if (typeof rebuildMap !== "function") return;

    try {
      try { currentMap.remove(); } catch { }

      const newMap = rebuildMap();

      // update references
      currentMap = newMap;
      container = newMap.getContainer();

      // ✅ wait for style/load before handing off
      const notify = () => {
        if (typeof window.onMapReinit === "function") {
          window.onMapReinit(newMap, { reason });
        }
      };

      if (newMap.loaded && newMap.loaded()) {
        notify();
      } else {
        newMap.once("load", notify);
      }
    } catch (e) {
      console.warn("hardRecover failed", e);
      window.__trailCrumbs?.add("keepalive:hardRecover_fail", { msg: e?.message });
    }
  }

  function checkAndRecover_(reason) {
    if (document.visibilityState !== "visible") return;

    /*const rect = container?.getBoundingClientRect?.();
    const canvas = currentMap.getCanvas?.();

    console.log("[keepalive]", reason, {
      visible: !!rect && rect.width > 40 && rect.height > 40,
      rect: rect ? { w: rect.width, h: rect.height } : null,
      canvasConnected: !!canvas?.isConnected,
      canvasSize: canvas ? { w: canvas.width, h: canvas.height } : null
    });*/

    const visible = isMapVisible_();
    const alive = canvasLooksAlive_();

    if (visible && alive) return softRecover_(reason);

    setTimeout(() => {
      const visible2 = isMapVisible_();
      const alive2 = canvasLooksAlive_();
      if (visible2 && alive2) softRecover_(reason + ":delayed");
      else hardRecover_(reason + ":hard");
    }, 350);
  }

  try {
    const DEBUG = new URLSearchParams(location.search).get("debug") === "1";
    if (DEBUG) {
      window.__trailKeepAliveCheck = (reason = "debug") => checkAndRecover_(String(reason));
    }
  } catch (_) { }

  document.addEventListener("visibilitychange", () => checkAndRecover_("visibilitychange"), { passive: true });
  window.addEventListener("pageshow", (e) => checkAndRecover_(e.persisted ? "pageshow:bfcache" : "pageshow"), { passive: true });
  window.addEventListener("focus", () => checkAndRecover_("focus"), { passive: true });
  let _resizeDebounce = null;
  window.addEventListener("resize", () => {
    clearTimeout(_resizeDebounce);
    _resizeDebounce = setTimeout(() => checkAndRecover_("resize"), 200);
  }, { passive: true });
  window.addEventListener("orientationchange", () => checkAndRecover_("orientationchange"), { passive: true });
}

function addDebugButtons_({ onRebuild, onKeepAlive } = {}) {
  if (document.getElementById("trailmap-debug-panel")) return;

  const panel = document.createElement("div");
  panel.id = "trailmap-debug-panel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Trail map debug controls");

  Object.assign(panel.style, {
    position: "fixed",
    right: "12px",
    bottom: "12px",
    zIndex: 9999,
    display: "flex",
    gap: "8px",
    padding: "10px",
    background: "rgba(255,255,255,0.95)",
    border: "1px solid rgba(0,0,0,.15)",
    borderRadius: "12px",
    boxShadow: "0 8px 24px rgba(0,0,0,.15)",
    backdropFilter: "blur(6px)"
  });

  function mkBtn(id, label, ariaLabel, handler) {
    const b = document.createElement("button");
    b.id = id;
    b.type = "button";
    b.textContent = label;
    b.setAttribute("aria-label", ariaLabel);
    Object.assign(b.style, {
      padding: "10px 12px",
      borderRadius: "10px",
      border: "1px solid rgba(0,0,0,.2)",
      background: "#fff",
      color: "#000",
      fontSize: "14px",
      cursor: "pointer"
    });
    b.addEventListener("click", () => {
      try { handler?.(); } catch (e) { console.error("[debug button error]", e); }
    });
    return b;
  }

  panel.appendChild(
    mkBtn(
      "trailmap-debug-rebuild",
      "Rebuild map",
      "Rebuild map instance (debug)",
      onRebuild
    )
  );

  panel.appendChild(
    mkBtn(
      "trailmap-debug-keepalive",
      "Safari keep-alive",
      "Simulate Safari canvas loss and recover (debug)",
      onKeepAlive
    )
  );

  document.body.appendChild(panel);
}

window.TrailmapError = {
  attachErrorLogging,
  installWebglAutoRecovery,
  logClientErrorToServer
};
