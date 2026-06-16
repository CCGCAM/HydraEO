const OL_VERSION = "10.9.0";
const OL_ESM = `https://esm.sh/ol@${OL_VERSION}`;
const OL_STYLE = `https://cdn.jsdelivr.net/npm/ol@${OL_VERSION}/ol.css`;
let openLayersPromise;

function loadOpenLayers() {
  if (openLayersPromise) return openLayersPromise;
  if (!document.querySelector(`link[href="${OL_STYLE}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = OL_STYLE;
    link.crossOrigin = "anonymous";
    document.head.append(link);
  }

  openLayersPromise = Promise.all([
    import(`${OL_ESM}/Map.js`), import(`${OL_ESM}/View.js`), import(`${OL_ESM}/layer/WebGLTile.js`),
    import(`${OL_ESM}/layer/Vector.js`), import(`${OL_ESM}/source/GeoTIFF.js`), import(`${OL_ESM}/source/Vector.js`),
    import(`${OL_ESM}/format/GeoJSON.js`), import(`${OL_ESM}/style/Style.js`), import(`${OL_ESM}/style/Fill.js`),
    import(`${OL_ESM}/style/Stroke.js`), import(`${OL_ESM}/style/Circle.js`), import(`${OL_ESM}/control/defaults.js`), import(`${OL_ESM}/control/ScaleLine.js`),
    import(`${OL_ESM}/proj.js`), import(`${OL_ESM}/render.js`)
  ]).then(([Map, View, WebGLTile, VectorLayer, GeoTIFF, VectorSource, GeoJSON, Style, Fill, Stroke, Circle, controls, ScaleLine, proj, render]) => ({
    Map: Map.default,
    View: View.default,
    layer: { WebGLTile: WebGLTile.default, Vector: VectorLayer.default },
    source: { GeoTIFF: GeoTIFF.default, Vector: VectorSource.default },
    format: { GeoJSON: GeoJSON.default },
    style: { Style: Style.default, Fill: Fill.default, Stroke: Stroke.default, Circle: Circle.default },
    control: { defaults: controls.defaults, ScaleLine: ScaleLine.default },
    proj,
    render
  })).catch(() => {
    openLayersPromise = null;
    throw new Error("OpenLayers could not be loaded from the pinned module CDN.");
  });
  return openLayersPromise;
}

function rasterLayer(ol, asset) {
  const sourceOptions = { sources: [{ url: asset.href }] };
  if (asset.href.startsWith("visualization-data/")) {
    sourceOptions.sourceOptions = { allowFullFile: true };
  }
  if (asset.nodata !== undefined && asset.nodata !== null) sourceOptions.sources[0].nodata = asset.nodata;
  if (Array.isArray(asset.bands) && asset.bands.length) sourceOptions.sources[0].bands = asset.bands;
  if (asset.normalize === false) sourceOptions.normalize = false;
  if (asset.convertToRGB) sourceOptions.convertToRGB = true;

  const source = new ol.source.GeoTIFF(sourceOptions);
  const layer = new ol.layer.WebGLTile({ source, opacity: Number.isFinite(asset.opacity) ? asset.opacity : 1 });
  layer.set("hydraAsset", asset);
  return layer;
}

function vectorLayer(ol, asset) {
  const source = new ol.source.Vector({
    url: asset.href,
    format: new ol.format.GeoJSON({ dataProjection: asset.data_crs || "EPSG:4326", featureProjection: "EPSG:3857" })
  });
  const baseStyle = new ol.style.Style({
    fill: new ol.style.Fill({ color: "rgba(5, 20, 31, 0.08)" }),
    stroke: new ol.style.Stroke({ color: "#79e2c8", width: 1.8 }),
    image: new ol.style.Circle({
      radius: 3.2,
      fill: new ol.style.Fill({ color: "rgba(121, 226, 200, 0.8)" }),
      stroke: new ol.style.Stroke({ color: "#06131c", width: 0.8 })
    })
  });
  const hoverStyle = new ol.style.Style({
    fill: new ol.style.Fill({ color: "rgba(242, 201, 76, 0.22)" }),
    stroke: new ol.style.Stroke({ color: "#f2c94c", width: 3 }),
    image: new ol.style.Circle({
      radius: 5,
      fill: new ol.style.Fill({ color: "#f2c94c" }),
      stroke: new ol.style.Stroke({ color: "#06131c", width: 1 })
    })
  });
  const layer = new ol.layer.Vector({
    source,
    declutter: true,
    style: (feature) => {
      const filter = layer.get("hydraFilter");
      if (filter?.value && String(feature.get(filter.property)) !== filter.value) return null;
      return feature === layer.get("hydraHover") ? hoverStyle : baseStyle;
    }
  });
  layer.set("hydraAsset", asset);
  return layer;
}

export class EOMapRenderer {
  constructor(target, callbacks = {}) {
    this.target = target;
    this.callbacks = callbacks;
    this.map = null;
    this.ol = null;
    this.dataset = null;
    this.abortController = null;
    this.swipeLayer = null;
    this.swipePosition = 50;
    this.swipePreRender = null;
    this.swipePostRender = null;
  }

  async load(dataset, assets = dataset.assets) {
    this.dispose();
    this.dataset = dataset;
    this.abortController = new AbortController();
    this.callbacks.onLoading?.(true, "Loading geospatial renderer");

    try {
      const ol = await loadOpenLayers();
      if (this.abortController.signal.aborted) return;
      this.ol = ol;

      const supported = assets.filter((asset) =>
        asset.type === "raster" || (asset.type === "vector" && /geo\+json|geojson|\.geojson(?:\?|$)/i.test(asset.media_type || asset.href))
      );
      if (!supported.length) throw new Error("No phase-1 renderable COG or GeoJSON assets are registered for this dataset.");

      const layers = supported.map((asset) => asset.type === "raster" ? rasterLayer(ol, asset) : vectorLayer(ol, asset));
      this.map = new ol.Map({
        target: this.target,
        layers,
        view: new ol.View({ center: [0, 0], zoom: 2, minZoom: 1, maxZoom: 24 }),
        controls: ol.control.defaults({ attribution: false, rotate: false }).extend([
          new ol.control.ScaleLine({ units: "metric", bar: true, steps: 2, text: true })
        ])
      });

      if (Array.isArray(dataset.bbox) && dataset.bbox.length === 4) {
        const extent = ol.proj.transformExtent(dataset.bbox, "EPSG:4326", "EPSG:3857");
        this.map.getView().fit(extent, { padding: [48, 48, 48, 48], maxZoom: 20, duration: 0 });
      } else {
        const vector = layers.find((layer) => layer instanceof ol.layer.Vector);
        vector?.getSource().once("change", () => {
          if (vector.getSource().getState() === "ready" && !vector.getSource().isEmpty()) {
            this.map?.getView().fit(vector.getSource().getExtent(), { padding: [48, 48, 48, 48], maxZoom: 20 });
          }
        });
      }

      this.map.on("singleclick", (event) => this.inspect(event));
      this.map.on("pointermove", (event) => {
        if (!this.map) return;
        const hit = this.map.forEachFeatureAtPixel(event.pixel, (feature, layer) => ({ feature, layer }));
        this.map.getLayers().forEach((layer) => {
          if (!(layer instanceof ol.layer.Vector)) return;
          const next = hit?.layer === layer ? hit.feature : null;
          if (layer.get("hydraHover") !== next) {
            layer.set("hydraHover", next);
            layer.changed();
          }
        });
        this.target.style.cursor = hit ? "pointer" : "crosshair";
      });
      layers.filter((layer) => layer instanceof ol.layer.Vector).forEach((layer) => {
        layer.getSource().once("change", () => {
          if (layer.getSource().getState() !== "ready") return;
          const accepted = ["crop", "site", "date", "stressor", "stress", "treatment", "block", "sensor", "Plot"];
          const fields = {};
          layer.getSource().getFeatures().forEach((feature) => {
            accepted.forEach((property) => {
              const value = feature.get(property);
              if (value === undefined || value === null || value === "") return;
              (fields[property] ||= new Set()).add(String(value));
            });
          });
          this.callbacks.onVectorFields?.(layer.get("hydraAsset"), Object.fromEntries(
            Object.entries(fields).map(([property, values]) => [property, [...values].sort()])
          ));
        });
      });
      this.callbacks.onReady?.(layers.map((layer) => layer.get("hydraAsset")));
    } catch (error) {
      this.callbacks.onError?.(error);
      throw error;
    } finally {
      this.callbacks.onLoading?.(false);
    }
  }

  async inspect(event) {
    if (!this.map || !this.dataset) return;
    const coordinate = this.ol.proj.toLonLat(event.coordinate);
    const details = {
      kind: "pixel",
      coordinates: coordinate,
      dataset: this.dataset.title,
      acquisitionDate: this.dataset.acquisition_date || null,
      values: []
    };

    const feature = this.map.forEachFeatureAtPixel(event.pixel, (item, layer) => ({ item, layer }));
    if (feature) {
      details.kind = "plot";
      details.properties = { ...feature.item.getProperties() };
      delete details.properties.geometry;
      details.asset = feature.layer.get("hydraAsset");
    } else {
      for (const layer of this.map.getLayers().getArray()) {
        const asset = layer.get("hydraAsset");
        if (!asset || asset.type !== "raster") continue;
        try {
          const value = await Promise.resolve(layer.getData(event.pixel));
          details.values.push({
            layer: asset.title || asset.role,
            value: value === null || value === undefined ? null : Array.from(value).map((item) =>
              Number.isFinite(item) ? item * (asset.scale ?? 1) + (asset.offset ?? 0) : item
            ),
            units: asset.units || null,
            nodata: asset.nodata ?? null,
            resolution: this.dataset.spatial_resolution || null,
            observationType: asset.observation_type || (asset.role === "quality_mask" ? "quality flag" : "not provided")
          });
        } catch {
          details.values.push({ layer: asset.title || asset.role, value: null, units: asset.units || null });
        }
      }
    }
    this.callbacks.onInspect?.(details);
  }

  setOpacity(assetId, opacity) {
    this.map?.getLayers().forEach((layer) => {
      if (layer.get("hydraAsset")?.id === assetId) layer.setOpacity(opacity);
    });
  }

  setVisible(assetId, visible) {
    this.map?.getLayers().forEach((layer) => {
      if (layer.get("hydraAsset")?.id === assetId) layer.setVisible(visible);
    });
  }

  setVectorFilter(assetId, property, value) {
    this.map?.getLayers().forEach((layer) => {
      if (layer.get("hydraAsset")?.id !== assetId || !(layer instanceof this.ol.layer.Vector)) return;
      layer.set("hydraFilter", value ? { property, value } : null);
      layer.changed();
    });
  }

  setMode(mode) {
    if (!this.map) return;
    const roles = {
      RGB: ["rgb_orthomosaic", "multispectral_reflectance"],
      "False color": ["multispectral_reflectance", "hyperspectral_reflectance"],
      Indices: ["vegetation_index"],
      Thermal: ["thermal"],
      Plots: ["plot_boundaries", "site_boundaries", "plant_positions", "plots", "blocks", "rows", "treatments"],
      Change: ["change", "difference", "relative_change", "anomaly"]
    };
    this.map.getLayers().forEach((layer) => {
      const asset = layer.get("hydraAsset");
      if (!asset) return;
      if (mode === "Overview" || mode === "Spectra" || mode === "3D / canopy") layer.setVisible(true);
      else layer.setVisible((roles[mode] || []).includes(asset.role));
    });
  }

  enableSwipe(enabled, position = 50) {
    if (!this.map) return false;
    if (this.swipeLayer) {
      this.swipeLayer.un("prerender", this.swipePreRender);
      this.swipeLayer.un("postrender", this.swipePostRender);
      this.swipeLayer = null;
    }
    if (!enabled) {
      this.map.render();
      return false;
    }
    const rasters = this.map.getLayers().getArray().filter((layer) => layer.get("hydraAsset")?.type === "raster");
    if (rasters.length < 2) return false;
    this.swipeLayer = rasters[rasters.length - 1];
    this.swipePosition = position;
    this.swipePreRender = (event) => {
      const gl = event.context;
      gl.enable(gl.SCISSOR_TEST);
      const mapSize = this.map.getSize();
      const bottomLeft = this.ol.render.getRenderPixel(event, [0, mapSize[1]]);
      const topRight = this.ol.render.getRenderPixel(event, [mapSize[0], 0]);
      const width = Math.round((topRight[0] - bottomLeft[0]) * (this.swipePosition / 100));
      gl.scissor(bottomLeft[0], bottomLeft[1], width, topRight[1] - bottomLeft[1]);
    };
    this.swipePostRender = (event) => event.context.disable(event.context.SCISSOR_TEST);
    this.swipeLayer.on("prerender", this.swipePreRender);
    this.swipeLayer.on("postrender", this.swipePostRender);
    this.map.render();
    return true;
  }

  setSwipePosition(position) {
    this.swipePosition = Number(position);
    this.map?.render();
  }

  exportCanvas() {
    if (!this.map) throw new Error("No map is active.");
    const size = this.map.getSize();
    const output = document.createElement("canvas");
    output.width = size[0];
    output.height = size[1];
    const context = output.getContext("2d");
    context.fillStyle = "#07131c";
    context.fillRect(0, 0, output.width, output.height);

    this.target.querySelectorAll("canvas").forEach((canvas) => {
      if (!canvas.width) return;
      const opacity = Number(canvas.parentNode.style.opacity || 1);
      context.globalAlpha = opacity;
      const transform = canvas.style.transform.match(/^matrix\(([^)]+)\)$/);
      if (transform) context.setTransform(...transform[1].split(",").map(Number));
      context.drawImage(canvas, 0, 0);
    });
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    return output;
  }

  dispose() {
    this.enableSwipe(false);
    this.abortController?.abort();
    if (this.map) {
      this.map.setTarget(null);
      this.map = null;
    }
    if (this.target) this.target.replaceChildren();
  }
}

export function renderSpectralChart(container, rows, metadata = {}) {
  container.replaceChildren();
  if (!Array.isArray(rows) || !rows.length) return false;
  const xKey = metadata.x_column;
  const yKey = metadata.y_column;
  if (!xKey || !yKey) return false;
  const points = rows.map((row) => ({ x: Number(row[xKey]), y: Number(row[yKey]) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (points.length < 2) return false;

  const width = 560, height = 240, pad = { left: 55, right: 18, top: 18, bottom: 42 };
  const minX = Math.min(...points.map((p) => p.x)), maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)), maxY = Math.max(...points.map((p) => p.y));
  if (minX === maxX || minY === maxY) return false;
  const sx = (x) => pad.left + ((x - minX) / (maxX - minX)) * (width - pad.left - pad.right);
  const sy = (y) => height - pad.bottom - ((y - minY) / (maxY - minY)) * (height - pad.top - pad.bottom);
  const path = points.sort((a, b) => a.x - b.x).map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join(" ");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${metadata.title || "Spectrum"}: ${xKey} by ${yKey}`);
  const ns = "http://www.w3.org/2000/svg";
  const add = (name, attributes, value) => {
    const node = document.createElementNS(ns, name);
    Object.entries(attributes).forEach(([key, item]) => node.setAttribute(key, String(item)));
    if (value !== undefined) node.textContent = String(value);
    svg.append(node);
  };
  add("path", { class: "eo-chart-axis", d: `M${pad.left},${pad.top}V${height-pad.bottom}H${width-pad.right}` });
  add("path", { class: "eo-chart-line", d: path });
  add("text", { x: width / 2, y: height - 8, "text-anchor": "middle" }, `${metadata.x_label || xKey}${metadata.x_unit ? ` (${metadata.x_unit})` : ""}`);
  add("text", { transform: `translate(15 ${height / 2}) rotate(-90)`, "text-anchor": "middle" }, `${metadata.y_label || yKey}${metadata.y_unit ? ` (${metadata.y_unit})` : ""}`);
  add("text", { x: pad.left, y: height - pad.bottom + 18 }, minX);
  add("text", { x: width - pad.right, y: height - pad.bottom + 18, "text-anchor": "end" }, maxX);
  add("text", { x: pad.left - 8, y: pad.top + 4, "text-anchor": "end" }, maxY);
  add("text", { x: pad.left - 8, y: height - pad.bottom, "text-anchor": "end" }, minY);
  container.append(svg);
  return true;
}
