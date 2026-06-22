#!/usr/bin/env python3
"""Build static browser assets for the Lelystad drone orthomosaic visualizer."""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "visualization-data/data-to-import/20260511T110230Z_Lelystad-HydraEO_ortho_202605211601.tif"
OUTPUT = ROOT / "visualization-data/derived/drone-orthomosaic"
TILE_SIZE = 256


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def run(command: list[str], *, timeout: int | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=timeout, check=True)


def require(command: str) -> str:
    path = shutil.which(command)
    if not path:
        raise SystemExit(f"ERROR: required command not found: {command}")
    return path


def gdalinfo(path: Path) -> dict:
    result = run([require("gdalinfo"), "-json", str(path)], timeout=120)
    return json.loads(result.stdout)


def bounds_from_info(info: dict) -> list[float] | None:
    corners = info.get("cornerCoordinates") or {}
    lower_left = corners.get("lowerLeft")
    upper_right = corners.get("upperRight")
    if not lower_left or not upper_right:
        return None
    return [float(lower_left[0]), float(lower_left[1]), float(upper_right[0]), float(upper_right[1])]


def translate_preview(source: Path, target: Path, width: int, driver: str = "WEBP", quality: int = 82) -> None:
    if target.exists():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    command = [
        require("gdal_translate"), "-q", "-of", driver,
        "-b", "1", "-b", "2", "-b", "3", "-b", "4",
        "-outsize", str(width), "0", "-r", "average",
    ]
    if driver == "WEBP":
        command += ["-co", f"QUALITY={quality}"]
    command += [str(source), str(target)]
    run(command, timeout=900)
    aux = target.with_suffix(target.suffix + ".aux.xml")
    aux.unlink(missing_ok=True)


def percentile(values: list[int], q: float) -> float:
    if not values:
        return 0.0
    index = min(len(values) - 1, max(0, int(round((len(values) - 1) * q))))
    return float(sorted(values)[index])


def stretch_channel(values: list[float]) -> tuple[float, float]:
    sampled = [int(max(-255, min(255, value)) + 255) for value in values[:: max(1, len(values) // 75000)]]
    low = percentile(sampled, 0.02) - 255
    high = percentile(sampled, 0.98) - 255
    if high <= low:
        high = low + 1
    return low, high


def ramp(value: float, stops: list[tuple[float, tuple[int, int, int]]]) -> tuple[int, int, int]:
    if value <= stops[0][0]:
        return stops[0][1]
    for (left_value, left_color), (right_value, right_color) in zip(stops, stops[1:]):
        if value <= right_value:
            amount = (value - left_value) / (right_value - left_value or 1)
            return tuple(round(left_color[i] + (right_color[i] - left_color[i]) * amount) for i in range(3))
    return stops[-1][1]


def make_overlay(source_png: Path, target: Path, mode: str) -> None:
    if target.exists():
        return
    Image.MAX_IMAGE_PIXELS = None
    image = Image.open(source_png).convert("RGBA")
    alpha = image.getchannel("A")
    rgb = image.convert("RGB")
    pixels = list(rgb.getdata())
    if mode == "texture":
        gray = ImageOps.grayscale(rgb)
        edges = gray.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.GaussianBlur(0.8))
        edges = ImageOps.autocontrast(edges, cutoff=1)
        colored = ImageOps.colorize(edges, black="#0b1d22", white="#f4d27a").convert("RGBA")
        colored.putalpha(alpha.point(lambda value: min(210, value)))
    else:
        if mode == "exg":
            values = [2 * g - r - b for r, g, b in pixels]
            stops = [(0, (73, 47, 112)), (0.33, (206, 205, 173)), (0.62, (86, 154, 91)), (1, (9, 84, 49))]
        elif mode == "vari":
            values = [(g - r) / max(1, g + r - b) for r, g, b in pixels]
            stops = [(0, (99, 52, 122)), (0.38, (224, 214, 156)), (0.64, (78, 148, 92)), (1, (6, 75, 45))]
        else:
            raise ValueError(mode)
        low, high = stretch_channel(values)
        mapped = [ramp(max(0, min(1, (value - low) / (high - low))), stops) for value in values]
        colored = Image.new("RGBA", image.size)
        colored.putdata([(*color, 214 if a else 0) for color, a in zip(mapped, alpha.getdata())])
    target.parent.mkdir(parents=True, exist_ok=True)
    colored.save(target, "WEBP", quality=84, method=6)


def level_dimensions(width: int, height: int, z: int, max_zoom: int, source_downsample: int) -> tuple[int, int]:
    divisor = source_downsample * (2 ** (max_zoom - z))
    return max(1, math.ceil(width / divisor)), max(1, math.ceil(height / divisor))


def tile_level(source: Path, level_dir: Path, z: int, max_zoom: int, width: int, height: int, quality: int, source_downsample: int) -> dict:
    level_width, level_height = level_dimensions(width, height, z, max_zoom, source_downsample)
    cols = math.ceil(level_width / TILE_SIZE)
    rows = math.ceil(level_height / TILE_SIZE)
    scale_x = width / level_width
    scale_y = height / level_height
    created = 0
    for tile_y in range(rows):
        for tile_x in range(cols):
            out_width = min(TILE_SIZE, level_width - tile_x * TILE_SIZE)
            out_height = min(TILE_SIZE, level_height - tile_y * TILE_SIZE)
            src_x0 = math.floor(tile_x * TILE_SIZE * scale_x)
            src_y0 = math.floor(tile_y * TILE_SIZE * scale_y)
            src_x1 = min(width, math.ceil((tile_x * TILE_SIZE + out_width) * scale_x))
            src_y1 = min(height, math.ceil((tile_y * TILE_SIZE + out_height) * scale_y))
            target = level_dir / str(tile_x) / f"{tile_y}.webp"
            if target.exists():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            run([
                require("gdal_translate"), "-q", "-of", "WEBP",
                "-b", "1", "-b", "2", "-b", "3", "-b", "4",
                "-srcwin", str(src_x0), str(src_y0), str(src_x1 - src_x0), str(src_y1 - src_y0),
                "-outsize", str(out_width), str(out_height), "-r", "average",
                "-co", f"QUALITY={quality}",
                str(source), str(target),
            ], timeout=120)
            target.with_suffix(target.suffix + ".aux.xml").unlink(missing_ok=True)
            created += 1
    return {"z": z, "width": level_width, "height": level_height, "cols": cols, "rows": rows, "created": created}


def build(source: Path, max_zoom: int | None, source_downsample: int, overlay_width: int, preview_width: int, quality: int, skip_tiles: bool) -> dict:
    info = gdalinfo(source)
    width, height = [int(value) for value in info["size"]]
    source_downsample = max(1, source_downsample)
    effective_width = math.ceil(width / source_downsample)
    effective_height = math.ceil(height / source_downsample)
    native_max_zoom = math.ceil(math.log2(max(width, height) / TILE_SIZE))
    recommended_max_zoom = max(0, math.floor(math.log2(max(effective_width, effective_height) / TILE_SIZE)))
    max_zoom = recommended_max_zoom if max_zoom is None else max_zoom
    max_zoom = max(0, min(max_zoom, recommended_max_zoom))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "tiles").mkdir(exist_ok=True)
    (OUTPUT / "overlays").mkdir(exist_ok=True)

    preview = OUTPUT / "preview.webp"
    poster = OUTPUT / "poster.webp"
    translate_preview(source, preview, preview_width)
    translate_preview(source, poster, 2600)

    with tempfile.TemporaryDirectory(prefix="hydra-drone-overlays-") as tmp:
        overlay_source = Path(tmp) / "overlay-source.png"
        translate_preview(source, overlay_source, overlay_width, driver="PNG")
        for mode in ("exg", "vari", "texture"):
            make_overlay(overlay_source, OUTPUT / "overlays" / f"{mode}.webp", mode)

    levels = []
    if not skip_tiles:
        for z in range(max_zoom + 1):
            levels.append(tile_level(source, OUTPUT / "tiles" / str(z), z, max_zoom, width, height, quality, source_downsample))
            print(f"level {z}: {levels[-1]['cols']}x{levels[-1]['rows']} tiles, created {levels[-1]['created']}")

    bbox = bounds_from_info(info)
    manifest = {
        "version": "1.0.0",
        "title": "Lelystad drone RGB orthomosaic",
        "generated_at": utc_now(),
        "source_name": source.name,
        "source_size_bytes": source.stat().st_size,
        "width": width,
        "height": height,
        "tile_size": TILE_SIZE,
        "max_zoom": max_zoom,
        "native_max_zoom": native_max_zoom,
        "source_downsample": source_downsample,
        "max_display_width": effective_width,
        "max_display_height": effective_height,
        "display_stretch_mode": "none_raw_rgb",
        "display_stretch": [],
        "tile_template": "visualization-data/derived/drone-orthomosaic/tiles/{z}/{x}/{y}.webp",
        "preview": "visualization-data/derived/drone-orthomosaic/preview.webp",
        "poster": "visualization-data/derived/drone-orthomosaic/poster.webp",
        "overlays": {
            "exg": "visualization-data/derived/drone-orthomosaic/overlays/exg.webp",
            "vari": "visualization-data/derived/drone-orthomosaic/overlays/vari.webp",
            "texture": "visualization-data/derived/drone-orthomosaic/overlays/texture.webp",
        },
        "bbox": bbox,
        "crs": "EPSG:4326",
        "pixel_size_degrees": info.get("geoTransform", [None, None, None, None, None, None])[1:6:4],
        "levels": levels or [
            {
                "z": z,
                "width": level_dimensions(width, height, z, max_zoom, source_downsample)[0],
                "height": level_dimensions(width, height, z, max_zoom, source_downsample)[1],
                "cols": math.ceil(level_dimensions(width, height, z, max_zoom, source_downsample)[0] / TILE_SIZE),
                "rows": math.ceil(level_dimensions(width, height, z, max_zoom, source_downsample)[1] / TILE_SIZE),
            }
            for z in range(max_zoom + 1)
        ],
        "hotspots": [
            {"id": "overview", "label": "Full field mosaic", "x": width * 0.5, "y": height * 0.5, "zoom": 0.9},
            {"id": "northwest", "label": "North-west crop texture", "x": width * 0.23, "y": height * 0.22, "zoom": 2.8},
            {"id": "central", "label": "Central row structure", "x": width * 0.53, "y": height * 0.46, "zoom": 3.7},
            {"id": "southeast", "label": "South-east detail", "x": width * 0.72, "y": height * 0.72, "zoom": 3.1},
        ],
        "notes": [
            "RGB orthomosaic display product. RGB-derived overlays are visual diagnostics, not NDVI or calibrated physiology.",
            f"Raw 6 GB TIFF is not loaded by the browser; the active natural-RGB tile pyramid preserves source byte values and is downsampled by {source_downsample}x for fast static delivery.",
        ],
    }
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--max-zoom", type=int, default=None, help="Tile zoom count over the downsampled product. Default is derived from --source-downsample.")
    parser.add_argument("--source-downsample", type=int, default=4, help="Power-of-two source downsample for the highest browser tile level.")
    parser.add_argument("--overlay-width", type=int, default=4096)
    parser.add_argument("--preview-width", type=int, default=1800)
    parser.add_argument("--quality", type=int, default=82)
    parser.add_argument("--skip-tiles", action="store_true")
    args = parser.parse_args()
    if not args.source.exists():
        print(f"ERROR: source not found: {args.source}", file=sys.stderr)
        return 2
    manifest = build(args.source, args.max_zoom, args.source_downsample, args.overlay_width, args.preview_width, args.quality, args.skip_tiles)
    print(f"Wrote {OUTPUT / 'manifest.json'}")
    print(f"Tile max zoom {manifest['max_zoom']} of native {manifest['native_max_zoom']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
