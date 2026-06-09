# HYDRA-EO visualization data

This folder is the only data interface used by the EO Explorer. It is intentionally
replaceable: update this folder and `catalog.json`; do not edit the website code to
publish a dataset. The catalog currently contains conservative imports from the
public HYDRA-EO Geospatial Dataset repository. This includes observational,
methodological, example, explicitly synthetic, unverified, duplicate, and
unresolved-CRS source material. These classes are labeled in the interface and
must not be conflated. See
`provenance/geospatial-dataset-import.md` for source commits, exclusions, checksums,
and metadata gaps. `provenance/source-manifest.json` accounts for every tracked
file under the source repository's `data/` and `Tables/` directories.

## Data contract

1. Register every dataset in `catalog.json` and validate it against
   `catalog.schema.json`.
2. Use a stable, unique `id` and set `status` to `public` before it can appear in the
   public Explorer. `draft`, `internal`, and `embargoed` entries are never rendered.
3. Put local assets below this folder and reference them as paths such as
   `visualization-data/rasters/flight-2026-05-01.tif`. Absolute remote assets must use
   HTTPS. HTTP is accepted only from localhost during development.
4. Provide an asset `type` and `role`. Supported types are `raster`, `vector`,
   `table`, `spectra`, `thumbnail`, `provenance`, `stac`, and `metadata`.
5. Do not infer scientific metadata from filenames. Supply units, nodata, scale,
   offset, display ranges, calibration, quality information, and provenance where
   applicable. Missing optional fields appear as `not provided`.

## Accepted formats

- Raster: Cloud Optimized GeoTIFF (preferred), GeoTIFF, or an HTTPS STAC asset link.
- Vector: GeoJSON, TopoJSON, or PMTiles. GeoJSON is supported directly in phase 1.
- Tables and spectra: CSV or JSON with documented column names and units.
- Metadata and provenance: JSON, Markdown, text, PDF, or a repository/DOI HTTPS URL.
- Thumbnails: PNG, JPEG, WebP, or SVG; thumbnails are never treated as measurements.

Remote COG servers must permit CORS and HTTP range requests. A STAC link may be
registered as an asset, but the dataset entry still needs the metadata required by
this catalog. Keep citations, licenses, calibration details, processing software,
known limitations, and the responsible contact with the dataset.

## Raster and band metadata

Use `bands` for calibrated multispectral or hyperspectral products. Include band
name, wavelength and units when known. Browser-side index computation remains
disabled unless `client_computation.allowed` is true, calibrated reflectance bands
are present, and the formula metadata is complete. Precomputed index rasters are
preferred.

Display ranges and percentiles must come from the dataset owner. The interface does
not estimate ranges or substitute generic scientific values. NDVI's mathematical
domain may be declared as `[-1, 1]`, but catalog display metadata takes precedence.

## Local testing and validation

Run:

```bash
node scripts/validate-visualization-data.js
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Do not open `index.html` via `file://`, because
browser security rules prevent the catalog fetch.

The validator permits the default empty catalog. It reports metadata that is
required before a public dataset can be publication-ready.
