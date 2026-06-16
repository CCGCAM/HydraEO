# EO Explorer stage 2 report

## Changes

- Added the secure Python import and validation workflow.
- Added the user-facing inbox, ignored imported-source archive, derived folder, generated report, and root-zip transaction.
- Added a dedicated ESA-style `explorer.html` cockpit and a lightweight homepage preview.
- Hardened catalog URLs and replaced metadata-adjacent `innerHTML` construction with explicit DOM/SVG nodes.
- Added CSP, dependency documentation, scientific gates, data readiness states, and security guidance.

## Import result

This stage-2 implementation run used the empty `visualization-data/data-to-import/` inbox; no root zip was imported. No source files were accepted, rejected, moved, or transformed, and no new scientific data were created. Existing catalog datasets were preserved. See `visualization-data/import-report.md` for the generated run record.

No newly imported dataset is publication-ready. Existing catalog entries retain their prior observational, synthetic, example, methodological, and unverified classifications. Browser-side computations remain blocked because the current catalog does not establish the complete calibration contract required by the stage-2 policy.

## Security and dependencies

Archive traversal, absolute paths, symlinks, nested archives, executable/web-code files, excessive sizes, unsafe URLs, raw-folder browser access, and metadata-driven HTML are blocked. OpenLayers remains pinned at 10.9.0; no new runtime framework was added.

## Validation and limitations

Validation run on 2026-06-10:

- `python scripts/import_visualization_data.py` completed with 0 accepted, 0 rejected, and 0 warnings for the empty inbox.
- `python scripts/validate_visualization_site.py` passed with 0 errors and 0 warnings.
- Python compilation and Node syntax checks passed for the importer, validator, and shared Explorer modules.
- Zip traversal and nested-archive rejection tests passed.
- An isolated `/tmp` integration test generated a public dataset only from an explicitly opted-in, metadata-complete small GeoJSON fixture.
- Chromium loaded the homepage preview and Explorer; the Explorer produced two map canvases with no application or CSP errors. Headless Chromium emitted only environment-specific WebGL performance warnings.

Large rasters still require intentional external HTTPS COG/STAC hosting. The current static site cannot publish local multi-GB sources. A fully evidenced 9.5/10 grade still requires real metadata-rich, externally hostable EO products. With honest blocked/empty states, the implemented architecture is estimated at 9.0/10.
