"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { buildAllAssets, projectRoot } = require("./asset-build-lib");

async function main() {
  const outputs = await buildAllAssets();
  const results = await Promise.all(
    outputs.map(async (asset) => {
      const current = await fs.readFile(asset.targetPath, "utf8");
      return current !== asset.output
        ? path.relative(projectRoot, asset.targetPath).replaceAll(path.sep, "/")
        : null;
    })
  );
  const mismatches = results.filter(Boolean);

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
