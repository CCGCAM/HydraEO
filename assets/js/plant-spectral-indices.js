const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const INDEX_DEFINITIONS = {
  NDVI: {
    formula: "(NIR - red) / (NIR + red)",
    continuousWavelengthsNm: [842, 665],
    bandTargetsNm: [842, 665],
    tolerancesNm: [95, 35]
  },
  NDRE: {
    formula: "(NIR - red edge) / (NIR + red edge)",
    continuousWavelengthsNm: [790, 705],
    bandTargetsNm: [790, 705],
    tolerancesNm: [60, 25]
  },
  PRI: {
    formula: "(531 - 570) / (531 + 570)",
    continuousWavelengthsNm: [531, 570],
    bandTargetsNm: [531, 570],
    tolerancesNm: [12, 18]
  },
  "NDMI-like": {
    formula: "(NIR - SWIR1) / (NIR + SWIR1)",
    continuousWavelengthsNm: [865, 1610],
    bandTargetsNm: [865, 1610],
    tolerancesNm: [95, 95]
  },
  MCARI: {
    formula: "((700 - 670) - 0.2 * (700 - 550)) * (700 / 670)",
    continuousWavelengthsNm: [700, 670, 550],
    bandTargetsNm: [700, 670, 550],
    tolerancesNm: [20, 25, 35]
  }
};

/**
 * Compute vegetation indices only from available continuous wavelengths or
 * sensor-resampled bands. No disease, yield or health class is inferred.
 */
export function computeVegetationIndices(wavelengthsNm, canopyReflectance, selectedSensorBands) {
  const continuous = selectedSensorBands.sensor.id === "continuous";
  const indices = {};
  for (const [name, definition] of Object.entries(INDEX_DEFINITIONS)) {
    indices[name] = computeIndex(name, definition, wavelengthsNm, canopyReflectance, selectedSensorBands, continuous);
  }
  indices["Red-edge position"] = continuous
    ? {
        value: estimateRedEdgePosition(wavelengthsNm, canopyReflectance),
        unit: "nm",
        available: true,
        formula: "maximum first derivative from 680 to 780 nm",
        inputs: "continuous model spectrum"
      }
    : unavailable("not available for this sampling", "maximum first derivative from 680 to 780 nm");
  return indices;
}

function computeIndex(name, definition, wavelengthsNm, canopyReflectance, selectedSensorBands, continuous) {
  const values = continuous
    ? definition.continuousWavelengthsNm.map((wavelength) => interpolateReflectance(wavelengthsNm, canopyReflectance, wavelength))
    : definition.bandTargetsNm.map((target, index) => nearestBand(selectedSensorBands.bands, target, definition.tolerancesNm[index]));
  if (values.some((value) => value === null || !Number.isFinite(value.reflectance ?? value))) {
    return unavailable("not available for this sampling", definition.formula);
  }
  const reflectances = values.map((value) => typeof value === "number" ? value : value.reflectance);
  const value = name === "MCARI"
    ? mcari(reflectances[0], reflectances[1], reflectances[2])
    : normalizedDifference(reflectances[0], reflectances[1]);
  if (!Number.isFinite(value)) return unavailable("not available for this sampling", definition.formula);
  return {
    value: clamp(value, -2, 2),
    unit: "",
    available: true,
    formula: definition.formula,
    inputs: continuous
      ? `${definition.continuousWavelengthsNm.join(", ")} nm`
      : values.map((band) => `${band.name} (${band.centerNm} nm)`).join(", ")
  };
}

function normalizedDifference(a, b) {
  return Math.abs(a + b) < 1e-8 ? null : (a - b) / (a + b);
}

function mcari(r700, r670, r550) {
  return ((r700 - r670) - 0.2 * (r700 - r550)) * (r700 / Math.max(r670, 1e-8));
}

function unavailable(reason, formula) {
  return { value: null, unit: "", available: false, reason, formula, inputs: "" };
}

function nearestBand(bands, target, tolerance) {
  let best = null;
  for (const band of bands) {
    const distance = Math.abs(band.centerNm - target);
    if (distance <= tolerance && (!best || distance < best.distance)) best = { ...band, distance };
  }
  return best;
}

export function interpolateReflectance(wavelengthsNm, canopyReflectance, target) {
  if (target <= wavelengthsNm[0]) return canopyReflectance[0];
  for (let index = 1; index < wavelengthsNm.length; index += 1) {
    if (wavelengthsNm[index] >= target) {
      const x0 = wavelengthsNm[index - 1], x1 = wavelengthsNm[index];
      const y0 = canopyReflectance[index - 1], y1 = canopyReflectance[index];
      const t = (target - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t;
    }
  }
  return canopyReflectance[canopyReflectance.length - 1];
}

function estimateRedEdgePosition(wavelengthsNm, canopyReflectance) {
  let bestWavelength = null;
  let bestSlope = -Infinity;
  for (let index = 1; index < wavelengthsNm.length; index += 1) {
    const wavelength = wavelengthsNm[index];
    if (wavelength < 680 || wavelength > 780) continue;
    const slope = canopyReflectance[index] - canopyReflectance[index - 1];
    if (slope > bestSlope) {
      bestSlope = slope;
      bestWavelength = wavelength;
    }
  }
  return bestWavelength;
}
