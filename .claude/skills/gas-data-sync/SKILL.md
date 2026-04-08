---
name: gas-data-sync
description: Explains the Google Apps Script → JSON data flow for this repo. Invoke when questions arise about data files, how to update trail data, or why JSON files should not be hand-edited.
user-invocable: true
disable-model-invocation: false
allowed-tools: "Read Glob"
---

# GAS Data Sync — How Trail Data Works

This repo contains two kinds of files:

| Type | Examples | Edited by |
|------|----------|-----------|
| **Code** (JS/CSS) | `trailmap-init.v1.js`, `tails-ui.v2026.js` | Developers (you) |
| **Data** (JSON) | `trail-poi.latest.json`, `sheep-locations`, `tails-donations` | Google Apps Script only |

## DO NOT hand-edit JSON data files

JSON data files are **generated and overwritten** by Google Apps Script running against Google Sheets. Any manual edits will be silently lost on the next sync.

If data is wrong, fix it in Google Sheets — not here.

## Data File Reference

| File | Source Sheet | Used by Pages |
|------|-------------|---------------|
| `trail-poi.latest.json` | Trail POI sheet | /trailmap, /map-points-of-interest, /adoptgarden, /valentine-cling-map-2027 |
| `sheep-locations` | TAILS sheep sheet | /tails-2026 |
| `no-mow-zones` | No-mow zones sheet | /tails-2026 |
| `overlay-state` | Overlay config sheet | /tails-2026 |
| `tails-donations` | Donations sheet | /tails-2026 |
| `trail-captains.latest.json` | Trail Captains sheet | /trail-captains |
| `valentine-cling.v2027.latest.json` | Valentine clings sheet | /valentine-cling-map-2027 |

## When a Data File Looks Wrong

1. Identify which Google Sheet is the source (table above)
2. Fix the data in Google Sheets
3. Trigger the GAS sync (or wait for scheduled sync)
4. Verify the updated JSON file is committed and pushed

## Common Mistakes — Avoid These

- "I'll just fix the one bad entry in the JSON" — Don't. It will be overwritten.
- "The JSON doesn't have the new field yet, I'll add it manually" — Add it to the GAS script/sheet instead.
- "I need to restructure the JSON format" — Coordinate with whoever maintains the GAS script; the JS consumer code and GAS output must stay in sync.
