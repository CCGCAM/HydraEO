#!/usr/bin/env python3
"""Build the lightweight browser index used by explorer.html.

The source archive remains authoritative. This script only creates GeoJSON copies of
the shapefiles and a compact JSON index; it does not alter or duplicate the TIFFs.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.warp import transform_bounds


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "visualization-data/data-to-import/HYDRA-EO-data/Sentinel-2"
OUTPUT = ROOT / "visualization-data/derived/sentinel2-explorer"

SITES = {
    "Chaparrillo": {
        "country": "Spain",
        "crop": "Olive and pistachio orchards",
        "series": "Series/Chaparrillo",
        "orchard": "Orchards/Chaparrilo_site.shp",
        "roi": "ROIs/Chaparrilo_site.shp",
        "point": "GeoJSON/Olives_orchards.geojson",
        "properties": "Chaparrillo",
    },
    "Lelystad": {
        "country": "Netherlands",
        "crop": "Experimental agricultural site",
        "series": "SeriesTiFFs-Lelystad",
        "orchard": "Orchards/Lelystad_site.shp",
        "roi": "ROIs/Lelystad_site.shp",
        "properties": "Lelystad",
    },
    "NL-Loobos": {
        "country": "Netherlands",
        "crop": "Forest research site",
        "series": "Series/NL-Loobos",
        "roi": "ROIs/NL-Loobos.shp",
    },
    "Alfalfa_site1": {
        "country": "Italy",
        "crop": "Irrigated alfalfa",
        "series": "SeriesTiFFs_Alfalfa_site1",
        "orchard": "Orchards/Alfalfa_site1.shp",
        "roi": "ROIs/Alfalfa_site1.shp",
        "point": "GeoJSON/Alfalfa_sites_1.geojson",
        "properties": "Alfalfa_site1",
    },
    "Alfalfa_site2": {
        "country": "Italy",
        "crop": "Irrigated alfalfa",
        "series": "SeriesTiFFs_Alfalfa_site2",
        "orchard": "Orchards/Alfalfa_site2.shp",
        "roi": "ROIs/Alfalfa_site2.shp",
        "point": "GeoJSON/Alfalfa_sites_2.geojson",
        "properties": "Alfalfa_site2",
    },
}

DATE_RE = re.compile(r"(20\d{2}-\d{2}-\d{2})(?:[ _](\d{2})[_:](\d{2})[_:](\d{2}))?")
OBSCURED_SCL = (3, 8, 9, 10, 11)
STATISTICS_VERSION = 2
QUICKLOOK_VERSION = 1
QUICKLOOK_DIR = OUTPUT / "quicklooks"
REFLECTANCE_SCALE = 0.0001


def web_path(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def read_properties(site_key: str | None) -> dict[str, list[dict[str, str]]]:
    rows: dict[str, list[dict[str, str]]] = {}
    if not site_key:
        return rows
    for path in sorted((SOURCE / "properties").glob(f"Sentinel-*-properties_{site_key}.csv")):
        with path.open(newline="", encoding="utf-8-sig") as handle:
            for row in csv.DictReader(handle):
                date = row.get("Date", "")[:10]
                if date:
                    rows.setdefault(date, []).append(row)
    return rows


def convert_shape(site_id: str, role: str, relative: str) -> str:
    source = SOURCE / relative
    target = OUTPUT / f"{site_id}-{role}.geojson"
    subprocess.run(
        ["ogr2ogr", "-f", "GeoJSON", "-t_srs", "EPSG:4326", str(target), str(source)],
        check=True,
        capture_output=True,
        text=True,
    )
    return web_path(target)


def geometry_bbox(paths: list[Path]) -> list[float] | None:
    points: list[tuple[float, float]] = []

    def walk(value):
        if isinstance(value, list) and len(value) >= 2 and all(isinstance(v, (int, float)) for v in value[:2]):
            points.append((float(value[0]), float(value[1])))
        elif isinstance(value, list):
            for item in value:
                walk(item)

    for path in paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        for feature in data.get("features", []):
            walk(feature.get("geometry", {}).get("coordinates", []))
    if not points:
        return None
    xs, ys = zip(*points)
    return [min(xs), min(ys), max(xs), max(ys)]


def geometry_signature(path: Path) -> str:
    data = json.loads(path.read_text(encoding="utf-8"))
    geometries = [feature.get("geometry") for feature in data.get("features", [])]
    return json.dumps(geometries, sort_keys=True, separators=(",", ":"))


def acquisition_stats(path: Path) -> dict[str, object]:
    with rasterio.open(path) as source:
        blue, red, red_edge, nir, nir_narrow, swir, scl = source.read((1, 3, 4, 7, 8, 9, 11))

    valid_scl = scl != 0
    total = int(valid_scl.sum())
    scl_counts = {str(code): int(((scl == code) & valid_scl).sum()) for code in range(1, 12)}
    obscured = valid_scl & np.isin(scl, OBSCURED_SCL)
    clear = valid_scl & (scl != 1) & ~obscured & (blue > 0) & (red > 0) & (red_edge > 0) & (nir > 0) & (nir_narrow > 0) & (swir > 0)

    def normalized_difference(first: np.ndarray, second: np.ndarray) -> np.ndarray:
        denominator = first.astype(np.float32) + second.astype(np.float32)
        return np.divide(first.astype(np.float32) - second.astype(np.float32), denominator, out=np.full(first.shape, np.nan, dtype=np.float32), where=denominator != 0)

    def median(values: np.ndarray) -> float | None:
        selected = values[clear]
        selected = selected[np.isfinite(selected)]
        return round(float(np.median(selected)), 4) if selected.size else None

    reflectance_blue = blue.astype(np.float32) * 0.0001
    reflectance_red = red.astype(np.float32) * 0.0001
    reflectance_nir = nir.astype(np.float32) * 0.0001
    evi_denominator = reflectance_nir + 6 * reflectance_red - 7.5 * reflectance_blue + 1
    evi = np.divide(2.5 * (reflectance_nir - reflectance_red), evi_denominator, out=np.full(blue.shape, np.nan, dtype=np.float32), where=evi_denominator != 0)

    return {
        "valid_pixels": total,
        "clear_pixels": int(clear.sum()),
        "obscured_percent": round(float(obscured.sum() * 100 / total), 2) if total else None,
        "cloud_percent": round(float(sum(scl_counts[str(code)] for code in (8, 9, 10)) * 100 / total), 2) if total else None,
        "shadow_percent": round(float(scl_counts["3"] * 100 / total), 2) if total else None,
        "snow_ice_percent": round(float(scl_counts["11"] * 100 / total), 2) if total else None,
        "scl_counts": scl_counts,
        "indices": {
            "ndvi": median(normalized_difference(nir, red)),
            "ndre": median(normalized_difference(nir_narrow, red_edge)),
            "ndmi": median(normalized_difference(nir, swir)),
            "evi": median(evi),
        },
    }


def scaled_rgb(red: np.ndarray, green: np.ndarray, blue: np.ndarray) -> np.ndarray:
    stack = np.stack((red, green, blue)).astype(np.float32)
    stack = np.clip((stack - 200) / (4000 - 200), 0, 1)
    return np.moveaxis(np.round(stack * 255).astype(np.uint8), 0, 2)


def index_rgba(values: np.ndarray, scl: np.ndarray) -> np.ndarray:
    stops = np.array([-1, -0.2, 0, 0.2, 0.5, 1], dtype=np.float32)
    colors = np.array([
        [84, 39, 136], [178, 171, 210], [247, 247, 212],
        [241, 199, 91], [77, 172, 107], [6, 75, 44],
    ], dtype=np.float32)
    flat = np.nan_to_num(np.clip(values, -1, 1), nan=0.0).ravel()
    rgb = np.stack([np.interp(flat, stops, colors[:, channel]) for channel in range(3)], axis=1)
    rgb = np.round(rgb).astype(np.uint8).reshape((*values.shape, 3))
    alpha = np.where(np.isfinite(values) & ~np.isin(scl, (0, 1, 3, 8, 9, 10, 11)), 255, 0).astype(np.uint8)
    return np.dstack((rgb, alpha))


def build_quicklooks(path: Path) -> tuple[dict[str, str], list[float]]:
    QUICKLOOK_DIR.mkdir(parents=True, exist_ok=True)
    identity = f"v{QUICKLOOK_VERSION}:{web_path(path)}:{path.stat().st_size}:{path.stat().st_mtime_ns}"
    digest = hashlib.sha1(identity.encode("utf-8")).hexdigest()[:16]
    targets = {view: QUICKLOOK_DIR / f"{digest}-{view}.webp" for view in ("natural", "false", "moisture", "ndvi", "ndre", "ndmi", "evi")}
    with rasterio.open(path) as source:
        bbox = list(transform_bounds(source.crs, "EPSG:4326", *source.bounds, densify_pts=21))
        if not all(target.exists() for target in targets.values()):
            blue, green, red, red_edge, nir, nir_narrow, swir, scl = source.read((1, 2, 3, 4, 7, 8, 9, 11))
            denominator = lambda first, second: first.astype(np.float32) + second.astype(np.float32)
            ratio = lambda first, second: np.divide(first.astype(np.float32) - second.astype(np.float32), denominator(first, second), out=np.full(first.shape, np.nan, dtype=np.float32), where=denominator(first, second) != 0)
            reflectance_blue, reflectance_red, reflectance_nir = blue * REFLECTANCE_SCALE, red * REFLECTANCE_SCALE, nir * REFLECTANCE_SCALE
            evi_denominator = reflectance_nir + 6 * reflectance_red - 7.5 * reflectance_blue + 1
            evi = np.divide(2.5 * (reflectance_nir - reflectance_red), evi_denominator, out=np.full(blue.shape, np.nan, dtype=np.float32), where=evi_denominator != 0)
            images = {
                "natural": Image.fromarray(scaled_rgb(red, green, blue), "RGB"),
                "false": Image.fromarray(scaled_rgb(nir, red, green), "RGB"),
                "moisture": Image.fromarray(scaled_rgb(swir, nir, red), "RGB"),
                "ndvi": Image.fromarray(index_rgba(ratio(nir, red), scl), "RGBA"),
                "ndre": Image.fromarray(index_rgba(ratio(nir_narrow, red_edge), scl), "RGBA"),
                "ndmi": Image.fromarray(index_rgba(ratio(nir, swir), scl), "RGBA"),
                "evi": Image.fromarray(index_rgba(evi, scl), "RGBA"),
            }
            for view, image in images.items():
                image.save(targets[view], "WEBP", quality=86, method=4, exact=True)
    return {view: web_path(target) for view, target in targets.items()}, bbox


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    cache_path = OUTPUT / "statistics-cache.json"
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    next_cache = {}
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": web_path(SOURCE),
        "sensor": "Sentinel-2 MSI surface reflectance",
        "bands": ["B2", "B3", "B4", "B5", "B6", "B7", "B8", "B8A", "B11", "B12", "SCL"],
        "sites": [],
    }

    for site_id, config in SITES.items():
        properties = read_properties(config.get("properties"))
        acquisitions = []
        for path in sorted((SOURCE / config["series"]).glob("*.tif")):
            match = DATE_RE.search(path.name)
            if not match:
                continue
            date = match.group(1)
            time = ":".join(match.groups()[1:]) if match.group(2) else None
            metadata = properties.get(date, [])
            cache_key = web_path(path)
            fingerprint = f"v{STATISTICS_VERSION}:{path.stat().st_size}:{path.stat().st_mtime_ns}"
            cached = cache.get(cache_key)
            if cached and cached.get("fingerprint") == fingerprint:
                statistics = cached["statistics"]
            else:
                statistics = acquisition_stats(path)
            next_cache[cache_key] = {"fingerprint": fingerprint, "statistics": statistics}
            quicklooks, raster_bbox = build_quicklooks(path)
            acquisitions.append({
                "date": date,
                "time": time,
                "datetime": f"{date}T{time}" if time else date,
                "href": web_path(path),
                "filename": path.name,
                "bytes": path.stat().st_size,
                "properties": metadata[0] if metadata else None,
                "statistics": statistics,
                "quicklooks": quicklooks,
                "raster_bbox": raster_bbox,
            })

        vectors = []
        geometry_files = []
        converted = {}
        for role in ("orchard", "roi"):
            if config.get(role):
                href = convert_shape(site_id, role, config[role])
                converted[role] = href
                geometry_files.append(ROOT / href)
        if converted.get("orchard") and converted.get("roi") and geometry_signature(ROOT / converted["orchard"]) == geometry_signature(ROOT / converted["roi"]):
            vectors.append({
                "role": "boundary",
                "href": converted["roi"],
                "source_roles": ["orchard", "roi"],
                "note": "The source orchard and ROI polygons are geometrically identical.",
            })
        else:
            vectors.extend({"role": role, "href": href} for role, href in converted.items())
        if config.get("point"):
            vectors.append({"role": "site", "href": web_path(SOURCE / config["point"])})
            geometry_files.append(SOURCE / config["point"])

        payload["sites"].append({
            "id": site_id,
            "label": site_id.replace("_", " "),
            "country": config["country"],
            "crop": config["crop"],
            "series_folder": web_path(SOURCE / config["series"]),
            "bbox": geometry_bbox(geometry_files),
            "vectors": vectors,
            "acquisitions": acquisitions,
        })

    target = OUTPUT / "manifest.json"
    target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    cache_path.write_text(json.dumps(next_cache), encoding="utf-8")
    print(f"Wrote {target.relative_to(ROOT)} with {sum(len(s['acquisitions']) for s in payload['sites'])} acquisitions")


if __name__ == "__main__":
    main()
