# Security Policy

## Reporting a Vulnerability

Please report suspected security issues privately to the HYDRA-EO project maintainers before public disclosure.

Do not place credentials, API keys, private tokens, unpublished personal data, or raw restricted datasets in this repository. Large source rasters and imported data should stay in the ignored `visualization-data/data-to-import/` or `visualization-data/data-imported/` paths unless an explicit publication workflow approves derived browser-safe assets.

## Static Site Data Boundary

The public visualization site is designed to serve static HTML, CSS, JavaScript, metadata, and derived browser assets. Raw multi-GB EO source products should not be committed or exposed directly through browser paths. Use reproducible derived assets, external HTTPS COG/STAC hosting, and the repository validation scripts before publishing data.
