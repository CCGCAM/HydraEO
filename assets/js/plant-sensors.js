export const SENSOR_REGISTRY_VERSION = "2026-06-16-sensor-registry-v2";

const gaussian = (wavelengthNm, centerNm, fwhmNm) => Math.exp(-4 * Math.log(2) * ((wavelengthNm - centerNm) / fwhmNm) ** 2);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const sentinel2Bands = [
  ["B1 Coastal aerosol", 443, 21],
  ["B2 Blue", 490, 65],
  ["B3 Green", 560, 35],
  ["B4 Red", 665, 30],
  ["B5 Red edge 1", 705, 15],
  ["B6 Red edge 2", 740, 15],
  ["B7 Red edge 3", 783, 20],
  ["B8 NIR", 842, 115],
  ["B8A Narrow NIR", 865, 20],
  ["B11 SWIR 1", 1610, 90],
  ["B12 SWIR 2", 2190, 180]
].map(toGaussianBand);

export const SENSOR_DEFINITIONS = {
  continuous: {
    id: "continuous",
    displayName: "Continuous model output",
    label: "Continuous model output",
    sensorType: "hyperspectral-like",
    wavelengthRangeNm: [400, 2500],
    numberOfBands: 2101,
    srfStatus: "model grid",
    badge: "1 nm model grid",
    sourceCitation: "RTM-lite model wavelength grid generated in browser.",
    caveats: "No instrument spectral response is applied.",
    bands: []
  },
  sentinel2: {
    id: "sentinel2",
    displayName: "Sentinel-2 generic approximate",
    label: "Sentinel-2-like multispectral sampling",
    sensorType: "multispectral",
    wavelengthRangeNm: [443, 2190],
    numberOfBands: sentinel2Bands.length,
    srfStatus: "approximate Gaussian",
    badge: "Approximate Gaussian SRF",
    sourceCitation: "Generic Sentinel-2-like center/FWHM approximation; no official SRF file included.",
    caveats: "Use for educational sensor-like resampling only.",
    bands: sentinel2Bands
  },
  "sentinel-2a-like": makeSentinelVariant("sentinel-2a-like", "Sentinel-2A-like approximate", -1),
  "sentinel-2b-like": makeSentinelVariant("sentinel-2b-like", "Sentinel-2B-like approximate", 0),
  "sentinel-2c-like": makeSentinelVariant("sentinel-2c-like", "Sentinel-2C-like approximate", 1),
  prisma: {
    id: "prisma",
    displayName: "PRISMA-like hyperspectral sampling",
    label: "PRISMA-like hyperspectral sampling",
    sensorType: "hyperspectral-like",
    wavelengthRangeNm: [410, 2450],
    numberOfBands: 205,
    srfStatus: "approximate Gaussian",
    badge: "Approximate Gaussian SRF",
    sourceCitation: "PRISMA-like educational approximation using 10 nm spacing and Gaussian responses.",
    caveats: "Not PRISMA official SRF; no instrument fidelity is claimed.",
    bands: rangeBands("P", 410, 2450, 10, 10)
  },
  enmap: {
    id: "enmap",
    displayName: "EnMAP-like hyperspectral sampling",
    label: "EnMAP-like hyperspectral sampling",
    sensorType: "hyperspectral-like",
    wavelengthRangeNm: [420, 2450],
    numberOfBands: 204,
    srfStatus: "approximate Gaussian",
    badge: "Approximate Gaussian SRF",
    sourceCitation: "EnMAP-like educational approximation using 10 nm spacing and Gaussian responses.",
    caveats: "Not EnMAP official SRF; no instrument fidelity is claimed.",
    bands: rangeBands("E", 420, 2450, 10, 9)
  },
  chime: {
    id: "chime",
    displayName: "CHIME-like candidate hyperspectral sampling",
    label: "CHIME-like candidate hyperspectral sampling",
    sensorType: "hyperspectral-like",
    wavelengthRangeNm: [400, 2500],
    numberOfBands: 211,
    srfStatus: "approximate Gaussian",
    badge: "Approximate Gaussian SRF",
    sourceCitation: "CHIME-like candidate educational approximation using 10 nm spacing and Gaussian responses.",
    caveats: "Not an official CHIME SRF and not a mission-grade simulator.",
    bands: rangeBands("C", 400, 2500, 10, 10)
  },
  "custom-gaussian": {
    id: "custom-gaussian",
    displayName: "Custom Gaussian hyperspectral mode",
    label: "Custom Gaussian hyperspectral mode",
    sensorType: "hyperspectral-like",
    wavelengthRangeNm: [400, 2500],
    numberOfBands: 141,
    srfStatus: "approximate Gaussian",
    badge: "Approximate Gaussian SRF",
    sourceCitation: "Generic 15 nm spacing Gaussian mode for browser-only demonstrations.",
    caveats: "Not associated with a real sensor.",
    bands: rangeBands("G", 400, 2500, 15, 12)
  }
};

function makeSentinelVariant(id, displayName, offsetNm) {
  return {
    id,
    displayName,
    label: `${displayName} multispectral sampling`,
    sensorType: "multispectral",
    wavelengthRangeNm: [443 + offsetNm, 2190 + offsetNm],
    numberOfBands: sentinel2Bands.length,
    srfStatus: "approximate Gaussian",
    badge: "Approximate Gaussian SRF",
    sourceCitation: "Sentinel-2 platform-like approximation; official SRF JSON is not included.",
    caveats: "Center wavelengths are shifted by a deterministic small offset for platform-like comparison only.",
    bands: sentinel2Bands.map((band) => ({ ...band, centerNm: band.centerNm + offsetNm }))
  };
}

function toGaussianBand([name, centerNm, fwhmNm]) {
  return { name, centerNm, fwhmNm, responseType: "gaussian" };
}

function rangeBands(prefix, start, end, spacing, fwhm) {
  const bands = [];
  let index = 1;
  for (let center = start; center <= end; center += spacing) {
    bands.push({ name: `${prefix}${String(index).padStart(3, "0")}`, centerNm: center, fwhmNm: fwhm, responseType: "gaussian" });
    index += 1;
  }
  return bands;
}

export function listSensors() {
  return Object.values(SENSOR_DEFINITIONS).map(sensorMetadata);
}

export function getSensorDefinition(sensorId) {
  return SENSOR_DEFINITIONS[sensorId] || SENSOR_DEFINITIONS.continuous;
}

export function sensorMetadata(sensor) {
  return {
    id: sensor.id,
    displayName: sensor.displayName,
    label: sensor.label,
    sensorType: sensor.sensorType,
    wavelengthRangeNm: sensor.wavelengthRangeNm,
    numberOfBands: sensor.id === "continuous" ? sensor.numberOfBands : sensor.bands.length,
    srfStatus: sensor.srfStatus,
    badge: sensor.badge,
    sourceCitation: sensor.sourceCitation,
    caveats: sensor.caveats
  };
}

/**
 * Resample canopy reflectance to a sensor-like band set using spectral
 * convolution. Gaussian approximations are explicitly labelled in metadata.
 */
export function resampleSpectrum(wavelengthsNm, canopyReflectance, sensorId) {
  const sensor = getSensorDefinition(sensorId);
  if (sensor.id === "continuous") {
    return {
      sensor: sensorMetadata(sensor),
      bands: wavelengthsNm.map((wavelength, index) => ({
        name: `${wavelength} nm`,
        centerNm: wavelength,
        fwhmNm: 1,
        reflectance: canopyReflectance[index],
        responseType: "model-grid"
      }))
    };
  }
  return {
    sensor: sensorMetadata(sensor),
    bands: sensor.bands.map((band) => ({
      ...band,
      reflectance: convolveBand(wavelengthsNm, canopyReflectance, band)
    }))
  };
}

export function convolveBand(wavelengthsNm, canopyReflectance, band) {
  let weighted = 0;
  let weightSum = 0;
  wavelengthsNm.forEach((wavelength, index) => {
    const weight = band.responseType === "gaussian" ? gaussian(wavelength, band.centerNm, band.fwhmNm) : 0;
    weighted += canopyReflectance[index] * weight;
    weightSum += weight;
  });
  return weightSum > 0 ? clamp(weighted / weightSum, 0, 1) : null;
}
