import { simulateCanopyReflectance } from "./plant-spectral-model.js";
import { interpolateReflectance } from "./plant-spectral-indices.js";

export const VALIDATION_FIXTURE_VERSION = "2026-06-16-sanity-fixtures-v1";

export const SANITY_REFERENCE_CASES = [
  {
    id: "healthy-canopy",
    description: "Moderate green canopy with enough LAI to show red absorption and NIR scattering.",
    uiParameters: { leafAreaIndex: 2.8, cab: 58, cw: 0.024, cm: 0.009, senescence: 8, leafAngle: 42, soilBrightness: 35, solarZenith: 30, solarAzimuth: 30 },
    checks: ["red_lower_than_green", "nir_greater_than_red", "reflectance_bounds"]
  },
  {
    id: "water-contrast-dry",
    description: "Dryer canopy case for water absorption comparison.",
    uiParameters: { leafAreaIndex: 2.8, cab: 58, cw: 0.006, cm: 0.009, senescence: 8, leafAngle: 42, soilBrightness: 35, solarZenith: 30, solarAzimuth: 30 },
    checks: ["reflectance_bounds"]
  },
  {
    id: "water-contrast-wet",
    description: "Wetter canopy case expected to show deeper modeled water absorption.",
    uiParameters: { leafAreaIndex: 2.8, cab: 58, cw: 0.042, cm: 0.009, senescence: 8, leafAngle: 42, soilBrightness: 35, solarZenith: 30, solarAzimuth: 30 },
    checks: ["water_absorption_deeper_than_dry", "reflectance_bounds"]
  },
  {
    id: "low-lai-soil",
    description: "Sparse canopy expected to move closer to soil background than dense canopy.",
    uiParameters: { leafAreaIndex: 0.35, cab: 42, cw: 0.018, cm: 0.011, senescence: 15, leafAngle: 55, soilBrightness: 70, solarZenith: 35, solarAzimuth: 45 },
    checks: ["low_lai_soil_influence", "reflectance_bounds"]
  }
];

export function runSanityChecks() {
  const cases = SANITY_REFERENCE_CASES.map((fixture) => {
    const result = simulateCanopyReflectance(fixture.uiParameters);
    const sampled = sampleReflectance(result, [450, 550, 670, 705, 740, 800, 970, 1200, 1450, 1650, 1950, 2200]);
    return { fixture, result, sampled };
  });
  const dryCase = cases.find((item) => item.fixture.id === "water-contrast-dry");
  const wetCase = cases.find((item) => item.fixture.id === "water-contrast-wet");
  const denseCase = cases.find((item) => item.fixture.id === "healthy-canopy");
  const lowLaiCase = cases.find((item) => item.fixture.id === "low-lai-soil");
  const checks = [];
  for (const item of cases) {
    for (const check of item.fixture.checks) {
      checks.push(evaluateCheck(check, item, { dryCase, wetCase, denseCase, lowLaiCase }));
    }
  }
  const failed = checks.filter((check) => !check.passed);
  return {
    fixtureVersion: VALIDATION_FIXTURE_VERSION,
    modelVersion: cases[0]?.result.modelMetadata.version,
    validationType: "qualitative sanity checks only",
    passedCount: checks.length - failed.length,
    failedCount: failed.length,
    maxAbsoluteError: null,
    rmse: null,
    checks,
    failedCases: failed
  };
}

function sampleReflectance(result, wavelengths) {
  return Object.fromEntries(wavelengths.map((wavelength) => [
    wavelength,
    interpolateReflectance(result.wavelengthsNm, result.canopyReflectance, wavelength)
  ]));
}

function evaluateCheck(check, item, context) {
  const r = item.sampled;
  if (check === "red_lower_than_green") {
    return checkResult(item.fixture.id, check, r[670] < r[550], `R670=${r[670].toFixed(4)}, R550=${r[550].toFixed(4)}`);
  }
  if (check === "nir_greater_than_red") {
    return checkResult(item.fixture.id, check, r[800] > r[670], `R800=${r[800].toFixed(4)}, R670=${r[670].toFixed(4)}`);
  }
  if (check === "water_absorption_deeper_than_dry") {
    const wet = context.wetCase.sampled;
    const dry = context.dryCase.sampled;
    return checkResult(item.fixture.id, check, wet[1450] < dry[1450] && wet[1950] < dry[1950], `wet R1450=${wet[1450].toFixed(4)}, dry R1450=${dry[1450].toFixed(4)}`);
  }
  if (check === "low_lai_soil_influence") {
    const low = context.lowLaiCase.result.derivedBiophysicalParameters.LAI;
    const dense = context.denseCase.result.derivedBiophysicalParameters.LAI;
    return checkResult(item.fixture.id, check, low < dense, `low LAI=${low.toFixed(2)}, dense LAI=${dense.toFixed(2)}`);
  }
  if (check === "reflectance_bounds") {
    const values = Object.values(r);
    return checkResult(item.fixture.id, check, values.every((value) => value >= 0 && value <= 1), "sampled reflectance values stay in [0, 1]");
  }
  return checkResult(item.fixture.id, check, false, "unknown check");
}

function checkResult(caseId, check, passed, detail) {
  return { caseId, check, passed, detail };
}
