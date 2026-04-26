const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..');
const PATCHED_FILES = new Map([
  [
    '/js/trailmap-fullscreen.v1.js',
    fs.readFileSync(path.join(ROOT, 'js', 'trailmap-fullscreen.v1.js'), 'utf8'),
  ],
  [
    '/js/gesture-control.v1.js',
    fs.readFileSync(path.join(ROOT, 'js', 'gesture-control.v1.js'), 'utf8'),
  ],
]);

function summarizeTrace(trace, startTsUs) {
  const endTsUs = startTsUs + 2_000_000;
  const totals = {
    Layout: 0,
    UpdateLayoutTree: 0,
    RecalculateStyles: 0,
    FunctionCall: 0,
  };

  for (const event of trace.traceEvents || []) {
    if (event.ph !== 'X') continue;
    if (typeof event.ts !== 'number' || typeof event.dur !== 'number') continue;
    if (event.ts < startTsUs || event.ts > endTsUs) continue;
    if (!Object.prototype.hasOwnProperty.call(totals, event.name)) continue;
    totals[event.name] += event.dur / 1000;
  }

  return totals;
}

async function runScenario({ label, interceptPatched }) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });

    if (interceptPatched) {
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const url = new URL(request.url());
        const body = PATCHED_FILES.get(url.pathname);
        if (body && url.hostname === 'assets.northaventrail.org') {
          request.respond({
            status: 200,
            contentType: 'application/javascript; charset=utf-8',
            body,
          }).catch(() => {});
          return;
        }
        request.continue().catch(() => {});
      });
    }

    await page.goto('https://northaventrail.org/trailmap', {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    await page.waitForSelector('#map .mapboxgl-canvas', { timeout: 30000 });
    await page.waitForSelector('.mapboxgl-ctrl-top-right button[aria-label*="fullscreen" i]', { timeout: 30000 });

    const tracePath = path.join('/tmp', `trailmap-fullscreen-${label}.json`);
    await page.tracing.start({
      path: tracePath,
      categories: [
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.frame',
      ],
    });

    const startTsUs = (await page.evaluate(() => performance.now())) * 1000;

    await page.click('.mapboxgl-ctrl-top-right button[aria-label*="fullscreen" i]');
    await page.waitForFunction(
      () => document.getElementById('mapView')?.classList.contains('is-fullscreen'),
      { timeout: 5000 }
    );
    await page.waitForTimeout(1200);

    await page.tracing.stop();
    const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));

    return {
      label,
      tracePath,
      totals: summarizeTrace(trace, startTsUs),
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const results = [];
  results.push(await runScenario({ label: 'live', interceptPatched: false }));
  results.push(await runScenario({ label: 'patched', interceptPatched: true }));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
