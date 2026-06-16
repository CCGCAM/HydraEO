# EO Explorer stage 2 baseline audit

Audit date: 2026-06-10.

The committed baseline preserved the main HYDRA-EO project page and an advanced embedded Explorer with modular JavaScript, explicit observational/synthetic/example/unverified dataset classes, COG/GeoJSON rendering, provenance, and conservative computation controls.

Stage-2 gaps found before changes:

- The full Explorer and heavy renderer entry point were embedded on the homepage; no separate `explorer.html` existed.
- Catalog generation used project-specific Node scripts and required direct catalog-oriented maintenance.
- The required import inbox, ignored source archive, root-zip workflow, import report, and Python validation command did not exist.
- Large-data import defenses and deterministic external-hosting states were absent.
- Shared UI modules contained three `innerHTML` assignments.
- The renderer used pinned CDN dependencies, but dependency documentation and CSP were absent.
- External `_blank` links were inconsistently isolated.
- Documentation did not describe the generated inbox-to-archive workflow or readiness ladder.

No baseline scientific assets were reclassified as real observations. Existing synthetic, example, methodological, and unresolved labels remain authoritative.
