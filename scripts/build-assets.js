"use strict";

const { buildAllAssets, writeBuiltAssets } = require("./asset-build-lib");

async function main() {
  const outputs = await buildAllAssets();
  await writeBuiltAssets(outputs);
  console.log(`Built ${outputs.length} generated asset files.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
