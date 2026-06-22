const MANIFEST = "visualization-data/derived/drone-orthomosaic/manifest.json";
const $ = (selector, root = document) => root.querySelector(selector);
const app = $("[data-drone-app]");
const nodes = {
  stage: $("[data-drone-stage]", app),
  poster: $("[data-drone-poster]", app),
  world: $("[data-drone-world]", app),
  tiles: $("[data-drone-tiles]", app),
  overlay: $("[data-drone-overlay]", app),
  readout: $("[data-drone-readout]", app),
  scale: $("[data-drone-scale]", app),
  status: $("[data-drone-status]", app),
  build: $("[data-drone-build]", app),
  fly: $("[data-drone-fly]", app),
  fit: $("[data-drone-fit]", app),
  zoomIn: $("[data-drone-zoom-in]", app),
  zoomOut: $("[data-drone-zoom-out]", app),
  opacity: $("[data-drone-opacity]", app),
  opacityOutput: $("[data-drone-opacity-output]", app),
  hotspots: $("[data-drone-hotspots]", app),
  meta: $("[data-drone-meta]", app),
  fatal: $("[data-drone-fatal]", app),
};

let manifest;
let view = { x: 0, y: 0, scale: 1 };
let dragging = false;
let dragStart = null;
let activeLevel = 0;
let currentLayer = "natural";
let flyTimer = null;
let frameRequested = false;
let tileTimer = null;
const tileCache = new Map();
const MAX_TILES = 420;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fmt(value) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value);
}

function tileUrl(z, x, y) {
  return manifest.tile_template.replace("{z}", z).replace("{x}", x).replace("{y}", y);
}

function fittedScale() {
  const rect = nodes.stage.getBoundingClientRect();
  return Math.min(rect.width / manifest.width, rect.height / manifest.height);
}

function levelForScale(scale) {
  const targetWidth = manifest.width * scale * window.devicePixelRatio;
  let best = manifest.levels[0];
  for (const level of manifest.levels) {
    best = level;
    if (level.width >= targetWidth) break;
  }
  return best;
}

function clampView() {
  const rect = nodes.stage.getBoundingClientRect();
  const scaledWidth = manifest.width * view.scale;
  const scaledHeight = manifest.height * view.scale;
  if (scaledWidth <= rect.width) {
    view.x = (rect.width - scaledWidth) / 2;
  } else {
    view.x = clamp(view.x, rect.width - scaledWidth, 0);
  }
  if (scaledHeight <= rect.height) {
    view.y = (rect.height - scaledHeight) / 2;
  } else {
    view.y = clamp(view.y, rect.height - scaledHeight, 0);
  }
}

function setTransform() {
  clampView();
  nodes.world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  const relativeZoom = view.scale / Math.max(fittedScale(), 0.0001);
  nodes.readout.textContent = `Zoom ${relativeZoom.toFixed(1)}x · z${activeLevel}`;
  nodes.poster.style.opacity = relativeZoom < 1.18 ? "1" : relativeZoom < 1.7 ? "0.45" : "0.16";
  nodes.tiles.style.opacity = relativeZoom < 1.12 ? "0" : "1";
  const pixelMeters = 0.006;
  const nominal = 100 / view.scale;
  const meters = Math.max(0.01, nominal * pixelMeters);
  nodes.scale.textContent = meters >= 1 ? `${meters.toFixed(1)} m approx.` : `${Math.round(meters * 100)} cm approx.`;
}

function fitView() {
  const rect = nodes.stage.getBoundingClientRect();
  const scale = fittedScale();
  view.scale = scale;
  view.x = (rect.width - manifest.width * scale) / 2;
  view.y = (rect.height - manifest.height * scale) / 2;
  render();
}

function zoomAt(clientX, clientY, factor) {
  const rect = nodes.stage.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const imageX = (px - view.x) / view.scale;
  const imageY = (py - view.y) / view.scale;
  const minScale = Math.min(rect.width / manifest.width, rect.height / manifest.height);
  const maxScale = Math.max(minScale, (manifest.max_display_width || manifest.width) / manifest.width * 1.25);
  view.scale = clamp(view.scale * factor, minScale, maxScale);
  view.x = px - imageX * view.scale;
  view.y = py - imageY * view.scale;
  clampView();
  render();
}

function centerOn(x, y, zoomFactor = 2, animate = true) {
  const rect = nodes.stage.getBoundingClientRect();
  const fitScale = Math.min(rect.width / manifest.width, rect.height / manifest.height);
  const target = {
    scale: clamp(fitScale * zoomFactor, fitScale * 0.9, Math.max(fitScale, (manifest.max_display_width || manifest.width) / manifest.width * 1.25)),
    x: rect.width / 2 - x * fitScale * zoomFactor,
    y: rect.height / 2 - y * fitScale * zoomFactor,
  };
  if (!animate) {
    view = target;
    clampView();
    render();
    return;
  }
  animateView(target, 900);
}

function animateView(target, duration) {
  const start = { ...view };
  const started = performance.now();
  function step(now) {
    const raw = clamp((now - started) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - raw, 3);
    view.x = start.x + (target.x - start.x) * eased;
    view.y = start.y + (target.y - start.y) * eased;
    view.scale = start.scale + (target.scale - start.scale) * eased;
    clampView();
    render();
    if (raw < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function pruneTiles(visibleKeys) {
  for (const [key, image] of tileCache) {
    if (visibleKeys.has(key)) continue;
    image.remove();
    tileCache.delete(key);
    if (tileCache.size <= MAX_TILES) break;
  }
}

function renderTiles() {
  const level = levelForScale(view.scale);
  activeLevel = level.z;
  const levelScale = manifest.width / level.width;
  const rect = nodes.stage.getBoundingClientRect();
  const left = clamp(Math.floor(((-view.x / view.scale) / levelScale) / manifest.tile_size) - 1, 0, level.cols - 1);
  const top = clamp(Math.floor(((-view.y / view.scale) / levelScale) / manifest.tile_size) - 1, 0, level.rows - 1);
  const right = clamp(Math.ceil((((rect.width - view.x) / view.scale) / levelScale) / manifest.tile_size) + 1, 0, level.cols - 1);
  const bottom = clamp(Math.ceil((((rect.height - view.y) / view.scale) / levelScale) / manifest.tile_size) + 1, 0, level.rows - 1);
  const visible = new Set();
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const key = `${level.z}/${x}/${y}`;
      visible.add(key);
      if (tileCache.has(key)) continue;
      const image = new Image();
      const tileWidth = Math.min(manifest.tile_size, level.width - x * manifest.tile_size);
      const tileHeight = Math.min(manifest.tile_size, level.height - y * manifest.tile_size);
      image.decoding = "async";
      image.loading = "eager";
      image.src = tileUrl(level.z, x, y);
      image.style.left = `${x * manifest.tile_size * levelScale - 0.5}px`;
      image.style.top = `${y * manifest.tile_size * levelScale - 0.5}px`;
      image.style.width = `${tileWidth * levelScale + 1}px`;
      image.style.height = `${tileHeight * levelScale + 1}px`;
      nodes.tiles.append(image);
      tileCache.set(key, image);
    }
  }
  pruneTiles(visible);
}

function setReady() {
  setTransform();
  nodes.stage.classList.add("ready");
  nodes.status.hidden = true;
}

function scheduleTileRender(delay = 90) {
  clearTimeout(tileTimer);
  tileTimer = setTimeout(() => {
    renderTiles();
    setReady();
  }, delay);
}

function render(options = {}) {
  if (options.immediateTiles) {
    renderTiles();
    setReady();
    return;
  }
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(() => {
    frameRequested = false;
    setTransform();
    nodes.stage.classList.add("ready");
    nodes.status.hidden = true;
    scheduleTileRender(dragging ? 140 : 70);
  });
}

function renderImmediate() {
  renderTiles();
  setReady();
}

function setLayer(layer) {
  currentLayer = layer;
  if (layer === "natural") {
    nodes.overlay.removeAttribute("src");
    nodes.overlay.style.opacity = 0;
    return;
  }
  nodes.overlay.src = manifest.overlays[layer];
  nodes.overlay.style.opacity = Number(nodes.opacity.value) / 100;
}

function renderHotspots() {
  nodes.hotspots.replaceChildren();
  manifest.hotspots.forEach((hotspot) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = hotspot.label;
    button.addEventListener("click", () => {
      nodes.hotspots.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
      centerOn(hotspot.x, hotspot.y, hotspot.zoom);
    });
    nodes.hotspots.append(button);
  });
}

function renderMeta() {
  const rows = [
    ["Dimensions", `${fmt(manifest.width)} x ${fmt(manifest.height)} px`],
    ["Tiles", `WebP XYZ pyramid, z0-z${manifest.max_zoom}`],
    ["Native level", `z${manifest.native_max_zoom}`],
    ["Source", manifest.source_name],
    ["CRS", manifest.crs || "not provided"],
    ["Generated", manifest.generated_at],
  ];
  nodes.meta.replaceChildren(...rows.flatMap(([term, value]) => {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = value;
    return [dt, dd];
  }));
}

function playFlyover() {
  clearInterval(flyTimer);
  nodes.fly.classList.add("active");
  let index = 0;
  const next = () => {
    const hotspot = manifest.hotspots[index % manifest.hotspots.length];
    centerOn(hotspot.x, hotspot.y, hotspot.zoom, true);
    index += 1;
    if (index > manifest.hotspots.length + 1) {
      clearInterval(flyTimer);
      flyTimer = null;
      nodes.fly.classList.remove("active");
    }
  };
  next();
  flyTimer = setInterval(next, 1800);
}

function bindEvents() {
  nodes.stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.28 : 0.78);
  }, { passive: false });
  nodes.stage.addEventListener("dragstart", (event) => event.preventDefault());
  nodes.stage.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    dragging = true;
    dragStart = { clientX: event.clientX, clientY: event.clientY, x: view.x, y: view.y };
    nodes.stage.classList.add("dragging");
    try { nodes.stage.setPointerCapture(event.pointerId); } catch { /* pointer capture can fail after browser gesture cancellation */ }
  });
  nodes.stage.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    view.x = dragStart.x + event.clientX - dragStart.clientX;
    view.y = dragStart.y + event.clientY - dragStart.clientY;
    clampView();
    render();
  });
  const stopDrag = () => {
    if (!dragging) return;
    dragging = false;
    nodes.stage.classList.remove("dragging");
    renderImmediate();
  };
  nodes.stage.addEventListener("pointerup", stopDrag);
  nodes.stage.addEventListener("pointercancel", stopDrag);
  nodes.stage.addEventListener("lostpointercapture", stopDrag);
  nodes.fit.addEventListener("click", fitView);
  nodes.fly.addEventListener("click", playFlyover);
  nodes.zoomIn.addEventListener("click", () => {
    const rect = nodes.stage.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.45);
  });
  nodes.zoomOut.addEventListener("click", () => {
    const rect = nodes.stage.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.69);
  });
  nodes.opacity.addEventListener("input", () => {
    nodes.opacityOutput.textContent = `${nodes.opacity.value}%`;
    if (currentLayer !== "natural") nodes.overlay.style.opacity = Number(nodes.opacity.value) / 100;
  });
  app.querySelectorAll('input[name="drone-layer"]').forEach((input) => {
    input.addEventListener("change", () => setLayer(input.value));
  });
  window.addEventListener("resize", fitView);
}

async function init() {
  try {
    const response = await fetch(MANIFEST, { cache: "no-store" });
    if (!response.ok) throw new Error(`Manifest request failed (${response.status}). Run scripts/build_drone_orthomosaic_visualizer.py first.`);
    manifest = await response.json();
    nodes.poster.src = manifest.poster || manifest.preview;
    nodes.tiles.style.width = `${manifest.width}px`;
    nodes.tiles.style.height = `${manifest.height}px`;
    nodes.overlay.style.width = `${manifest.width}px`;
    nodes.overlay.style.height = `${manifest.height}px`;
    nodes.build.textContent = `Generated ${manifest.generated_at} · source ${Math.round(manifest.source_size_bytes / 1073741824)} GB`;
    renderHotspots();
    renderMeta();
    bindEvents();
    requestAnimationFrame(fitView);
    app.removeAttribute("aria-busy");
  } catch (error) {
    nodes.status.hidden = true;
    nodes.fatal.hidden = false;
    nodes.fatal.textContent = error.message;
  }
}

init();
