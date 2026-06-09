const NOT_PROVIDED = "not provided";

function text(value) {
  if (value === undefined || value === null || value === "") return NOT_PROVIDED;
  if (Array.isArray(value)) return value.length ? value.join(", ") : NOT_PROVIDED;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function el(root, selector) {
  return root.querySelector(selector);
}

export function createExplorerUI(root) {
  const nodes = {
    root,
    status: el(root, "[data-eo-status]"),
    datasetSelect: el(root, "[data-eo-dataset]"),
    empty: el(root, "[data-eo-empty]"),
    cockpit: el(root, "[data-eo-cockpit]"),
    map: el(root, "[data-eo-map]"),
    mapMessage: el(root, "[data-eo-map-message]"),
    layers: el(root, "[data-eo-layers]"),
    filters: el(root, "[data-eo-filters]"),
    inspector: el(root, "[data-eo-inspector]"),
    metadata: el(root, "[data-eo-metadata]"),
    warnings: el(root, "[data-eo-warnings]"),
    legend: el(root, "[data-eo-legend]"),
    spectral: el(root, "[data-eo-spectral]"),
    timeline: el(root, "[data-eo-timeline]"),
    tablePanel: el(root, "[data-eo-table-panel]"),
    tableMeta: el(root, "[data-eo-table-meta]"),
    tableSelect: el(root, "[data-eo-table-select]"),
    table: el(root, "[data-eo-table]"),
    swipe: el(root, "[data-eo-swipe]"),
    loading: el(root, "[data-eo-loading]")
  };

  return {
    nodes,
    setStatus(label, tone = "neutral") {
      nodes.status.textContent = label;
      nodes.status.dataset.tone = tone;
    },
    setLoading(active, label = "Loading") {
      nodes.loading.hidden = !active;
      nodes.loading.querySelector("span").textContent = label;
      nodes.root.setAttribute("aria-busy", String(active));
    },
    showNoData(message, detail, tone = "neutral") {
      nodes.empty.hidden = false;
      nodes.cockpit.hidden = true;
      el(nodes.empty, "[data-eo-empty-title]").textContent = message;
      el(nodes.empty, "[data-eo-empty-detail]").textContent = detail;
      this.setStatus(tone === "error" ? "Catalog attention required" : "Engine ready · no public data", tone);
      nodes.root.querySelectorAll("[data-requires-data]").forEach((control) => control.disabled = true);
    },
    showCockpit() {
      nodes.empty.hidden = true;
      nodes.cockpit.hidden = false;
      this.setStatus("Public dataset active", "ready");
    },
    setDatasets(datasets) {
      nodes.datasetSelect.replaceChildren();
      datasets.forEach((dataset) => {
        const option = document.createElement("option");
        option.value = dataset.id;
        const prefix = dataset.data_class === "synthetic" ? "[Synthetic] " : dataset.data_class === "unverified" ? "[Unverified] " : "";
        option.textContent = `${prefix}${dataset.title}`;
        nodes.datasetSelect.append(option);
      });
      nodes.datasetSelect.disabled = datasets.length < 2;
    },
    setCapabilities(capabilities) {
      const capabilityMap = {
        Overview: true, RGB: capabilities.rgb, "False color": capabilities.bandComposer,
        Indices: capabilities.indices, Thermal: capabilities.thermal, Plots: capabilities.plots,
        Change: capabilities.change, Spectra: capabilities.spectra, "3D / canopy": capabilities.threeD
      };
      nodes.root.querySelectorAll("[data-eo-mode]").forEach((button) => {
        const enabled = Boolean(capabilityMap[button.dataset.eoMode]);
        button.disabled = !enabled;
        button.title = enabled ? "" : `Unavailable: required real ${button.dataset.eoMode.toLowerCase()} assets or metadata are not configured.`;
      });
      nodes.root.querySelector("[data-eo-band-red]").disabled = !capabilities.bandComposer;
      nodes.root.querySelector("[data-eo-band-green]").disabled = !capabilities.bandComposer;
      nodes.root.querySelector("[data-eo-band-blue]").disabled = !capabilities.bandComposer;
      nodes.root.querySelector("[data-eo-compare]").disabled = !capabilities.compare;
      nodes.root.querySelector("[data-eo-play]").disabled = !capabilities.temporal;
      nodes.swipe.disabled = !capabilities.compare;
    },
    renderBands(dataset) {
      const rasterBands = dataset.assets.find((asset) => asset.type === "raster")?.bands || [];
      ["red", "green", "blue"].forEach((channel, channelIndex) => {
        const select = nodes.root.querySelector(`[data-eo-band-${channel}]`);
        select.replaceChildren(new Option("Not selected", ""));
        dataset.bands.filter((band) => band.name !== "SCL").forEach((band) => select.add(new Option(band.name, band.name)));
        const preferred = dataset.bands.find((band) => band.common_name?.toLowerCase() === channel);
        const configuredBand = dataset.bands[(rasterBands[channelIndex] || 0) - 1];
        if (preferred || configuredBand) select.value = (preferred || configuredBand).name;
      });
    },
    renderLayers(dataset, onVisibility, onOpacity) {
      nodes.layers.replaceChildren();
      nodes.filters.replaceChildren();
      dataset.assets.filter((asset) => ["raster", "vector"].includes(asset.type)).forEach((asset) => {
        const item = document.createElement("div");
        item.className = "eo-layer-row";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = true;
        check.setAttribute("aria-label", `Toggle ${asset.title || asset.role}`);
        check.addEventListener("change", () => onVisibility(asset.id, check.checked));
        const label = document.createElement("span");
        label.innerHTML = `<strong></strong><small></small>`;
        label.querySelector("strong").textContent = asset.title || asset.role;
        label.querySelector("small").textContent = `${asset.type} · ${asset.units || NOT_PROVIDED}`;
        const opacity = document.createElement("input");
        opacity.type = "range";
        opacity.min = "0";
        opacity.max = "1";
        opacity.step = "0.05";
        opacity.value = String(asset.opacity ?? 1);
        opacity.setAttribute("aria-label", `${asset.title || asset.role} opacity`);
        opacity.addEventListener("input", () => onOpacity(asset.id, Number(opacity.value)));
        item.append(check, label, opacity);
        nodes.layers.append(item);
      });
      if (!nodes.layers.children.length) nodes.layers.textContent = "No renderable layers registered.";
    },
    renderVectorFilters(asset, fields, onChange) {
      Object.entries(fields).forEach(([property, values]) => {
        if (!values.length) return;
        const label = document.createElement("label");
        label.className = "eo-control";
        label.textContent = `${asset.title || asset.role} · ${property}`;
        const select = document.createElement("select");
        select.append(new Option("All values", ""));
        values.forEach((value) => select.append(new Option(value, value)));
        select.addEventListener("change", () => onChange(asset.id, property, select.value));
        label.append(select);
        nodes.filters.append(label);
      });
    },
    renderMetadata(dataset) {
      const provenance = dataset.provenance || {};
      nodes.metadata.parentElement.querySelector(".eo-class-badge")?.remove();
      const resolution = dataset.spatial_resolution ? `${dataset.spatial_resolution.value} ${dataset.spatial_resolution.unit}` : null;
      const fields = [
        ["Dataset", dataset.title], ["Data class", dataset.data_class], ["Version", dataset.version], ["Acquisition", dataset.acquisition_date],
        ["Site", dataset.site], ["Country", dataset.country], ["Crop", dataset.crop],
        ["Stressor labels", dataset.stressors], ["Platform", dataset.platform], ["Sensor", dataset.sensor],
        ["Processing level", provenance.processing_level], ["CRS", dataset.crs], ["Resolution", resolution],
        ["Calibration", provenance.calibration], ["Atmospheric correction", provenance.atmospheric_correction],
        ["Georeferencing", provenance.georeferencing], ["Software", [provenance.software, provenance.software_version].filter(Boolean).join(" ")],
        ["DOI / repository", provenance.doi || provenance.repository], ["License", dataset.license],
        ["Citation", dataset.citation], ["Quality", provenance.quality], ["Uncertainty", provenance.uncertainty],
        ["Known limitations", provenance.known_limitations], ["Contact", provenance.contact]
      ];
      nodes.metadata.replaceChildren();
      fields.forEach(([label, value]) => {
        const dt = document.createElement("dt");
        const dd = document.createElement("dd");
        dt.textContent = label;
        dd.textContent = text(value);
        nodes.metadata.append(dt, dd);
      });
      const badge = document.createElement("span");
      badge.className = "eo-class-badge";
      badge.dataset.class = dataset.data_class || "not-provided";
      badge.textContent = dataset.data_class || NOT_PROVIDED;
      nodes.metadata.after(badge);
    },
    renderWarnings(warnings) {
      nodes.warnings.replaceChildren();
      warnings.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item.message;
        nodes.warnings.append(li);
      });
      nodes.warnings.closest("details").hidden = warnings.length === 0;
    },
    renderLegend(asset) {
      nodes.legend.replaceChildren();
      if (!asset) {
        nodes.legend.textContent = "Select a raster layer to view its legend.";
        return;
      }
      const title = document.createElement("strong");
      title.textContent = asset.title || asset.role;
      const scale = document.createElement("div");
      scale.className = "eo-colorbar";
      const palette = asset.display?.palette;
      scale.style.background = Array.isArray(palette) && palette.length > 1
        ? `linear-gradient(90deg, ${palette.join(",")})`
        : "linear-gradient(90deg, #172c3a, #4d9d91, #f2c94c)";
      if (!palette) scale.dataset.generic = "true";
      const labels = document.createElement("div");
      labels.className = "eo-colorbar-labels";
      labels.innerHTML = `<span></span><span></span><span></span>`;
      labels.children[0].textContent = text(asset.display?.min);
      labels.children[1].textContent = asset.units || NOT_PROVIDED;
      labels.children[2].textContent = text(asset.display?.max);
      const note = document.createElement("small");
      note.textContent = `Nodata: ${text(asset.nodata)}${palette ? "" : " · generic interface palette; dataset palette not provided"}`;
      nodes.legend.append(title, scale, labels, note);
    },
    renderInspector(details) {
      nodes.inspector.replaceChildren();
      const heading = document.createElement("h4");
      heading.textContent = details.kind === "plot" ? "Selected feature" : "Selected pixel";
      const coordinates = document.createElement("p");
      coordinates.textContent = `Coordinates: ${details.coordinates.map((value) => value.toFixed(6)).join(", ")} (EPSG:4326)`;
      nodes.inspector.append(heading, coordinates);
      const entries = details.kind === "plot" ? Object.entries(details.properties || {}) : (details.values || []).map((value) => [value.layer, value.value === null ? "nodata or unreadable" : `${value.value.join(", ")} ${value.units || NOT_PROVIDED}`]);
      if (!entries.length) entries.push(["Value", "not available from the active asset"]);
      const dl = document.createElement("dl");
      entries.forEach(([key, value]) => {
        const dt = document.createElement("dt"); dt.textContent = key;
        const dd = document.createElement("dd"); dd.textContent = text(value);
        dl.append(dt, dd);
      });
      nodes.inspector.append(dl);
    },
    setMapMessage(message = "", tone = "neutral") {
      nodes.mapMessage.hidden = !message;
      nodes.mapMessage.textContent = message;
      nodes.mapMessage.dataset.tone = tone;
    },
    renderTimeline(dataset, comparable, onSelect) {
      nodes.timeline.replaceChildren();
      [dataset, ...comparable].filter((item) => item.acquisition_date).sort((a, b) => a.acquisition_date.localeCompare(b.acquisition_date)).forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = item.acquisition_date;
        button.className = item.id === dataset.id ? "active" : "";
        button.addEventListener("click", () => onSelect(item.id));
        nodes.timeline.append(button);
      });
      if (!nodes.timeline.children.length) nodes.timeline.textContent = "Acquisition date not provided.";
    },
    renderTable(asset, rows, totalRows) {
      nodes.tablePanel.hidden = false;
      nodes.table.replaceChildren();
      if (!rows.length) {
        nodes.tableMeta.textContent = `${asset.title || asset.role} · no rows`;
        return;
      }
      const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      nodes.tableMeta.textContent = `${asset.title || asset.role} · showing ${rows.length} of ${totalRows} rows · ${columns.length} columns`;
      const table = document.createElement("table");
      table.className = "eo-data-table";
      const head = document.createElement("thead");
      const headerRow = document.createElement("tr");
      columns.forEach((column) => { const th = document.createElement("th"); th.textContent = column; headerRow.append(th); });
      head.append(headerRow);
      const body = document.createElement("tbody");
      rows.forEach((row) => {
        const tr = document.createElement("tr");
        columns.forEach((column) => { const td = document.createElement("td"); td.textContent = text(row[column]); td.title = td.textContent; tr.append(td); });
        body.append(tr);
      });
      table.append(head, body);
      nodes.table.append(table);
    },
    clearTable() {
      nodes.tablePanel.hidden = true;
      nodes.table.replaceChildren();
      nodes.tableMeta.textContent = "";
      nodes.tableSelect.replaceChildren();
    },
    setTableAssets(assets, onSelect) {
      nodes.tableSelect.replaceChildren();
      assets.forEach((asset) => nodes.tableSelect.append(new Option(asset.title || asset.role, asset.id)));
      nodes.tableSelect.disabled = assets.length < 2;
      nodes.tableSelect.onchange = () => onSelect(nodes.tableSelect.value);
    }
  };
}
