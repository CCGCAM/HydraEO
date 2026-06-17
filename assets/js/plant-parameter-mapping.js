export const PARAMETER_MAPPING_VERSION = "2026-06-16-rtm-lite-pistachio-mapping-v3";

export const SIMULATION_TYPE_PRESETS = {
  "pistachio tree": {
    label: "Pistachio tree",
    laiMultiplier: 0.88,
    cabMultiplier: 1.04,
    cwMultiplier: 1.04,
    cmMultiplier: 0.95,
    nStructOffset: 0.02,
    alaOffsetDeg: -3,
    baseCrownClosure: 0.66,
    clumpingFactor: 0.68,
    pSoilOffset: 0.02,
    hspotMultiplier: 1.05,
    woodBaseFraction: 0.11,
    note: "Pistachio tree preset: broadleaf orchard-tree RTM-lite approximation with wider grouped leaflets, more open irregular branching and lower crown closure."
  }
};

const UI_LIMITS = {
  leafAreaIndex: [0.2, 6.5],
  cab: [5, 80],
  cw: [0.003, 0.05],
  cm: [0.002, 0.02],
  senescence: [0, 100],
  leafAngle: [10, 80],
  soilBrightness: [0, 100],
  solarZenith: [0, 75],
  solarAzimuth: [0, 360]
};

const BIOPHYSICAL_LIMITS = {
  nStruct: [1.0, 2.5],
  Cab: [5, 80],
  Car: [1, 25],
  Ant: [0, 8],
  Cbrown: [0, 1],
  Cw: [0.003, 0.05],
  Cm: [0.002, 0.02],
  LAI: [0.1, 8],
  ALA: [5, 85],
  pSoil: [0, 1],
  hspot: [0.01, 0.25],
  canopyCover: [0.02, 1],
  crownCoverFraction: [0.02, 1],
  fractionalCover: [0.02, 1],
  clumpingFactor: [0.3, 1.2],
  woodyFraction: [0.02, 0.35],
  tts: [0, 70],
  tto: [0, 70],
  psi: [0, 180],
  saa: [0, 360],
  vaa: [0, 360]
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Map senescence to pigment terms. Cbrown is a dimensionless brown pigment
 * factor; carotenoids are retained at low chlorophyll but bounded.
 */
export function mapSenescenceToPigments(senescence, cabPercent) {
  const senescence01 = senescence / 100;
  return {
    Car: 2 + 18 * (cabPercent / 100) * (1 - 0.35 * senescence01) + 5 * senescence01,
    Ant: 1.5 * senescence01,
    Cbrown: senescence01
  };
}

/**
 * Map average leaf angle to a simple ellipsoidal leaf angle descriptor.
 * This RTM-lite implementation uses ALA directly rather than LIDFa/LIDFb.
 */
export function mapLeafAngleToLIDF(leafAngle) {
  return { ALA: leafAngle, LIDFa: null, LIDFb: null };
}

function normalizeUiParameters(input = {}) {
  const params = {};
  const warnings = [];
  for (const [key, [min, max]] of Object.entries(UI_LIMITS)) {
    const raw = Number(input[key] ?? legacyParameterValue(input, key));
    const value = Number.isFinite(raw) ? raw : defaultUiValue(key);
    const clamped = clamp(value, min, max);
    params[key] = clamped;
    if (clamped !== value) warnings.push(`${key} was clamped to the UI guardrail range ${min}-${max}.`);
  }
  params.simulationType = "pistachio tree";
  return { params, warnings };
}

function defaultUiValue(key) {
  return {
    leafAreaIndex: 2.4,
    cab: 52,
    cw: 0.020,
    cm: 0.009,
    senescence: 14,
    leafAngle: 42,
    soilBrightness: 36,
    solarZenith: 32,
    solarAzimuth: 35
  }[key] ?? 0;
}

function legacyParameterValue(input, key) {
  if (key === "leafAreaIndex") return input.leafAreaIndex ?? input.LAI;
  if (key === "cab") return input.cab ?? input.Cab;
  if (key === "cw") return input.cw ?? input.Cw;
  if (key === "cm") return input.cm ?? input.Cm;
  if (key === "solarZenith") return input.sunZenith;
  if (key === "solarAzimuth") return input.relativeAzimuth;
  return undefined;
}

/**
 * Clamp biophysical parameters to interface guardrail ranges and report
 * clamping. These are practical interactive ranges, not universal truths.
 */
export function clampBiophysicalParameters(params) {
  const result = { ...params };
  const warnings = [];
  for (const [key, [min, max]] of Object.entries(BIOPHYSICAL_LIMITS)) {
    if (!Number.isFinite(result[key])) continue;
    const value = result[key];
    result[key] = clamp(value, min, max);
    if (result[key] !== value) warnings.push(`${key} was clamped to ${min}-${max}.`);
  }
  return { params: result, warnings };
}

/**
 * Derive explicit RTM-lite / PROSAIL-parameterized biophysical inputs from
 * intuitive UI controls. Only this derived state may feed the spectral model.
 */
export function deriveBiophysicalParameters(uiInput = {}) {
  const { params: uiParameters, warnings } = normalizeUiParameters(uiInput);
  const preset = SIMULATION_TYPE_PRESETS["pistachio tree"];
  const rawLAI = uiParameters.leafAreaIndex;
  const crownLAI = rawLAI;
  const crownProjectedAreaM2 = 18.1;
  const orchardCellAreaM2 = 30;
  const crownCoverFraction = canopyCoverFromLAI(rawLAI, preset.baseCrownClosure, preset.clumpingFactor);
  const fractionalCover = clamp(crownCoverFraction * 0.88, 0.05, 0.86);
  const waterStatus = clamp((uiParameters.cw - UI_LIMITS.cw[0]) / (UI_LIMITS.cw[1] - UI_LIMITS.cw[0]) * 100, 0, 100);
  const pigments = mapSenescenceToPigments(uiParameters.senescence, clamp((uiParameters.cab - 5) / 75 * 100, 0, 100));
  const lidf = mapLeafAngleToLIDF(uiParameters.leafAngle);
  const relativeAzimuthDeg = relativeAzimuth(uiParameters.solarAzimuth, 0);
  const senescence01 = uiParameters.senescence / 100;
  const woodyFraction = preset.woodBaseFraction + 0.045 * (1 - Math.exp(-rawLAI / 2.5)) + 0.055 * senescence01;
  const biophysicalBeforeClamp = {
    nStruct: 1.15 + 0.75 * (1 - uiParameters.senescence / 100) + preset.nStructOffset,
    Cab: uiParameters.cab * (1 - 0.35 * senescence01) * preset.cabMultiplier,
    Car: pigments.Car * Math.sqrt(preset.cabMultiplier),
    Ant: pigments.Ant,
    Cbrown: pigments.Cbrown,
    Cw: uiParameters.cw * (1 - 0.12 * senescence01) * preset.cwMultiplier,
    Cm: uiParameters.cm * (1 + 0.35 * senescence01) * preset.cmMultiplier,
    LAI: rawLAI * preset.laiMultiplier,
    ALA: lidf.ALA + preset.alaOffsetDeg,
    LIDFa: lidf.LIDFa,
    LIDFb: lidf.LIDFb,
    pSoil: uiParameters.soilBrightness / 100 + preset.pSoilOffset,
    hspot: (0.01 + 0.16 * Math.exp(-Math.max(rawLAI, 0.01) / 2.2)) * preset.hspotMultiplier,
    canopyCover: fractionalCover,
    crownCoverFraction,
    fractionalCover,
    clumpingFactor: preset.clumpingFactor,
    woodyFraction,
    tts: uiParameters.solarZenith,
    tto: 8,
    saa: uiParameters.solarAzimuth,
    vaa: 0,
    psi: relativeAzimuthDeg
  };
  const { params: derivedBiophysicalParameters, warnings: clampWarnings } = clampBiophysicalParameters(biophysicalBeforeClamp);
  const rangeWarnings = buildRangeWarnings(derivedBiophysicalParameters, rawLAI);
  return {
    uiParameters,
    derivedBiophysicalParameters: {
      ...derivedBiophysicalParameters,
      rawLAI,
      crownLAI,
      waterStatus,
      crownProjectedAreaM2,
      orchardCellAreaM2,
      laiGroundAreaM2: 1,
      simulationType: "pistachio tree",
      simulationTypeLabel: preset.label
    },
    mappingMetadata: {
      version: PARAMETER_MAPPING_VERSION,
      units: {
        Cab: "ug/cm2",
        Car: "ug/cm2",
        Ant: "ug/cm2",
        Cbrown: "dimensionless",
        Cw: "cm",
        Cm: "g/cm2",
        LAI: "m2/m2",
        ALA: "degrees",
        tts: "degrees",
        tto: "degrees",
        saa: "degrees",
        vaa: "degrees",
        psi: "degrees",
        crownProjectedAreaM2: "m2",
        orchardCellAreaM2: "m2",
        fractionalCover: "unitless"
      }
    },
    warnings: [...warnings, preset.note, ...clampWarnings, ...rangeWarnings]
  };
}

function canopyCoverFromLAI(crownLAI, baseCrownClosure, clumpingFactor) {
  const beamExtinctionProxy = 0.62;
  return clamp(baseCrownClosure * (1 - Math.exp(-beamExtinctionProxy * crownLAI * clumpingFactor)), 0.03, 0.99);
}

function relativeAzimuth(solarAzimuth, viewAzimuth) {
  return Math.abs(((solarAzimuth - viewAzimuth + 540) % 360) - 180);
}

function buildRangeWarnings(params, rawLAI) {
  const warnings = [];
  if (rawLAI < 0.3) warnings.push("LAI is very low; simulated canopy surface reflectance will be strongly soil-influenced.");
  if (rawLAI > 8) warnings.push("Raw LAI exceeds the interactive guardrail; LAI is clamped to 8 m2/m2.");
  if (params.Cab < 8 || params.Cab > 75) warnings.push("Cab is near the edge of the practical interface guardrail range.");
  if (params.Cw < 0.006 || params.Cw > 0.045) warnings.push("Cw is near the edge of the practical interface guardrail range.");
  if (params.tts > 65 || params.tto > 60) warnings.push("Illumination or viewing geometry is extreme for this RTM-lite approximation.");
  return warnings;
}
