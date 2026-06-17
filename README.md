# HYDRA-EO

Website for the **HYDRA-EO – Hybrid Machine Learning & Earth Observation for Multi-Stressor Crop Disease Detection** project, funded by the European Space Agency (ESA, EXPRO+ Tender, Action 1-12684).

**Project website (GitHub Pages)**\
<https://CCGCAM.github.io/HydraEO>

------------------------------------------------------------------------

## About HYDRA-EO

HYDRA-EO is an ESA-funded project that combines **hyperspectral, thermal and fluorescence** data with **radiative transfer models (RTMs)** and **hybrid machine learning** to detect biotic and abiotic stress in key crops across Spain, Italy and the Netherlands.

The project is coordinated by the **Laboratory of Geo-information Science and Remote Sensing**, Department Environment Sciences, Wageningen University (WU-DES), together with:

-   **WENR** – Wageningen Environmental Research, Wageningen University and Research (Wageningen, Netherlands)
-   **CNR-IBE** Consiglio Nazionale della Ricerca, Institute of BioEconomy (Fiorenze, Italy)
-   **CIAG-IRIAF** – Agro-environmental Research Centre (Ciudad Real, Spain)

------------------------------------------------------------------------

## This repository

This repository contains the **static website** for HYDRA-EO:

-   `index.html`: main project page (project description, objectives, scenarios, methods, open tools, consortium, news).
-   `explorer.html`: full static EO Explorer cockpit.
-   `plant-spectral-simulator.html`: browser-only pistachio canopy and spectral simulator. It generates simulated/model-derived canopy surface reflectance with an RTM-lite, PROSAIL-parameterized approximation and sensor-like spectral convolution. The visual canopy uses EZ-Tree/Three.js when available and a static-compatible pistachio fallback if the runtime import fails. Remaining plant controls are coupled to both the visual canopy and the reflectance parameter mapping. It does not use observed HYDRA-EO measurements, atmosphere simulation, a backend service, or a validated PROSAIL run. Model details are documented in `docs/PLANT_SPECTRAL_SIMULATOR_MODEL.md`.
-   `assets/css/scientific-home.css`: the single source of truth for the main page design. The readable `Homepage topbar` block near the top controls the ESA logo, project title, navigation text and responsive menu.
-   `docs/`: documents, papers.
-   `assets/`:figures, logos and icons used on the site.
-   `tools/`: HTML pages describing open tools such as **ToolsRTM** and **SCOPEinR**.

### Editing the website

The public homepage is the root `index.html`. Do not edit `docs-quarto/`, `quarto/`, `versions/`, `Index-internal.html` or `Index-public.html` when changing the homepage; those are legacy or supplementary pages and do not control the main navigation shown at the project URL.

For topbar changes, edit only the `Homepage topbar` block in `assets/css/scientific-home.css`. Avoid adding later overrides for `.site-header`, `.nav-wrap`, `.identity`, `.site-nav` or `.nav-toggle`.

Visualization data are imported by placing files in `visualization-data/data-to-import/` and running `python scripts/import_visualization_data.py`. The generated `catalog.json` should not be edited manually. Imported raw sources move to the git-ignored `visualization-data/data-imported/`; large rasters require external HTTPS COG/STAC hosting. Validate before publishing with `python scripts/validate_visualization_site.py`.

The site is deployed via **GitHub Pages** and is intended as a public entry point for the HYDRA-EO project.

------------------------------------------------------------------------

## Related code repositories

The HYDRA-EO website links to the following scientific software:

-   **ToolsRTM** – R package for accessing multiple radiative transfer models\
    GitLab: <https://gitlab.com/caminoccg/toolsrtm>

-   **SCOPEinR** – R interface for SCOPE-style energy-balance and fluorescence simulations\
    GitLab: <https://gitlab.com/caminoccg/scopeinr>

------------------------------------------------------------------------

## Citation & Acknowledgements

If you use HYDRA-EO materials or tools, please acknowledge:

> HYDRA-EO – Hybrid Machine Learning & Earth Observation for Multi-Stressor Crop Disease and Pest Detection (ESA EXPRO+ Tender, Action 1-12684).

The project is funded by the **European Space Agency (ESA)**.
