const CATALOG_URL = "visualization-data/catalog.json";
const ALLOWED_STATUSES = new Set(["public", "embargoed", "internal", "draft"]);
const ALLOWED_ASSET_TYPES = new Set([
  "raster", "vector", "table", "spectra", "thumbnail", "provenance", "stac", "metadata"
]);

export class CatalogError extends Error {
  constructor(message, code = "catalog_error") {
    super(message);
    this.name = "CatalogError";
    this.code = code;
  }
}

function isLocalHost() {
  return ["localhost", "127.0.0.1", "[::1]", ""].includes(window.location.hostname);
}

export function isSafeAssetHref(href) {
  if (typeof href !== "string" || !href.trim()) return false;
  if (/^https:\/\//i.test(href)) return true;
  if (/^http:\/\//i.test(href)) return isLocalHost();
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return false;

  const normalized = href.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = normalized.split("/");
  const allowedFolders = new Set(["rasters", "vectors", "tables", "spectra", "thumbnails", "provenance", "derived", "demo"]);
  return parts[0] === "visualization-data" && allowedFolders.has(parts[1]) &&
    !parts.includes("..") && !parts.includes("data-imported") && !parts.includes("data-to-import");
}

function warning(datasetId, message) {
  return { datasetId, message };
}

export function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new CatalogError("The visualization catalog must be a JSON object.", "invalid_structure");
  }
  for (const key of ["version", "title", "description", "datasets"]) {
    if (!(key in catalog)) throw new CatalogError(`Catalog is missing required key: ${key}.`, "missing_key");
  }
  if (!Array.isArray(catalog.datasets)) {
    throw new CatalogError("Catalog datasets must be an array.", "invalid_datasets");
  }
  if (catalog.detected_assets !== undefined && !Array.isArray(catalog.detected_assets)) {
    throw new CatalogError("Catalog detected_assets must be an array.", "invalid_detected_assets");
  }

  const ids = new Set();
  const warnings = [];
  const datasets = catalog.datasets.map((source, index) => {
    if (!source || typeof source !== "object") {
      throw new CatalogError(`Dataset at position ${index + 1} must be an object.`, "invalid_dataset");
    }
    if (typeof source.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(source.id)) {
      throw new CatalogError(`Dataset at position ${index + 1} has a missing or invalid id.`, "invalid_id");
    }
    if (ids.has(source.id)) throw new CatalogError(`Duplicate dataset id: ${source.id}.`, "duplicate_id");
    ids.add(source.id);

    if (!source.title || typeof source.title !== "string") {
      throw new CatalogError(`Dataset ${source.id} is missing a title.`, "missing_title");
    }
    if (!ALLOWED_STATUSES.has(source.status)) {
      throw new CatalogError(`Dataset ${source.id} has an unsupported status.`, "invalid_status");
    }
    if (!Array.isArray(source.assets)) {
      throw new CatalogError(`Dataset ${source.id} must define an assets array.`, "invalid_assets");
    }

    const assetIds = new Set();
    const assets = source.assets.map((asset) => {
      if (!asset || typeof asset !== "object" || !asset.id || !asset.role || !asset.href || !asset.type) {
        throw new CatalogError(`Dataset ${source.id} has an asset without id, type, role, or href.`, "invalid_asset");
      }
      if (assetIds.has(asset.id)) {
        throw new CatalogError(`Dataset ${source.id} has duplicate asset id: ${asset.id}.`, "duplicate_asset_id");
      }
      assetIds.add(asset.id);
      if (!ALLOWED_ASSET_TYPES.has(asset.type)) {
        throw new CatalogError(`Dataset ${source.id} asset ${asset.id} has unsupported type: ${asset.type}.`, "invalid_asset_type");
      }
      if (!isSafeAssetHref(asset.href)) {
        throw new CatalogError(`Dataset ${source.id} asset ${asset.id} uses an unsafe path.`, "unsafe_asset_path");
      }
      return Object.freeze({ ...asset });
    });

    const optional = [
      ["license", source.license], ["citation", source.citation], ["acquisition date", source.acquisition_date],
      ["platform", source.platform], ["sensor", source.sensor], ["CRS", source.crs],
      ["spatial resolution", source.spatial_resolution], ["provenance", source.provenance]
    ];
    optional.forEach(([label, value]) => {
      if (value === undefined || value === null || value === "") warnings.push(warning(source.id, `${label} not provided`));
    });
    if (source.status === "public" && (!source.license || !source.citation)) {
      warnings.push(warning(source.id, "Public dataset is missing a license or recommended citation."));
    }

    return Object.freeze({
      ...source,
      assets: Object.freeze(assets),
      bands: Object.freeze(Array.isArray(source.bands) ? source.bands.map((band) => Object.freeze({ ...band })) : []),
      indices: Object.freeze(Array.isArray(source.indices) ? source.indices.map((item) => Object.freeze({ ...item })) : []),
      stressors: Object.freeze(Array.isArray(source.stressors) ? [...source.stressors] : [])
    });
  });

  return Object.freeze({
    catalog: Object.freeze({ ...catalog, datasets: Object.freeze(datasets) }),
    publicDatasets: Object.freeze(datasets.filter((dataset) => dataset.status === "public")),
    warnings: Object.freeze(warnings)
  });
}

export async function loadCatalog({ signal, url = CATALOG_URL } = {}) {
  let response;
  try {
    response = await fetch(url, { signal, cache: "no-store", headers: { Accept: "application/json" } });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new CatalogError("The visualization catalog could not be reached.", "catalog_unavailable");
  }
  if (!response.ok) {
    throw new CatalogError(
      response.status === 404 ? "The visualization catalog is not configured." : `Catalog request failed (${response.status}).`,
      response.status === 404 ? "catalog_missing" : "catalog_request_failed"
    );
  }

  let catalog;
  try {
    catalog = await response.json();
  } catch {
    throw new CatalogError("The visualization catalog contains invalid JSON.", "invalid_json");
  }
  return validateCatalog(catalog);
}

export function datasetCapabilities(dataset, allPublicDatasets = []) {
  const assets = dataset.assets || [];
  const roles = new Set(assets.map((asset) => asset.role));
  const types = new Set(assets.map((asset) => asset.type));
  const comparable = allPublicDatasets.filter((candidate) =>
    candidate.id !== dataset.id && dataset.comparability_group &&
    candidate.comparability_group === dataset.comparability_group &&
    (dataset.harmonized || candidate.harmonized || (
      candidate.crs === dataset.crs &&
      JSON.stringify(candidate.spatial_resolution) === JSON.stringify(dataset.spatial_resolution)
    ))
  );
  const hasBand = (name) => dataset.bands.some((band) =>
    [band.name, band.common_name].filter(Boolean).map((value) => value.toLowerCase()).includes(name)
  );
  const rasterCount = assets.filter((asset) => asset.type === "raster").length;
  const hasChangeAsset = assets.some((asset) => ["change", "difference", "relative_change", "anomaly"].includes(asset.role));

  return Object.freeze({
    raster: types.has("raster"),
    rgb: roles.has("rgb_orthomosaic") || dataset.bands.length >= 3,
    vector: types.has("vector"),
    spectra: types.has("spectra") || roles.has("hyperspectral_reflectance"),
    thermal: roles.has("thermal"),
    indices: dataset.indices.length > 0 || roles.has("vegetation_index"),
    plots: types.has("vector"),
    threeD: roles.has("dsm") || roles.has("chm") || roles.has("dtm"),
    temporal: comparable.length > 0,
    compare: rasterCount > 1,
    change: hasChangeAsset,
    bandComposer: dataset.bands.length >= 3,
    trueColor: hasBand("red") && hasBand("green") && hasBand("blue"),
    colorInfrared: hasBand("nir") && hasBand("red") && hasBand("green"),
    redEdge: hasBand("rededge") && hasBand("nir") && hasBand("red"),
    comparable
  });
}
