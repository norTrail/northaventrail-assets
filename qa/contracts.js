"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const JSON_DIR = path.join(REPO_ROOT, "json");
const ASSETS_JSON_PREFIX = "https://assets.northaventrail.org/json/";

const MANIFEST_VALIDATORS = {
  "trail-poi.latest.json": validateTrailPoiPayload,
  "trail-captains.latest.json": validateTrailCaptainsPayload,
  "overlay-state.v2026.latest.json": validateOverlayStatePayload,
  "tails-donations.v2026.latest.json": validateDonationsPayload,
  "valentine-cling.v2027.latest.json": validateValentinePayload,
  "no-mow-zones.v2026.latest.json": validateNoMowPayload,
  "sheep-locations.v2026.latest.json": validateSheepLocationsPayload
};

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function toRepoJsonPath(url) {
  assert.equal(typeof url, "string", "manifest URL must be a string");
  assert.ok(url.startsWith(ASSETS_JSON_PREFIX), `expected assets JSON URL, got ${url}`);
  return path.join(JSON_DIR, url.slice(ASSETS_JSON_PREFIX.length));
}

function assertFileExists(filePath, label) {
  assert.ok(fs.existsSync(filePath), `${label} does not exist: ${filePath}`);
}

function assertNumber(value, label) {
  assert.equal(typeof value, "number", `${label} must be a number`);
  assert.ok(Number.isFinite(value), `${label} must be finite`);
}

function assertString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value.trim().length > 0, `${label} must not be empty`);
}

function assertCoordinates(coords, label) {
  assert.ok(Array.isArray(coords), `${label} must be an array`);
  assert.ok(coords.length >= 2, `${label} must have at least lng/lat`);
  assertNumber(Number(coords[0]), `${label}[0]`);
  assertNumber(Number(coords[1]), `${label}[1]`);
}

function assertFeatureCollection(payload, label) {
  assert.equal(payload?.type, "FeatureCollection", `${label} must be a FeatureCollection`);
  assert.ok(Array.isArray(payload?.features), `${label}.features must be an array`);
}

function validateManifest(manifestName) {
  const manifestPath = path.join(JSON_DIR, manifestName);
  const manifest = readJsonFile(manifestPath);

  assertString(manifest.current, `${manifestName}.current`);
  assertString(manifest.version, `${manifestName}.version`);
  assert.ok(isIsoDate(manifest.updatedAt), `${manifestName}.updatedAt must be ISO-like`);

  const urlKeys = ["current", "fallback", "previous"].filter((key) => manifest[key]);
  assert.ok(urlKeys.length >= 1, `${manifestName} must include at least one data URL`);

  const validatePayload = MANIFEST_VALIDATORS[manifestName];
  assert.equal(typeof validatePayload, "function", `No validator registered for ${manifestName}`);

  for (const key of urlKeys) {
    const localPath = toRepoJsonPath(manifest[key]);
    assertFileExists(localPath, `${manifestName}.${key}`);
    validatePayload(readJsonFile(localPath), `${manifestName}.${key}`);
  }

  return {
    manifestName,
    version: manifest.version,
    checkedPayloads: urlKeys.length
  };
}

function validateTrailPoiPayload(payload, label) {
  assertFeatureCollection(payload, label);
  assert.equal(String(payload.v), "6.2", `${label}.v should be 6.2`);
  assert.equal(typeof payload?.defs?.types, "object", `${label}.defs.types must exist`);
  assert.ok(Object.keys(payload.defs.types).length > 0, `${label}.defs.types must not be empty`);
  assert.ok(payload.features.length > 0, `${label}.features must not be empty`);

  for (const feature of payload.features) {
    assert.equal(feature?.type, "Feature", `${label} feature type must be Feature`);
    assertString(String(feature?.id || ""), `${label} feature.id`);
    assert.equal(feature?.geometry?.type, "Point", `${label} feature geometry must be Point`);
    assertCoordinates(feature?.geometry?.coordinates, `${label} feature coordinates`);
    assert.equal(typeof feature?.properties, "object", `${label} feature.properties must exist`);
    assertString(String(feature.properties.t || ""), `${label} feature.properties.t`);
  }
}

function validateTrailCaptainsPayload(payload, label) {
  assert.equal(typeof payload?.sections, "object", `${label}.sections must exist`);
  const sections = Object.values(payload.sections);
  assert.ok(sections.length > 0, `${label}.sections must not be empty`);

  for (const section of sections) {
    assertString(section?.label, `${label} section.label`);
    assertString(section?.range, `${label} section.range`);
    assert.ok(Array.isArray(section?.segments), `${label} section.segments must be an array`);
    for (const segment of section.segments) {
      assertString(segment?.segment, `${label} segment.segment`);
      assert.ok(Array.isArray(segment?.captains), `${label} segment.captains must be an array`);
      for (const captain of segment.captains) {
        assertString(captain, `${label} captain name`);
      }
    }
  }
}

function validateOverlayStatePayload(payload, label) {
  assertString(payload?.state, `${label}.state`);
  assertString(payload?.image, `${label}.image`);
  assert.ok(isIsoDate(payload?.startDate), `${label}.startDate must be ISO-like`);
  assertNumber(payload?.grazingStartHour, `${label}.grazingStartHour`);
  assertNumber(payload?.grazingEndHour, `${label}.grazingEndHour`);
  assert.ok(Array.isArray(payload?.adminSheet), `${label}.adminSheet must be an array`);
}

function validateDonationsPayload(payload, label) {
  assertNumber(payload?.raised, `${label}.raised`);
  assertNumber(payload?.goal, `${label}.goal`);
  assertNumber(payload?.matchingFunds, `${label}.matchingFunds`);
  assertNumber(payload?.remainingFunds, `${label}.remainingFunds`);
  assert.ok(isIsoDate(payload?.updated), `${label}.updated must be ISO-like`);
}

function validateValentinePayload(payload, label) {
  assertFeatureCollection(payload, label);
  assert.ok(payload.features.length > 0, `${label}.features must not be empty`);

  for (const feature of payload.features) {
    assert.equal(feature?.type, "Feature", `${label} feature type must be Feature`);
    assertString(String(feature?.id || ""), `${label} feature.id`);
    assert.equal(feature?.geometry?.type, "Point", `${label} feature geometry must be Point`);
    assertCoordinates(feature?.geometry?.coordinates, `${label} feature coordinates`);
    assertString(feature?.properties?.locationID, `${label} feature.properties.locationID`);
    if (feature?.properties?.imageURL !== undefined && feature?.properties?.imageURL !== null) {
      assertString(feature.properties.imageURL, `${label} feature.properties.imageURL`);
    }
  }
}

function validateNoMowPayload(payload, label) {
  assertFeatureCollection(payload, label);
  assert.ok(payload.features.length > 0, `${label}.features must not be empty`);

  for (const feature of payload.features) {
    assert.equal(feature?.type, "Feature", `${label} feature type must be Feature`);
    assertString(String(feature?.id || ""), `${label} feature.id`);
    assert.equal(feature?.geometry?.type, "Polygon", `${label} feature geometry must be Polygon`);
    assert.ok(Array.isArray(feature?.geometry?.coordinates), `${label} polygon coordinates must be an array`);
    assertString(feature?.properties?.zoneCode, `${label} feature.properties.zoneCode`);
    assertString(feature?.properties?.zoneName, `${label} feature.properties.zoneName`);
    assertCoordinates(feature?.properties?.center, `${label} feature.properties.center`);
  }
}

function validateSheepLocationsPayload(payload, label) {
  assert.equal(typeof payload, "object", `${label} must be an object`);
  const herds = Object.entries(payload);
  assert.ok(herds.length > 0, `${label} must include at least one herd`);

  for (const [herdCode, herd] of herds) {
    assertString(herdCode, `${label} herd code`);
    assertString(herd?.color, `${label}.${herdCode}.color`);
    assertFeatureCollection(herd?.current, `${label}.${herdCode}.current`);
    assertFeatureCollection(herd?.history, `${label}.${herdCode}.history`);
    assert.ok(herd.current.features.length > 0, `${label}.${herdCode}.current.features must not be empty`);

    for (const feature of herd.current.features) {
      assert.equal(feature?.type, "Feature", `${label}.${herdCode} current feature type must be Feature`);
      assert.equal(feature?.geometry?.type, "Point", `${label}.${herdCode} current geometry must be Point`);
      assertCoordinates(feature?.geometry?.coordinates, `${label}.${herdCode} current coordinates`);
    }
  }
}

function checkNoConsoleLogs() {
  const srcJsDir = path.join(REPO_ROOT, "src", "js");
  const files = fs.readdirSync(srcJsDir).filter((f) => f.endsWith(".js"));
  const violations = [];

  for (const file of files) {
    const filePath = path.join(srcJsDir, file);
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      // Skip lines that are comments
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      if (/console\.log\s*\(/.test(lines[i])) {
        violations.push(`${file}:${i + 1}: ${lines[i].trim()}`);
      }
    }
  }

  assert.equal(
    violations.length,
    0,
    `console.log found in source JS (remove before committing):\n  ${violations.join("\n  ")}`
  );

  return { checked: files.length };
}

// Regression guard for: escape handler checked lightBox.style.display === "block" but
// the lightbox uses display:flex — so the guard was always falsy and Escape closed the
// popup while the lightbox was open. Fix: check display !== "none". (2026-04-17, e4f2f8f)
function checkLightboxEscapeCondition() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, "src", "js", "trailmap-ui.v1.js"), "utf8"
  );
  assert.ok(
    /lightBox\.style\.display\s*&&\s*lightBox\.style\.display\s*!==\s*["']none["']/.test(content),
    "trailmap-ui: lightbox escape guard must use display !== 'none' (not === 'block') — lightbox renders as flex, so the block check was always falsy and let Escape close the popup"
  );
  return { checked: 1 };
}

// Regression guard for: search used a single haystackLower.includes(query) call, so
// multi-word queries like "mural bridge" failed to match "Mural on Northaven Trail Bridge"
// because the substring doesn't appear contiguously. Fix: split on whitespace and use
// .every(). (2026-04-17, 410699c)
function checkSearchTokenization() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, "src", "js", "trailmap-ui.v1.js"), "utf8"
  );
  assert.ok(
    /const\s+tokens\s*=\s*query\.split\s*\(/.test(content),
    "trailmap-ui: search must split query into tokens (regression guard — single includes() missed multi-word queries)"
  );
  assert.ok(
    /tokens\.every\s*\(\s*t\s*=>/.test(content),
    "trailmap-ui: search must use tokens.every() to match all words (regression guard — see 410699c)"
  );
  return { checked: 1 };
}

// Regression guard for: .mapboxgl-popup-close-button lacked a minimum tap target size,
// making the ✕ very difficult to tap on mobile. Fix: min-width/height 44px, flex center.
// (2026-04-17, 447bbb1)
function checkPopupCloseButtonTouchTarget() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, "src", "css", "trailmap.v1.css"), "utf8"
  );
  assert.ok(
    /\.mapboxgl-popup-close-button\s*\{[^}]*min-width\s*:\s*44px/.test(content),
    "trailmap.v1.css: .mapboxgl-popup-close-button must declare min-width: 44px for a reachable tap target"
  );
  assert.ok(
    /\.mapboxgl-popup-close-button\s*\{[^}]*min-height\s*:\s*44px/.test(content),
    "trailmap.v1.css: .mapboxgl-popup-close-button must declare min-height: 44px for a reachable tap target"
  );
  return { checked: 1 };
}

// Regression guard for: .mapboxgl-popup-content used symmetric padding (8px 10px),
// causing popup text to slide under the absolute-positioned close button. Fix: add
// 44px right padding to reserve space for the button. (2026-04-17, 3d7db30)
function checkPopupContentReservesCloseButtonSpace() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, "src", "css", "trailmap.v1.css"), "utf8"
  );
  assert.ok(
    /\.mapboxgl-popup-content\s*\{[^}]*padding\s*:[^;]*\b44px\b/.test(content),
    "trailmap.v1.css: .mapboxgl-popup-content must include 44px right padding to prevent text overlapping the close button"
  );
  return { checked: 1 };
}

// Regression guard for: popup desc was passed through escapeHtml(), stripping <br> and
// other HTML tags that GAS embeds in descriptions. Fix: assign desc directly — it comes
// from GAS-generated JSON which is a trusted internal source. (2026-04-17, 447bbb1)
function checkPopupDescRendersHtml() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, "src", "js", "trailmap-ui.v1.js"), "utf8"
  );
  assert.ok(
    !/let\s+bodyHtml\s*=\s*escapeHtml\s*\(\s*desc\s*\)/.test(content),
    "trailmap-ui: popup bodyHtml must NOT be escapeHtml(desc) — GAS descriptions may contain intentional HTML like <br>"
  );
  assert.ok(
    /let\s+bodyHtml\s*=\s*desc\s*;/.test(content),
    "trailmap-ui: popup bodyHtml must be assigned directly from desc (not escaped)"
  );
  return { checked: 1 };
}

// Regression guard for: trailmap-live.html was missing trailmap-error.v1.js and
// trailmap-listing.v1.js. trailmap-init.v1.js polls for window.TrailmapError via
// bootWhenReady(), so the map never initialized without it. (2026-04-18, 395864d)
function checkTrailmapLiveHtmlScripts() {
  const htmlPath = path.join(REPO_ROOT, "trailmap-live.html");
  const content = fs.readFileSync(htmlPath, "utf8");

  assert.ok(
    /trailmap-error\.v1\.js/.test(content),
    "trailmap-live.html must include trailmap-error.v1.js — trailmap-init polls for window.TrailmapError in bootWhenReady() and never initializes without it"
  );

  assert.ok(
    /trailmap-listing\.v1\.js/.test(content),
    "trailmap-live.html must include trailmap-listing.v1.js (required per CLAUDE.md file map)"
  );

  const errorPos = content.indexOf("trailmap-error.v1.js");
  const initPos = content.indexOf("trailmap-init.v1.js");
  assert.ok(
    errorPos !== -1 && initPos !== -1 && errorPos < initPos,
    "trailmap-live.html: trailmap-error.v1.js must appear before trailmap-init.v1.js — init polls for window.TrailmapError"
  );

  return { checked: 1 };
}

// Regression guard for: setActiveFeature_ used a hardcoded "loc" fallback instead of
// DEFAULTS.locationParam, causing the URL parameter name to diverge from the canonical
// value if DEFAULTS.locationParam was ever changed. Fix: add locationParam to DEFAULTS
// and use it at every call site. (identified 2026-04-14, fix in be3bb4d)
function checkLocationParamConsistency() {
  const filePath = path.join(REPO_ROOT, "src", "js", "trailmap-listing.v1.js");
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  // DEFAULTS must declare locationParam so every call site can reference it
  assert.ok(
    /\blocationParam\s*:/.test(content),
    "trailmap-listing.v1.js: DEFAULTS must define locationParam (regression guard — raw \"loc\" fallbacks diverge from the canonical default)"
  );

  // No LOCATION_PARM initialisation should fall back to a raw string literal
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    if (/\bLOCATION_PARM\s*=\s*window\.LOCATION_PARM\s*\|\|\s*["']/.test(lines[i])) {
      violations.push(`trailmap-listing.v1.js:${i + 1}: ${trimmed}`);
    }
  }
  assert.equal(
    violations.length,
    0,
    `LOCATION_PARM must fall back to DEFAULTS.locationParam, not a raw string literal:\n  ${violations.join("\n  ")}`
  );

  return { checked: 1 };
}

// Regression guard for: buildHTML read p.h / td.h for the hours field, but the
// JSON schema uses p.hr / td.hr — hours were silently blank for every POI that
// had hours set. Fix: updated field key from h to hr. (2026-04-19, 01205ab)
function checkCardHoursFieldKey() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, "src", "js", "northaven-card.v1.js"), "utf8"
  );
  assert.ok(
    /\bp\.hr\b/.test(content),
    "northaven-card.v1.js: must reference p.hr — the hours field was renamed from p.h to p.hr in the JSON schema"
  );
  const hoursLine = content.split("\n").find((l) => /const\s+hours\s*=/.test(l));
  assert.ok(hoursLine, "northaven-card.v1.js: must have a 'const hours =' assignment in buildHTML");
  assert.ok(
    /\bp\.hr\b/.test(hoursLine),
    `northaven-card.v1.js: hours assignment must read p.hr, not p.h — p.h was the old key before the JSON schema rename (got: ${hoursLine?.trim()})`
  );
  return { checked: 1 };
}

// Regression guard for: the sheet drag handler registered touchstart with
// {passive:true}, so e.preventDefault() inside the handler was silently ignored —
// iOS Safari would steal every upward swipe as a page scroll instead of a sheet drag.
// Fix: switched to pointer events registered with {passive:false} so preventDefault()
// takes effect before the browser commits the gesture. (2026-04-19, 01205ab → 72c5b49)
function checkDragListenerIsNonPassive() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, "src", "js", "northaven-card.v1.js"), "utf8"
  );
  assert.ok(
    /addEventListener\s*\(\s*['"]pointermove['"]\s*,\s*\w+\s*,\s*\{\s*passive\s*:\s*false\s*\}/.test(content),
    "northaven-card.v1.js: pointermove must be registered with {passive:false} — passive:true silently drops preventDefault() and lets iOS Safari steal the sheet drag as a page scroll"
  );
  return { checked: 1 };
}

// Regression guard for: m_id values like "NONE", "TBD", or empty strings triggered
// unnecessary Mapillary Graph API fetches that returned 404s and cluttered the network
// tab. Fix: normalizeMid() rejects known sentinel strings and non-numeric values before
// any fetch() call is made. (2026-04-19, 9471d82)
function checkMapillaryMidNormalization() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, "src", "js", "northaven-card.v1.js"), "utf8"
  );
  assert.ok(
    /INVALID_MIDS/.test(content),
    "northaven-card.v1.js: must define INVALID_MIDS to reject sentinel m_id values (NONE, TBD, etc.) before Mapillary API fetches"
  );
  assert.ok(
    /function\s+normalizeMid\s*\(/.test(content),
    "northaven-card.v1.js: must define normalizeMid() to validate and sanitize m_id before any Mapillary fetch() call"
  );
  return { checked: 1 };
}

// Regression guard for: showDesktopCard called panDesktopCardIntoView directly inside
// a single requestAnimationFrame, which fired before Mapbox finished settling after an
// easeTo — the sidecar panel panned to the wrong position or not at all when a marker
// was clicked while the map was still animating. Fix: scheduleDesktopPan fans the pan
// call across double-rAF + 240 ms timeout + moveend so at least one attempt lands after
// the map is stable. (2026-04-20, 342be36)
function checkScheduleDesktopPan() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, "src", "js", "northaven-card-sidecar.v1.js"), "utf8"
  );
  assert.ok(
    /function\s+scheduleDesktopPan\s*\(/.test(content),
    "northaven-card-sidecar.v1.js: scheduleDesktopPan() must be defined — bare panDesktopCardIntoView() in a single rAF fires too early when the map is mid-animation"
  );
  // showDesktopCard must delegate to scheduleDesktopPan, not call panDesktopCardIntoView directly
  const showDesktopCardMatch = content.match(/function\s+showDesktopCard\s*\([^)]*\)\s*\{([\s\S]*?)^  \}/m);
  if (showDesktopCardMatch) {
    assert.ok(
      /scheduleDesktopPan/.test(showDesktopCardMatch[1]),
      "northaven-card-sidecar.v1.js: showDesktopCard must call scheduleDesktopPan(), not panDesktopCardIntoView() directly"
    );
  } else {
    // Fall back to a simpler check: scheduleDesktopPan appears after the function definition
    assert.ok(
      content.indexOf("scheduleDesktopPan") > content.indexOf("function showDesktopCard"),
      "northaven-card-sidecar.v1.js: showDesktopCard must call scheduleDesktopPan() — direct panDesktopCardIntoView() fires before the map settles"
    );
  }
  return { checked: 1 };
}

// Regression guard for: panDesktopCardIntoView set suppressMapEvents = true before
// calling map.easeTo() but never reset it — leaving map click/drag events permanently
// suppressed after the first sidecar pan, until page reload. Fix: map.once('moveend')
// resets suppressMapEvents = false after the easeTo animation completes. (2026-04-20, bc2bdbb)
function checkSuppressMapEventsReset() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, "src", "js", "northaven-card-sidecar.v1.js"), "utf8"
  );
  assert.ok(
    /suppressMapEvents\s*=\s*true/.test(content),
    "northaven-card-sidecar.v1.js: panDesktopCardIntoView must set suppressMapEvents = true before easeTo"
  );
  assert.ok(
    /suppressMapEvents\s*=\s*false/.test(content),
    "northaven-card-sidecar.v1.js: panDesktopCardIntoView must reset suppressMapEvents = false (missing reset left map events permanently suppressed after the first sidecar pan)"
  );
  return { checked: 1 };
}

// Regression guard for: .nc-desktop-card.is-collapsed used translateX(calc(
// var(--nc-sidecar-handle-width) - 100%)) without accounting for the card's 12px left
// inset — the collapsed handle was offset 12px past the viewport edge and clipped.
// Fix: --nc-sidecar-inset CSS variable subtracted from the transform so the handle sits
// flush at the left edge. (2026-04-20, 7358ec9)
function checkCollapsedSidecarTransform() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, "src", "css", "northaven-card-sidecar.v1.css"), "utf8"
  );
  assert.ok(
    /--nc-sidecar-inset/.test(content),
    "northaven-card-sidecar.v1.css: must define --nc-sidecar-inset CSS variable — the collapsed transform must subtract the inset or the handle overflows the viewport edge"
  );
  assert.ok(
    /is-collapsed[^}]*transform\s*:[^}]*var\(--nc-sidecar-inset\)/.test(content),
    "northaven-card-sidecar.v1.css: .nc-desktop-card.is-collapsed transform must include var(--nc-sidecar-inset) — omitting it shifts the collapsed handle 12px off-screen"
  );
  return { checked: 1 };
}

// Regression guard for: the popup image was a raw <img role="button"> with a src_large
// attribute; showModal(img) reads data-src-large from the element, so passing the img
// produced a blank/empty modal image. Fix (13def5e): wrapped in
// <button class="popUpClingImageButton"> with data-src-large / data-alt. The click handler
// passes the button to showModal(). Also: the carousel image was given role="button"
// directly on the <img>; fix wraps it in <button class="val-carousel__img-btn">.
function checkValentineImageButtons() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, "src", "js", "valentines.v2027.v1.js"), "utf8"
  );

  assert.ok(
    /class="popUpClingImageButton"/.test(content),
    "valentines.v2027.v1.js: popup image must use <button class=\"popUpClingImageButton\"> — " +
    "raw <img role=\"button\"> with src_large broke showModal() which reads data-src-large from its argument"
  );
  assert.ok(
    !/img[^>]*role=["']button["'][^>]*src_large/.test(content),
    "valentines.v2027.v1.js: popup image must not have role='button' + src_large on the <img> — " +
    "showModal() now reads data-src-large from the button wrapper, not the img"
  );

  assert.ok(
    /class="val-carousel__img-btn"/.test(content),
    "valentines.v2027.v1.js: carousel image must be inside <button class=\"val-carousel__img-btn\"> — " +
    "interactive element must be a native button, not an img with role=\"button\""
  );
  assert.ok(
    /closest\??\.?\s*\(\s*['"]\.?popUpClingImageButton['"]\s*\)/.test(content),
    "valentines.v2027.v1.js: click handler must use .closest('.popUpClingImageButton') to resolve the button — " +
    "passing the img to showModal() produces an empty modal image"
  );

  return { checked: 1 };
}

// Regression guard for: pressing browser back/forward while a POI card was open caused
// the popstate handler to call goToElement() without setting the backButton flag,
// so flyToMarker pushed a new history entry — trapping the user in an infinite forward loop.
// Fix (4cac835): runDuringHistoryNavigation_() wraps the entire popstate callback, sets
// backButton = true for the duration, and resets userMovedMap_ before flyToMarker.
function checkTrailmapHistoryNavWrapper() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, "src", "js", "trailmap-ui.v1.js"), "utf8"
  );

  assert.ok(
    /function\s+runDuringHistoryNavigation_\s*\(/.test(content),
    "trailmap-ui.v1.js: runDuringHistoryNavigation_() must be defined — " +
    "without it the popstate handler doesn't set backButton=true and flyToMarker pushes a new history entry"
  );
  assert.ok(
    /addEventListener\s*\(\s*["']popstate["'][^)]*\)[\s\S]{1,200}runDuringHistoryNavigation_/.test(content),
    "trailmap-ui.v1.js: popstate listener must call runDuringHistoryNavigation_() — " +
    "bare popstate without this wrapper traps users in a back-navigation loop"
  );
  assert.ok(
    /historyNavigationDepth_/.test(content),
    "trailmap-ui.v1.js: must track historyNavigationDepth_ to handle nested popstate calls safely"
  );

  return { checked: 1 };
}

// Regression guard for: map.easeTo() calls inside panMobileSheetIntoView and show/hide
// sequences triggered map move events, which fired suppressMapEvents checks at the wrong
// time — back/forward navigation panned the map silently but left suppressMapEvents=true
// or fired a spurious popstate. Fix (37abe11): easeMapSilently() wraps easeTo and manages
// suppressMapEvents with a token-guarded moveend listener + timeout fallback.
function checkCardEaseMapSilently() {
  for (const [fileName, jsFile] of [
    ["northaven-card.v1.js", "northaven-card.v1.js"],
    ["northaven-card-sidecar.v1.js", "northaven-card-sidecar.v1.js"]
  ]) {
    const content = fs.readFileSync(path.join(REPO_ROOT, "src", "js", jsFile), "utf8");
    assert.ok(
      /function\s+easeMapSilently\s*\(/.test(content),
      `${fileName}: easeMapSilently() must be defined — direct map.easeTo() triggered spurious map events during back/forward navigation`
    );
    assert.ok(
      /panMobileSheetIntoView[\s\S]{1,600}easeMapSilently\s*\(/.test(content),
      `${fileName}: panMobileSheetIntoView must delegate to easeMapSilently() instead of calling map.easeTo() directly`
    );
  }
  return { checked: 2 };
}

// Regression guard for: initTurnstile relied on turnstile.ready() (a single callback)
// which silently failed when the Turnstile script hadn't loaded yet. If the script loaded
// late (slow network, CSP delay) the widget was never rendered and the form could not be
// submitted. Fix (adcf031): initTurnstile now accepts attemptsRemaining and retries up to
// 20 times (500 ms intervals) before giving up, with error-callback retry as well.
function checkTurnstileRetryLoop() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, "src", "js", "issue-tracker.v1.js"), "utf8"
  );
  assert.ok(
    /function\s+initTurnstile\s*\(\s*attemptsRemaining/.test(content),
    "issue-tracker.v1.js: initTurnstile must accept an attemptsRemaining parameter — " +
    "single turnstile.ready() callback failed silently when the Turnstile script loaded late"
  );
  assert.ok(
    /attemptsRemaining\s*-\s*1/.test(content),
    "issue-tracker.v1.js: initTurnstile must recurse with attemptsRemaining - 1 — " +
    "without the decrement the retry loop runs forever or not at all"
  );
  assert.ok(
    /attemptsRemaining\s*>\s*0/.test(content),
    "issue-tracker.v1.js: initTurnstile must guard recursion with attemptsRemaining > 0 — " +
    "missing guard causes infinite retry on persistent Turnstile failures"
  );
  return { checked: 1 };
}

// Regression guard for: POIs that belong to neighbouring parks or sponsors had no way
// to opt out of the issue-tracker CTA — ni=FALSE on the feature or its type was ignored,
// so non-trail POIs appeared as reportable locations. Fix (2fea76d): shouldShowReportIssueCta_()
// reads the ni flag from the feature and its type definition and returns false when either
// is explicitly false.
function checkNiFilterFunctions() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, "src", "js", "northaven-card.v1.js"), "utf8"
  );
  assert.ok(
    /function\s+normalizeFlagValue_\s*\(/.test(content),
    "northaven-card.v1.js: normalizeFlagValue_() must be defined — " +
    "ni flag values can be boolean, number, or string ('FALSE'/'false'/'0') and need normalization"
  );
  assert.ok(
    /function\s+readNoIssueTrackerFlag_\s*\(/.test(content),
    "northaven-card.v1.js: readNoIssueTrackerFlag_() must be defined — " +
    "checks both 'ni' and 'NI' properties so GAS-generated JSON with either casing is handled"
  );
  assert.ok(
    /function\s+shouldShowReportIssueCta_\s*\(/.test(content),
    "northaven-card.v1.js: shouldShowReportIssueCta_() must be defined — " +
    "missing function allows ni=FALSE POIs (non-trail parks, sponsors) to appear as reportable locations"
  );
  assert.ok(
    /shouldShowReportIssueCta_\s*\(/.test(content.replace(/function\s+shouldShowReportIssueCta_/, "")),
    "northaven-card.v1.js: shouldShowReportIssueCta_() must be called at the CTA build site — " +
    "defining the function without calling it has no effect"
  );
  return { checked: 1 };
}

// Regression guard for: gesture-control called positionTip_() synchronously on every
// resize event and on every fullscreen toggle — each call forced a synchronous layout read
// (getBoundingClientRect / offsetHeight) immediately after a style change, causing layout
// thrash. Fix (68587e9, 9f51a53): schedulePositionTip_() debounces the call through
// requestAnimationFrame so layout reads happen after paint, not mid-frame. The resize
// listener and fullscreen branch must both go through schedulePositionTip_, and
// tipPositionFrame must be cancelled in destroyGestureControl() to avoid stale callbacks.
function checkGestureControlSchedulePositionTip() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, "src", "js", "gesture-control.v1.js"), "utf8"
  );
  assert.ok(
    /function\s+schedulePositionTip_\s*\(/.test(content),
    "gesture-control.v1.js: schedulePositionTip_() must be defined — direct positionTip_() calls on resize caused layout thrash (synchronous layout read mid-frame)"
  );
  assert.ok(
    /addEventListener\s*\(\s*["']resize["'][^)]*schedulePositionTip_/.test(content),
    "gesture-control.v1.js: resize listener must use schedulePositionTip_, not positionTip_ directly — direct call causes layout thrash on every resize event"
  );
  assert.ok(
    /cancelAnimationFrame\s*\(\s*tipPositionFrame\s*\)/.test(content),
    "gesture-control.v1.js: tipPositionFrame rAF must be cancelled (cancelAnimationFrame) — missing cancel lets stale tip-position callbacks fire after destroy"
  );
  return { checked: 1 };
}

// Regression guard for: FullscreenMapControl._renderIcon() replaced this._btn.innerHTML
// on every fullscreen toggle — destroying and recreating the entire SVG subtree caused
// unnecessary DOM churn and broke any references held by other code. Fix (68587e9): split
// into _mountIcon() (called once at onAdd) which builds the SVG and caches this._iconUse,
// and _renderIcon() which only sets the href attribute on the cached <use> element.
function checkFullscreenIconMountOnce() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, "src", "js", "trailmap-fullscreen.v1.js"), "utf8"
  );
  assert.ok(
    /function\s+_mountIcon\s*\(\s*\)|_mountIcon\s*\(\s*\)\s*\{/.test(content),
    "trailmap-fullscreen.v1.js: _mountIcon() must be defined — without it _renderIcon() uses innerHTML, destroying and recreating the SVG subtree on every toggle"
  );
  assert.ok(
    /this\._iconUse/.test(content),
    "trailmap-fullscreen.v1.js: _iconUse must be cached on the instance — _renderIcon() must update href on the cached <use> element, not re-render the whole SVG"
  );
  assert.ok(
    !/this\._btn\.innerHTML\s*=\s*`[\s\S]*?<svg/.test(content),
    "trailmap-fullscreen.v1.js: _renderIcon must not set this._btn.innerHTML to an SVG string — use this._iconUse.setAttribute('href', ...) instead to avoid DOM churn"
  );
  return { checked: 1 };
}

// Regression guard for: FullscreenMapControl._toggle() called updateSafeViewport(),
// onToggle, and map.resize() in a single synchronous block (or single rAF), before the
// browser had applied the fullscreen CSS class changes — layout reads inside those calls
// returned stale geometry. Fix (68587e9, 9f51a53): a two-frame rAF chain lets the
// fullscreen class land in frame A (updateSafeViewport), then onToggle and map.resize()
// run in frame B after one more paint. Pending frames must also be cancelled in remove().
function checkFullscreenTwoFramePostToggle() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, "src", "js", "trailmap-fullscreen.v1.js"), "utf8"
  );
  assert.ok(
    /_postToggleFrameA/.test(content),
    "trailmap-fullscreen.v1.js: _postToggleFrameA must be tracked — the toggle sequence needs a two-frame rAF chain so CSS changes land before geometry reads"
  );
  assert.ok(
    /_postToggleFrameB/.test(content),
    "trailmap-fullscreen.v1.js: _postToggleFrameB must be tracked — onToggle and map.resize() must run in the second rAF frame, after updateSafeViewport() in the first"
  );
  // remove() must cancel both pending frames
  const removeMatch = content.match(/remove\s*\(\s*\)\s*\{([\s\S]*?)^\s{4}\}/m);
  if (removeMatch) {
    assert.ok(
      /cancelAnimationFrame/.test(removeMatch[1]),
      "trailmap-fullscreen.v1.js: remove() must cancel pending _postToggleFrame rAFs — leaving them live causes onToggle/resize to fire after the control is torn down"
    );
  } else {
    assert.ok(
      /remove[\s\S]{1,400}cancelAnimationFrame/.test(content),
      "trailmap-fullscreen.v1.js: remove() must cancel pending _postToggleFrame rAFs — leaving them live causes onToggle/resize to fire after the control is torn down"
    );
  }
  return { checked: 1 };
}

// Regression guard for: donations.v1.js read the progress label via
// querySelector('.progress'), but the CSS class was renamed to 'fund-progress-label' and
// the generated HTML uses <span class="fund-progress-label"> — the querySelector missed
// the element and the percentage label stayed at its initial "0%". Fix (c662b30): the
// selector was updated to '.fund-progress-label, .progress' so both the new and any
// legacy markup are found. Also: .fund-bar--tails .meter needed min-width:0 to prevent
// the flex item from overflowing its row when the bar was narrow.
function checkDonationsProgressLabelSelector() {
  const jsContent = fs.readFileSync(
    path.join(REPO_ROOT, "src", "js", "donations.v1.js"), "utf8"
  );
  assert.ok(
    /querySelector\s*\(\s*['"]\.fund-progress-label/.test(jsContent),
    "donations.v1.js: querySelector must target .fund-progress-label — the old .progress class was renamed and the bare .progress selector silently missed the element, leaving the % label stuck at 0%"
  );

  const cssContent = fs.readFileSync(
    path.join(REPO_ROOT, "src", "css", "donations.v1.css"), "utf8"
  );
  assert.ok(
    /\.fund-bar--tails\s+\.meter\s*\{[^}]*min-width\s*:\s*0/.test(cssContent),
    "donations.v1.css: .fund-bar--tails .meter must declare min-width:0 — without it the flex item can overflow its container when the fund-bar is narrow"
  );
  assert.ok(
    /\.fund-bar--tails\s+\.fund-progress-label\s*\{/.test(cssContent),
    "donations.v1.css: .fund-bar--tails must style .fund-progress-label (not .progress) — the class was renamed and the CSS must match the generated HTML"
  );
  return { checked: 2 };
}

// Regression guard for: the CTA <a> link in buildDesktopCardHTML had no target
// attribute — external CTAs (e.g. links to partner sites) opened in the same tab,
// navigating the user away from the map. Fix: isExternalDomain() check added; external
// CTAs get target="_blank" rel="noopener noreferrer". (2026-04-20, 7358ec9)
function checkCtaExternalTarget() {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, "src", "js", "northaven-card-sidecar.v1.js"), "utf8"
  );
  assert.ok(
    /isExternalDomain\s*\(\s*resolvedCta\s*\)/.test(content),
    "northaven-card-sidecar.v1.js: CTA link must call isExternalDomain(resolvedCta) to detect external URLs before setting target — missing check left external CTAs opening in the same tab"
  );
  assert.ok(
    /ctaTarget/.test(content),
    "northaven-card-sidecar.v1.js: CTA link must use a ctaTarget variable to conditionally apply target=\"_blank\" rel=\"noopener noreferrer\" for external CTAs"
  );
  return { checked: 1 };
}

function main() {
  const manifestNames = Object.keys(MANIFEST_VALIDATORS).sort();
  const results = manifestNames.map(validateManifest);

  const logCheck = checkNoConsoleLogs();
  const trailmapLiveHtmlCheck = checkTrailmapLiveHtmlScripts();
  const locationParamCheck = checkLocationParamConsistency();
  const lightboxEscapeCheck = checkLightboxEscapeCondition();
  const searchTokenCheck = checkSearchTokenization();
  const closeButtonCheck = checkPopupCloseButtonTouchTarget();
  const popupPaddingCheck = checkPopupContentReservesCloseButtonSpace();
  const descHtmlCheck = checkPopupDescRendersHtml();
  const cardHoursKeyCheck = checkCardHoursFieldKey();
  const dragPassiveCheck = checkDragListenerIsNonPassive();
  const mapillaryMidCheck = checkMapillaryMidNormalization();
  const scheduleDesktopPanCheck = checkScheduleDesktopPan();
  const suppressResetCheck = checkSuppressMapEventsReset();
  const collapsedTransformCheck = checkCollapsedSidecarTransform();
  const ctaExternalCheck = checkCtaExternalTarget();
  const valentineImageBtnCheck = checkValentineImageButtons();
  const trailmapHistoryNavCheck = checkTrailmapHistoryNavWrapper();
  const cardEaseSilentlyCheck = checkCardEaseMapSilently();
  const turnstileRetryCheck = checkTurnstileRetryLoop();
  const niFilterCheck = checkNiFilterFunctions();
  const gestureScheduleCheck = checkGestureControlSchedulePositionTip();
  const fullscreenIconMountCheck = checkFullscreenIconMountOnce();
  const fullscreenTwoFrameCheck = checkFullscreenTwoFramePostToggle();
  const donationsLabelCheck = checkDonationsProgressLabelSelector();

  console.log("Contract checks passed:");
  for (const result of results) {
    console.log(`- ${result.manifestName} (${result.checkedPayloads} payload file(s), version ${result.version})`);
  }
  console.log(`- no console.log in src/js (${logCheck.checked} file(s) checked)`);
  console.log(`- trailmap-live.html includes trailmap-error + trailmap-listing before trailmap-init (${trailmapLiveHtmlCheck.checked} file(s) checked)`);
  console.log(`- LOCATION_PARM uses DEFAULTS.locationParam (${locationParamCheck.checked} file(s) checked)`);
  console.log(`- lightbox escape guard uses display !== 'none' (${lightboxEscapeCheck.checked} file(s) checked)`);
  console.log(`- search uses token splitting with .every() (${searchTokenCheck.checked} file(s) checked)`);
  console.log(`- popup close button has 44px min touch target (${closeButtonCheck.checked} file(s) checked)`);
  console.log(`- popup content reserves 44px for close button (${popupPaddingCheck.checked} file(s) checked)`);
  console.log(`- popup desc renders HTML from GAS without escaping (${descHtmlCheck.checked} file(s) checked)`);
  console.log(`- northaven-card hours field uses p.hr (not old p.h) (${cardHoursKeyCheck.checked} file(s) checked)`);
  console.log(`- northaven-card pointermove drag is non-passive (${dragPassiveCheck.checked} file(s) checked)`);
  console.log(`- northaven-card normalizeMid rejects sentinel m_id values (${mapillaryMidCheck.checked} file(s) checked)`);
  console.log(`- sidecar showDesktopCard uses scheduleDesktopPan (not bare rAF pan) (${scheduleDesktopPanCheck.checked} file(s) checked)`);
  console.log(`- sidecar panDesktopCardIntoView resets suppressMapEvents on moveend (${suppressResetCheck.checked} file(s) checked)`);
  console.log(`- sidecar collapsed transform subtracts --nc-sidecar-inset (${collapsedTransformCheck.checked} file(s) checked)`);
  console.log(`- sidecar CTA link uses isExternalDomain for target=_blank (${ctaExternalCheck.checked} file(s) checked)`);
  console.log(`- valentine popup/carousel use native button elements (not img role=button) (${valentineImageBtnCheck.checked} file(s) checked)`);
  console.log(`- trailmap popstate wrapped in runDuringHistoryNavigation_ (${trailmapHistoryNavCheck.checked} file(s) checked)`);
  console.log(`- card/sidecar easeTo calls use easeMapSilently (${cardEaseSilentlyCheck.checked} file(s) checked)`);
  console.log(`- issue-tracker Turnstile init has retry loop with attemptsRemaining (${turnstileRetryCheck.checked} file(s) checked)`);
  console.log(`- northaven-card ni=FALSE filter functions present and called (${niFilterCheck.checked} file(s) checked)`);
  console.log(`- gesture-control resize uses schedulePositionTip_ rAF debounce (${gestureScheduleCheck.checked} file(s) checked)`);
  console.log(`- fullscreen icon mounted once via _mountIcon/_iconUse (not innerHTML) (${fullscreenIconMountCheck.checked} file(s) checked)`);
  console.log(`- fullscreen post-toggle uses two-frame rAF chain with frame cancellation (${fullscreenTwoFrameCheck.checked} file(s) checked)`);
  console.log(`- donations querySelector targets .fund-progress-label and .meter has min-width:0 (${donationsLabelCheck.checked} file(s) checked)`);
}

try {
  main();
} catch (error) {
  console.error(`Contract check failed: ${error.message}`);
  process.exit(1);
}
