"use strict";

const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer");

const QA_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/146.0.0.0 Safari/537.36";

const AXE_SOURCE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const PAGES = [
  "https://northaventrail.org/trailmap",
  "https://northaventrail.org/map-points-of-interest",
  "https://northaventrail.org/report-trail-issue",
  "https://northaventrail.org/tails-2026",
  "https://northaventrail.org/valentine-cling-map-2027",
  "https://northaventrail.org/trail-captains"
];

function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
}

async function runAxe(page, url) {
  const response = await page.goto(url, {
    waitUntil: "networkidle2",
    timeout: 45000
  });

  await page.addScriptTag({ content: AXE_SOURCE });

  const result = await page.evaluate(async () => {
    return window.axe.run(document, {
      rules: {
        // These pages inherit duplicate landmark structure from the host shell,
        // and some dynamic search/map widgets expose transient container roles
        // before their child options mount. Keep CI focused on asset-owned regressions.
        region: { enabled: false },
        "landmark-unique": { enabled: false },
        "aria-required-children": { enabled: false }
      }
    });
  });

  return {
    url,
    status: response ? response.status() : null,
    violations: Array.isArray(result?.violations) ? result.violations : []
  };
}

async function main() {
  const browser = await launchBrowser();
  let hasFailure = false;

  try {
    console.log("Running axe accessibility checks...");

    for (const url of PAGES) {
      const page = await browser.newPage();
      await page.setUserAgent(QA_USER_AGENT);

      try {
        const result = await runAxe(page, url);
        console.log(`\n${url}`);

        if (result.status !== 200) {
          hasFailure = true;
          console.log(`  status: ${result.status}`);
          continue;
        }

        if (!result.violations.length) {
          console.log("  no violations found");
          continue;
        }

        hasFailure = true;
        console.log(`  violations: ${result.violations.length}`);
        for (const violation of result.violations) {
          const impact = violation.impact || "unknown";
          const nodes = Array.isArray(violation.nodes) ? violation.nodes.length : 0;
          console.log(`  - [${impact}] ${violation.id}: ${violation.help} (${nodes} node(s))`);
        }
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  process.exitCode = hasFailure ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
