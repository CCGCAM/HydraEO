const MANIFEST = "visualization-data/derived/sentinel2-explorer/manifest.json";
const OL = "https://esm.sh/ol@10.9.0";
const GEOTIFF = "https://esm.sh/geotiff@2.1.3";
const PROJ4 = "https://esm.sh/proj4@2.15.0";
const REFLECTANCE_SCALE = 0.0001;
const BAND_LABELS = ["B2", "B3", "B4", "B5", "B6", "B7", "B8", "B8A", "B11", "B12", "SCL"];
const IRRADIANCE_BANDS = ["B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B11", "B12"];
const WAVELENGTHS = [490, 560, 665, 705, 740, 783, 842, 945, 1610, 2190];
const OBSCURED_CLASSES = new Set([3, 8, 9, 10, 11]);
const SCL_LABELS = {
  0:"No data", 1:"Saturated/defective", 2:"Dark area", 3:"Cloud shadow", 4:"Vegetation",
  5:"Bare soil", 6:"Water", 7:"Unclassified", 8:"Cloud medium probability",
  9:"Cloud high probability", 10:"Thin cirrus", 11:"Snow/ice"
};
const INDEX_INFO = {
  ndvi:{label:"NDVI", formula:"(B8 − B4) / (B8 + B4)"},
  ndre:{label:"NDRE", formula:"(B8A − B5) / (B8A + B5)"},
  ndmi:{label:"NDMI", formula:"(B8 − B11) / (B8 + B11)"},
  evi:{label:"EVI", formula:"2.5 × (B8 − B4) / (B8 + 6B4 − 7.5B2 + 1)"}
};

const $ = (selector, root = document) => root.querySelector(selector);
const app = $("[data-s2-app]");
const nodeNames = ["site","year","cloud","view-left","view-right","swipe-divider","swipe-left-label","swipe-right-label","play","place","country","crop","count","range","date","sensor","quality","map","map-status","map-key","lens","lens-date","lens-values","scene-title","metadata","indices","spectrum","file","prev","next","output","slider","ticks","observations","season-boundaries","season","story","story-play","generated","folder","fatal"];
const nodes = Object.fromEntries(nodeNames.map((name) => [name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), $(`[data-s2-${name}]`, app)]));

let manifest, site, filtered = [], index = 0, map, ol, rasterLayers = [], vectorLayers = [], roiExtent, roiClipCoordinates;
let playbackTimer, storyTimer, storyChapters = [], lensTimer, lensToken = 0;
let geotiffModulePromise, proj4Promise, pixelReader;
let rasterRequestId = 0, sliderTimer;
let swipePosition = 50, swipeDragging = false;
const rasterCache = new Map();
const prefetchCache = new Map();
const MAX_RASTER_CACHE = 8;
const MAX_PREFETCH_CACHE = 6;

function option(value, label = value) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

function fmtBytes(value) { return `${(value / 1048576).toFixed(1)} MB`; }
function nice(value, digits = 1, fallback = "Not available") {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : fallback;
}

function stopPlayback() {
  clearInterval(playbackTimer);
  playbackTimer = null;
  nodes.play.textContent = "Play time series";
  nodes.play.classList.remove("active");
}

function stopStory() {
  clearInterval(storyTimer);
  storyTimer = null;
  nodes.storyPlay.textContent = "Play observation story";
  nodes.storyPlay.classList.remove("active");
}

function cacheKey(acquisition, view, slot) {
  return `${acquisition.href}::${view}::${slot}`;
}

function remember(cache, key, value, limit) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value);
  return value;
}

async function loadOpenLayers() {
  if (!document.querySelector('link[href*="ol.css"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdn.jsdelivr.net/npm/ol@10.9.0/ol.css";
    document.head.append(link);
  }
  const modules = await Promise.all([
    import(`${OL}/Map.js`), import(`${OL}/View.js`), import(`${OL}/layer/WebGLTile.js`), import(`${OL}/layer/Vector.js`),
    import(`${OL}/source/GeoTIFF.js`), import(`${OL}/source/Vector.js`), import(`${OL}/format/GeoJSON.js`),
    import(`${OL}/style/Style.js`), import(`${OL}/style/Fill.js`), import(`${OL}/style/Stroke.js`), import(`${OL}/style/Circle.js`),
    import(`${OL}/control/defaults.js`), import(`${OL}/control/ScaleLine.js`), import(`${OL}/proj.js`),
    import(`${OL}/layer/Image.js`), import(`${OL}/source/ImageStatic.js`), import(`${OL}/render.js`)
  ]);
  return {
    Map:modules[0].default, View:modules[1].default, WebGLTile:modules[2].default, VectorLayer:modules[3].default,
    GeoTIFF:modules[4].default, VectorSource:modules[5].default, GeoJSON:modules[6].default,
    Style:modules[7].default, Fill:modules[8].default, Stroke:modules[9].default, Circle:modules[10].default,
    defaults:modules[11].defaults, ScaleLine:modules[12].default, proj:modules[13],
    ImageLayer:modules[14].default, ImageStatic:modules[15].default, render:modules[16]
  };
}

function vectorStyle(role) {
  const color = role === "roi" || role === "boundary" ? "#67e6bd" : role === "orchard" ? "#f5c96a" : "#4fc8e8";
  return new ol.Style({
    fill:new ol.Fill({color:role === "site" ? "rgba(79,200,232,.25)" : "rgba(103,230,189,.035)"}),
    stroke:new ol.Stroke({color,width:role === "boundary" ? 4 : role === "roi" ? 3 : 2,lineDash:role === "orchard" ? [8,5] : undefined}),
    image:new ol.Circle({radius:7,fill:new ol.Fill({color}),stroke:new ol.Stroke({color:"#071a22",width:2})})
  });
}

async function initMap() {
  ol = await loadOpenLayers();
  map = new ol.Map({
    target:nodes.map,
    layers:[],
    view:new ol.View({center:[0,0],zoom:2,maxZoom:22}),
    controls:[],
    interactions:[]
  });
  map.on("pointermove", scheduleLens);
  nodes.map.addEventListener("pointerleave", () => { nodes.lens.hidden = true; });
}

function setVectors() {
  vectorLayers.forEach((layer) => map.removeLayer(layer));
  vectorLayers = [];
  roiClipCoordinates=null;
  site.vectors.forEach((asset) => {
    const source=new ol.VectorSource({url:asset.href,format:new ol.GeoJSON({dataProjection:"EPSG:4326",featureProjection:"EPSG:3857"})});
    const layer = new ol.VectorLayer({source,style:vectorStyle(asset.role)});
    layer.setZIndex(asset.role === "site" ? 4 : asset.role === "roi" ? 3 : 2);
    map.addLayer(layer);
    vectorLayers.push(layer);
    if(asset.role==="boundary"||asset.role==="roi")source.once("change",()=>{
      if(source.getState()!=="ready")return;
      const geometry=source.getFeatures()[0]?.getGeometry();
      if(geometry?.getType()==="Polygon"){
        roiClipCoordinates=geometry.getCoordinates()[0];
        map.render();
      }
    });
  });
  if (site.bbox) {
    roiExtent=ol.proj.transformExtent(site.bbox,"EPSG:4326","EPSG:3857");
    const width=roiExtent[2]-roiExtent[0],height=roiExtent[3]-roiExtent[1];
    nodes.map.parentElement.style.setProperty("--s2-roi-ratio",String(width/height));
    requestAnimationFrame(()=>{
      map.updateSize();
      map.getView().setMinZoom(0);
      map.getView().setMaxZoom(28);
      map.getView().fit(roiExtent,{padding:[0,0,0,0],duration:0,nearest:true});
      map.getView().setMinZoom(map.getView().getZoom());
      map.getView().setMaxZoom(map.getView().getZoom());
    });
  }
}

function obscuredExpression(sclBand) {
  return ["any", ...[0,1,3,8,9,10,11].map((code) => ["==",["band",sclBand],code])];
}

function indexColor(expression, sclBand) {
  return ["case", obscuredExpression(sclBand), [0,0,0,0],
    ["interpolate",["linear"],expression,
      -1,"#542788", -0.2,"#b2abd2", 0,"#f7f7d4", 0.2,"#f1c75b", 0.5,"#4dac6b", 1,"#064b2c"
    ]
  ];
}

function rasterConfiguration(view) {
  const rgb = {natural:[3,2,1],false:[7,3,2],moisture:[9,7,3]};
  if (rgb[view]) {
    return {
      bands:rgb[view], normalize:true,
      style:{color:["color",["*",["band",1],255],["*",["band",2],255],["*",["band",3],255],1]}
    };
  }
  if (view === "ndvi") {
    const value = ["/",["-",["band",1],["band",2]],["+",["band",1],["band",2]]];
    return {bands:[7,3,11],normalize:false,style:{color:indexColor(value,3)}};
  }
  if (view === "ndre") {
    const value = ["/",["-",["band",1],["band",2]],["+",["band",1],["band",2]]];
    return {bands:[8,4,11],normalize:false,style:{color:indexColor(value,3)}};
  }
  if (view === "ndmi") {
    const value = ["/",["-",["band",1],["band",2]],["+",["band",1],["band",2]]];
    return {bands:[7,9,11],normalize:false,style:{color:indexColor(value,3)}};
  }
  const numerator = ["*",2.5,["-",["band",1],["band",2]]];
  const denominator = ["+",["band",1],["*",6,["band",2]],["*",-7.5,["band",3]],10000];
  return {bands:[7,3,1,11],normalize:false,style:{color:indexColor(["/",numerator,denominator],4)}};
}

function renderMapKey() {
  const labels = {boundary:"Experiment boundary (Orchards + ROI)",roi:"ROI",orchard:"Orchards extent",site:"Site point"};
  const items = site.vectors.map((asset) => {
    const item=document.createElement("span"),swatch=document.createElement("i");
    swatch.className=asset.role;
    item.append(swatch,labels[asset.role]);
    return item;
  });
  const indices=[nodes.viewLeft.value,nodes.viewRight.value].filter((view,position,all)=>INDEX_INFO[view]&&all.indexOf(view)===position);
  indices.forEach((view)=>{const item=document.createElement("span"),swatch=document.createElement("i");swatch.className="index-ramp";item.append(swatch,`${INDEX_INFO[view].label} · −1 to 1 · obscured transparent`);items.unshift(item);});
  nodes.mapKey.replaceChildren(...items);
}

function createRaster(acquisition, view, slot) {
  const key=cacheKey(acquisition,view,slot);
  if(rasterCache.has(key))return rasterCache.get(key);
  const href=acquisition.quicklooks?.[view];
  if(!href)throw new Error("Display quicklook missing. Rebuild the Sentinel-2 explorer manifest.");
  const extent=ol.proj.transformExtent(acquisition.raster_bbox,"EPSG:4326","EPSG:3857");
  const source=new ol.ImageStatic({url:href,imageExtent:extent,projection:"EPSG:3857",interpolate:true});
  const layer=new ol.ImageLayer({source,opacity:.98});
  layer.on("prerender",(event)=>{
    const context=event.context;
    context.save();
    if(!roiClipCoordinates?.length)return;
    context.beginPath();
    roiClipCoordinates.forEach((coordinate,coordinateIndex)=>{
      const renderPixel=ol.render.getRenderPixel(event,map.getPixelFromCoordinate(coordinate));
      if(coordinateIndex===0)context.moveTo(renderPixel[0],renderPixel[1]);
      else context.lineTo(renderPixel[0],renderPixel[1]);
    });
    context.closePath();
    context.clip();
  });
  layer.on("postrender",(event)=>event.context.restore());
  layer.setZIndex(1);
  return remember(rasterCache,key,{source,layer},MAX_RASTER_CACHE);
}

function prefetchUrl(key) {
  if(prefetchCache.has(key))return;
  const request=fetch(key,{cache:"force-cache"}).then((response)=>{
    if(!response.ok)throw new Error(`Prefetch failed (${response.status})`);
    return response.arrayBuffer();
  }).catch(()=>null);
  remember(prefetchCache,key,request,MAX_PREFETCH_CACHE);
}

function comparisonViews() {
  return [nodes.viewLeft.value,nodes.viewRight.value];
}

function viewLabel(view) {
  return {natural:"Natural colour",false:"Vegetation false colour",moisture:"Moisture false colour",ndvi:"NDVI",ndre:"NDRE",ndmi:"NDMI",evi:"EVI"}[view]||view;
}

function updateSwipe(position = swipePosition) {
  if(!roiExtent||rasterLayers.length<2)return;
  swipePosition=Math.max(0,Math.min(100,Number(position)));
  const cut=roiExtent[0]+(roiExtent[2]-roiExtent[0])*(swipePosition/100);
  rasterLayers[1].setExtent([roiExtent[0],roiExtent[1],cut,roiExtent[3]]);
  nodes.swipeDivider.style.left=`${swipePosition}%`;
  nodes.swipeDivider.setAttribute("aria-valuenow",String(Math.round(swipePosition)));
  nodes.swipeLeftLabel.textContent=viewLabel(nodes.viewLeft.value);
  nodes.swipeRightLabel.textContent=viewLabel(nodes.viewRight.value);
  map.render();
}

function moveSwipeFromPointer(event) {
  const bounds=nodes.map.getBoundingClientRect();
  updateSwipe(((event.clientX-bounds.left)/bounds.width)*100);
}

function initSwipeHandle() {
  nodes.swipeDivider.addEventListener("pointerdown",(event)=>{
    swipeDragging=true;
    nodes.swipeDivider.classList.add("dragging");
    nodes.swipeDivider.setPointerCapture(event.pointerId);
    moveSwipeFromPointer(event);
    event.preventDefault();
  });
  nodes.swipeDivider.addEventListener("pointermove",(event)=>{if(swipeDragging)moveSwipeFromPointer(event);});
  const stop=(event)=>{
    if(!swipeDragging)return;
    swipeDragging=false;
    nodes.swipeDivider.classList.remove("dragging");
    if(nodes.swipeDivider.hasPointerCapture(event.pointerId))nodes.swipeDivider.releasePointerCapture(event.pointerId);
  };
  nodes.swipeDivider.addEventListener("pointerup",stop);
  nodes.swipeDivider.addEventListener("pointercancel",stop);
  nodes.swipeDivider.addEventListener("keydown",(event)=>{
    if(event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;
    updateSwipe(swipePosition+(event.key==="ArrowRight"?2:-2));
    event.preventDefault();
  });
}

function prefetchNeighbors() {
  if(filtered.length<2)return;
  comparisonViews().forEach((view)=>{
    const next=filtered[index+1]?.quicklooks?.[view],previous=filtered[index-1]?.quicklooks?.[view];
    if(next)prefetchUrl(next);
    if(previous)prefetchUrl(previous);
    const current=filtered[index]?.quicklooks?.[view];
    if(current)prefetchUrl(current);
  });
}

async function showRaster(acquisition) {
  const requestId=++rasterRequestId;
  nodes.mapStatus.hidden = false;
  nodes.mapStatus.textContent = `Loading fast display · ${acquisition.date}`;
  nodes.lens.hidden = true;
  pixelReader = null;
  lensToken += 1;
  rasterLayers.forEach((layer)=>map.removeLayer(layer));
  const [leftView,rightView]=comparisonViews();
  const right=createRaster(acquisition,rightView,"right");
  const left=createRaster(acquisition,leftView,"left");
  rasterLayers=[right.layer,left.layer];
  right.layer.setZIndex(1); left.layer.setZIndex(2);
  map.getLayers().insertAt(0,right.layer);
  map.getLayers().insertAt(1,left.layer);
  updateSwipe();
  renderMapKey();
  let loadedCount=0;
  const loaded=()=>{loadedCount+=1;if(requestId===rasterRequestId&&loadedCount>=2){nodes.mapStatus.hidden=true;prefetchNeighbors();}};
  [right.source,left.source].forEach((source)=>{source.once("imageloadend",loaded);source.once("imageloaderror",()=>{if(requestId===rasterRequestId){nodes.mapStatus.hidden=false;nodes.mapStatus.textContent="A comparison quicklook could not be loaded.";}});});
  setTimeout(loaded,1200);
  setTimeout(loaded,1200);
}

function metadataRows(acquisition) {
  const p = acquisition.properties || {};
  const s = acquisition.statistics || {};
  return [
    ["Acquisition", acquisition.datetime.replace("T", " ")], ["Sensor", p.Sensor || "Sentinel-2 (metadata unavailable)"],
    ["Solar azimuth", p["Solar Azimuth"] ? `${nice(p["Solar Azimuth"],2)}°` : "Not available"], ["Solar zenith", p["Solar Zenith"] ? `${nice(p["Solar Zenith"],2)}°` : "Not available"],
    ["View zenith", p.incident_zenith ? `${nice(p.incident_zenith,2)}°` : "Not available"], ["View azimuth", p.incident_azimuth ? `${nice(p.incident_azimuth,2)}°` : "Not available"],
    ["Cloud SCL", `${nice(s.cloud_percent,2)}%`], ["Cloud shadow", `${nice(s.shadow_percent,2)}%`],
    ["Snow / ice", `${nice(s.snow_ice_percent,2)}%`], ["Usable pixels", Number.isFinite(s.clear_pixels) ? s.clear_pixels.toLocaleString() : "Not available"],
    ["Resolution", "10 m"], ["Raster size", fmtBytes(acquisition.bytes)], ["Bands", "B2–B8A, B11, B12, SCL"]
  ];
}

function renderIndexSummary(acquisition) {
  const values = acquisition.statistics?.indices || {};
  nodes.indices.replaceChildren(...Object.entries(INDEX_INFO).flatMap(([id, info]) => {
    const wrapper=document.createElement("div"),dt=document.createElement("dt"),dd=document.createElement("dd");
    dt.textContent=info.label;
    dt.title=info.formula;
    dd.textContent=nice(values[id],4);
    wrapper.append(dt,dd);
    return [wrapper];
  }));
}

function renderMetadata(acquisition) {
  nodes.metadata.replaceChildren(...metadataRows(acquisition).flatMap(([key,value]) => {
    const dt=document.createElement("dt"),dd=document.createElement("dd");
    dt.textContent=key; dd.textContent=value; return [dt,dd];
  }));
  renderIndexSummary(acquisition);
  nodes.sceneTitle.textContent = acquisition.date;
  nodes.file.href = acquisition.href;
  nodes.file.title = acquisition.filename;
  nodes.date.textContent = acquisition.date;
  nodes.sensor.textContent = acquisition.properties?.Sensor || "Sentinel-2 MSI";
  nodes.quality.textContent = `${nice(acquisition.statistics?.obscured_percent,2)}% obscured`;
  nodes.output.textContent = `${index + 1} / ${filtered.length} · ${acquisition.date}`;
  const irradiance = IRRADIANCE_BANDS.map((band) => acquisition.properties?.[`Solar_irradiance_${band}`]).map(Number);
  if (irradiance.every(Number.isFinite)) renderIrradiance(irradiance);
  else nodes.spectrum.innerHTML = '<text class="s2-chart-label" x="220" y="95" text-anchor="middle">Solar irradiance metadata are not available for this site.</text>';
}

function renderSeason() {
  const width=1200,height=150,pad=24;
  const values=filtered.map((item)=>Number(item.properties?.["Solar Zenith"])).filter(Number.isFinite);
  const min=Math.min(...values,0),max=Math.max(...values,90);
  const start=Date.parse(`${filtered[0].date}T00:00:00Z`),end=Date.parse(`${filtered.at(-1).date}T00:00:00Z`),span=Math.max(end-start,86400000);
  const x=(item)=>((Date.parse(`${item.date}T00:00:00Z`)-start)/span)*width;
  const y=(value)=>height-pad-((value-min)/Math.max(max-min,1))*(height-pad*2);
  const lines=[25,50,75,100,125].map((yy)=>`<line class="s2-chart-grid" x1="0" y1="${yy}" x2="${width}" y2="${yy}"/>`).join("");
  const points=filtered.map((item)=>Number.isFinite(Number(item.properties?.["Solar Zenith"]))?`${x(item)},${y(Number(item.properties["Solar Zenith"]))}`:null).filter(Boolean).join(" ");
  const seasonLines=seasonDates(start,end).map(({date})=>`<line class="s2-chart-season" x1="${((date-start)/span)*width}" y1="0" x2="${((date-start)/span)*width}" y2="${height}"/>`).join("");
  nodes.season.innerHTML=`${lines}${seasonLines}<polyline class="s2-chart-line" points="${points}"/><line class="s2-chart-current" x1="${x(filtered[index])}" y1="0" x2="${x(filtered[index])}" y2="${height}"/><text class="s2-chart-label" x="8" y="18">Solar zenith</text>`;
}

function seasonDates(start,end) {
  const definitions=[[2,20,"Spring","spring"],[5,21,"Summer","summer"],[8,22,"Autumn","autumn"],[11,21,"Winter","winter"]];
  const startYear=new Date(start).getUTCFullYear(),endYear=new Date(end).getUTCFullYear(),dates=[];
  for(let year=startYear;year<=endYear;year+=1)definitions.forEach(([month,day,label,className])=>{const date=Date.UTC(year,month,day);if(date>=start&&date<=end)dates.push({date,label,className,year});});
  return dates;
}

function renderObservationMarks() {
  if(!filtered.length){nodes.observations.querySelectorAll(".s2-observation-mark").forEach((mark)=>mark.remove());nodes.seasonBoundaries.replaceChildren();return;}
  const start=Date.parse(`${filtered[0].date}T00:00:00Z`),end=Date.parse(`${filtered.at(-1).date}T00:00:00Z`),span=Math.max(end-start,86400000);
  nodes.observations.querySelectorAll(".s2-observation-mark").forEach((mark)=>mark.remove());
  nodes.observations.append(...filtered.map((acquisition,acquisitionIndex)=>{
    const mark=document.createElement("button");
    mark.type="button";
    mark.className=`s2-observation-mark${acquisitionIndex===index?" active":""}`;
    mark.style.left=`${((Date.parse(`${acquisition.date}T00:00:00Z`)-start)/span)*100}%`;
    mark.title=`Recorded ${acquisition.datetime.replace("T"," ")} · ${nice(acquisition.statistics?.obscured_percent,2)}% obscured`;
    mark.setAttribute("aria-label",mark.title);
    mark.addEventListener("click",()=>selectAcquisition(acquisitionIndex));
    return mark;
  }));
  renderSeasonBoundaries(start,end,span);
}

function renderSeasonBoundaries(start,end,span) {
  const items=[];
  seasonDates(start,end).forEach(({date,label,className,year})=>{
      const line=document.createElement("div"),caption=document.createElement("span");
      line.className=`s2-season-boundary ${className}`;
      line.style.left=`${((date-start)/span)*100}%`;
      caption.textContent=nodes.year.value==="all"?`${label} ${year}`:label;
      line.append(caption);items.push(line);
  });
  nodes.seasonBoundaries.replaceChildren(...items);
}

function updateActiveObservationMark() {
  const marks=nodes.observations.querySelectorAll(".s2-observation-mark");
  for(let markIndex=0;markIndex<marks.length;markIndex+=1)marks[markIndex].classList.toggle("active",markIndex===index);
}

function nearestAcquisitionIndex(timestamp) {
  let nearest=0,distance=Infinity;
  filtered.forEach((acquisition,acquisitionIndex)=>{const nextDistance=Math.abs(Date.parse(`${acquisition.date}T00:00:00Z`)-timestamp);if(nextDistance<distance){distance=nextDistance;nearest=acquisitionIndex;}});
  return nearest;
}

function renderIrradiance(values) {
  const width=440,height=190,pad=34,clean=values.slice(0,10).map(Number),max=Math.max(...clean,1);
  const x=(itemIndex)=>pad+(itemIndex/(clean.length-1))*(width-pad*2),y=(value)=>height-pad-(value/max)*(height-pad*2);
  const points=clean.map((value,itemIndex)=>`${x(itemIndex)},${y(value)}`).join(" ");
  nodes.spectrum.innerHTML=`<line class="s2-chart-grid" x1="${pad}" y1="${height-pad}" x2="${width-pad}" y2="${height-pad}"/><polyline class="s2-spectrum-line" points="${points}"/>${clean.map((value,itemIndex)=>`<circle class="s2-spectrum-dot" cx="${x(itemIndex)}" cy="${y(value)}" r="3"><title>${IRRADIANCE_BANDS[itemIndex]} · ${value.toFixed(2)} W m⁻² μm⁻¹</title></circle>`).join("")}${[0,3,6,9].map((itemIndex)=>`<text class="s2-chart-label" x="${x(itemIndex)}" y="${height-8}" text-anchor="middle">${WAVELENGTHS[itemIndex]} nm</text>`).join("")}`;
}

function activeStoryCard(acquisition) {
  nodes.story.querySelectorAll("button").forEach((button) => button.classList.toggle("active",button.dataset.href === acquisition.href));
}

async function selectAcquisition(next) {
  if (!filtered.length) return;
  index=Math.max(0,Math.min(next,filtered.length-1));
  const acquisition=filtered[index];
  nodes.slider.value=String(Date.parse(`${acquisition.date}T00:00:00Z`));
  renderMetadata(acquisition);
  renderSeason();
  updateActiveObservationMark();
  activeStoryCard(acquisition);
  await showRaster(acquisition);
}

function storyGroups() {
  const selectedYear = nodes.year.value;
  const groups = new Map();
  filtered.forEach((acquisition) => {
    const month = Number(acquisition.date.slice(5,7));
    const key = selectedYear === "all" ? acquisition.date.slice(0,4) : `Q${Math.ceil(month/3)}`;
    const label = selectedYear === "all" ? key : `${selectedYear} · ${key}`;
    if (!groups.has(key)) groups.set(key,{label,items:[]});
    groups.get(key).items.push(acquisition);
  });
  return [...groups.values()];
}

function renderStory() {
  storyChapters = storyGroups().map((group) => ({
    label:group.label,
    acquisition:[...group.items].sort((a,b)=>(a.statistics?.obscured_percent ?? 101)-(b.statistics?.obscured_percent ?? 101) || a.date.localeCompare(b.date))[0]
  }));
  nodes.story.replaceChildren(...storyChapters.map((chapter) => {
    const button=document.createElement("button"),span=document.createElement("span"),strong=document.createElement("strong"),small=document.createElement("small");
    span.textContent=chapter.label;
    strong.textContent=chapter.acquisition.date;
    const stats=chapter.acquisition.statistics;
    small.textContent=`Least obscured: ${nice(stats?.obscured_percent,2)}% · NDVI ${nice(stats?.indices?.ndvi,4)} · NDMI ${nice(stats?.indices?.ndmi,4)}`;
    button.dataset.href=chapter.acquisition.href;
    button.append(span,strong,small);
    button.addEventListener("click",()=>selectAcquisition(filtered.findIndex((item)=>item.href===chapter.acquisition.href)));
    return button;
  }));
}

function applyFilters() {
  stopPlayback(); stopStory();
  const year=nodes.year.value,threshold=Number(nodes.cloud.value);
  filtered=site.acquisitions.filter((item)=>(year==="all"||item.date.startsWith(year)) && Number(item.statistics?.obscured_percent)<=threshold);
  nodes.count.textContent=`${filtered.length} / ${site.acquisitions.length} scenes`;
  nodes.range.textContent=filtered.length?`${filtered[0].date} – ${filtered.at(-1).date}`:"No scenes pass this filter";
  nodes.slider.disabled=!filtered.length;
  if(filtered.length){nodes.slider.min=String(Date.parse(`${filtered[0].date}T00:00:00Z`));nodes.slider.max=String(Date.parse(`${filtered.at(-1).date}T00:00:00Z`));nodes.slider.step="86400000";}
  nodes.ticks.innerHTML=`<span>${filtered[0]?.date||"—"}</span><span>${filtered.at(-1)?.date||"—"}</span>`;
  renderStory();
  if (!filtered.length) {
    rasterLayers.forEach((layer)=>map.removeLayer(layer));
    rasterLayers=[]; nodes.mapStatus.hidden=false; nodes.mapStatus.textContent="No acquisitions pass the selected SCL quality filter.";
    nodes.date.textContent="No scene"; nodes.quality.textContent="—"; nodes.story.replaceChildren();
    return;
  }
  index=filtered.length-1;
  renderObservationMarks();
  selectAcquisition(index);
}

function selectSite(id) {
  stopPlayback(); stopStory();
  site=manifest.sites.find((item)=>item.id===id);
  rasterCache.clear(); prefetchCache.clear();
  nodes.place.textContent=site.label; nodes.country.textContent=site.country; nodes.crop.textContent=site.crop; nodes.folder.textContent=site.series_folder;
  const years=[...new Set(site.acquisitions.map((item)=>item.date.slice(0,4)))];
  nodes.year.replaceChildren(option("all","All years"),...years.map((year)=>option(year)));
  nodes.year.value="all";
  setVectors();
  applyFilters();
}

async function createPixelReader(acquisition) {
  const token=++lensToken;
  geotiffModulePromise ||= import(GEOTIFF);
  proj4Promise ||= import(PROJ4).then((module)=>module.default);
  const [geotiff,proj4,response]=await Promise.all([geotiffModulePromise,proj4Promise,fetch(acquisition.href)]);
  if (!response.ok) throw new Error(`Pixel source request failed (${response.status})`);
  const tiff=await geotiff.fromArrayBuffer(await response.arrayBuffer());
  const image=await tiff.getImage();
  if (token!==lensToken) return null;
  const geoKeys=image.getGeoKeys(),epsg=geoKeys.ProjectedCSTypeGeoKey||geoKeys.GeographicTypeGeoKey;
  const bbox=image.getBoundingBox(),width=image.getWidth(),height=image.getHeight();
  let projection="WGS84";
  if (epsg>=32601&&epsg<=32660) projection=`+proj=utm +zone=${epsg-32600} +datum=WGS84 +units=m +no_defs`;
  else if (epsg>=32701&&epsg<=32760) projection=`+proj=utm +zone=${epsg-32700} +south +datum=WGS84 +units=m +no_defs`;
  return async (lonLat) => {
    const coordinate=projection==="WGS84"?lonLat:proj4("WGS84",projection,lonLat);
    const column=Math.floor((coordinate[0]-bbox[0])/(bbox[2]-bbox[0])*width);
    const row=Math.floor((bbox[3]-coordinate[1])/(bbox[3]-bbox[1])*height);
    if(column<0||row<0||column>=width||row>=height)return null;
    const values=await image.readRasters({window:[column,row,column+1,row+1],samples:[0,1,2,3,4,5,6,7,8,9,10],interleave:true});
    return Array.from(values);
  };
}

function pixelIndices(values) {
  const [blue,,red,redEdge,,,nir,nirNarrow,swir]=values.map((value)=>value*REFLECTANCE_SCALE);
  const ratio=(first,second)=>first+second===0?null:(first-second)/(first+second);
  const eviDenominator=nir+6*red-7.5*blue+1;
  return {ndvi:ratio(nir,red),ndre:ratio(nirNarrow,redEdge),ndmi:ratio(nir,swir),evi:eviDenominator===0?null:2.5*(nir-red)/eviDenominator};
}

function renderLens(pixel,event,acquisition) {
  const scl=Math.round(pixel[10]),indices=pixelIndices(pixel);
  const rows=[
    ["B2",(pixel[0]*REFLECTANCE_SCALE).toFixed(4)],["B3",(pixel[1]*REFLECTANCE_SCALE).toFixed(4)],
    ["B4",(pixel[2]*REFLECTANCE_SCALE).toFixed(4)],["B8",(pixel[6]*REFLECTANCE_SCALE).toFixed(4)],
    ["B8A",(pixel[7]*REFLECTANCE_SCALE).toFixed(4)],["B11",(pixel[8]*REFLECTANCE_SCALE).toFixed(4)],
    ["NDVI",nice(indices.ndvi,4)],["NDRE",nice(indices.ndre,4)],["NDMI",nice(indices.ndmi,4)],["EVI",nice(indices.evi,4)],
    ["SCL",`${scl} · ${SCL_LABELS[scl]||"Unknown"}`]
  ];
  nodes.lensValues.replaceChildren(...rows.flatMap(([key,value],rowIndex)=>{
    const dt=document.createElement("dt"),dd=document.createElement("dd");dt.textContent=key;dd.textContent=value;if(rowIndex===rows.length-1){dt.className="wide";dd.className="wide";}return[dt,dd];
  }));
  nodes.lensDate.textContent=`${acquisition.date} · source pixel${OBSCURED_CLASSES.has(scl)?" · obscured SCL":""}`;
  const panel=nodes.map.getBoundingClientRect(),left=Math.min(event.pixel[0]+24,panel.width-270),top=Math.min(event.pixel[1]-20,panel.height-330);
  nodes.lens.style.left=`${Math.max(16,left)}px`; nodes.lens.style.top=`${Math.max(16,top)}px`; nodes.lens.hidden=false;
}

function scheduleLens(event) {
  clearTimeout(lensTimer);
  if(event.dragging||!filtered.length)return;
  const acquisition=filtered[index],eventSnapshot={coordinate:[...event.coordinate],pixel:[...event.pixel]};
  lensTimer=setTimeout(async()=>{
    try {
      nodes.lens.hidden=false; nodes.lens.style.left=`${Math.min(eventSnapshot.pixel[0]+24,nodes.map.clientWidth-270)}px`; nodes.lens.style.top=`${Math.max(16,eventSnapshot.pixel[1]-20)}px`;
      nodes.lensDate.textContent="Reading source GeoTIFF pixel…"; nodes.lensValues.replaceChildren();
      pixelReader ||= await createPixelReader(acquisition);
      if(!pixelReader)return;
      const pixel=await pixelReader(ol.proj.toLonLat(eventSnapshot.coordinate));
      if(pixel)renderLens(pixel,eventSnapshot,acquisition);else nodes.lens.hidden=true;
    } catch(error) { nodes.lensDate.textContent=`Pixel read unavailable: ${error.message}`; }
  },140);
}

async function init() {
  try {
    const response=await fetch(MANIFEST,{cache:"no-store"});
    if(!response.ok)throw new Error(`Manifest request failed (${response.status})`);
    manifest=await response.json();
    nodes.site.replaceChildren(...manifest.sites.map((item)=>option(item.id,item.label)));
    nodes.generated.textContent=`Index generated ${new Date(manifest.generated_at).toLocaleString()} · ${manifest.sites.reduce((sum,item)=>sum+item.acquisitions.length,0)} measured scenes`;
    await initMap();
    selectSite(manifest.sites[0].id);
    nodes.site.addEventListener("change",()=>selectSite(nodes.site.value));
    nodes.year.addEventListener("change",applyFilters);
    nodes.cloud.addEventListener("change",applyFilters);
    nodes.viewLeft.addEventListener("change",()=>selectAcquisition(index));
    nodes.viewRight.addEventListener("change",()=>selectAcquisition(index));
    initSwipeHandle();
    nodes.slider.addEventListener("input",()=>{
      const next=nearestAcquisitionIndex(Number(nodes.slider.value));
      const acquisition=filtered[next];
      if(!acquisition)return;
      nodes.output.textContent=`${next+1} / ${filtered.length} · ${acquisition.date}`;
      clearTimeout(sliderTimer);
      sliderTimer=setTimeout(()=>selectAcquisition(next),180);
    });
    nodes.slider.addEventListener("change",()=>{clearTimeout(sliderTimer);selectAcquisition(nearestAcquisitionIndex(Number(nodes.slider.value)));});
    nodes.prev.addEventListener("click",()=>selectAcquisition(index-1));
    nodes.next.addEventListener("click",()=>selectAcquisition(index+1));
    nodes.play.addEventListener("click",()=>{
      if(playbackTimer){stopPlayback();return;} if(!filtered.length)return;
      stopStory(); nodes.play.textContent="Pause"; nodes.play.classList.add("active");
      playbackTimer=setInterval(()=>selectAcquisition((index+1)%filtered.length),1800);
    });
    nodes.storyPlay.addEventListener("click",()=>{
      if(storyTimer){stopStory();return;} if(!storyChapters.length)return;
      stopPlayback(); nodes.storyPlay.textContent="Pause story"; nodes.storyPlay.classList.add("active");
      let chapterIndex=0;
      const show=()=>{const chapter=storyChapters[chapterIndex%storyChapters.length];selectAcquisition(filtered.findIndex((item)=>item.href===chapter.acquisition.href));chapterIndex+=1;};
      show(); storyTimer=setInterval(show,3200);
    });
    app.setAttribute("aria-busy","false");
  } catch(error) {
    nodes.fatal.hidden=false;
    nodes.fatal.textContent=`Explorer initialization failed: ${error.message}. Run scripts/build_sentinel2_explorer.py and serve the repository over HTTP.`;
    nodes.mapStatus.textContent="Renderer unavailable";
    app.setAttribute("aria-busy","false");
  }
}

init();
