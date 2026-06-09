#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const catalogPath = path.join(root, "visualization-data", "catalog.json");
const allowedTypes = new Set(["raster", "vector", "table", "spectra", "thumbnail", "provenance", "stac", "metadata"]);
const allowedStatuses = new Set(["public", "embargoed", "internal", "draft"]);
const allowedDataClasses = new Set(["observational", "methodological", "example", "synthetic", "unverified"]);
const errors = [];
const warnings = [];

function fail(message) { errors.push(message); }
function warn(message) { warnings.push(message); }
function safeHref(href) {
  if (typeof href !== "string" || !href) return false;
  if (/^https:\/\//i.test(href)) return true;
  const normalized = href.replace(/\\/g, "/").replace(/^\.\//, "");
  return normalized.startsWith("visualization-data/") && !normalized.split("/").includes("..");
}

if (!fs.existsSync(catalogPath)) {
  fail("visualization-data/catalog.json does not exist.");
} else {
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  } catch (error) {
    fail(`catalog.json is invalid JSON: ${error.message}`);
  }

  if (catalog) {
    for (const key of ["version", "title", "description", "datasets"]) {
      if (!(key in catalog)) fail(`Catalog is missing required key: ${key}.`);
    }
    if (!Array.isArray(catalog.datasets)) {
      fail("Catalog datasets must be an array.");
    } else {
      if (!catalog.datasets.length) warn("No public visualization datasets are configured; the polished empty state will be shown.");
      const datasetIds = new Set();
      catalog.datasets.forEach((dataset, index) => {
        const label = dataset?.id || `dataset ${index + 1}`;
        if (!dataset || typeof dataset !== "object") return fail(`Dataset ${index + 1} must be an object.`);
        if (!dataset.id || !/^[a-z0-9][a-z0-9._-]*$/.test(dataset.id)) fail(`${label}: invalid or missing id.`);
        if (datasetIds.has(dataset.id)) fail(`${label}: duplicate dataset id.`);
        datasetIds.add(dataset.id);
        if (!dataset.title) fail(`${label}: title is required.`);
        if (!allowedStatuses.has(dataset.status)) fail(`${label}: unsupported status.`);
        if (!allowedDataClasses.has(dataset.data_class)) fail(`${label}: missing or unsupported data_class.`);
        if (!Array.isArray(dataset.assets)) return fail(`${label}: assets must be an array.`);

        const assetIds = new Set();
        dataset.assets.forEach((asset, assetIndex) => {
          const assetLabel = `${label} asset ${asset?.id || assetIndex + 1}`;
          if (!asset?.id || !asset.type || !asset.role || !asset.href) fail(`${assetLabel}: id, type, role, and href are required.`);
          if (assetIds.has(asset?.id)) fail(`${assetLabel}: duplicate asset id.`);
          assetIds.add(asset?.id);
          if (!allowedTypes.has(asset?.type)) fail(`${assetLabel}: unsupported type ${asset?.type}.`);
          if (!safeHref(asset?.href)) fail(`${assetLabel}: unsafe path; use visualization-data/ or HTTPS.`);
          if (asset?.href?.startsWith("visualization-data/")) {
            const localPath = path.join(root, asset.href);
            if (!fs.existsSync(localPath)) fail(`${assetLabel}: local file does not exist (${asset.href}).`);
          }
        });
        if (dataset.status === "public" && !dataset.citation) warn(`${label}: public dataset has no recommended citation.`);
        if (dataset.status === "public" && !dataset.license) warn(`${label}: public dataset has no license or access condition.`);
      });
    }
  }
}

const sourceManifestPath = path.join(root, "visualization-data", "provenance", "source-manifest.json");
if (fs.existsSync(sourceManifestPath)) {
  try {
    const manifest = JSON.parse(fs.readFileSync(sourceManifestPath, "utf8"));
    const unaccounted = (manifest.files || []).filter((file) => file.disposition === "unaccounted");
    if (unaccounted.length) fail(`Source manifest contains ${unaccounted.length} unaccounted file(s).`);
  } catch (error) {
    fail(`Source manifest is invalid JSON: ${error.message}`);
  }
}

warnings.forEach((message) => console.warn(`WARNING: ${message}`));
errors.forEach((message) => console.error(`ERROR: ${message}`));
if (errors.length) {
  console.error(`Catalog validation failed with ${errors.length} error(s).`);
  process.exit(1);
}
console.log(`Catalog validation passed with ${warnings.length} warning(s).`);
