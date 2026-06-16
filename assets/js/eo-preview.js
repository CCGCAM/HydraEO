"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const preview = document.querySelector("[data-eo-preview]");
  if (!preview) return;

  const setText = (selector, value) => {
    const node = preview.querySelector(selector);
    if (node) node.textContent = value;
  };

  try {
    const response = await fetch("visualization-data/catalog.json", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Catalog request failed");
    const catalog = await response.json();
    const datasets = Array.isArray(catalog.datasets) ? catalog.datasets : [];
    const detected = Array.isArray(catalog.detected_assets) ? catalog.detected_assets : [];
    const external = detected.filter((item) => item && item.storage === "external_required").length;
    const level = Number.isInteger(catalog.readiness_level) ? catalog.readiness_level : 0;
    const status = typeof catalog.status === "string" ? catalog.status : "metadata_required";
    const publicationReady = datasets.filter((dataset) => dataset && dataset.publication_ready === true).length;

    setText("[data-preview-catalog]", `${datasets.length} registered · ${detected.length} detected`);
    setText("[data-preview-readiness]", `Level ${level} · ${status.replaceAll("_", " ")}`);
    setText("[data-preview-publication]", publicationReady ? `${publicationReady} publication-ready` : "Not established");
    setText("[data-preview-state]", `READINESS LEVEL ${level}`);
    setText("[data-preview-import]", external ? `${external} asset${external === 1 ? "" : "s"} require external hosting` : "Generated catalog loaded");

    if (external) {
      setText("[data-preview-title]", "Large EO assets detected.");
      setText("[data-preview-message]", "External COG/STAC hosting is required for browser visualization. Local source paths remain private.");
    } else if (detected.length && level < 4) {
      setText("[data-preview-title]", "Data detected, but scientific metadata are incomplete.");
      setText("[data-preview-message]", "The catalog records the files, but browser visualization and scientific computation remain gated.");
    } else if (datasets.length) {
      const first = datasets[0];
      setText("[data-preview-title]", "Catalog evidence is available for inspection.");
      setText("[data-preview-message]", "Open the full Explorer to review data class, readiness, provenance, limitations and permitted interactions.");
      setText("[data-preview-dataset]", typeof first.title === "string" ? first.title : "registered dataset");
    }
  } catch {
    setText("[data-preview-catalog]", "Catalog unavailable");
    setText("[data-preview-readiness]", "Error state");
    setText("[data-preview-state]", "READINESS UNKNOWN");
    setText("[data-preview-title]", "The generated catalog could not be loaded.");
    setText("[data-preview-message]", "Run the importer and validation script before publishing this site.");
    setText("[data-preview-import]", "Validation required");
  }
});
