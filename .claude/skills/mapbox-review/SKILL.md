---
name: mapbox-review
description: Review a MapBox map implementation for quality, accessibility, performance, and mobile support. Use when adding or updating a map page.
user-invocable: true
context: fork
agent: Explore
allowed-tools: "Read Grep Glob"
---

# MapBox Map Review

Review the JS and CSS files for the map page specified in $ARGUMENTS (or the most recently changed map files if no argument given). Report findings by category with file paths and line numbers.

## Checklist

### 1. Map Initialization
- [ ] Map container element has explicit width/height (not relying solely on CSS)
- [ ] `fitBounds` or `setCenter`+`setZoom` restricts view to trail area on load
- [ ] `maxBounds` prevents panning far outside the trail
- [ ] Appropriate `minZoom` / `maxZoom` set (typical: min 10, max 20 for a trail)

### 2. Data Loading
- [ ] POI/GeoJSON data fetched from the correct `.latest.json` endpoint
- [ ] Error handling present if fetch fails (see `trailmap-error` pattern)
- [ ] No hand-edited JSON data inline — data must come from the JSON files

### 3. Gesture & Touch Control
- [ ] `gesture-control.v1.js` included on all mobile-capable map pages
- [ ] Touch gestures do not hijack full-page scroll (cooperative gesture handling)
- [ ] Keyboard navigation works (arrow keys, +/-)

### 4. Accessibility
- [ ] Map has an `aria-label` describing its purpose
- [ ] Popups/tooltips are readable by screen readers
- [ ] Custom layer colors meet WCAG 2.1 AA contrast ratio

### 5. Performance
- [ ] GeoJSON files are not bundled inline — loaded async
- [ ] No synchronous XHR calls
- [ ] CSS does not block render of above-the-fold content

### 6. Consistency with northaven-utils
- [ ] Uses `northaven-utils.v1.js` helper functions where applicable (don't re-implement utilities)
- [ ] Follows existing naming conventions in the codebase

## Output Format

For each finding, report:
```
[PASS|FAIL|WARN] Category — Description
File: path/to/file.js:line
```

Summarize with a count of PASS / WARN / FAIL at the end.

## Common Excuses — Reject These

- "I can't test interactivity without a browser" — Review the code logic; flag anything that looks wrong as WARN.
- "The data loads eventually so the error handling doesn't matter" — Network failures are real. Flag missing error handling as FAIL.
- "gesture-control is optional on desktop" — It must still be present; it self-disables on non-touch devices.

## Red Flags

- Direct DOM manipulation of map container outside of MapBox API
- Hardcoded lat/lng coordinates that don't match the Northaven Trail area (~42.08°N, 87.74°W)
- `console.log` statements left in production files
