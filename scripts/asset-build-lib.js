"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const CleanCSS = require("clean-css");
const terser = require("terser");

const projectRoot = path.resolve(__dirname, "..");
const assetGroups = [
  { type: "js", srcDir: path.join(projectRoot, "src", "js"), outDir: path.join(projectRoot, "js") },
  { type: "css", srcDir: path.join(projectRoot, "src", "css"), outDir: path.join(projectRoot, "css") }
];

function bannerFor(relativeSourcePath) {
  return `/* GENERATED FILE - DO NOT EDIT.\n * Source: ${relativeSourcePath}\n */\n`;
}

async function minifyJs(input, filePath) {
  const result = await terser.minify(input, {
    compress: true,
    mangle: false
  });

  if (!result.code) {
    throw new Error(`Terser returned no output for ${filePath}`);
  }

  return result.code;
}

function minifyCss(input, filePath) {
  const result = new CleanCSS({ level: 2 }).minify(input);

  if (result.errors.length > 0) {
    throw new Error(`CleanCSS failed for ${filePath}: ${result.errors.join("; ")}`);
  }

  return result.styles;
}

async function buildAsset(type, sourceFilePath) {
  const source = await fs.readFile(sourceFilePath, "utf8");
  const fileName = path.basename(sourceFilePath);
  const relativeSourcePath = path.relative(projectRoot, sourceFilePath).replaceAll(path.sep, "/");
  const minified = type === "js"
    ? await minifyJs(source, sourceFilePath)
    : minifyCss(source, sourceFilePath);

  return {
    fileName,
    relativeSourcePath,
    output: `${bannerFor(relativeSourcePath)}${minified}\n`
  };
}

async function listSourceFiles(srcDir) {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(srcDir, entry.name))
    .sort();
}

async function buildAllAssets() {
  const groupResults = await Promise.all(assetGroups.map(async (group) => {
    const sourceFiles = await listSourceFiles(group.srcDir);
    const built = await Promise.all(sourceFiles.map((sourceFilePath) => buildAsset(group.type, sourceFilePath)));
    return built.map((asset) => ({
      ...asset,
      type: group.type,
      targetPath: path.join(group.outDir, asset.fileName)
    }));
  }));

  return groupResults.flat();
}

async function writeBuiltAssets(outputs) {
  await Promise.all(outputs.map((asset) => fs.writeFile(asset.targetPath, asset.output, "utf8")));
}

module.exports = {
  buildAllAssets,
  projectRoot,
  writeBuiltAssets
};
