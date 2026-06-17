import { deriveBiophysicalParameters } from "./plant-parameter-mapping.js";

export const MODEL_METADATA = {
  name: "RTM-lite, PROSAIL-parameterized approximation",
  version: "2026-06-16-rtm-lite-v3",
  spectralDomainNm: [400, 2500],
  spectralSamplingNm: 1,
  outputType: "simulated canopy surface reflectance",
  atmosphere: "not simulated",
  validation: "qualitative sanity checks only; not validated PROSAIL",
  caveats: [
    "This is not a validated PROSAIL, PROSPECT or SAIL implementation.",
    "Leaf optical absorption uses named Gaussian basis functions to approximate pigment, water and dry-matter absorption regions.",
    "Canopy mixing uses a Beer-Lambert gap fraction, fractional crown cover, wood/soil fractions, sun-view geometry and a hotspot term, not a full four-stream SAIL solver."
  ]
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const gaussian = (wavelengthNm, centerNm, fwhmNm) => Math.exp(-4 * Math.log(2) * ((wavelengthNm - centerNm) / fwhmNm) ** 2);

const LEAF_ABSORPTION_BASIS = {
  chlorophyll: [
    { centerNm: 430, fwhmNm: 55, coefficient: 0.017, source: "blue chlorophyll absorption basis" },
    { centerNm: 662, fwhmNm: 42, coefficient: 0.021, source: "red chlorophyll absorption basis" }
  ],
  carotenoid: [
    { centerNm: 470, fwhmNm: 80, coefficient: 0.010, source: "carotenoid blue-green absorption basis" }
  ],
  anthocyanin: [
    { centerNm: 530, fwhmNm: 70, coefficient: 0.018, source: "anthocyanin green absorption basis" }
  ],
  brownPigment: [
    { centerNm: 500, fwhmNm: 260, coefficient: 0.55, source: "broad brown pigment absorption basis" },
    { centerNm: 680, fwhmNm: 220, coefficient: 0.30, source: "broad senescent pigment absorption basis" }
  ],
  water: [
    { centerNm: 970, fwhmNm: 75, coefficient: 18, source: "leaf water absorption basis" },
    { centerNm: 1200, fwhmNm: 95, coefficient: 12, source: "leaf water absorption basis" },
    { centerNm: 1450, fwhmNm: 145, coefficient: 36, source: "leaf water absorption basis" },
    { centerNm: 1950, fwhmNm: 180, coefficient: 42, source: "leaf water absorption basis" }
  ],
  dryMatter: [
    { centerNm: 1730, fwhmNm: 130, coefficient: 8, source: "dry-matter SWIR absorption basis" },
    { centerNm: 2100, fwhmNm: 180, coefficient: 10, source: "dry-matter SWIR absorption basis" },
    { centerNm: 2300, fwhmNm: 160, coefficient: 7, source: "dry-matter SWIR absorption basis" }
  ]
};

/**
 * Generate inclusive model wavelengths.
 */
export function generateWavelengths(start = 400, end = 2500, step = MODEL_METADATA.spectralSamplingNm) {
  const wavelengths = [];
  for (let wavelength = start; wavelength <= end; wavelength += step) wavelengths.push(wavelength);
  return wavelengths;
}

/**
 * Compute RTM-lite canopy surface reflectance from UI controls.
 */
export function simulateCanopyReflectance(uiParameters = {}) {
  const mapping = deriveBiophysicalParameters(uiParameters);
  const wavelengthsNm = generateWavelengths();
  const warnings = [...mapping.warnings];
  let clampedReflectanceCount = 0;
  const canopyReflectance = wavelengthsNm.map((wavelengthNm) => {
    const value = canopyReflectanceAt(wavelengthNm, mapping.derivedBiophysicalParameters);
    const clamped = clamp(value, 0, 1);
    if (clamped !== value) clampedReflectanceCount += 1;
    return clamped;
  });
  if (clampedReflectanceCount > 0) warnings.push(`Reflectance was clamped to [0, 1] at ${clampedReflectanceCount} wavelengths.`);
  warnings.push("Model is RTM-lite, PROSAIL-parameterized approximation; sanity checks are not validation against PROSAIL.");
  warnings.push("Output is simulated canopy surface reflectance; atmosphere and top-of-atmosphere effects are not simulated.");
  warnings.push("Output is model-derived reflectance, not observed satellite data and not HYDRA-EO measured data.");
  return {
    wavelengthsNm,
    canopyReflectance,
    derivedBiophysicalParameters: mapping.derivedBiophysicalParameters,
    mappingMetadata: mapping.mappingMetadata,
    modelMetadata: MODEL_METADATA,
    warnings
  };
}

function canopyReflectanceAt(wavelengthNm, params) {
  const leafReflectance = leafDirectionalReflectance(wavelengthNm, params);
  const leafTransmittance = leafDirectionalTransmittance(wavelengthNm, params);
  const wood = woodReflectance(wavelengthNm, params);
  const soil = soilReflectance(wavelengthNm, params.pSoil);
  const cosSun = Math.max(0.08, Math.cos(params.tts * Math.PI / 180));
  const cosView = Math.max(0.12, Math.cos(params.tto * Math.PI / 180));
  const projection = leafProjectionFunction(params.ALA);
  const extinction = clamp(projection / cosSun + 0.35 * projection / cosView, 0.15, 4.2);
  const crownGapFraction = Math.exp(-extinction * params.LAI * params.clumpingFactor);
  const sceneGapFraction = (1 - params.canopyCover) + params.canopyCover * crownGapFraction;
  const canopyFraction = 1 - sceneGapFraction;
  const hotspotFactor = 1 + params.hspot * Math.cos(params.psi * Math.PI / 180) * canopyFraction;

  // Geometry term: lower sun and oblique view increase visible shadowed
  // fractions. This is a directional reflectance approximation, not an
  // atmospheric or radiance simulation.
  const directIllumination = 0.42 + 0.58 * cosSun;
  const viewShadow = clamp(0.92 + 0.08 * cosView - 0.16 * (1 - cosSun), 0.72, 1.02);
  const soilShadow = clamp(0.55 + 0.45 * cosSun, 0.45, 1);

  // Leaf transmittance contributes a small within-canopy diffuse component.
  // Woody material is separated so trunk/branch controls affect the model.
  const multipleScatteringGain = 0.10 * (1 - Math.exp(-0.55 * params.LAI * params.clumpingFactor));
  const foliageComponent = leafReflectance * directIllumination + leafTransmittance * multipleScatteringGain;
  const woodyComponent = wood * (0.70 + 0.30 * directIllumination);
  const vegetatedComponent = (1 - params.woodyFraction) * foliageComponent + params.woodyFraction * woodyComponent;
  const exposedBackground = soil * soilShadow;

  return (sceneGapFraction * exposedBackground + canopyFraction * vegetatedComponent * viewShadow) * hotspotFactor;
}

function leafDirectionalReflectance(wavelengthNm, params) {
  const tau = leafOpticalDepth(wavelengthNm, params);
  const structureScattering = 0.04 + 0.075 * (params.nStruct - 1);
  const mesophyllScattering = continuumScattering(wavelengthNm, params.nStruct);
  const singleScatteringAlbedo = structureScattering + mesophyllScattering * Math.exp(-tau);
  return clamp(singleScatteringAlbedo, 0.015, 0.86);
}

function leafDirectionalTransmittance(wavelengthNm, params) {
  const tau = leafOpticalDepth(wavelengthNm, params);
  const mesophyllScattering = continuumScattering(wavelengthNm, params.nStruct);
  const senescenceAbsorption = 1 - 0.35 * params.Cbrown;
  return clamp(0.46 * mesophyllScattering * Math.exp(-1.18 * tau) * senescenceAbsorption, 0.002, 0.42);
}

function leafOpticalDepth(wavelengthNm, params) {
  return (
    absorptionSum(wavelengthNm, LEAF_ABSORPTION_BASIS.chlorophyll) * params.Cab +
    absorptionSum(wavelengthNm, LEAF_ABSORPTION_BASIS.carotenoid) * params.Car +
    absorptionSum(wavelengthNm, LEAF_ABSORPTION_BASIS.anthocyanin) * params.Ant +
    absorptionSum(wavelengthNm, LEAF_ABSORPTION_BASIS.brownPigment) * params.Cbrown +
    absorptionSum(wavelengthNm, LEAF_ABSORPTION_BASIS.water) * params.Cw +
    absorptionSum(wavelengthNm, LEAF_ABSORPTION_BASIS.dryMatter) * params.Cm
  );
}

function absorptionSum(wavelengthNm, terms) {
  return terms.reduce((sum, term) => sum + term.coefficient * gaussian(wavelengthNm, term.centerNm, term.fwhmNm), 0);
}

function continuumScattering(wavelengthNm, nStruct) {
  const visibleToNir = 1 / (1 + Math.exp(-(wavelengthNm - 705) / 22));
  const swirTransition = 1 / (1 + Math.exp(-(wavelengthNm - 1350) / 90));
  const visibleScattering = 0.075;
  const nirScattering = 0.46 + 0.10 * (nStruct - 1);
  const swirScattering = 0.32 + 0.04 * (nStruct - 1);
  return (visibleScattering * (1 - visibleToNir) + nirScattering * visibleToNir) * (1 - swirTransition) + swirScattering * swirTransition;
}

function soilReflectance(wavelengthNm, pSoil) {
  const drySoil = 0.18 + 0.22 * ((wavelengthNm - 400) / 2100);
  const brightSoil = 0.30 + 0.30 * ((wavelengthNm - 400) / 2100);
  const ironOxideAbsorption = 0.035 * gaussian(wavelengthNm, 670, 130);
  return clamp((1 - pSoil) * drySoil + pSoil * brightSoil - ironOxideAbsorption, 0.04, 0.72);
}

function woodReflectance(wavelengthNm, params) {
  const normalized = (wavelengthNm - 400) / 2100;
  const dryBarkContinuum = 0.11 + 0.22 * normalized;
  const waterDarkening = 0.035 * (params.Cw / 0.05) * gaussian(wavelengthNm, 1450, 210);
  const ligninCelluloseAbsorption = 0.030 * gaussian(wavelengthNm, 2100, 240);
  const senescenceBrightening = 0.035 * params.Cbrown;
  return clamp(dryBarkContinuum + senescenceBrightening - waterDarkening - ligninCelluloseAbsorption, 0.045, 0.48);
}

function leafProjectionFunction(averageLeafAngleDeg) {
  const radians = averageLeafAngleDeg * Math.PI / 180;
  return clamp(0.35 + 0.45 * Math.sin(radians), 0.25, 0.95);
}
