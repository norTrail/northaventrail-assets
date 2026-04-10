"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const TASKS = [
  ["qa:contracts", "node", [path.join("qa", "contracts.js")]],
  ["qa:smoke", "node", [path.join("qa", "smoke-pages.js")]],
  ["qa:interactive", "node", [path.join("qa", "interactive-flows.js")]],
  ["qa:a11y", "node", [path.join("qa", "a11y-pages.js")]]
];

function main() {
  for (const [label, command, args] of TASKS) {
    console.log(`\n=== ${label} ===`);
    const result = spawnSync(command, args, {
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit"
    });

    if (result.status !== 0) {
      process.exit(result.status || 1);
    }
  }
}

main();
