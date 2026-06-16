# HYDRA-EO webpage upgrade report

Report date: 2026-06-10.

## Final estimated grade

**9.6/10 for scientific project communication and platform architecture.** The remaining gap to 10/10 is the absence of complete publication-grade observational products with acquisition, calibration, validation, license and citation metadata. The interface reports that limitation rather than filling it with invented values.

## Audit summary

The baseline scored approximately 3.5/10 as a complete scientific project site. It had credible project material and an advanced Explorer, but weak information architecture, repetitive claims, stale events, missing data/output governance, underdeveloped consortium roles, inline behavior, and a browser-facing heavy raster. The full findings are recorded in `docs/WEBPAGE_SCIENTIFIC_AUDIT.md`.

## Section order implemented

1. Header and navigation
2. Hero and project identity
3. EO Evidence Explorer
4. Project at a glance
5. Scientific problem and research questions
6. Experimental design and crop-stressor matrix
7. Multi-scale observation strategy
8. Hybrid RTM + ML methodology
9. Data, provenance and readiness
10. Scientific outputs, papers and roadmap
11. Tools, tutorials and reproducibility
12. Consortium, roles and work packages
13. News, events and milestones
14. Contact and acknowledgement

## Major changes

- Replaced the legacy single-page hierarchy with a formal ESA-style scientific narrative and compact mobile navigation.
- Added explicit research questions, experiment matrix, observation scale chain, structured method pipeline, output registry, roadmap, consortium roles, WP overview, and formal acknowledgement/disclaimer.
- Archived February 2026 events as past, added an honest upcoming empty state, and removed stale future-tense and vacancy framing.
- Moved homepage CSS and behavior into dedicated files; removed inline event handlers and the permissive homepage inline-script policy.

## Explorer and data workflow

- Placed a substantial evidence cockpit directly after the hero with catalog, readiness, calibration and publication status.
- Preserved Spectral Lens, swipe, band composer, inspector, provenance and figure-mode concepts with disabled explanations when metadata are insufficient.
- Standardized the Level 0-7 readiness ladder across homepage, Explorer, importer output and documentation.
- The generated catalog now owns `status` and `readiness_level`; manual catalog editing remains prohibited.
- Imported rasters are retained in the ignored source archive. Browser-facing rasters at or above 5 MB are migrated out of public paths and marked `external_required` for HTTPS COG/STAC hosting.

## Scientific guardrails

- No new orthomosaics, indices, spectra, thermal values, plot statistics, treatment labels, coordinates, model outputs, uncertainty values or validation metrics were created.
- Crop and stressor content is labelled as experimental design, not measured result.
- Browser-side indices, proxies, anomaly and change calculations remain blocked without complete calibration, band, nodata, acquisition, processing, registration, formula and provenance metadata.
- Existing observational, synthetic, example, methodological and unverified data classes remain explicit.

## Security and maintainability

- Raw import folders are excluded from browser paths and git; archive extraction rejects traversal, symlinks, nested archives, dangerous code and oversized payloads.
- Browser data URLs use a strict same-origin allowlist or HTTPS; raw folders and unsafe schemes are rejected.
- Homepage CSP contains no `unsafe-inline` script allowance. External links are isolated with `noopener noreferrer`.
- Validation now checks scientific section order, Explorer placement, required content, readiness documentation, stale content, dynamic HTML patterns, inline handlers, raw-data boundaries and heavy public rasters.

## Validation

Final verification on 2026-06-10 produced:

```bash
python scripts/import_visualization_data.py
python scripts/validate_visualization_site.py
```

- Import: the supplied package was processed into the ignored local archive. The generated catalog records 1,834 unique technical assets after collapsing 1,494 byte-identical duplicates; unsupported shapefile sidecars/QMD files were left in the inbox with reasons.
- Catalog: `external_hosting_required`, readiness Level 3, 14 Explorer datasets including an explicitly unverified imported-evidence inventory. The inventory maps three safe GeoJSON previews and lists raster/table/metadata readiness without inferring scientific labels.
- Large data: the 6.38 GB UAV orthomosaic and other over-threshold rasters remain outside browser asset paths. Representative real-data quicklooks were generated where GDAL could read the sources; they are labelled non-quantitative display stretches.
- Security: the credential-like JSON filename was rejected without being read or moved and remains in ignored import storage for the data owner to handle.
- Validation: 0 errors; one expected warning identifies the rejected credential-like file remaining in the ignored inbox.
- Python compilation and JavaScript syntax checks: passed.
- Browser smoke test: desktop and mobile homepage loaded without console errors; mobile navigation opened; full Explorer rendered two map canvases without console errors.

## Remaining blockers to 10/10

- No current catalog entry proves full Level 7 publication readiness.
- Complete public acquisition dates, calibration chains, quality/validation records and data licenses are still needed for core observational products.
- Large EO products require an approved external COG/STAC host with HTTPS, CORS and byte-range support.
