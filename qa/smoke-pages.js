"use strict";

const puppeteer = require("puppeteer");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PAGES = [
  "https://northaventrail.org/map-points-of-interest",
  "https://northaventrail.org/trailmap",
  "https://northaventrail.org/where-to-park",
  "https://northaventrail.org/adoptgarden",
  "https://northaventrail.org/hawk-lights",
  "https://northaventrail.org/report-trail-issue",
  "https://northaventrail.org/tails-2026",
  "https://northaventrail.org/valentine-cling-map-2027"
];

function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
}

function isIgnorableRequestFailure(url) {
  return [
    "google-analytics.com/g/collect",
    "youtube.com/embed/",
    "youtube.com/youtubei/v1/log_event",
    "googleads.g.doubleclick.net/pagead/id",
    "static.doubleclick.net/instream/ad_status.js"
  ].some((needle) => url.includes(needle));
}

async function checkPage(browser, url) {
  const page = await browser.newPage();
  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
    }
  });

  page.on("pageerror", (err) => {
    pageErrors.push(err.message || String(err));
  });

  page.on("requestfailed", (req) => {
    failedRequests.push({
      url: req.url(),
      error: req.failure()?.errorText || "request failed"
    });
  });

  const response = await page.goto(url, {
    waitUntil: "networkidle2",
    timeout: 45000
  });

  await delay(2000);

  const title = await page.title();
  const mapboxCanvases = await page.$$eval(".mapboxgl-canvas", (nodes) => nodes.length).catch(() => 0);
  const fallbackVisible = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("*")).some((el) => {
      const text = (el.textContent || "").trim();
      if (!text.includes("Map unavailable right now")) return false;
      const style = window.getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    });
  });

  await page.close();

  return {
    url,
    status: response ? response.status() : null,
    title,
    mapboxCanvases,
    fallbackVisible,
    consoleMessages,
    pageErrors,
    failedRequests
  };
}

async function main() {
  const browser = await launchBrowser();

  const results = [];
  try {
    for (const url of PAGES) {
      results.push(await checkPage(browser, url));
    }
  } finally {
    await browser.close();
  }

  let hasFailure = false;
  for (const result of results) {
    const badStatus = result.status !== 200;
    const hasJsErrors = result.pageErrors.length > 0;
    const actionableNetworkFailures = result.failedRequests.filter(
      (item) => !isIgnorableRequestFailure(item.url)
    );
    const ignoredNetworkFailures = result.failedRequests.filter((item) =>
      isIgnorableRequestFailure(item.url)
    );
    const hasNetworkFailures = actionableNetworkFailures.length > 0;
    const hasFallback = result.fallbackVisible;
    const isProblem = badStatus || hasJsErrors || hasNetworkFailures || hasFallback;

    if (isProblem) hasFailure = true;

    console.log(`\n${result.url}`);
    console.log(`  status: ${result.status}`);
    console.log(`  title: ${result.title}`);
    console.log(`  mapbox canvases: ${result.mapboxCanvases}`);
    console.log(`  map fallback visible: ${result.fallbackVisible ? "yes" : "no"}`);

    if (result.pageErrors.length) {
      console.log("  page errors:");
      for (const error of result.pageErrors) console.log(`    - ${error}`);
    }

    if (actionableNetworkFailures.length) {
      console.log("  failed requests:");
      for (const item of actionableNetworkFailures.slice(0, 10)) {
        console.log(`    - ${item.error}: ${item.url}`);
      }
    }

    if (ignoredNetworkFailures.length) {
      console.log("  ignored third-party request failures:");
      for (const item of ignoredNetworkFailures.slice(0, 10)) {
        console.log(`    - ${item.error}: ${item.url}`);
      }
    }

    if (result.consoleMessages.length) {
      console.log("  console warnings/errors:");
      for (const msg of result.consoleMessages.slice(0, 10)) {
        console.log(`    - ${msg}`);
      }
    }
  }

  process.exitCode = hasFailure ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
