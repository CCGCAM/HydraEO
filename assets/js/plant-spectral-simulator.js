import { listSensors, resampleSpectrum } from "./plant-sensors.js";
import { simulateCanopyReflectance } from "./plant-spectral-model.js";
import { computeVegetationIndices } from "./plant-spectral-indices.js";
import { runSanityChecks } from "./plant-spectral-validation.js";
import { deriveBiophysicalParameters } from "./plant-parameter-mapping.js";
import { initPistachioCanopyScene } from "./plant-canopy-eztree-visualization.js";

const DEFAULTS = {
  leafAreaIndex: 2.4,
  cab: 52,
  cw: 0.020,
  cm: 0.009,
  senescence: 14,
  leafAngle: 42,
  soilBrightness: 36,
  solarZenith: 32,
  solarAzimuth: 35,
  sensor: "sentinel2"
};

const app = document.querySelector("[data-ps-app]");
const form = app.querySelector("[data-ps-form]");
const sensorSelect = app.querySelector("[data-ps-sensor]");
const chart = app.querySelector("[data-ps-chart]");
const tooltip = app.querySelector("[data-ps-tooltip]");
const canvas = app.querySelector("[data-ps-canvas]");
const treeStatus = app.querySelector("[data-ps-tree-status]");
const derivedNode = app.querySelector("[data-ps-derived]");
const indicesNode = app.querySelector("[data-ps-indices]");
const notesNode = app.querySelector("[data-ps-notes]");
const statusNode = app.querySelector("[data-ps-status]");
const validationNode = app.querySelector("[data-ps-validation]");
const sensorBadge = app.querySelector("[data-ps-sensor-badge]");
const resetButton = app.querySelector("[data-ps-reset]");
const downloadButton = app.querySelector("[data-ps-download]");
const copyButton = app.querySelector("[data-ps-copy]");
const validateMode = new URLSearchParams(window.location.search).get("validate") === "1";

let worker;
let workerAvailable = false;
let requestId = 0;
let lastResult = null;
let debounceTimer;
let plantRenderer = null;
let pendingVisualParameters = { ...DEFAULTS };
let hasDispatchedInitialSimulation = false;

init();

function init() {
  populateSensors();
  setFormValues(DEFAULTS);
  initInfoTooltips();
  try {
    worker = new Worker(new URL("./plant-spectral-worker.js", import.meta.url), { type: "module" });
    workerAvailable = true;
    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("error", () => {
      workerAvailable = false;
      dispatchSimulation(readParameters());
    });
  } catch (error) {
    workerAvailable = false;
  }
  createPlantRenderer(canvas, treeStatus).then((renderer) => {
    plantRenderer = renderer;
    plantRenderer.update(deriveBiophysicalParameters(pendingVisualParameters).derivedBiophysicalParameters);
  });
  form.addEventListener("input", scheduleSimulation);
  form.addEventListener("change", scheduleSimulation);
  resetButton.addEventListener("click", resetParameters);
  downloadButton.addEventListener("click", downloadCsv);
  copyButton.addEventListener("click", copyParameterJson);
  chart.addEventListener("pointermove", showChartTooltip);
  chart.addEventListener("pointerleave", () => { tooltip.hidden = true; });
  scheduleSimulation();
}

function initInfoTooltips() {
  const infoTooltip = document.createElement("div");
  infoTooltip.className = "ps-info-tooltip";
  infoTooltip.setAttribute("role", "tooltip");
  infoTooltip.hidden = true;
  document.body.append(infoTooltip);
  const hide = () => {
    infoTooltip.classList.remove("is-visible");
    infoTooltip.hidden = true;
  };
  const show = (target) => {
    const message = target.dataset.info;
    if (!message) return;
    infoTooltip.textContent = message;
    infoTooltip.hidden = false;
    const iconBox = target.getBoundingClientRect();
    const tooltipBox = infoTooltip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - tooltipBox.width - 14, Math.max(14, iconBox.left + iconBox.width / 2 - tooltipBox.width / 2));
    const top = iconBox.top > tooltipBox.height + 18 ? iconBox.top - tooltipBox.height - 10 : iconBox.bottom + 10;
    infoTooltip.style.left = `${left}px`;
    infoTooltip.style.top = `${Math.max(10, top)}px`;
    infoTooltip.classList.add("is-visible");
  };
  app.querySelectorAll(".ps-info").forEach((info) => {
    info.addEventListener("pointerenter", () => show(info));
    info.addEventListener("pointerleave", hide);
    info.addEventListener("focus", () => show(info));
    info.addEventListener("blur", hide);
  });
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
}

function populateSensors() {
  listSensors().forEach((sensor) => {
    const option = document.createElement("option");
    option.value = sensor.id;
    option.textContent = sensor.displayName;
    sensorSelect.append(option);
  });
}

function setFormValues(values) {
  Object.entries(values).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (field) field.value = value;
  });
  syncOutputs();
}

function readParameters() {
  const data = new FormData(form);
  const params = {};
  for (const [key, value] of data.entries()) params[key] = key === "sensor" ? value : Number(value);
  return params;
}

function syncOutputs() {
  form.querySelectorAll("[data-output]").forEach((output) => {
    const field = form.elements.namedItem(output.dataset.output);
    output.textContent = field?.value ?? "";
  });
}

function scheduleSimulation() {
  syncOutputs();
  const params = readParameters();
  pendingVisualParameters = params;
  const mapping = deriveBiophysicalParameters(params);
  plantRenderer?.update(mapping.derivedBiophysicalParameters);
  clearTimeout(debounceTimer);
  if (!hasDispatchedInitialSimulation) {
    hasDispatchedInitialSimulation = true;
    dispatchSimulation(params);
    return;
  }
  debounceTimer = setTimeout(() => {
    dispatchSimulation(params);
  }, 70);
}

function dispatchSimulation(params) {
  const id = ++requestId;
  if (!workerAvailable || !worker) {
    runMainThreadSimulation(id, params);
    return;
  }
  try {
    worker.postMessage({ type: "simulate", requestId: id, parameters: params, sensor: params.sensor, validate: validateMode });
  } catch (error) {
    workerAvailable = false;
    runMainThreadSimulation(id, params);
  }
}

function handleWorkerMessage(event) {
  if (event.data.requestId !== requestId) return;
  if (event.data.type === "error") {
    workerAvailable = false;
    runMainThreadSimulation(event.data.requestId, readParameters(), event.data.message);
    return;
  }
  lastResult = event.data;
  renderResult(event.data);
}

function runMainThreadSimulation(id, params, workerMessage = "") {
  try {
    const simulation = simulateCanopyReflectance(params);
    const selectedSensorBands = resampleSpectrum(
      simulation.wavelengthsNm,
      simulation.canopyReflectance,
      params.sensor
    );
    const vegetationIndices = computeVegetationIndices(
      simulation.wavelengthsNm,
      simulation.canopyReflectance,
      selectedSensorBands
    );
    const indexWarnings = Object.entries(vegetationIndices)
      .filter(([, index]) => !index.available)
      .map(([name]) => `${name} is not available for this sampling.`);
    const sensorWarnings = selectedSensorBands.sensor.srfStatus.includes("approximate")
      ? [`${selectedSensorBands.sensor.displayName} uses ${selectedSensorBands.sensor.srfStatus} SRFs.`]
      : [];
    const fallbackWarnings = workerMessage
      ? [`Worker simulation fallback used: ${workerMessage}`]
      : ["Worker simulation fallback used; calculation remains browser-only."];
    const result = {
      type: "result",
      requestId: id,
      wavelengthsNm: simulation.wavelengthsNm,
      canopyReflectance: simulation.canopyReflectance,
      selectedSensorBands,
      vegetationIndices,
      derivedBiophysicalParameters: simulation.derivedBiophysicalParameters,
      modelMetadata: simulation.modelMetadata,
      mappingMetadata: simulation.mappingMetadata,
      sensorMetadata: selectedSensorBands.sensor,
      warnings: [...simulation.warnings, ...sensorWarnings, ...indexWarnings, ...fallbackWarnings],
      validationStatus: validateMode ? runSanityChecks() : null
    };
    if (id === requestId) {
      lastResult = result;
      renderResult(result);
    }
  } catch (error) {
    notesNode.replaceChildren(noteItem(error instanceof Error ? error.message : "Unknown simulator error"));
  }
}

function renderResult(result) {
  sensorBadge.textContent = result.sensorMetadata.badge;
  renderStatus(result);
  renderDerived(result.derivedBiophysicalParameters, result.mappingMetadata);
  renderIndices(result.vegetationIndices);
  renderNotes(result.warnings);
  renderValidation(result.validationStatus);
  renderChart(result);
}

function renderStatus(result) {
  const rows = [
    ["Model", result.modelMetadata.name],
    ["Output", "simulated canopy surface reflectance"],
    ["Sensor sampling", `${result.sensorMetadata.displayName} · ${result.sensorMetadata.srfStatus}`],
    ["Atmosphere", "not simulated"],
    ["Observation", "not satellite-measured"],
    ["Spatial scale", "canopy or pixel-mixture approximation"],
    ["Canopy preset", result.derivedBiophysicalParameters.simulationTypeLabel],
    ["3D plant", "EZ-Tree pistachio-style visual explanation"]
  ];
  statusNode.replaceChildren(...definitionRows(rows));
}

function renderDerived(d, mappingMetadata) {
  const rows = [
    ["LAI", `${formatNumber(d.LAI, 2)} m2/m2`],
    ["Cab", `${formatNumber(d.Cab, 1)} ${mappingMetadata.units.Cab}`],
    ["Car", `${formatNumber(d.Car, 1)} ${mappingMetadata.units.Car}`],
    ["Cbrown", formatNumber(d.Cbrown, 2)],
    ["Cw", `${formatNumber(d.Cw, 4)} ${mappingMetadata.units.Cw}`],
    ["Cm", `${formatNumber(d.Cm, 4)} ${mappingMetadata.units.Cm}`],
    ["ALA", `${formatNumber(d.ALA, 0)} deg`],
    ["pSoil", formatNumber(d.pSoil, 2)],
    ["Cover / clumping", `${formatNumber(d.canopyCover, 2)} / ${formatNumber(d.clumpingFactor, 2)}`],
    ["Geometry", `tts ${formatNumber(d.tts, 0)} deg · tto ${formatNumber(d.tto, 0)} deg · psi ${formatNumber(d.psi, 0)} deg`]
  ];
  derivedNode.replaceChildren(...definitionRows(rows));
}

function definitionRows(rows) {
  return rows.flatMap(([term, value]) => {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = value;
    return [dt, dd];
  });
}

function renderIndices(indices) {
  indicesNode.replaceChildren(...Object.entries(indices).map(([label, item]) => {
    const card = document.createElement("div");
    card.className = "ps-index-card";
    const title = document.createElement("span");
    const value = document.createElement("strong");
    const detail = document.createElement("small");
    title.textContent = label;
    value.textContent = item.available ? (item.unit === "nm" ? `${Math.round(item.value)} nm` : formatNumber(item.value, 3)) : "N/A";
    detail.textContent = item.available ? `${item.formula}; ${item.inputs}` : item.reason;
    card.append(title, value, detail);
    return card;
  }));
}

function renderNotes(warnings) {
  notesNode.replaceChildren(...warnings.map(noteItem));
}

function renderValidation(validationStatus) {
  if (!validationNode) return;
  if (!validateMode) {
    validationNode.hidden = true;
    return;
  }
  validationNode.hidden = false;
  const rows = [
    ["Model version", validationStatus?.modelVersion ?? "not available"],
    ["Fixture version", validationStatus?.fixtureVersion ?? "not available"],
    ["Validation type", validationStatus?.validationType ?? "sanity checks only"],
    ["Passed checks", String(validationStatus?.passedCount ?? 0)],
    ["Failed checks", String(validationStatus?.failedCount ?? 0)],
    ["Max abs error", validationStatus?.maxAbsoluteError ?? "not applicable"],
    ["RMSE", validationStatus?.rmse ?? "not applicable"]
  ];
  validationNode.querySelector("dl").replaceChildren(...definitionRows(rows));
  const failed = validationStatus?.failedCases ?? [];
  validationNode.querySelector("ul").replaceChildren(...(failed.length ? failed.map((item) => noteItem(`${item.caseId}: ${item.check} (${item.detail})`)) : [noteItem("No failed sanity checks.")]));
}

function noteItem(text) {
  const item = document.createElement("li");
  item.textContent = text;
  return item;
}

function renderChart(result) {
  const width = 1000, height = 360;
  const margin = { top: 18, right: 24, bottom: 44, left: 54 };
  chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
  chart.replaceChildren();
  const x = (wavelength) => margin.left + ((wavelength - 400) / 2100) * (width - margin.left - margin.right);
  const y = (reflectance) => margin.top + (1 - reflectance) * (height - margin.top - margin.bottom);
  for (let value = 0; value <= 1.0001; value += 0.25) {
    line(chart, margin.left, y(value), width - margin.right, y(value), "ps-chart-grid");
    text(chart, 12, y(value) + 4, value.toFixed(2), "ps-chart-label");
  }
  [400, 700, 1000, 1300, 1600, 1900, 2200, 2500].forEach((wavelength) => {
    line(chart, x(wavelength), margin.top, x(wavelength), height - margin.bottom, "ps-chart-grid");
    text(chart, x(wavelength) - 18, height - 16, String(wavelength), "ps-chart-label");
  });
  line(chart, margin.left, height - margin.bottom, width - margin.right, height - margin.bottom, "ps-chart-axis");
  line(chart, margin.left, margin.top, margin.left, height - margin.bottom, "ps-chart-axis");
  text(chart, width / 2 - 58, height - 4, "wavelength (nm)", "ps-chart-label");
  text(chart, 8, 18, "reflectance", "ps-chart-label");
  const points = result.wavelengthsNm.map((wavelength, index) => `${x(wavelength).toFixed(2)},${y(result.canopyReflectance[index]).toFixed(2)}`).join(" ");
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", points);
  polyline.setAttribute("class", "ps-spectrum-line");
  chart.append(polyline);
  visibleBands(result.selectedSensorBands.bands).forEach((band) => {
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    marker.setAttribute("cx", x(band.centerNm));
    marker.setAttribute("cy", y(band.reflectance));
    marker.setAttribute("r", result.selectedSensorBands.bands.length > 80 ? 1.7 : 4.4);
    marker.setAttribute("class", result.selectedSensorBands.bands.length > 80 ? "ps-band-marker" : "ps-band-marker sparse");
    chart.append(marker);
  });
}

function visibleBands(bands) {
  if (bands.length <= 140) return bands;
  const stride = Math.ceil(bands.length / 140);
  return bands.filter((_, index) => index % stride === 0);
}

function line(svg, x1, y1, x2, y2, className) {
  const item = document.createElementNS("http://www.w3.org/2000/svg", "line");
  item.setAttribute("x1", x1);
  item.setAttribute("y1", y1);
  item.setAttribute("x2", x2);
  item.setAttribute("y2", y2);
  item.setAttribute("class", className);
  svg.append(item);
}

function text(svg, x, y, value, className) {
  const item = document.createElementNS("http://www.w3.org/2000/svg", "text");
  item.setAttribute("x", x);
  item.setAttribute("y", y);
  item.setAttribute("class", className);
  item.textContent = value;
  svg.append(item);
}

function showChartTooltip(event) {
  if (!lastResult) return;
  const box = chart.getBoundingClientRect();
  const ratio = (event.clientX - box.left) / box.width;
  const wavelength = Math.round(400 + Math.max(0, Math.min(1, ratio)) * 2100);
  const index = nearestIndex(lastResult.wavelengthsNm, wavelength);
  tooltip.textContent = `${lastResult.wavelengthsNm[index]} nm · canopy R ${formatNumber(lastResult.canopyReflectance[index], 3)}`;
  tooltip.style.left = `${event.clientX - box.left + 16}px`;
  tooltip.style.top = `${event.clientY - box.top + 12}px`;
  tooltip.hidden = false;
}

function nearestIndex(values, target) {
  let best = 0;
  let distance = Infinity;
  values.forEach((value, index) => {
    const d = Math.abs(value - target);
    if (d < distance) {
      distance = d;
      best = index;
    }
  });
  return best;
}

function resetParameters() {
  setFormValues(DEFAULTS);
  scheduleSimulation();
}

function downloadCsv() {
  if (!lastResult) return;
  const metadata = [
    "# HYDRA-EO Plant Spectral Simulator",
    "# output_type: simulated canopy surface reflectance",
    `# model: ${lastResult.modelMetadata.name}`,
    `# model_version: ${lastResult.modelMetadata.version}`,
    `# timestamp: ${new Date().toISOString()}`,
    `# ui_parameters: ${JSON.stringify(readParameters())}`,
    `# derived_biophysical_parameters: ${JSON.stringify(lastResult.derivedBiophysicalParameters)}`,
    `# sensor_selection: ${lastResult.sensorMetadata.displayName}`,
    `# srf_status: ${lastResult.sensorMetadata.srfStatus}`,
    "# atmosphere_not_simulated: true",
    "# not_observed_satellite_data: true",
    "wavelength_nm,canopy_reflectance"
  ];
  const rows = lastResult.wavelengthsNm.map((wavelength, index) => `${wavelength},${lastResult.canopyReflectance[index].toFixed(6)}`);
  const bandRows = [
    "",
    "# sensor_resampled_reflectance",
    "band_name,center_nm,fwhm_nm,reflectance,srf_status",
    ...lastResult.selectedSensorBands.bands.map((band) => [
      csvCell(band.name),
      band.centerNm,
      band.fwhmNm ?? "",
      Number.isFinite(band.reflectance) ? band.reflectance.toFixed(6) : "",
      csvCell(lastResult.sensorMetadata.srfStatus)
    ].join(","))
  ];
  const blob = new Blob([`${metadata.concat(rows, bandRows).join("\n")}\n`], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "hydra-eo-simulated-canopy-surface-reflectance.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n;]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function copyParameterJson() {
  if (!lastResult) return;
  const payload = {
    uiParameters: readParameters(),
    derivedBiophysicalParameters: lastResult.derivedBiophysicalParameters,
    modelMetadata: lastResult.modelMetadata,
    sensorMetadata: lastResult.sensorMetadata,
    vegetationIndices: lastResult.vegetationIndices,
    warnings: lastResult.warnings
  };
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  copyButton.textContent = "Copied JSON";
  setTimeout(() => { copyButton.textContent = "Copy parameter JSON"; }, 1200);
}

async function createPlantRenderer(targetCanvas, statusNode) {
  return initPistachioCanopyScene(targetCanvas, { statusNode });
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "N/A";
}
