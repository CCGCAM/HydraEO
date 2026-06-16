# Browser dependencies

| Library | Version | Source | License | Purpose |
| --- | --- | --- | --- | --- |
| OpenLayers | 10.9.0 | `https://esm.sh/ol@10.9.0` and `https://cdn.jsdelivr.net/npm/ol@10.9.0/ol.css` | BSD-2-Clause | COG/GeoTIFF and GeoJSON map rendering on `explorer.html` only |

The origins and version are fixed in `assets/js/eo-renderers.js`; catalog metadata cannot alter them. The Explorer CSP permits `data:` and `blob:` workers solely because the pinned GeoTIFF decoder uses local parsing workers. Vendoring is preferred for a future release if the repository adopts a reproducible dependency update process. No heavy map dependency is loaded on the homepage.
