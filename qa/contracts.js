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

function main() {
  const manifestNames = Object.keys(MANIFEST_VALIDATORS).sort();
  const results = manifestNames.map(validateManifest);

  console.log("Contract checks passed:");
  for (const result of results) {
    console.log(`- ${result.manifestName} (${result.checkedPayloads} payload file(s), version ${result.version})`);
  }
}

try {
  main();
} catch (error) {
  console.error(`Contract check failed: ${error.message}`);
  process.exit(1);
}
