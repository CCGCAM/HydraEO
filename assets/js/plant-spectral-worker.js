import { simulateCanopyReflectance } from "./plant-spectral-model.js";
import { resampleSpectrum } from "./plant-sensors.js";
import { computeVegetationIndices } from "./plant-spectral-indices.js";
import { runSanityChecks } from "./plant-spectral-validation.js";

self.addEventListener("message", (event) => {
  if (event.data?.type !== "simulate") return;
  try {
    const simulation = simulateCanopyReflectance(event.data.parameters);
    const selectedSensorBands = resampleSpectrum(
      simulation.wavelengthsNm,
      simulation.canopyReflectance,
      event.data.sensor
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
    self.postMessage({
      type: "result",
      requestId: event.data.requestId,
      wavelengthsNm: simulation.wavelengthsNm,
      canopyReflectance: simulation.canopyReflectance,
      selectedSensorBands,
      vegetationIndices,
      derivedBiophysicalParameters: simulation.derivedBiophysicalParameters,
      modelMetadata: simulation.modelMetadata,
      mappingMetadata: simulation.mappingMetadata,
      sensorMetadata: selectedSensorBands.sensor,
      warnings: [...simulation.warnings, ...sensorWarnings, ...indexWarnings],
      validationStatus: event.data.validate ? runSanityChecks() : null
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId: event.data.requestId,
      message: error instanceof Error ? error.message : "Unknown simulator error"
    });
  }
});
