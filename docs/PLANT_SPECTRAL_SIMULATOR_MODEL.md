# HYDRA-EO Plant Spectral Simulator Model

## Status

The simulator generates **model-derived canopy surface reflectance** in the browser. It does not generate measured satellite data, does not simulate atmosphere, does not perform disease diagnosis, does not predict yield, and does not use HYDRA-EO field observations.

The implemented model is **RTM-lite, PROSAIL-parameterized approximation**. It is not a validated PROSAIL, PROSPECT, or SAIL implementation.

The 3D/depth plant visualization is visual and explanatory only. It uses EZ-Tree (`@dgreenheck/ez-tree`) with Three.js to generate a pistachio-style deciduous orchard tree in the browser. A static-compatible pistachio fallback geometry is used only if the runtime EZ-Tree module import fails. The visualization is driven by the same derived biophysical parameters as the model, but it is not the radiative transfer engine and it does not feed the spectral calculation.

Three.js and EZ-Tree are loaded as ES modules from `esm.sh` to keep the site static and build-free. EZ-Tree is an MIT-licensed procedural tree generator that can be imported as `@dgreenheck/ez-tree` and used with `tree.generate()` before adding the tree to a Three.js scene. The Content Security Policy for `plant-spectral-simulator.html` allows `https://esm.sh` only for scripts and connections needed by that visual layer. If the module cannot load, the simulator uses local fallback geometry and the spectral model still runs.

The visualizer includes a sun marker and a directional light. Sun position is driven by `solarZenith` and `solarAzimuth` using zenith as the angle from vertical/up and azimuth as the horizontal direction around the vertical axis. The model separately uses `tts`, `saa`, `tto`, `vaa`, and derived `psi` in the RTM-lite canopy reflectance calculation.

## Model

The spectral model lives in `assets/js/plant-spectral-model.js`.

It uses:

- A 400-2500 nm wavelength domain.
- 1 nm sampling.
- Leaf optical depth from named Gaussian absorption basis functions for chlorophyll, carotenoids, anthocyanin, brown pigment, water, and dry matter.
- A simple leaf scattering continuum with PROSAIL-like structural parameter semantics.
- A Beer-Lambert canopy gap fraction.
- Separate leaf reflectance, leaf transmittance, bark/wood reflectance, and soil/background reflectance terms.
- Soil background mixture controlled by LAI, fractional cover and `pSoil`.
- Solar/view geometry terms using `tts`, `saa`, `tto`, `vaa`, derived `psi`, and a simple hotspot parameter.

These equations are deterministic and physically interpretable, but approximate. Coefficients are internal RTM-lite coefficients and are not claimed to reproduce official PROSAIL output.

## Parameter Mapping

The mapping layer lives in `assets/js/plant-parameter-mapping.js`.

The current UI intentionally exposes only controls that affect both the EZ-Tree visual canopy and RTM-lite reflectance output. Sensor selection remains because it is an output resampling mode rather than a plant parameter.

| Control | Visual effect | Model effect | Units / range | Warning condition |
| --- | --- | --- | --- | --- |
| Leaf area index | Changes visible foliage instance count, opacity and crown density around the EZ-Tree skeleton. | `LAI`, Beer-Lambert gap fraction, canopy cover and soil exposure. | m2/m2, 0.2-6.5 | Very low LAI increases soil influence; very high LAI is near the interactive guardrail. |
| Cab | Changes leaf material from pale gray-green to saturated gray-green. | `Cab`, chlorophyll absorption in blue and red wavelengths; senescence can reduce effective Cab. | ug/cm2, 5-80 | Cab near range edge. |
| Cw | Changes subtle leaf turgor/desaturation and droop in the visual leaf layer. | `Cw`, water absorption near 970, 1200, 1450 and 1950 nm. | cm, 0.003-0.05 | Cw near range edge. |
| Cm | Changes dry, rougher, slightly browner leaf material. | `Cm`, dry-matter SWIR absorption and dry material contribution. | g/cm2, 0.002-0.02 | Cm near range edge. |
| Senescence | Adds yellow-brown tint and slightly more open/dry foliage appearance. | `Cbrown`, `Ant`, effective Cab reduction and Cm/Cw adjustment. | percent, 0-100 | High senescence is an extreme educational case. |
| Leaf angle | Tilts the visual leaf layer and compound leaflet planes. | `ALA`, leaf projection and Beer-Lambert extinction. | degrees, 10-80 | Extreme inclination reduces approximation reliability. |
| Soil brightness | Brightens or darkens dry orchard ground. | `pSoil`, soil/background reflectance contribution. | percent, 0-100 | Most influential at low LAI. |
| Solar zenith | Moves sun disk higher/lower and changes directional light. | `tts`, illumination and shadowing terms. | degrees, 0-75 | Very high zenith is an extreme geometry. |
| Solar azimuth | Rotates sun disk and light direction around the tree. | `saa` and relative azimuth `psi` with fixed nadir-like view azimuth. | degrees, 0-360 | None; it controls directional geometry. |

The visualizer uses a fixed pistachio-style orchard-tree architecture. There are no user-facing olive, crop-health, disease, yield, wind, trunk, branch, row spacing, or leaf-count scientific controls.

Practical interface guardrails are:

- `Cab`: 5-80 ug/cm2.
- `Car`: 1-25 ug/cm2.
- `Cw`: 0.003-0.05 cm.
- `Cm`: 0.002-0.02 g/cm2.
- `LAI`: 0.1-8 m2/m2.
- `tts`: 0-70 degrees.
- `tto`: fixed 8 degrees in this version.
- `saa`: 0-360 degrees.
- `vaa`: fixed 0 degrees in this version.
- `psi`: 0-180 degrees.

These are interactive guardrails, not universal biological ranges.

## Sensor Resampling

Sensor logic lives in `assets/js/plant-sensors.js`.

The simulator supports:

- Continuous model output.
- Sentinel-2 generic approximate multispectral sampling.
- Sentinel-2A-like, Sentinel-2B-like, and Sentinel-2C-like approximate multispectral sampling.
- PRISMA-like hyperspectral-like sampling.
- EnMAP-like hyperspectral-like sampling.
- CHIME-like candidate hyperspectral-like sampling.
- Custom Gaussian hyperspectral mode.

Static SRF metadata are stored under `assets/data/srf/`. They are approximate Gaussian definitions unless explicitly marked otherwise. No official Sentinel-2, PRISMA, EnMAP, or CHIME SRF fidelity is claimed.

Band reflectance is computed by spectral convolution:

```text
R_band = sum(R_lambda * SRF_lambda) / sum(SRF_lambda)
```

Nearest-wavelength sampling is not used when Gaussian SRFs are available.

## Vegetation Indices

Index logic lives in `assets/js/plant-spectral-indices.js`.

Implemented indices:

- NDVI: `(NIR - red) / (NIR + red)`.
- NDRE: `(NIR - red edge) / (NIR + red edge)`.
- PRI: `(531 - 570) / (531 + 570)`.
- NDMI-like: `(NIR - SWIR1) / (NIR + SWIR1)`.
- MCARI: `((700 - 670) - 0.2 * (700 - 550)) * (700 / 670)`.
- Red-edge position: maximum first derivative from 680 to 780 nm, continuous mode only.

If a selected sensor sampling lacks compatible bands, the UI reports “not available for this sampling.” Indices are not converted into disease, yield, stress diagnosis, or plant health classes.

## Validation And Sanity Checks

Validation logic lives in `assets/js/plant-spectral-validation.js`.

Fixtures are mirrored in `assets/data/validation/prosail_reference_cases.json`.

The current fixture set provides qualitative sanity checks only:

- Red absorption lower than green for a healthy canopy case.
- NIR reflectance greater than red for a healthy canopy case.
- Water absorption dips deepen when modeled Cw increases.
- Low LAI increases soil background influence.
- Sampled reflectance remains in [0, 1].

There are no exact trusted PROSAIL reference spectra in this repository. Therefore the UI reports these as sanity checks, not validation. Numeric max absolute error and RMSE are not applicable.

Validation mode is available at:

```text
plant-spectral-simulator.html?validate=1
```

## Atmosphere

Atmosphere is not simulated. Current output is canopy surface reflectance.

Top-of-atmosphere radiance or reflectance would require atmospheric state, aerosol optical thickness, water vapor, ozone, pressure, altitude, and detailed sensor geometry. Those inputs are not included and no fake atmospheric sliders are provided.

## Known Limitations

- RTM-lite is not a replacement for validated PROSAIL, PROSPECT, SAIL, SCOPE, or sensor-specific processing chains.
- Gaussian SRFs are simplified approximations unless official SRF data are added later.
- The model does not represent crop-specific disease physiology.
- The model does not use HYDRA-EO observations, calibration values, field measurements, validation accuracy, or satellite acquisitions.
- The EZ-Tree pistachio-style visual plant is explanatory and cannot be used as evidence for measured canopy structure. Visual mesh state does not alter model-derived canopy surface reflectance except through the documented UI-to-biophysical parameter mapping.
