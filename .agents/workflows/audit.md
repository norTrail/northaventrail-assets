---
description: Full site audit for northaventrail.org
---

// turbo-all

## Full Site Audit — Northaven Trail

### Step 1: Smoke test all 9 pages
Run the Puppeteer smoke script. It checks HTTP status, JS page errors, Mapbox canvas presence, failed network requests, and map fallback visibility for every page.

```bash
node /Users/willdawson/Documents/GitHub/northaventrail-assets/qa/smoke-pages.js
```

Expected output: each page shows `status: 200`, `mapbox canvases: 1` (for map pages), and no page errors or actionable request failures.

Known-safe warnings to ignore:
- Squarespace YUI loading warnings — platform-level, cannot fix
- YouTube `compute-pressure` permissions policy — third-party embed
- Google Analytics / doubleclick failures — already in the ignore list

### Step 2: Interactive flow tests
Run the interactive flow test suite. This tests: trailmap search → popup, maps menu keyboard, issue tracker location search, tails marker state, and valentine modal open/close/Escape.

```bash
node /Users/willdawson/Documents/GitHub/northaventrail-assets/qa/interactive-flows.js
```

Expected output: `trailmap search: pass`, `listing maps menu: pass`, `issue tracker search: pass`, `tails status ui (X): pass` (or `tails marker popup: pass` if active), `valentine modal: pass`.

### Step 3: Investigate failures (only if any)
If a page fails either script, open a browser subagent targeting ONLY that page. Do not re-test passing pages. Capture a screenshot and console log output.

### Step 4: Write walkthrough
Create or update `walkthrough.md` in the current conversation folder with a pass/fail table for all 9 pages and a summary of any fixes made.
