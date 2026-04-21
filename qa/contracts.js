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
}

try {
  main();
} catch (error) {
  console.error(`Contract check failed: ${error.message}`);
  process.exit(1);
}
