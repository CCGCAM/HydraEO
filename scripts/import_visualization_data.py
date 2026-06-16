#!/usr/bin/env python3
"""Safely import untrusted EO data into the static HYDRA-EO data contract."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.parse
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath, PureWindowsPath

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "visualization-data"
INBOX = DATA / "data-to-import"
IMPORTED = DATA / "data-imported"
CATALOG = DATA / "catalog.json"
REPORT = DATA / "import-report.md"

GIT_OK = 5 * 1024 * 1024
GIT_AVOID = 50 * 1024 * 1024
GIT_NEVER = 100 * 1024 * 1024
DEFAULT_FILE_LIMIT = 10 * 1024**3
DEFAULT_ZIP_TOTAL_LIMIT = 20 * 1024**3
DEFAULT_ZIP_MEMBERS = 10000

DANGEROUS = {
    ".js", ".mjs", ".cjs", ".html", ".htm", ".svg", ".php", ".sh",
    ".bash", ".zsh", ".fish", ".bat", ".cmd", ".ps1", ".exe", ".dll",
    ".so", ".dylib", ".jar", ".class", ".py", ".rb", ".pl",
}
ARCHIVES = {".zip", ".tar", ".tgz", ".gz", ".7z", ".rar", ".bz2", ".xz"}
RASTERS = {".tif", ".tiff"}
TABLES = {".csv", ".tsv", ".parquet"}
THUMBNAILS = {".png", ".jpg", ".jpeg", ".webp"}
UNSUPPORTED = {".gpkg", ".nc", ".zarr", ".h5", ".hdf5"}
PROVENANCE_WORDS = {"provenance", "metadata", "readme", "license", "citation", "processing", "calibration"}
SENSITIVE_WORDS = {"credential", "credentials", "creds", "secret", "secrets", "password", "passwd", "token", "apikey", "api-key", "private-key"}
PUBLIC_FOLDERS = {"rasters", "vectors", "tables", "spectra", "thumbnails", "provenance", "derived", "external", "demo"}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    if path.is_dir():
        for child in sorted(item for item in path.rglob("*") if item.is_file()):
            digest.update(child.relative_to(path).as_posix().encode("utf-8"))
            with child.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
        return digest.hexdigest()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_size(path: Path) -> int:
    if path.is_dir():
        return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())
    return path.stat().st_size


def slug(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9._-]+", "-", value.lower()).strip("-._")
    return cleaned or "asset"


def safe_https_base(value: str | None) -> str | None:
    if not value:
        return None
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("--external-base-url must be an HTTPS URL without credentials")
    return value.rstrip("/") + "/"


def safe_relative_name(name: str) -> Path:
    if not name or "\x00" in name or re.match(r"^[a-zA-Z]:", name):
        raise ValueError("empty, NUL, or drive-letter path")
    if urllib.parse.urlparse(name).scheme or name.startswith(("/", "\\", "//")):
        raise ValueError("absolute or URL-like path")
    normalized = name.replace("\\", "/")
    parts = PurePosixPath(normalized).parts
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError("path traversal or ambiguous path component")
    if PureWindowsPath(name).is_absolute():
        raise ValueError("absolute Windows path")
    return Path(*parts)


def zip_member_is_symlink(info: zipfile.ZipInfo) -> bool:
    mode = info.external_attr >> 16
    return stat.S_ISLNK(mode)


def safe_extract_zip(source: Path, destination: Path, file_limit: int, total_limit: int, member_limit: int) -> list[Path]:
    extracted: list[Path] = []
    total = 0
    with zipfile.ZipFile(source) as archive:
        infos = archive.infolist()
        if len(infos) > member_limit:
            raise ValueError(f"archive has {len(infos)} members; limit is {member_limit}")
        for info in infos:
            relative = safe_relative_name(info.filename.rstrip("/"))
            if zip_member_is_symlink(info):
                raise ValueError(f"symlink rejected: {info.filename}")
            suffix = relative.suffix.lower()
            if suffix in ARCHIVES:
                raise ValueError(f"nested archive rejected: {info.filename}")
            if suffix in DANGEROUS:
                raise ValueError(f"dangerous file rejected: {info.filename}")
            if info.file_size > file_limit:
                raise ValueError(f"member exceeds per-file limit: {info.filename}")
            total += info.file_size
            if total > total_limit:
                raise ValueError("archive exceeds total uncompressed-size limit")
            target = (destination / relative).resolve()
            if destination.resolve() not in target.parents:
                raise ValueError(f"extraction escaped temporary directory: {info.filename}")
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as incoming, target.open("wb") as outgoing:
                shutil.copyfileobj(incoming, outgoing)
            os.chmod(target, 0o600)
            extracted.append(target)
    return extracted


def read_json(path: Path) -> object | None:
    if path.stat().st_size > GIT_OK:
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None


def classify(path: Path) -> tuple[str, list[str]]:
    suffix = path.suffix.lower()
    name = path.name.lower()
    warnings: list[str] = []
    if any(word in name for word in SENSITIVE_WORDS):
        return "dangerous", ["Sensitive credential-like filename rejected without reading or moving the file."]
    if suffix in DANGEROUS:
        return "dangerous", warnings
    if suffix in ARCHIVES:
        return "archive", warnings
    if suffix in RASTERS:
        return "raster", warnings
    if suffix in THUMBNAILS:
        return "thumbnail", warnings
    if suffix in UNSUPPORTED:
        return "unsupported", ["Detected data format is unsupported in the static browser viewer."]
    if suffix in {".json", ".geojson"}:
        value = read_json(path)
        if isinstance(value, dict):
            if "stac_version" in value or ("assets" in value and "links" in value):
                return "stac", warnings
            if value.get("type") in {"FeatureCollection", "Feature"}:
                return "vector", warnings
        if any(word in name for word in PROVENANCE_WORDS):
            return "provenance", warnings
        return "metadata", ["JSON did not match GeoJSON or STAC keys; treated as metadata."]
    if suffix in TABLES:
        if suffix in {".csv", ".tsv"} and path.stat().st_size <= GIT_OK:
            try:
                delimiter = "\t" if suffix == ".tsv" else ","
                with path.open(encoding="utf-8-sig", newline="") as handle:
                    columns = next(csv.reader(handle, delimiter=delimiter), [])
                if any(re.search(r"wave(length)?|nm|micron", item, re.I) for item in columns):
                    warnings.append("Spectral-like columns detected; wavelength units and calibration remain unverified.")
                    return "spectra", warnings
            except (OSError, UnicodeError, csv.Error):
                warnings.append("Table header could not be inspected safely.")
        return "table", warnings
    if suffix in {".txt", ".md", ".xml"}:
        return "provenance" if any(word in name for word in PROVENANCE_WORDS) else "metadata", warnings
    return "unknown", ["Extension is not in the accepted data allowlist."]


def sidecar_metadata(path: Path, all_files: dict[str, Path]) -> dict:
    stem = path.name
    for ending in (".cog.tiff", ".cog.tif", ".tiff", ".tif", path.suffix):
        if stem.lower().endswith(ending):
            stem = stem[: -len(ending)]
            break
    merged: dict = {}
    for suffix in (".metadata.json", ".provenance.json", ".calibration.json", ".stac.json"):
        candidate = all_files.get((path.parent / f"{stem}{suffix}").as_posix().lower())
        if candidate:
            value = read_json(candidate)
            if isinstance(value, dict):
                merged.update(value)
    return merged


def metadata_complete(meta: dict) -> bool:
    required = {"units", "nodata", "calibration_method", "processing_level", "acquisition_date", "sensor", "platform", "crs", "provenance"}
    bands = meta.get("bands")
    if not required.issubset(meta) or not isinstance(bands, list) or not bands:
        return False
    return all(isinstance(b, dict) and b.get("name") and b.get("units") is not None and b.get("scale") is not None and b.get("offset") is not None and b.get("nodata") is not None for b in bands)


def media_type(path: Path, kind: str) -> str:
    mapping = {
        "raster": "image/tiff; application=geotiff", "vector": "application/geo+json",
        "table": "text/csv" if path.suffix.lower() == ".csv" else "text/tab-separated-values",
        "spectra": "text/csv", "thumbnail": "image/" + ("jpeg" if path.suffix.lower() in {".jpg", ".jpeg"} else path.suffix.lower().lstrip(".")),
        "stac": "application/json", "metadata": "application/octet-stream", "provenance": "text/plain",
    }
    return mapping.get(kind, "application/octet-stream")


def inspect_raster(path: Path) -> dict:
    """Read technical raster metadata with GDAL when available; never read science into claims."""
    executable = shutil.which("gdalinfo")
    if not executable:
        return {}
    try:
        result = subprocess.run([executable, "-json", str(path)], text=True, capture_output=True, timeout=60, check=True)
        value = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return {}
    coordinate = value.get("coordinateSystem", {}) if isinstance(value, dict) else {}
    wkt = coordinate.get("wkt") if isinstance(coordinate, dict) else None
    authority = re.search(r'ID\["EPSG",(\d+)\]', wkt or "")
    image_structure = value.get("metadata", {}).get("IMAGE_STRUCTURE", {}) if isinstance(value.get("metadata"), dict) else {}
    return {
        "dimensions": value.get("size"),
        "band_count": len(value.get("bands", [])) if isinstance(value.get("bands"), list) else None,
        "crs": f"EPSG:{authority.group(1)}" if authority else None,
        "is_cog": image_structure.get("LAYOUT") == "COG",
        "gdal_driver": value.get("driverShortName"),
    }


def generate_raster_quicklook(path: Path, digest: str) -> str | None:
    """Create a non-quantitative first-band quicklook when GDAL can read the source."""
    executable = shutil.which("gdal_translate")
    if not executable:
        return None
    target = DATA / "thumbnails" / "imported" / f"{slug(path.stem)}-{digest[:8]}-quicklook.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        target.with_suffix(target.suffix + ".aux.xml").unlink(missing_ok=True)
        return target.relative_to(ROOT).as_posix()
    try:
        subprocess.run(
            [executable, "-q", "-of", "PNG", "-b", "1", "-outsize", "800", "0", "-scale", str(path), str(target)],
            text=True, capture_output=True, timeout=120, check=True,
        )
    except (OSError, subprocess.SubprocessError):
        target.unlink(missing_ok=True)
        return None
    target.with_suffix(target.suffix + ".aux.xml").unlink(missing_ok=True)
    return target.relative_to(ROOT).as_posix() if target.is_file() else None


def copy_public(path: Path, kind: str) -> str | None:
    folder = {"vector": "vectors", "table": "tables", "spectra": "spectra", "thumbnail": "thumbnails", "provenance": "provenance", "metadata": "provenance", "stac": "provenance"}.get(kind)
    if not folder or path.is_dir() or source_size(path) >= GIT_OK:
        return None
    if kind == "table" and path.suffix.lower() not in {".csv", ".tsv"}:
        return None
    target = DATA / folder / "imported" / path.name
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and sha256(target) != sha256(path):
        target = target.with_name(f"{target.stem}-{sha256(path)[:8]}{target.suffix}")
    shutil.copy2(path, target)
    return target.relative_to(ROOT).as_posix()


def imported_target(relative: Path) -> Path:
    target = IMPORTED / relative
    if target.exists():
        target = target.with_name(f"{target.stem}-{datetime.now().strftime('%Y%m%d%H%M%S')}{target.suffix}")
    target.parent.mkdir(parents=True, exist_ok=True)
    return target


def archive_source(path: Path, relative: Path) -> tuple[Path, bool]:
    """Archive a source, copying when inbox permissions prevent a true move."""
    target = IMPORTED / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.is_file() and target.stat().st_size == path.stat().st_size and sha256(target) == sha256(path):
        try:
            path.unlink()
            return target, False
        except PermissionError:
            return target, True
    target = imported_target(relative)
    try:
        shutil.move(str(path), target)
        return target, False
    except PermissionError:
        shutil.copy2(path, target)
        return target, True


def existing_catalog_state() -> tuple[list, list[dict], list[str]]:
    if not CATALOG.exists():
        return [], [], []
    value = read_json(CATALOG)
    datasets = value.get("datasets", []) if isinstance(value, dict) and isinstance(value.get("datasets"), list) else []
    retained: list = []
    detected = [item for item in value.get("detected_assets", []) if isinstance(item, dict)]
    for item in detected:
        quicklook_href = item.get("quicklook_href")
        if isinstance(quicklook_href, str) and quicklook_href.startswith("visualization-data/thumbnails/"):
            quicklook_path = ROOT / quicklook_href
            quicklook_path.with_suffix(quicklook_path.suffix + ".aux.xml").unlink(missing_ok=True)
        archived = IMPORTED / "legacy-public-rasters" / str(item.get("source_name", ""))
        if item.get("storage") == "external_required" and archived.is_file() and not item.get("quicklook_href"):
            quicklook = generate_raster_quicklook(archived, str(item.get("sha256") or sha256(archived)))
            if quicklook:
                item["quicklook_href"] = quicklook
                item.setdefault("warnings", []).append("Quicklook is a display-stretched first-band preview and is not a quantitative product.")
    known_sources = {str(item.get("source_name")) for item in detected}
    legacy_archive = IMPORTED / "legacy-public-rasters"
    if legacy_archive.is_dir():
        for path in sorted(legacy_archive.iterdir()):
            if not path.is_file() or path.name in known_sources:
                continue
            detected.append({
                "id": slug(f"legacy-{path.name}"), "title": path.name,
                "technical_type": "raster", "source_name": path.name,
                "size_bytes": path.stat().st_size, "sha256": sha256(path),
                "storage": "external_required", "web_ready": False, "href": None,
                "media_type": "image/tiff; application=geotiff",
                "units": "not provided", "nodata": "not provided", "crs": "not provided",
                "provenance": "Moved from the legacy browser asset tree by scripts/import_visualization_data.py.",
                "citation": "not provided", "license": "not provided",
                "calibration_status": "incomplete", "client_computation": {"allowed": False},
                "readiness_level": 2,
                "warnings": ["External COG/STAC hosting and complete scientific metadata are required."],
            })
            quicklook = generate_raster_quicklook(path, sha256(path))
            if quicklook:
                detected[-1]["quicklook_href"] = quicklook
                detected[-1]["warnings"].append("Quicklook is a display-stretched first-band preview and is not a quantitative product.")
    for path in sorted(item for item in IMPORTED.rglob("*") if item.is_file() and item.name != ".gitkeep" and "legacy-public-rasters" not in item.parts):
        relative = path.relative_to(IMPORTED)
        if path.name in known_sources or relative.as_posix() in known_sources:
            continue
        kind, item_warnings = classify(path)
        if kind in {"dangerous", "archive", "unknown"}:
            continue
        size = source_size(path)
        public_folder = {"vector": "vectors", "table": "tables", "spectra": "spectra", "thumbnail": "thumbnails", "provenance": "provenance", "metadata": "provenance", "stac": "provenance"}.get(kind)
        public_path = DATA / public_folder / "imported" / path.name if public_folder else None
        href = public_path.relative_to(ROOT).as_posix() if public_path and public_path.is_file() else None
        storage = "external_required" if kind == "raster" and size >= GIT_OK else ("local_tracked" if href else "local_untracked")
        record = {
            "id": slug(relative.as_posix()), "title": path.name,
            "technical_type": kind, "source_name": relative.as_posix(), "size_bytes": size,
            "storage": storage, "web_ready": bool(href), "href": href,
            "media_type": media_type(path, kind), "units": "not provided", "nodata": "not provided",
            "crs": "not provided", "provenance": "Imported source retained in the private data-imported archive.",
            "citation": "not provided", "license": "not provided", "calibration_status": "incomplete",
            "client_computation": {"allowed": False}, "readiness_level": 3 if href else 2,
            "warnings": item_warnings + (["External COG/STAC hosting and complete scientific metadata are required."] if kind == "raster" else ["Scientific metadata and publication opt-in are required before dataset registration."]),
        }
        if kind == "raster":
            prefix = f"{slug(path.stem)}-"
            quicklooks = sorted((DATA / "thumbnails" / "imported").glob(f"{prefix}*-quicklook.png"))
            quicklook = quicklooks[0].relative_to(ROOT).as_posix() if quicklooks else generate_raster_quicklook(path, "archive")
            if quicklook:
                record["quicklook_href"] = quicklook
                record["warnings"].append("Quicklook is a display-stretched first-band preview and is not a quantitative product.")
        detected.append(record)
    warnings: list[str] = []
    visual_types = {"raster", "vector", "table", "spectra", "thumbnail"}
    for dataset in datasets:
        if not isinstance(dataset, dict):
            continue
        assets = []
        for asset in dataset.get("assets", []):
            href = asset.get("href") if isinstance(asset, dict) else None
            path = ROOT / href if isinstance(href, str) and href.startswith("visualization-data/") else None
            if asset.get("type") == "raster" and path and path.is_file() and path.stat().st_size >= GIT_OK:
                archive = IMPORTED / "legacy-public-rasters" / path.name
                archive.parent.mkdir(parents=True, exist_ok=True)
                if not archive.exists():
                    shutil.move(str(path), archive)
                detected.append({
                    "id": slug(f"legacy-{dataset.get('id')}-{asset.get('id')}"),
                    "title": asset.get("title") or path.name,
                    "technical_type": "raster", "source_name": path.name,
                    "size_bytes": archive.stat().st_size, "sha256": sha256(archive),
                    "storage": "external_required", "web_ready": False, "href": None,
                    "media_type": asset.get("media_type", "image/tiff; application=geotiff"),
                    "units": asset.get("units", "not provided"), "nodata": asset.get("nodata", "not provided"),
                    "crs": dataset.get("crs", "not provided"), "provenance": dataset.get("provenance", "not provided"),
                    "citation": dataset.get("citation", "not provided"), "license": dataset.get("license", "not provided"),
                    "calibration_status": "incomplete", "client_computation": {"allowed": False},
                    "readiness_level": 2,
                    "warnings": ["Former browser raster exceeded the 5 MB public-asset threshold and was moved to the ignored source archive. External COG/STAC hosting is required."],
                })
                quicklook = generate_raster_quicklook(archive, sha256(archive))
                if quicklook:
                    detected[-1]["quicklook_href"] = quicklook
                    detected[-1]["warnings"].append("Quicklook is a display-stretched first-band preview and is not a quantitative product.")
                warnings.append(f"{dataset.get('id')}/{asset.get('id')}: moved oversized public raster to data-imported; external hosting required.")
                continue
            assets.append(asset)
        dataset["assets"] = assets
        if any(isinstance(asset, dict) and asset.get("type") in visual_types for asset in assets):
            retained.append(dataset)
        else:
            warnings.append(f"{dataset.get('id')}: omitted because no browser-visualizable assets remain.")
    return retained, detected, warnings


def catalog_state(datasets: list, detected: list) -> tuple[str, int]:
    if any(item.get("storage") == "external_required" for item in detected if isinstance(item, dict)):
        return "external_hosting_required", max([1] + [int(item.get("readiness_level", 1)) for item in detected if isinstance(item, dict)])
    if detected and not datasets:
        level = max([1] + [int(item.get("readiness_level", 1)) for item in detected if isinstance(item, dict)])
        return ("metadata_required" if level >= 2 else "detected_only"), level
    if datasets:
        publication_ready = any(item.get("publication_ready") is True for item in datasets if isinstance(item, dict))
        computation_ready = any(item.get("client_computation", {}).get("allowed") is True for item in datasets if isinstance(item, dict))
        return "ready", 7 if publication_ready else (6 if computation_ready else 4)
    return "empty", 0


def build_catalog(datasets: list, detected: list, warnings: list[str]) -> dict:
    status, readiness_level = catalog_state(datasets, detected)
    return {
        "version": "1.0.0",
        "title": "HYDRA-EO visualization catalog",
        "description": "Generated catalog for the HYDRA-EO scientific webpage and EO Explorer.",
        "generated_at": utc_now(),
        "generated_by": "scripts/import_visualization_data.py",
        "manual_editing": "Do not edit this file by hand. Put files in visualization-data/data-to-import/ and rerun the import script.",
        "source_policy": "Large source data are stored locally under visualization-data/data-imported/ and excluded from git.",
        "status": status,
        "readiness_level": readiness_level,
        "datasets": datasets,
        "detected_assets": detected,
        "warnings": warnings,
    }


def deduplicate_detected(items: list[dict]) -> list[dict]:
    deduplicated: dict[tuple[str, str], dict] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        key = (str(item.get("sha256") or item.get("id")), str(item.get("technical_type")))
        current = deduplicated.get(key)
        if current is None:
            item["duplicate_count"] = 1
            deduplicated[key] = item
            continue
        count = int(current.get("duplicate_count", 1)) + 1
        current["duplicate_count"] = count
        if item.get("web_ready") and not current.get("web_ready"):
            item["duplicate_count"] = count
            deduplicated[key] = item
    return sorted(deduplicated.values(), key=lambda item: (str(item.get("technical_type")), str(item.get("title"))))


def write_report(records: list[dict], rejected: list[dict], warnings: list[str], source: str, detected: list[dict]) -> None:
    accepted = [record for record in records if record["status"] == "accepted"]
    lines = [
        "# Visualization data import report", "", f"Generated: `{utc_now()}`", f"Import source: `{source}`", "",
        "## Summary", "", f"- Accepted source files: {len(accepted)}", f"- Rejected files: {len(rejected)}",
        f"- Files requiring external hosting: {sum(1 for item in detected if item.get('storage') == 'external_required')}",
        "- Catalog is generated; manual editing is discouraged.", "",
        "## Accepted", "",
    ]
    if not accepted:
        lines.append("No new source files were accepted in this run.")
    for item in accepted:
        lines.append(f"- `{item['source']}` -> `{item['archive']}`; type `{item['type']}`; {item['size']} bytes; storage `{item['storage']}`; SHA-256 `{item['sha256']}`")
    lines += ["", "## Rejected", ""]
    if not rejected:
        lines.append("No files were rejected in this run.")
    for item in rejected:
        lines.append(f"- `{item['source']}`: {item['reason']}")
    lines += ["", "## Warnings", ""]
    lines.extend(f"- {warning}" for warning in warnings) if warnings else lines.append("No import warnings.")
    lines += ["", "## Scientific safeguards", "", "Browser-side scientific computation remains blocked unless the generated catalog records complete calibration, band, units, nodata, acquisition, sensor, processing, CRS, formula, and provenance metadata.", ""]
    REPORT.write_text("\n".join(lines), encoding="utf-8")


def process_sources(paths: list[tuple[Path, Path]], external_base: str | None, file_limit: int) -> tuple[list[dict], list[dict], list[str]]:
    records: list[dict] = []
    rejected: list[dict] = []
    warnings: list[str] = []
    lookup = {(path.parent / path.name).as_posix().lower(): path for path, _ in paths}
    sidecar_names = {".metadata.json", ".provenance.json", ".calibration.json", ".stac.json"}
    quicklook_groups: set[str] = set()
    for path, relative in sorted(paths, key=lambda item: item[1].as_posix().lower()):
        kind, item_warnings = classify(path)
        try:
            size = source_size(path)
        except OSError as error:
            rejected.append({"source": relative.as_posix(), "reason": f"source is not readable: {error}"})
            continue
        if size > file_limit:
            rejected.append({"source": relative.as_posix(), "reason": f"file exceeds configured limit of {file_limit} bytes"})
            continue
        if kind in {"dangerous", "archive", "unknown"}:
            rejected.append({"source": relative.as_posix(), "reason": item_warnings[0] if item_warnings else f"rejected type: {kind}"})
            continue
        meta = sidecar_metadata(path, lookup)
        technical = inspect_raster(path) if kind == "raster" else {}
        try:
            archive, source_retained = archive_source(path, relative)
        except OSError as error:
            rejected.append({"source": relative.as_posix(), "reason": f"could not archive source safely: {error}"})
            continue
        if source_retained:
            item_warnings.append("Source was copied into the private archive but remains in the inbox because its parent directory is not writable.")
        digest = sha256(archive)
        group = relative.parent.as_posix()
        quicklook = generate_raster_quicklook(archive, digest) if kind == "raster" and group not in quicklook_groups else None
        if quicklook:
            quicklook_groups.add(group)
        storage = "local_untracked"
        href = copy_public(archive, kind)
        web_ready = href is not None and kind in {"vector", "table", "spectra", "thumbnail", "stac"}
        if kind == "table" and path.suffix.lower() not in {".csv", ".tsv"}:
            web_ready = False
            item_warnings.append("Table format is detected but unsupported by the static browser preview.")
        if kind == "raster":
            if size >= GIT_OK:
                storage = "external_required"
                if external_base:
                    href = urllib.parse.urljoin(external_base, urllib.parse.quote(relative.as_posix()))
                    storage = "external_url"
                    web_ready = bool(technical.get("is_cog")) or ".cog." in path.name.lower() or bool(meta.get("cog"))
            else:
                href = None
                web_ready = False
                item_warnings.append("Raster retained in the ignored source archive; publish an intentional COG/quicklook before browser use.")
        elif href:
            storage = "local_tracked"
        if GIT_OK <= size < GIT_AVOID:
            item_warnings.append("File is 5-50 MB and is not copied into git-trackable website assets.")
        if size >= GIT_AVOID:
            item_warnings.append("File exceeds 50 MB and must not be committed to normal git history.")
        calibration = "complete" if metadata_complete(meta) else "incomplete"
        detected = {
            "id": slug(relative.as_posix()), "title": meta.get("title") or path.name,
            "technical_type": kind, "source_name": path.name, "size_bytes": size,
            "sha256": digest, "storage": storage, "web_ready": web_ready,
            "href": href, "media_type": media_type(path, kind),
            "units": meta.get("units", "not provided"), "nodata": meta.get("nodata", "not provided"),
            "crs": meta.get("crs") or technical.get("crs") or "not provided", "provenance": meta.get("provenance", "not provided"),
            "citation": meta.get("citation", "not provided"), "license": meta.get("license", "not provided"),
            "calibration_status": calibration, "client_computation": {"allowed": calibration == "complete" and bool(meta.get("formula"))},
            "readiness_level": 3 if web_ready and meta else (2 if meta else 1), "warnings": item_warnings,
        }
        if technical:
            detected["raster_metadata"] = {key: value for key, value in technical.items() if value is not None}
        if quicklook:
            detected["quicklook_href"] = quicklook
            detected["warnings"].append("Quicklook is a display-stretched first-band preview and is not a quantitative product.")
        records.append({"status": "accepted", "source": relative.as_posix(), "archive": archive.relative_to(ROOT).as_posix(), "type": kind, "size": size, "storage": storage, "sha256": digest, "detected": detected, "metadata": meta})
        warnings.extend(f"{relative.as_posix()}: {message}" for message in item_warnings)
    return records, rejected, warnings


def publication_datasets(records: list[dict], existing_ids: set[str]) -> list[dict]:
    """Create datasets only from an explicit, sufficiently documented sidecar opt-in."""
    datasets: list[dict] = []
    for record in records:
        meta = record.get("metadata", {})
        detected = record["detected"]
        href = detected.get("href")
        opted_in = meta.get("publish") is True or meta.get("status") == "public"
        if not opted_in or not detected.get("web_ready") or not href:
            continue
        if not all(isinstance(meta.get(key), str) and meta[key].strip() for key in ("title", "license", "citation", "provenance")):
            detected["warnings"].append("Publication opt-in ignored: title, license, citation, and provenance are required.")
            continue
        dataset_id = slug(str(meta.get("id") or Path(record["source"]).stem))
        if dataset_id in existing_ids:
            dataset_id = f"{dataset_id}-{record['sha256'][:8]}"
        existing_ids.add(dataset_id)
        role = str(meta.get("role") or "source_product")
        asset = {
            "id": slug(str(meta.get("asset_id") or Path(record["source"]).name)),
            "type": detected["technical_type"], "role": role, "title": meta["title"],
            "href": href, "media_type": detected["media_type"],
            "units": meta.get("units", "not provided"), "nodata": meta.get("nodata", "not provided"),
            "storage": detected["storage"], "web_ready": True,
        }
        if isinstance(meta.get("display"), dict):
            asset["display"] = meta["display"]
        if meta.get("precomputed") is True:
            asset["processing_mode"] = "precomputed"
            asset["title"] = f"Precomputed {meta['title']}"
        computation_allowed = metadata_complete(meta) and isinstance(meta.get("formula"), str) and bool(meta["formula"].strip())
        data_class = meta.get("data_class") if meta.get("data_class") in {"observational", "methodological", "example", "synthetic", "unverified"} else "unverified"
        datasets.append({
            "id": dataset_id, "title": meta["title"], "version": meta.get("version"),
            "status": "public", "data_class": data_class,
            "site": meta.get("site"), "country": meta.get("country"), "crop": meta.get("crop"),
            "stressors": meta.get("stressors", []), "platform": meta.get("platform"), "sensor": meta.get("sensor"),
            "acquisition_date": meta.get("acquisition_date"), "bbox": meta.get("bbox"), "crs": meta.get("crs"),
            "spatial_resolution": meta.get("spatial_resolution"), "assets": [asset],
            "bands": meta.get("bands", []), "indices": meta.get("indices", []), "plot_statistics": [],
            "client_computation": {"allowed": computation_allowed, "formula": meta.get("formula") if computation_allowed else None},
            "provenance": {"processing_chain": meta["provenance"], "processing_level": meta.get("processing_level"), "calibration": meta.get("calibration_method"), "quality": meta.get("quality"), "known_limitations": meta.get("known_limitations"), "contact": meta.get("contact")},
            "license": meta["license"], "citation": meta["citation"],
        })
        detected["readiness_level"] = 6
    return datasets


def imported_inventory_dataset(detected: list[dict]) -> dict | None:
    if not detected:
        return None
    target = DATA / "tables" / "imported" / "imported-asset-inventory.csv"
    target.parent.mkdir(parents=True, exist_ok=True)
    fields = ["id", "title", "technical_type", "size_bytes", "storage", "web_ready", "readiness_level", "units", "crs", "calibration_status", "quicklook_href"]
    with target.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for item in detected:
            writer.writerow({field: item.get(field, "not provided") for field in fields})
    assets = [{
        "id": "imported-asset-inventory", "type": "table", "role": "technical_asset_inventory",
        "title": "Imported asset inventory", "href": target.relative_to(ROOT).as_posix(),
        "media_type": "text/csv", "units": None, "nodata": None,
        "public_download": True,
    }]
    vector_hrefs: set[str] = set()
    for item in detected:
        href = item.get("href")
        if item.get("technical_type") == "vector" and item.get("web_ready") and isinstance(href, str) and href not in vector_hrefs:
            vector_hrefs.add(href)
            assets.append({
                "id": slug(f"preview-{item.get('id')}"), "type": "vector", "role": "unverified_source_geometry",
                "title": f"Metadata-required geometry · {item.get('title', 'source')}", "href": href,
                "media_type": "application/geo+json", "units": None, "nodata": None,
                "public_download": False,
            })
    return {
        "id": "imported-evidence-inventory", "title": "Imported evidence inventory · metadata required",
        "version": utc_now(), "status": "public", "data_class": "unverified",
        "site": None, "country": None, "crop": None, "stressors": [], "platform": None,
        "sensor": None, "acquisition_date": None, "bbox": None, "crs": None,
        "spatial_resolution": None, "assets": assets, "bands": [], "indices": [], "plot_statistics": [],
        "client_computation": {"allowed": False},
        "provenance": {
            "processing_chain": "Generated technical inventory from scripts/import_visualization_data.py; filenames and folders are not interpreted as scientific labels.",
            "processing_level": "Technical import inventory", "calibration": None,
            "quality": "Source presence and technical classification only.",
            "known_limitations": "No crop, stressor, treatment, acquisition, calibration, license, validation, or publication claims are inferred.",
            "contact": "HYDRA-EO project coordinator",
        },
        "license": None, "citation": None, "publication_ready": False,
    }


def validate() -> bool:
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "validate_visualization_site.py")], cwd=ROOT)
    return result.returncode == 0


def collect_inbox() -> list[tuple[Path, Path]]:
    collected: list[tuple[Path, Path]] = []
    for current, directories, files in os.walk(INBOX, followlinks=False):
        base = Path(current)
        for name in list(directories):
            path = base / name
            if path.is_symlink():
                raise ValueError(f"symlink rejected in import inbox: {path.relative_to(INBOX)}")
            if path.suffix.lower() == ".zarr":
                collected.append((path, path.relative_to(INBOX)))
                directories.remove(name)
        for name in files:
            path = base / name
            if name == ".gitkeep":
                continue
            if path.is_symlink():
                raise ValueError(f"symlink rejected in import inbox: {path.relative_to(INBOX)}")
            collected.append((path, path.relative_to(INBOX)))
    return collected


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-root-zip", action="store_true", help="Import exactly one root-level zip safely")
    parser.add_argument("--check", action="store_true", help="Validate without changing files")
    parser.add_argument("--clean-generated", action="store_true", help="Remove generated catalog and report only")
    parser.add_argument("--external-base-url")
    parser.add_argument("--max-file-bytes", type=int, default=DEFAULT_FILE_LIMIT)
    parser.add_argument("--max-extracted-bytes", type=int, default=DEFAULT_ZIP_TOTAL_LIMIT)
    parser.add_argument("--max-archive-members", type=int, default=DEFAULT_ZIP_MEMBERS)
    args = parser.parse_args()
    public_folders = ("rasters", "vectors", "tables", "spectra", "thumbnails", "provenance", "derived", "external")
    for folder in (INBOX, IMPORTED, *(DATA / name for name in public_folders)):
        folder.mkdir(parents=True, exist_ok=True)
        (folder / ".gitkeep").touch()
    for auxiliary in (DATA / "thumbnails").rglob("*.aux.xml"):
        auxiliary.unlink(missing_ok=True)
    if args.check:
        return 0 if validate() else 1
    if args.clean_generated:
        for path in (CATALOG, REPORT):
            if path.exists():
                path.unlink()
        print("Removed generated catalog/report; source data were not deleted.")
        return 0
    try:
        external_base = safe_https_base(args.external_base_url)
    except ValueError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2
    root_zip: Path | None = None
    temporary: tempfile.TemporaryDirectory[str] | None = None
    source_label = "visualization-data/data-to-import/"
    try:
        paths = collect_inbox()
        if args.from_root_zip:
            zips = sorted(path for path in ROOT.glob("*.zip") if path.is_file())
            if len(zips) != 1:
                print(f"ERROR: expected exactly one root-level .zip; found {len(zips)}. No archives were removed.", file=sys.stderr)
                return 2
            root_zip = zips[0]
            temporary = tempfile.TemporaryDirectory(prefix="hydra-eo-import-")
            extraction = Path(temporary.name)
            extracted = safe_extract_zip(root_zip, extraction, args.max_file_bytes, args.max_extracted_bytes, args.max_archive_members)
            paths.extend((path, Path("root-zip") / path.relative_to(extraction)) for path in extracted)
            source_label = root_zip.name
        datasets, retained_detected, retained_warnings = existing_catalog_state()
        datasets = [item for item in datasets if isinstance(item, dict) and item.get("id") != "imported-evidence-inventory"]
        records, rejected, warnings = process_sources(paths, external_base, args.max_file_bytes)
        warnings = retained_warnings + warnings
        datasets.extend(publication_datasets(records, {str(item.get("id")) for item in datasets if isinstance(item, dict)}))
        detected = deduplicate_detected(retained_detected + [record["detected"] for record in records])
        inventory = imported_inventory_dataset(detected)
        if inventory:
            datasets.append(inventory)
        CATALOG.write_text(json.dumps(build_catalog(datasets, detected, warnings), indent=2) + "\n", encoding="utf-8")
        write_report(records, rejected, warnings, source_label, detected)
        if not validate():
            print("ERROR: import completed locally but validation failed; root zip was retained.", file=sys.stderr)
            return 1
        if root_zip and rejected:
            print(f"ERROR: {len(rejected)} file(s) were rejected; root archive was retained.", file=sys.stderr)
            return 1
        if root_zip:
            root_zip.unlink()
            print(f"Removed root archive only after successful import and validation: {root_zip.name}")
        print(f"Import complete: {len(records)} accepted, {len(rejected)} rejected, {len(warnings)} warnings.")
        return 0
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"ERROR: import aborted safely: {error}", file=sys.stderr)
        print("Source archives were not removed.", file=sys.stderr)
        return 1
    finally:
        if temporary:
            temporary.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
