import { CatalogError, datasetCapabilities, loadCatalog } from "./eo-catalog.js";
import { EOMapRenderer, renderSpectralChart } from "./eo-renderers.js";
import { availableClientIndices } from "./eo-spectral-math.js";
import { createExplorerUI } from "./eo-ui.js";

const EMPTY_MESSAGE = "No public HYDRA-EO visualization datasets are configured yet.";
const EMPTY_DETAIL = "Add real assets to visualization-data/ and register them in catalog.json.";

function downloadBlob(blob, filename) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

async function fetchRows(asset, signal) {
  const response = await fetch(asset.href, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Spectrum request failed (${response.status}).`);
  if (/json/i.test(asset.media_type || asset.href)) {
    const value = await response.json();
    return Array.isArray(value) ? value : (value.rows || value.features || []);
  }
  const source = await response.text();
  const delimiter = asset.delimiter || ",";
  const records = [];
  let record = [], field = "", quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      record.push(field); field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      record.push(field); field = "";
      if (record.some((value) => value !== "")) records.push(record);
      record = [];
    } else field += character;
  }
  if (field || record.length) { record.push(field); records.push(record); }
  const headers = records.shift()?.map((value) => value.trim()) || [];
  return records.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function metadataJson(dataset) {
  return JSON.stringify(dataset, null, 2);
}

async function initExplorer(root) {
  const ui = createExplorerUI(root);
  let validated;
  let activeDataset;
  let swipeEnabled = false;
  let playbackTimer = null;
  let renderer = new EOMapRenderer(ui.nodes.map, {
    onLoading: (active, label) => ui.setLoading(active, label),
    onInspect: (details) => ui.renderInspector(details),
    onError: (error) => ui.setMapMessage(error.message, "error"),
    onVectorFields: (asset, fields) => ui.renderVectorFilters(asset, fields, (assetId, property, value) =>
      renderer.setVectorFilter(assetId, property, value)
    )
  });
  let spectrumController;

  ui.setLoading(true, "Reading visualization catalog");
  try {
    validated = await loadCatalog();
  } catch (error) {
    const detail = error instanceof CatalogError ? error.message : "The visualization catalog could not be read.";
    ui.showNoData("Visualization catalog unavailable", detail, "error");
    ui.setLoading(false);
    return;
  }
  ui.setLoading(false);

  if (!validated.publicDatasets.length) {
    ui.showNoData(EMPTY_MESSAGE, EMPTY_DETAIL);
    return;
  }

  ui.setDatasets(validated.publicDatasets);
  ui.showCockpit();

  async function selectDataset(id) {
    const dataset = validated.publicDatasets.find((item) => item.id === id);
    if (!dataset) return;
    activeDataset = dataset;
    const classStatus = {
      synthetic: ["Synthetic method dataset", "neutral"],
      unverified: ["Unverified source dataset", "error"],
      example: ["Example source dataset", "neutral"],
      methodological: ["Methodological dataset", "ready"],
      observational: ["Public dataset active", "ready"]
    }[dataset.data_class] || ["Public dataset active", "ready"];
    ui.setStatus(...classStatus);
    swipeEnabled = false;
    renderer.enableSwipe(false);
    ui.nodes.root.querySelector("[data-eo-swipe-control]").hidden = true;
    ui.nodes.datasetSelect.value = dataset.id;
    ui.setMapMessage();
    const capabilities = datasetCapabilities(dataset, validated.publicDatasets);
    ui.setCapabilities(capabilities);
    ui.renderBands(dataset);
    ui.renderLayers(dataset, (assetId, visible) => renderer.setVisible(assetId, visible), (assetId, opacity) => renderer.setOpacity(assetId, opacity));
    ui.renderMetadata(dataset);
    ui.renderWarnings(validated.warnings.filter((item) => item.datasetId === dataset.id));
    ui.renderLegend(dataset.assets.find((asset) => asset.type === "raster"));
    ui.renderTimeline(dataset, capabilities.comparable, selectDataset);
    ui.nodes.spectral.replaceChildren();
    ui.clearTable();
    root.querySelector("[data-eo-copy-citation]").disabled = !dataset.citation;
    root.querySelector("[data-eo-export-legend]").disabled = !dataset.assets.some((asset) => asset.type === "raster");

    const clientIndices = availableClientIndices(dataset);
    const indexNote = root.querySelector("[data-eo-index-note]");
    indexNote.textContent = clientIndices.length
      ? `Client computation authorized for: ${clientIndices.map((index) => `${index.id} · ${index.formula}`).join("; ")}.`
      : "Browser-side index computation is disabled. Precomputed, catalog-registered products are preferred.";

    const renderable = dataset.assets.filter((asset) => asset.type === "raster" || asset.type === "vector");
    if (renderable.length) {
      try { await renderer.load(dataset, renderable); } catch { /* user-visible callback handles this */ }
    } else {
      renderer.dispose();
      const hasTable = dataset.assets.some((asset) => asset.type === "table");
      const unresolved = dataset.assets.some((asset) => asset.role === "unresolved_source_geometry");
      ui.setMapMessage(unresolved
        ? "Spatial rendering is blocked because the source coordinates conflict with their declared CRS. Original files remain preserved in provenance."
        : hasTable
          ? "This dataset contains source tables rather than map layers. Use the table preview below."
          : "This dataset has metadata but no renderable COG or GeoJSON map asset.");
    }

    const spectraAsset = dataset.assets.find((asset) => asset.type === "spectra");
    if (spectraAsset) {
      spectrumController?.abort();
      spectrumController = new AbortController();
      try {
        const rows = await fetchRows(spectraAsset, spectrumController.signal);
        if (!renderSpectralChart(ui.nodes.spectral, rows, spectraAsset)) {
          ui.nodes.spectral.textContent = "Spectral values are present, but axis-column metadata is incomplete.";
        }
      } catch (error) {
        if (error.name !== "AbortError") ui.nodes.spectral.textContent = error.message;
      }
    } else {
      ui.nodes.spectral.textContent = "No real spectral values are registered for this dataset.";
    }

    const tableAssets = dataset.assets.filter((asset) => asset.type === "table");
    if (tableAssets.length) {
      const showTable = async (assetId) => {
        const tableAsset = tableAssets.find((asset) => asset.id === assetId);
        if (!tableAsset) return;
        try {
          const rows = await fetchRows(tableAsset, spectrumController?.signal);
          ui.renderTable(tableAsset, rows.slice(0, 50), rows.length);
        } catch (error) {
          if (error.name !== "AbortError") ui.renderTable(tableAsset, [{ error: error.message }], 1);
        }
      };
      ui.setTableAssets(tableAssets, showTable);
      await showTable(tableAssets[0].id);
    }
  }

  ui.nodes.datasetSelect.addEventListener("change", () => selectDataset(ui.nodes.datasetSelect.value));
  const bandSelects = ["red", "green", "blue"].map((channel) => root.querySelector(`[data-eo-band-${channel}]`));
  async function applyBandComposition() {
    if (!activeDataset || bandSelects.some((select) => !select.value)) return;
    const raster = activeDataset.assets.find((asset) => asset.type === "raster");
    if (!raster) return;
    const bandNumbers = bandSelects.map((select) => activeDataset.bands.findIndex((band) => band.name === select.value) + 1);
    if (bandNumbers.some((number) => number < 1)) return;
    ui.setMapMessage();
    const assets = activeDataset.assets.map((asset) => asset.id === raster.id ? { ...asset, bands: bandNumbers } : asset);
    try { await renderer.load(activeDataset, assets); } catch { /* renderer reports the failure */ }
  }
  bandSelects.forEach((select) => select.addEventListener("change", applyBandComposition));
  root.querySelectorAll("[data-eo-mode]").forEach((button) => button.addEventListener("click", () => {
    if (button.disabled) return;
    root.querySelectorAll("[data-eo-mode]").forEach((item) => item.classList.toggle("active", item === button));
    renderer.setMode(button.dataset.eoMode);
  }));
  root.querySelector("[data-eo-compare]").addEventListener("click", (event) => {
    if (!activeDataset) return;
    swipeEnabled = !swipeEnabled;
    const enabled = renderer.enableSwipe(swipeEnabled, Number(ui.nodes.swipe.value));
    swipeEnabled = enabled;
    const control = root.querySelector("[data-eo-swipe-control]");
    control.hidden = !enabled;
    event.currentTarget.textContent = enabled ? "Close swipe" : "Swipe";
    if (enabled) {
      const rasters = activeDataset.assets.filter((asset) => asset.type === "raster");
      root.querySelector("[data-eo-swipe-left]").textContent = rasters[0].title || rasters[0].role;
      root.querySelector("[data-eo-swipe-right]").textContent = rasters[1].title || rasters[1].role;
    }
  });
  ui.nodes.swipe.addEventListener("input", () => renderer.setSwipePosition(ui.nodes.swipe.value));
  root.querySelector("[data-eo-play]").addEventListener("click", (event) => {
    if (playbackTimer) {
      clearInterval(playbackTimer);
      playbackTimer = null;
      event.currentTarget.textContent = "Play acquisitions";
      return;
    }
    const comparableIds = new Set([activeDataset.id, ...datasetCapabilities(activeDataset, validated.publicDatasets).comparable.map((dataset) => dataset.id)]);
    const sequence = validated.publicDatasets.filter((dataset) => dataset.acquisition_date && comparableIds.has(dataset.id))
      .sort((a, b) => a.acquisition_date.localeCompare(b.acquisition_date));
    if (sequence.length < 2) return;
    event.currentTarget.textContent = "Pause acquisitions";
    playbackTimer = setInterval(() => {
      const index = sequence.findIndex((dataset) => dataset.id === activeDataset?.id);
      selectDataset(sequence[(index + 1) % sequence.length].id);
    }, 2200);
  });
  root.querySelector("[data-eo-export-metadata]").addEventListener("click", () => {
    if (!activeDataset) return;
    downloadBlob(new Blob([metadataJson(activeDataset)], { type: "application/json" }), `${activeDataset.id}-metadata.json`);
  });
  root.querySelector("[data-eo-copy-citation]").addEventListener("click", async (event) => {
    if (!activeDataset?.citation) return;
    await navigator.clipboard.writeText(activeDataset.citation);
    const previous = event.currentTarget.textContent;
    event.currentTarget.textContent = "Citation copied";
    setTimeout(() => event.currentTarget.textContent = previous, 1400);
  });
  root.querySelector("[data-eo-export-view]").addEventListener("click", () => {
    if (!activeDataset) return;
    try {
      const map = renderer.exportCanvas();
      const output = document.createElement("canvas");
      output.width = map.width;
      output.height = map.height + 96;
      const context = output.getContext("2d");
      context.fillStyle = "#07131c"; context.fillRect(0, 0, output.width, output.height);
      context.drawImage(map, 0, 0);
      context.fillStyle = "#eef7f7"; context.font = "600 16px Poppins, sans-serif";
      context.fillText(activeDataset.title, 20, map.height + 28);
      context.fillStyle = "#a8bcc5"; context.font = "12px Poppins, sans-serif";
      context.fillText(`${activeDataset.acquisition_date || "date not provided"} · ${activeDataset.crs || "CRS not provided"} · ${activeDataset.citation || "citation not provided"}`.slice(0, 150), 20, map.height + 56);
      output.toBlob((blob) => blob && downloadBlob(blob, `${activeDataset.id}-view.png`), "image/png");
    } catch (error) {
      ui.setMapMessage(`${error.message} Cross-origin assets must permit canvas export.`, "error");
    }
  });
  root.querySelector("[data-eo-export-legend]").addEventListener("click", () => {
    const asset = activeDataset?.assets.find((item) => item.type === "raster");
    if (!asset) return;
    const palette = asset.display?.palette || ["#172c3a", "#4d9d91", "#f2c94c"];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="120"><rect width="680" height="120" fill="#07131c"/><text x="20" y="28" fill="#eef7f7" font-family="sans-serif" font-size="16">${asset.title || asset.role}</text><defs><linearGradient id="g">${palette.map((color, index) => `<stop offset="${index/(palette.length-1)*100}%" stop-color="${color}"/>`).join("")}</linearGradient></defs><rect x="20" y="44" width="640" height="24" rx="4" fill="url(#g)"/><text x="20" y="94" fill="#a8bcc5" font-family="sans-serif" font-size="12">${asset.display?.min ?? "not provided"}</text><text x="340" y="94" text-anchor="middle" fill="#a8bcc5" font-family="sans-serif" font-size="12">${asset.units || "not provided"}</text><text x="660" y="94" text-anchor="end" fill="#a8bcc5" font-family="sans-serif" font-size="12">${asset.display?.max ?? "not provided"}</text></svg>`;
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${activeDataset.id}-legend.svg`);
  });

  await selectDataset(validated.publicDatasets[0].id);
}

const root = document.getElementById("eo-explorer-app");
if (root) {
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    initExplorer(root);
  }, { rootMargin: "500px" });
  observer.observe(root);
}
