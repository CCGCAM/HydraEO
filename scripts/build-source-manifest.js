#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const sourceRoot = path.resolve(process.argv[2] || "/tmp/HYDRA-EO-Geospatial-dataset");
const output = path.resolve(__dirname, "..", "visualization-data", "provenance", "source-manifest.json");
const roots = ["data", "Tables"];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

const mappings = [
  [/^data\/processed\/s2_to_rm\.tif$/, "imported", "visualization-data/rasters/chaparrillo-sentinel2-reflectance.tif"],
  [/^data\/(?:raw|interim|processed)\/.+\/s2_to_rm\.tif$|^data\/interim\/s2_to_rm\.tif$/, "duplicate", "visualization-data/rasters/chaparrillo-sentinel2-reflectance.tif"],
  [/^data\/rasters\/UAV_1m_1m_200b\.tif$/, "imported_synthetic", "visualization-data/rasters/synthetic/uav-1m-200band.tif"],
  [/^data\/rasters\/(?:EnMAP|PRISMA)_30m_30m_200b\.tif$/, "imported_synthetic", "visualization-data/rasters/synthetic/enmap-prisma-30m-200band.tif"],
  [/^data\/rasters\/S2_20m_20m_12b\.tif$/, "imported_synthetic", "visualization-data/rasters/synthetic/sentinel2-20m-12band.tif"],
  [/^data\/rasters\/THERM_70m_70m_1b\.tif$/, "imported_synthetic", "visualization-data/rasters/synthetic/thermal-70m.tif"],
  [/^data\/rasters\/FLEX_300m_300m_1b\.tif$/, "imported_synthetic", "visualization-data/rasters/synthetic/flex-300m.tif"],
  [/^data\/sites\/Orchards\.(?:shp|shx|dbf|prj|cpg)$/, "imported_shapefile_component", "visualization-data/vectors/hydra-eo-study-sites.geojson"],
  [/^data\/sites\/Olive-Pistachio-CIAG_trees\/Olive-Arbequina\.(?:shp|shx|dbf|prj)$/, "imported_shapefile_component", "visualization-data/vectors/chaparrillo-olive-arbequina-trees.geojson"],
  [/^data\/sites\/Olive-Pistachio-CIAG_trees\/Olive-Cornicabra\.(?:shp|shx|dbf|prj)$/, "imported_shapefile_component", "visualization-data/vectors/chaparrillo-olive-cornicabra-trees.geojson"],
  [/^data\/Sentinel-2\/ROIs\/Alfalfa__point_2\.(?:shp|shx|dbf|prj|cpg)$/, "imported_shapefile_component", "visualization-data/vectors/rois/alfalfa-sites-points.geojson"],
  [/^data\/Sentinel-2\/ROIs\/Alfalfa_site1\.(?:shp|shx|dbf|prj|cpg)$/, "imported_shapefile_component", "visualization-data/vectors/rois/alfalfa-site-1-roi.geojson"],
  [/^data\/Sentinel-2\/ROIs\/Alfalfa_site2\.(?:shp|shx|dbf|prj|cpg)$/, "imported_shapefile_component", "visualization-data/vectors/rois/alfalfa-site-2-roi.geojson"],
  [/^data\/Sentinel-2\/ROIs\/Chaparrilo_site\.(?:shp|shx|dbf|prj|cpg)$/, "imported_shapefile_component", "visualization-data/vectors/rois/chaparrillo-roi.geojson"],
  [/^data\/Sentinel-2\/ROIs\/Lelystad_site\.(?:shp|shx|dbf|prj|cpg)$/, "imported_shapefile_component", "visualization-data/vectors/rois/lelystad-roi.geojson"],
  [/^data\/Sentinel-2\/ROIs\/NL-Loobos\.(?:shp|shx|dbf|prj|cpg)$/, "imported_shapefile_component", "visualization-data/vectors/rois/loobos-roi.geojson"],
  [/^data\/grids\/Grid_Lelystad_3x3km_30PRISMA\.(?:shp|shx|dbf|prj|cpg)$/, "imported_shapefile_component", "visualization-data/vectors/grids/lelystad-prisma-30m-grid.geojson"],
  [/^data\/grids\/Grid_Lelystad_3x3km_300Flex_reproject\.(?:shp|shx|dbf|prj|cpg)$/, "imported_shapefile_component", "visualization-data/vectors/grids/lelystad-flex-300m-grid.geojson"],
  [/^data\/sites\/Alfalfa-CNR\/Site_Alfalfa\.(?:shp|shx|dbf|prj|cpg)$/, "imported_shapefile_component", "visualization-data/vectors/sites/alfalfa-primary-site.geojson"],
  [/^data\/sites\/Alfalfa-CNR\/additionals\.(?:shp|shx|dbf|prj|cpg)$/, "imported_shapefile_component", "visualization-data/vectors/sites/alfalfa-additional-site.geojson"],
  [/^data\/sites\/Olive-Pistachio-CIAG\/Site_olive_pistacchio\.(?:shp|shx|dbf|prj|cpg)$/, "imported_shapefile_component", "visualization-data/vectors/sites/chaparrillo-site-points.geojson"],
  [/^data\/sites\/Potato-Lelystad\/Site_Lelystad\.(?:shp|shx|dbf|prj|cpg)$/, "imported_shapefile_component", "visualization-data/vectors/sites/lelystad-site-point.geojson"],
  [/^data\/sites\/Potato-Lelystad\/Site_Lelystad_area\.(?:shp|shx|dbf|prj|cpg)$/, "imported_shapefile_component", "visualization-data/vectors/sites/lelystad-site-area.geojson"],
  [/^data\/sites\/Alfalfa-CNR\/alfaalfa_test\.(?:shp|shx|dbf|prj|cpg)$/, "preserved_unresolved_crs", "visualization-data/provenance/source-archives/alfalfa-test-unresolved-crs.zip"],
  [/^data\/sites\/Olive-Pistachio-CIAG\/Areas_olive_pistacchio\.(?:shp|shx|dbf|prj|cpg)$/, "preserved_unresolved_crs", "visualization-data/provenance/source-archives/chaparrillo-areas-unresolved-crs.zip"],
  [/^data\/Sentinel-2\/GeoJSON\/Alfalfa_sites_1\.geojson$/, "imported", "visualization-data/vectors/sites/alfalfa-site-1-point.geojson"],
  [/^data\/Sentinel-2\/GeoJSON\/Alfalfa_sites_2\.geojson$/, "imported", "visualization-data/vectors/sites/alfalfa-site-2-point.geojson"],
  [/^data\/Sentinel-2\/GeoJSON\/Olives_orchards\.geojson$/, "imported", "visualization-data/vectors/sites/chaparrillo-center-point.geojson"],
  [/^data\/sites\/olive_orchard\.geojson$/, "imported", "visualization-data/vectors/sites/olive-orchard-polygon.geojson"],
  [/^Tables\/Examples\/Olive_arbequina\.csv$/, "imported", "visualization-data/tables/examples/olive-arbequina-layout.csv"],
  [/^Tables\/Examples\/Olive_cornicabra\.csv$/, "imported", "visualization-data/tables/examples/olive-cornicabra-layout.csv"],
  [/^Tables\/Examples\/Example_olives\.xlsx$/, "converted_all_sheets", "visualization-data/tables/examples/example-olives-*.csv"],
  [/^data\/raw\/(?:field\/(?:biochemistry|calibration|genomics|leaf_physiology|metabolomics|qpcr|visual_scoring)|metadata(?:\/plant_positions)?)\/HYDRA_CRE_20260505_scoring_v1\.\.csv$/, "deduplicated_unverified", "visualization-data/tables/unverified/hydra-cre-20260505-scoring.csv"],
  [/^data\/HYDRA-EO\.qgz$/, "preserved_source_project", "visualization-data/provenance/source-archives/HYDRA-EO.qgz"],
  [/^data\/sites\/Olive-Pistachio-CIAG_trees\/proyectoESA-RMG\.qgz$/, "preserved_source_project", "visualization-data/provenance/source-archives/proyectoESA-RMG.qgz"],
  [/\.qmd$/, "companion_rendered_document", null],
  [/Readme\.txt$/i, "source_documentation", null],
  [/\.aux\.xml$/, "raster_statistics_sidecar", "visualization-data/rasters/chaparrillo-sentinel2-reflectance.tif"]
];

function classify(relative) {
  for (const [pattern, disposition, importedAs] of mappings) {
    if (pattern.test(relative)) return { disposition, imported_as: importedAs };
  }
  return { disposition: "unaccounted", imported_as: null };
}

const files = roots.flatMap((folder) => walk(path.join(sourceRoot, folder))).map((file) => {
  const relative = path.relative(sourceRoot, file).replaceAll(path.sep, "/");
  const data = fs.readFileSync(file);
  return {
    source_path: relative,
    bytes: data.length,
    sha256: crypto.createHash("sha256").update(data).digest("hex"),
    ...classify(relative)
  };
}).sort((a, b) => a.source_path.localeCompare(b.source_path));

const unaccounted = files.filter((file) => file.disposition === "unaccounted");
const manifest = {
  source_repository: "https://github.com/CCGCAM/HYDRA-EO-Geospatial-dataset",
  source_commit: "f33b294f0d3e364afade6a739fc4fea473fff090",
  generated_at: new Date().toISOString(),
  summary: Object.fromEntries([...new Set(files.map((file) => file.disposition))].sort().map((key) => [key, files.filter((file) => file.disposition === key).length])),
  files
};
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${files.length} source-file records; ${unaccounted.length} unaccounted.`);
if (unaccounted.length) {
  unaccounted.forEach((file) => console.error(`UNACCOUNTED: ${file.source_path}`));
  process.exit(1);
}
