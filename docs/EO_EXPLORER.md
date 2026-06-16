# EO Explorer architecture

`explorer.html` is a static, provenance-first Earth Observation cockpit. The homepage loads only `assets/js/eo-preview.js`; OpenLayers is loaded lazily and only on the dedicated Explorer page when a renderable public dataset is selected.

The browser reads the generated `visualization-data/catalog.json`. Researchers place untrusted source data in `visualization-data/data-to-import/` and run `python scripts/import_visualization_data.py`. Accepted sources move to the git-ignored `data-imported/` archive. The browser is prohibited from loading either raw-data folder.

The interface distinguishes no data, detected-only, external-hosting-required, ready, demo, and invalid states. Controls are capability-driven. Swipe and the Spectral Lens remain disabled when compatible real layers are unavailable. Index and proxy calculations remain blocked unless calibration metadata are complete. Precomputed layers are displayed only as registered source products with units, nodata, provenance, and citation/access notes.

The renderer supports registered COG/GeoTIFF and GeoJSON assets, limited table previews, spectral charts with declared axes, colorbars, safe feature-property display, timeline selection, provenance inspection, and metadata/legend exports. It does not infer scientific meaning from filenames or columns.

## Shared readiness ladder

- Level 0: No files detected.
- Level 1: Files detected.
- Level 2: Technical type identified.
- Level 3: Browser preview available.
- Level 4: Source product visualizable with metadata.
- Level 5: Calibrated product with provenance.
- Level 6: Computation-ready.
- Level 7: Publication-ready.

OpenLayers 10.9.0 is pinned in `assets/js/eo-renderers.js` and loaded from fixed module/style CDN origins documented in `assets/vendor/README.md`. Catalog metadata cannot choose script origins. See `visualization-data/README.md` for import, STAC, sidecar, hosting, readiness, and troubleshooting guidance.
