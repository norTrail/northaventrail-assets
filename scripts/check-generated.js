"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { buildAllAssets, projectRoot } = require("./asset-build-lib");

async function main() {
  const outputs = await buildAllAssets();
  const mismatches = [];

  for (const asset of outputs) {
    const current = await fs.readFile(asset.targetPath, "utf8");
    if (current !== asset.output) {
      mismatches.push(path.relative(projectRoot, asset.targetPath).replaceAll(path.sep, "/"));
    }
  }

  if (mismatches.length > 0) {
    console.error("Generated assets are out of date:");
    for (const mismatch of mismatches) {
      console.error(` - ${mismatch}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Generated assets are up to date for ${outputs.length} files.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
