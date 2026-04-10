"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PAGES = [
  "https://northaventrail.org/trailmap",
  "https://northaventrail.org/map-points-of-interest",
  "https://northaventrail.org/report-trail-issue",
  "https://northaventrail.org/tails-2026",
  "https://northaventrail.org/valentine-cling-map-2027",
  "https://northaventrail.org/trail-captains"
];

function runAxe(url, outputDir) {
  const slug = new URL(url).pathname.replace(/^\/+/, "").replace(/[^\w-]+/g, "-") || "home";
  const outputFile = `${slug}.json`;
  const result = spawnSync(
    "npx",
    [
      "axe",
      url,
      "--save",
      outputFile,
      "--load-delay",
      "3000",
      "--timeout",
      "120",
      "--chrome-options",
      "no-sandbox,disable-setuid-sandbox"
    ],
    {
      encoding: "utf8",
      cwd: outputDir
    }
  );

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`axe run failed for ${url}${details ? `\n${details}` : ""}`);
  }

  const raw = fs.readFileSync(path.join(outputDir, outputFile), "utf8");
  const parsed = JSON.parse(raw);
  const violations = Array.isArray(parsed?.violations) ? parsed.violations : [];

  return {
    url,
    violations,
    outputFile
  };
}

function main() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "northaven-axe-"));
  let hasFailure = false;

  try {
    console.log("Running axe accessibility checks...");

    for (const url of PAGES) {
      const result = runAxe(url, outputDir);
      console.log(`\n${url}`);

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
    }
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }

  process.exitCode = hasFailure ? 1 : 0;
}

main();
