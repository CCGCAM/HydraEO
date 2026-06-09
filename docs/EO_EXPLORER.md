# EO Explorer developer note

The public Explorer reads only `visualization-data/catalog.json`. The current catalog
imports every distinct dataset object from the HYDRA-EO Geospatial Dataset source
tree and classifies it as observational, methodological, example, synthetic, or
unverified. See `visualization-data/README.md` for formats, metadata, CORS,
range-request, STAC, publication-status, validation, and local-testing guidance, and
`visualization-data/provenance/source-manifest.json` for complete source-file
accounting.

Frontend modules live in `assets/js/`; presentation is in
`assets/css/eo-explorer.css`. Public datasets can activate raster, vector, spectra,
temporal, comparison, inspector, provenance, and export controls. Controls remain
disabled when the required real assets or metadata are absent.
