/**
 * Populates closest parking (`cp`) and nearby amenities (`na`) columns
 * for a POI sheet whose human labels live on row 3 and JSON keys on row 4.
 *
 * Column detection uses the row-4 key row first, with row-3 labels as fallback.
 * Data rows begin on row 5 by default.
 */

var DEFAULT_CP_NA_OPTIONS = {
  headerRow: 3,
  keyRow: 4,
  dataStartRow: 5,
  overwriteCp: false,
  overwriteNa: false,
  forceLockedRows: false,
  respectActiveColumn: true,
  inactiveValues: ['false', '0', 'no', 'inactive', 'off'],
  maxNearbyAmenities: 3,
  maxNearbyAmenityMiles: 0.25,
  maxClosestParkingMiles: null,
  includeParkingInNa: false,
  dedupeNaByType: true,
  preferAccessPoints: true,
  preferRestAreas: false,
  parkingRowGetsCp: false,
  duplicateIdMode: 'first-wins',
  writeDebugNotes: false,
  debugColumnPrefix: '_debug_',
  dryRun: false,
  parkingTypeKeys: ['parking', 'parking_lot', 'pl'],
  nearbyAmenityTypeKeys: [
    'parking',
    'parking_lot',
    'pl',
    'rest_area',
    'ra',
    'pet_waste',
    'pc',
    'pu',
    'water',
    'water_fountain',
    'df',
    'access_point',
    'bench',
    'be',
    'bike_fix',
    'repair_station',
    'bi',
    'shade',
    'kiosk',
    'ki',
    'picnic_table',
    'pt'
  ],
  typePriorityBonus: {
    access_point: -0.03,
    rest_area: -0.02,
    ra: -0.02
  },
  lockColumnKeys: ['lock_relations', 'cp_na_lock', 'relations_lock', 'override_relations'],
  activeColumnKeys: ['active'],
  cpColumnKeys: ['cp'],
  naColumnKeys: ['na']
};

function populateCpAndNaForActiveSheet(options) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  return populateCpAndNaForSheet(sheet.getName(), options);
}

function dryRunPopulateCpAndNaForActiveSheet(options) {
  var merged = mergeOptions_(DEFAULT_CP_NA_OPTIONS, options || {});
  merged.dryRun = true;
  return populateCpAndNaForActiveSheet(merged);
}

function populateCpAndNaForSheet(sheetName, options) {
  var settings = mergeOptions_(DEFAULT_CP_NA_OPTIONS, options || {});
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Sheet not found: ' + sheetName);
  }

  ensureMinimumSheetRows_(sheet, settings.keyRow);

  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headerRowValues = sheet.getRange(settings.headerRow, 1, 1, lastColumn).getValues()[0];
  var keyRowValues = sheet.getRange(settings.keyRow, 1, 1, lastColumn).getValues()[0];

  var outputInfo = ensureOutputColumns_(sheet, {
    headerRow: settings.headerRow,
    keyRow: settings.keyRow,
    neededKeys: ['cp', 'na']
  });

  lastColumn = Math.max(sheet.getLastColumn(), 1);
  headerRowValues = sheet.getRange(settings.headerRow, 1, 1, lastColumn).getValues()[0];
  keyRowValues = sheet.getRange(settings.keyRow, 1, 1, lastColumn).getValues()[0];

  var headerMap = getHeaderMap_(headerRowValues, keyRowValues);
  var columnRefs = resolveColumnRefs_(headerMap, settings);
  validateRequiredColumns_(columnRefs);

  var lastRow = sheet.getLastRow();
  var dataRowCount = Math.max(0, lastRow - settings.dataStartRow + 1);
  var values = dataRowCount > 0
    ? sheet.getRange(settings.dataStartRow, 1, dataRowCount, lastColumn).getValues()
    : [];

  var parsed = parseRowsToFeatures_(values, columnRefs, settings);
  var results = computeCpAndNaResults_(parsed.features, settings);
  var outputArrays = buildOutputArrays_(parsed, results, columnRefs, settings);

  if (!settings.dryRun && dataRowCount > 0) {
    writeOutputColumns_(sheet, settings, columnRefs, outputArrays, dataRowCount);
    if (settings.writeDebugNotes) {
      writeDebugColumns_(sheet, settings, outputArrays, dataRowCount);
    }
  }

  var summary = buildSummary_({
    sheetName: sheetName,
    totalRowsRead: values.length,
    validFeatureRows: parsed.features.length,
    invalidRows: parsed.invalidRows,
    duplicateIds: parsed.duplicateIds,
    cpWritten: outputArrays.cpWritten,
    naWritten: outputArrays.naWritten,
    cpSkippedExisting: outputArrays.cpSkippedExisting,
    naSkippedExisting: outputArrays.naSkippedExisting,
    lockedRowsSkipped: outputArrays.lockedRowsSkipped,
    inactiveRowsSkipped: parsed.inactiveRowsSkipped,
    dryRun: settings.dryRun
  });

  Logger.log(formatSummaryForLog_(summary));
  return summary;
}

function ensureMinimumSheetRows_(sheet, minimumRowCount) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  if (sheet.getMaxRows() < minimumRowCount) {
    sheet.insertRowsAfter(sheet.getMaxRows(), minimumRowCount - sheet.getMaxRows());
  }
  if (sheet.getLastColumn() < 1) {
    sheet.insertColumnAfter(1);
  }
  if (sheet.getLastColumn() !== lastColumn) {
    lastColumn = sheet.getLastColumn();
  }
}

function ensureOutputColumns_(sheet, config) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headerRow = sheet.getRange(config.headerRow, 1, 1, lastColumn).getValues()[0];
  var keyRow = sheet.getRange(config.keyRow, 1, 1, lastColumn).getValues()[0];
  var headerMap = getHeaderMap_(headerRow, keyRow);
  var addedKeys = [];

  for (var i = 0; i < config.neededKeys.length; i += 1) {
    var neededKey = normalizeHeader_(config.neededKeys[i]);
    if (headerMap[neededKey]) {
      continue;
    }

    sheet.insertColumnAfter(sheet.getLastColumn());
    var newColumn = sheet.getLastColumn();
    sheet.getRange(config.headerRow, newColumn).setValue(String(config.neededKeys[i]).toUpperCase());
    sheet.getRange(config.keyRow, newColumn).setValue(config.neededKeys[i]);
    addedKeys.push(config.neededKeys[i]);
  }

  return { addedKeys: addedKeys };
}

function getHeaderMap_(headerRowValues, keyRowValues) {
  var map = {};
  for (var i = 0; i < Math.max(headerRowValues.length, keyRowValues.length); i += 1) {
    var keyName = normalizeHeader_(keyRowValues[i]);
    var headerName = normalizeHeader_(headerRowValues[i]);
    if (keyName && !map[keyName]) {
      map[keyName] = i + 1;
    }
    if (headerName && !map[headerName]) {
      map[headerName] = i + 1;
    }
  }
  return map;
}

function normalizeHeader_(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function resolveColumnRefs_(headerMap, options) {
  return {
    id: findFirstColumn_(headerMap, ['id']),
    type: findFirstColumn_(headerMap, ['t', 'type']),
    lat: findFirstColumn_(headerMap, ['lat', 'latitude']),
    lng: findFirstColumn_(headerMap, ['lng', 'lon', 'long', 'longitude']),
    name: findFirstColumn_(headerMap, ['n', 'l', 'name', 'label']),
    near: findFirstColumn_(headerMap, ['r', 'near']),
    cp: findFirstColumn_(headerMap, options.cpColumnKeys),
    na: findFirstColumn_(headerMap, options.naColumnKeys),
    lock: findFirstColumn_(headerMap, options.lockColumnKeys),
    active: findFirstColumn_(headerMap, options.activeColumnKeys)
  };
}

function findFirstColumn_(headerMap, keys) {
  for (var i = 0; i < keys.length; i += 1) {
    var normalized = normalizeHeader_(keys[i]);
    if (normalized && headerMap[normalized]) {
      return headerMap[normalized];
    }
  }
  return null;
}

function validateRequiredColumns_(columnRefs) {
  var missing = [];
  if (!columnRefs.id) missing.push('id');
  if (!columnRefs.type) missing.push('t');
  if (!columnRefs.lat) missing.push('lat');
  if (!columnRefs.lng) missing.push('lng');
  if (!columnRefs.cp) missing.push('cp');
  if (!columnRefs.na) missing.push('na');

  if (missing.length) {
    throw new Error('Missing required columns: ' + missing.join(', '));
  }
}

function parseRowsToFeatures_(values, columnRefs, options) {
  var features = [];
  var invalidRows = [];
  var duplicateIds = [];
  var inactiveRowsSkipped = 0;
  var seenIds = {};

  for (var rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    var rawRow = values[rowIndex];
    var rowNumber = options.dataStartRow + rowIndex;
    var rawId = getCell_(rawRow, columnRefs.id);
    var id = String(rawId == null ? '' : rawId).trim();
    var typeKey = normalizeHeader_(getCell_(rawRow, columnRefs.type));
    var lat = toFiniteNumber_(getCell_(rawRow, columnRefs.lat));
    var lng = toFiniteNumber_(getCell_(rawRow, columnRefs.lng));
    var isActive = isRowActive_(rawRow, columnRefs, options);
    var isLocked = columnRefs.lock ? isTruthyCell_(getCell_(rawRow, columnRefs.lock)) : false;
    var validationErrors = [];

    if (!id) validationErrors.push('missing id');
    if (!typeKey) validationErrors.push('missing type');
    if (!isFinite(lat)) validationErrors.push('invalid lat');
    if (!isFinite(lng)) validationErrors.push('invalid lng');

    if (!isActive) {
      inactiveRowsSkipped += 1;
    }

    if (validationErrors.length || !isActive) {
      invalidRows.push({
        rowNumber: rowNumber,
        id: id,
        reasons: !isActive ? validationErrors.concat(['inactive']) : validationErrors
      });
      continue;
    }

    if (seenIds[id]) {
      duplicateIds.push({
        id: id,
        rowNumber: rowNumber,
        firstRowNumber: seenIds[id]
      });
      invalidRows.push({
        rowNumber: rowNumber,
        id: id,
        reasons: ['duplicate id']
      });

      if (options.duplicateIdMode === 'fail') {
        throw new Error('Duplicate id "' + id + '" found at row ' + rowNumber);
      }
      continue;
    }

    seenIds[id] = rowNumber;
    features.push({
      rowNumber: rowNumber,
      rowIndex: rowIndex,
      id: id,
      typeKey: typeKey,
      name: String(getCell_(rawRow, columnRefs.name) || '').trim(),
      near: String(getCell_(rawRow, columnRefs.near) || '').trim(),
      lat: lat,
      lng: lng,
      isParking: containsNormalized_(options.parkingTypeKeys, typeKey),
      isAmenityCandidate: containsNormalized_(options.nearbyAmenityTypeKeys, typeKey),
      isActive: true,
      isLocked: isLocked,
      existingCp: String(getCell_(rawRow, columnRefs.cp) || ''),
      existingNa: String(getCell_(rawRow, columnRefs.na) || ''),
      rawRow: rawRow
    });
  }

  return {
    features: features,
    invalidRows: invalidRows,
    duplicateIds: duplicateIds,
    inactiveRowsSkipped: inactiveRowsSkipped
  };
}

function isRowActive_(rawRow, columnRefs, options) {
  if (!options.respectActiveColumn || !columnRefs.active) {
    return true;
  }
  var value = getCell_(rawRow, columnRefs.active);
  if (isBlankCell_(value)) {
    return true;
  }
  var normalized = normalizeHeader_(value);
  return options.inactiveValues.map(normalizeHeader_).indexOf(normalized) === -1;
}

function isTruthyCell_(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  var normalized = normalizeHeader_(value);
  return ['true', '1', 'yes', 'y', 'locked', 'lock'].indexOf(normalized) !== -1;
}

function isBlankCell_(value) {
  return value == null || String(value).trim() === '';
}

function getCell_(rawRow, columnNumber) {
  return columnNumber ? rawRow[columnNumber - 1] : '';
}

function toFiniteNumber_(value) {
  var parsed = typeof value === 'number' ? value : parseFloat(String(value).trim());
  return isFinite(parsed) ? parsed : NaN;
}

function containsNormalized_(values, target) {
  var normalizedTarget = normalizeHeader_(target);
  for (var i = 0; i < values.length; i += 1) {
    if (normalizeHeader_(values[i]) === normalizedTarget) {
      return true;
    }
  }
  return false;
}

function computeCpAndNaResults_(features, options) {
  var results = {};
  var parkingFeatures = [];
  var amenityFeatures = [];

  for (var i = 0; i < features.length; i += 1) {
    if (features[i].isParking) {
      parkingFeatures.push(features[i]);
    }
    if (features[i].isAmenityCandidate) {
      amenityFeatures.push(features[i]);
    }
  }

  if (!parkingFeatures.length) {
    Logger.log('populateCpAndNaForSheet: no parking rows found; cp will remain blank.');
  }

  for (var j = 0; j < features.length; j += 1) {
    var feature = features[j];
    results[feature.id] = {
      cp: computeClosestParking_(feature, parkingFeatures, options),
      na: computeNearbyAmenities_(feature, amenityFeatures, options)
    };
  }

  return results;
}

function computeClosestParking_(feature, parkingFeatures, options) {
  if (feature.isParking && !options.parkingRowGetsCp) {
    return { id: '', distanceMiles: null, reason: 'parking-row' };
  }

  var best = null;
  for (var i = 0; i < parkingFeatures.length; i += 1) {
    var candidate = parkingFeatures[i];
    if (candidate.id === feature.id) {
      continue;
    }

    var distanceMiles = haversineMiles_(feature.lng, feature.lat, candidate.lng, candidate.lat);
    if (options.maxClosestParkingMiles != null && distanceMiles > options.maxClosestParkingMiles) {
      continue;
    }

    if (!best || distanceMiles < best.distanceMiles) {
      best = {
        id: candidate.id,
        distanceMiles: distanceMiles
      };
    }
  }

  return best || { id: '', distanceMiles: null, reason: 'no-match' };
}

function computeNearbyAmenities_(feature, amenityFeatures, options) {
  var candidates = [];

  for (var i = 0; i < amenityFeatures.length; i += 1) {
    var candidate = amenityFeatures[i];
    if (candidate.id === feature.id) {
      continue;
    }
    if (!options.includeParkingInNa && candidate.isParking) {
      continue;
    }

    var distanceMiles = haversineMiles_(feature.lng, feature.lat, candidate.lng, candidate.lat);
    if (distanceMiles > options.maxNearbyAmenityMiles) {
      continue;
    }

    candidates.push({
      id: candidate.id,
      typeKey: candidate.typeKey,
      distanceMiles: distanceMiles,
      score: scoreNearbyAmenity_(candidate, distanceMiles, options)
    });
  }

  candidates.sort(function(a, b) {
    if (a.score !== b.score) {
      return a.score - b.score;
    }
    if (a.distanceMiles !== b.distanceMiles) {
      return a.distanceMiles - b.distanceMiles;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  if (options.dedupeNaByType) {
    candidates = dedupeCandidatesByType_(candidates);
  }

  candidates = candidates.slice(0, Math.max(0, options.maxNearbyAmenities));

  return {
    ids: candidates.map(function(candidate) { return candidate.id; }),
    distances: candidates.map(function(candidate) {
      return {
        id: candidate.id,
        typeKey: candidate.typeKey,
        distanceMiles: candidate.distanceMiles
      };
    })
  };
}

function scoreNearbyAmenity_(candidate, distanceMiles, options) {
  var score = distanceMiles;
  var typeKey = normalizeHeader_(candidate.typeKey);

  if (options.preferAccessPoints && (typeKey === 'access_point' || typeKey === 'ap')) {
    score -= 0.02;
  }
  if (options.preferRestAreas && (typeKey === 'rest_area' || typeKey === 'ra')) {
    score -= 0.02;
  }
  if (options.typePriorityBonus && Object.prototype.hasOwnProperty.call(options.typePriorityBonus, typeKey)) {
    score += Number(options.typePriorityBonus[typeKey]) || 0;
  }

  return score;
}

function dedupeCandidatesByType_(candidates) {
  var seenTypes = {};
  var deduped = [];
  for (var i = 0; i < candidates.length; i += 1) {
    var typeKey = normalizeHeader_(candidates[i].typeKey);
    if (seenTypes[typeKey]) {
      continue;
    }
    seenTypes[typeKey] = true;
    deduped.push(candidates[i]);
  }
  return deduped;
}

function haversineMiles_(lng1, lat1, lng2, lat2) {
  var toRadians = Math.PI / 180;
  var dLat = (lat2 - lat1) * toRadians;
  var dLng = (lng2 - lng1) * toRadians;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRadians) * Math.cos(lat2 * toRadians) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  var earthRadiusMiles = 3958.7613;
  return earthRadiusMiles * c;
}

function buildOutputArrays_(parsed, results, columnRefs, options) {
  var cpValues = [];
  var naValues = [];
  var debugStatus = [];
  var debugCpDistance = [];
  var debugNaDistances = [];
  var featureByRowIndex = {};

  for (var i = 0; i < parsed.features.length; i += 1) {
    featureByRowIndex[parsed.features[i].rowIndex] = parsed.features[i];
  }

  var cpWritten = 0;
  var naWritten = 0;
  var cpSkippedExisting = 0;
  var naSkippedExisting = 0;
  var lockedRowsSkipped = 0;

  var totalRows = parsed.features.length + parsed.invalidRows.length;
  var maxRowIndex = -1;
  for (var featureIndex = 0; featureIndex < parsed.features.length; featureIndex += 1) {
    if (parsed.features[featureIndex].rowIndex > maxRowIndex) {
      maxRowIndex = parsed.features[featureIndex].rowIndex;
    }
  }
  for (var invalidIndex = 0; invalidIndex < parsed.invalidRows.length; invalidIndex += 1) {
    var invalidRowIndex = parsed.invalidRows[invalidIndex].rowNumber - options.dataStartRow;
    if (invalidRowIndex > maxRowIndex) {
      maxRowIndex = invalidRowIndex;
    }
  }

  for (var rowIndex = 0; rowIndex <= maxRowIndex; rowIndex += 1) {
    var feature = featureByRowIndex[rowIndex];

    if (!feature) {
      cpValues.push(['']);
      naValues.push(['']);
      debugStatus.push(['skipped']);
      debugCpDistance.push(['']);
      debugNaDistances.push(['']);
      continue;
    }

    var computed = results[feature.id];
    var locked = feature.isLocked && !options.forceLockedRows;

    if (locked) {
      lockedRowsSkipped += 1;
    }

    var nextCp = feature.existingCp;
    var nextNa = feature.existingNa;
    var rowStatus = [];

    if (locked) {
      rowStatus.push('locked');
    } else {
      if (options.overwriteCp || isBlankCell_(feature.existingCp)) {
        nextCp = computed.cp.id || '';
        cpWritten += nextCp !== String(feature.existingCp || '') ? 1 : 0;
      } else {
        cpSkippedExisting += 1;
        rowStatus.push('kept-cp');
      }

      if (options.overwriteNa || isBlankCell_(feature.existingNa)) {
        nextNa = computed.na.ids.join(',');
        naWritten += nextNa !== String(feature.existingNa || '') ? 1 : 0;
      } else {
        naSkippedExisting += 1;
        rowStatus.push('kept-na');
      }
    }

    cpValues.push([nextCp]);
    naValues.push([nextNa]);
    debugStatus.push([rowStatus.join(',') || 'computed']);
    debugCpDistance.push([computed.cp.distanceMiles == null ? '' : roundTo_(computed.cp.distanceMiles, 4)]);
    debugNaDistances.push([computed.na.distances.map(function(item) {
      return item.id + ':' + roundTo_(item.distanceMiles, 4);
    }).join(',')]);
  }

  return {
    cpValues: cpValues,
    naValues: naValues,
    debugStatus: debugStatus,
    debugCpDistance: debugCpDistance,
    debugNaDistances: debugNaDistances,
    cpWritten: cpWritten,
    naWritten: naWritten,
    cpSkippedExisting: cpSkippedExisting,
    naSkippedExisting: naSkippedExisting,
    lockedRowsSkipped: lockedRowsSkipped
  };
}

function writeOutputColumns_(sheet, options, columnRefs, outputArrays, dataRowCount) {
  sheet.getRange(options.dataStartRow, columnRefs.cp, dataRowCount, 1).setValues(outputArrays.cpValues);
  sheet.getRange(options.dataStartRow, columnRefs.na, dataRowCount, 1).setValues(outputArrays.naValues);
}

function writeDebugColumns_(sheet, options, outputArrays, dataRowCount) {
  var debugColumns = ensureDebugColumns_(sheet, options, [
    { key: options.debugColumnPrefix + 'status', label: 'Debug Status' },
    { key: options.debugColumnPrefix + 'cp_distance_miles', label: 'Debug CP Distance' },
    { key: options.debugColumnPrefix + 'na_distances', label: 'Debug NA Distances' }
  ]);

  sheet.getRange(options.dataStartRow, debugColumns[options.debugColumnPrefix + 'status'], dataRowCount, 1)
    .setValues(outputArrays.debugStatus);
  sheet.getRange(options.dataStartRow, debugColumns[options.debugColumnPrefix + 'cp_distance_miles'], dataRowCount, 1)
    .setValues(outputArrays.debugCpDistance);
  sheet.getRange(options.dataStartRow, debugColumns[options.debugColumnPrefix + 'na_distances'], dataRowCount, 1)
    .setValues(outputArrays.debugNaDistances);
}

function ensureDebugColumns_(sheet, options, columns) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headerRow = sheet.getRange(options.headerRow, 1, 1, lastColumn).getValues()[0];
  var keyRow = sheet.getRange(options.keyRow, 1, 1, lastColumn).getValues()[0];
  var headerMap = getHeaderMap_(headerRow, keyRow);
  var result = {};

  for (var i = 0; i < columns.length; i += 1) {
    var key = normalizeHeader_(columns[i].key);
    if (!headerMap[key]) {
      sheet.insertColumnAfter(sheet.getLastColumn());
      var newColumn = sheet.getLastColumn();
      sheet.getRange(options.headerRow, newColumn).setValue(columns[i].label);
      sheet.getRange(options.keyRow, newColumn).setValue(columns[i].key);
      headerMap[key] = newColumn;
    }
    result[columns[i].key] = headerMap[key];
  }

  return result;
}

function buildSummary_(parts) {
  return {
    sheetName: parts.sheetName,
    totalRowsRead: parts.totalRowsRead,
    validFeatureRows: parts.validFeatureRows,
    invalidRows: parts.invalidRows.length,
    duplicateIds: parts.duplicateIds.length,
    cpWritten: parts.cpWritten,
    naWritten: parts.naWritten,
    cpSkippedExisting: parts.cpSkippedExisting,
    naSkippedExisting: parts.naSkippedExisting,
    lockedRowsSkipped: parts.lockedRowsSkipped,
    inactiveRowsSkipped: parts.inactiveRowsSkipped,
    dryRun: parts.dryRun,
    invalidRowDetails: parts.invalidRows,
    duplicateIdDetails: parts.duplicateIds
  };
}

function formatSummaryForLog_(summary) {
  return [
    'populateCpAndNaForSheet summary',
    'sheet=' + summary.sheetName,
    'rows=' + summary.totalRowsRead,
    'valid=' + summary.validFeatureRows,
    'invalid=' + summary.invalidRows,
    'duplicates=' + summary.duplicateIds,
    'cpWritten=' + summary.cpWritten,
    'naWritten=' + summary.naWritten,
    'cpSkippedExisting=' + summary.cpSkippedExisting,
    'naSkippedExisting=' + summary.naSkippedExisting,
    'lockedRowsSkipped=' + summary.lockedRowsSkipped,
    'inactiveRowsSkipped=' + summary.inactiveRowsSkipped,
    'dryRun=' + summary.dryRun
  ].join(' | ');
}

function roundTo_(value, digits) {
  var factor = Math.pow(10, digits || 0);
  return Math.round(value * factor) / factor;
}

function mergeOptions_(base, overrides) {
  var result = {};
  var key;

  for (key in base) {
    if (Object.prototype.hasOwnProperty.call(base, key)) {
      result[key] = copyOptionValue_(base[key]);
    }
  }
  for (key in overrides) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      result[key] = copyOptionValue_(overrides[key]);
    }
  }

  return result;
}

function copyOptionValue_(value) {
  if (Array.isArray(value)) {
    return value.slice();
  }
  if (value && typeof value === 'object') {
    var clone = {};
    for (var key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        clone[key] = copyOptionValue_(value[key]);
      }
    }
    return clone;
  }
  return value;
}
