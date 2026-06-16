# HYDRA-EO visualization data workflow

This folder is the generated data interface for the static, GitHub Pages-compatible EO Explorer. Do not edit `catalog.json` by hand.

## Import data

1. Put raw rasters, vectors, tables, STAC JSON, metadata, citations, and sidecars in `data-to-import/`.
2. Run `python scripts/import_visualization_data.py` from the repository root.
3. Accepted source files move to `data-imported/`. That folder is intentionally excluded from git.
4. Lightweight safe outputs are copied into public folders where appropriate.
5. The script writes `catalog.json` and `import-report.md`, then runs validation.

To safely process exactly one root-level zip, run:

```bash
python scripts/import_visualization_data.py --from-root-zip
```

The zip is extracted in a temporary directory and removed only after import and validation succeed. If zero or multiple root zips exist, the command stops and removes none. Archive paths, symlinks, nested archives, executable/web-code files, member counts, and extracted sizes are checked before acceptance.

Other commands:

```bash
python scripts/import_visualization_data.py --check
python scripts/import_visualization_data.py --clean-generated
python scripts/import_visualization_data.py --external-base-url https://example.org/eo-assets/
python scripts/validate_visualization_site.py
```

`--clean-generated` removes only the generated catalog and report. It never deletes source data.

## Size and hosting policy

- Below 5 MB: small safe vectors, tables, metadata, and thumbnails may become tracked website assets.
- 5-50 MB: retained in the ignored archive unless explicitly justified.
- Above 50 MB: not committed to normal git history.
- Above 100 MB: never committed to normal git history.
- Large rasters remain in `data-imported/` and receive `external_required` status unless `--external-base-url` supplies an HTTPS destination.

For browser raster viewing, publish a Cloud Optimized GeoTIFF on an HTTPS server that supports CORS and byte-range requests, or publish a suitable STAC item/catalog. Supplying an external URL does not make a non-COG raster web-ready.

## Metadata sidecars

Place sidecars beside their source asset:

```text
flight.tif
flight.metadata.json
flight.provenance.json
flight.calibration.json
flight.stac.json
flight.citation.txt
```

Metadata may provide `title`, `units`, `nodata`, `crs`, `sensor`, `platform`, `acquisition_date`, `processing_level`, `calibration_method`, `provenance`, `citation`, `license`, `bands`, and `formula`. Filenames are never used to confirm crops, treatments, stress, disease, indices, or scientific validity.

STAC files are detected from `stac_version`, `assets`, and `links`. Only same-origin public data paths and HTTPS remote assets pass the browser URL policy. Arbitrary STAC code/extensions are not executed and non-HTTPS links are not followed.

## Scientific gate

Browser-side NDVI, NDRE, GNDVI, SAVI, PRI, red-edge, chlorophyll, water, nitrogen, SIF, disease, stress, and anomaly computations remain blocked unless all required band identities, units, scale, offset, nodata, calibration method, processing level, acquisition, sensor/platform, formula, provenance, and CRS/registration metadata are complete.

Real precomputed raster layers may be displayed when they include units, colorbar/display metadata, nodata status, provenance, citation/access information, and an intentional browser-safe asset. They must be labelled precomputed.

## Readiness ladder

- Level 0: No files detected.
- Level 1: Files detected.
- Level 2: Technical type identified.
- Level 3: Browser preview available.
- Level 4: Source product visualizable with metadata.
- Level 5: Calibrated product with provenance.
- Level 6: Computation-ready.
- Level 7: Publication-ready with citation, license, quality, and validation notes.

Troubleshooting starts with `import-report.md`. A detected asset may remain blocked because it is too large, unsupported by the static viewer, missing metadata, missing external hosting, or unsafe. Rejected files remain in the inbox when possible; root archives are retained after any failed run.
