#!/usr/bin/env python3
"""Validate the static HYDRA-EO Explorer, generated data contract, and security rules."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "visualization-data"
errors: list[str] = []
warnings: list[str] = []

ALLOWED_TYPES = {"raster", "vector", "table", "spectra", "thumbnail", "provenance", "stac", "metadata"}
ALLOWED_STORAGE = {"local_tracked", "local_untracked", "external_required", "external_url"}
PUBLIC_FOLDERS = {"rasters", "vectors", "tables", "spectra", "thumbnails", "provenance", "derived", "external", "demo"}
DANGEROUS_EXTENSIONS = {".js", ".mjs", ".cjs", ".html", ".htm", ".svg", ".php", ".sh", ".bash", ".bat", ".cmd", ".ps1", ".exe", ".dll", ".so", ".dylib", ".jar", ".class", ".py", ".rb", ".pl"}
SECTION_ORDER = ["top", "explorer", "overview", "science", "experiments", "observations", "methods", "data", "outputs", "tools", "consortium", "news", "contact"]


def fail(message: str) -> None:
    errors.append(message)


def warn(message: str) -> None:
    warnings.append(message)


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        fail(f"Cannot read {path.relative_to(ROOT)}: {error}")
        return ""


def safe_href(href: object, allow_missing_external: bool = True) -> bool:
    if not isinstance(href, str) or not href.strip():
        return False
    parsed = urlparse(href)
    if parsed.scheme:
        return parsed.scheme == "https" and bool(parsed.netloc) and not parsed.username and not parsed.password
    if href.startswith(("//", "/", "\\")) or "\\" in href:
        return False
    parts = Path(href).parts
    if ".." in parts or len(parts) < 2 or parts[0] != "visualization-data" or parts[1] not in PUBLIC_FOLDERS:
        return False
    if parts[1] in {"data-imported", "data-to-import"}:
        return False
    return True


def validate_catalog() -> None:
    path = DATA / "catalog.json"
    if not path.exists():
        fail("visualization-data/catalog.json is missing.")
        return
    try:
        catalog = json.loads(read(path))
    except json.JSONDecodeError as error:
        fail(f"catalog.json is invalid JSON: {error}")
        return
    if not isinstance(catalog, dict):
        fail("Catalog must be an object.")
        return
    for key in ("version", "title", "description", "status", "readiness_level", "datasets"):
        if key not in catalog:
            fail(f"Catalog is missing required key: {key}.")
    if catalog.get("generated_by") != "scripts/import_visualization_data.py":
        warn("Catalog predates the Python importer; run scripts/import_visualization_data.py to refresh generated metadata.")
    datasets = catalog.get("datasets", [])
    detected = catalog.get("detected_assets", [])
    if not isinstance(datasets, list):
        fail("Catalog datasets must be an array.")
        return
    if catalog.get("status") not in {"empty", "detected_only", "metadata_required", "external_hosting_required", "ready", "external_demo", "error"}:
        fail("Catalog has an invalid generated status.")
    if not isinstance(catalog.get("readiness_level"), int) or not 0 <= catalog["readiness_level"] <= 7:
        fail("Catalog readiness_level must be an integer from 0 to 7.")
    if detected is not None and not isinstance(detected, list):
        fail("Catalog detected_assets must be an array.")
        detected = []
    ids: set[str] = set()
    for index, dataset in enumerate(datasets):
        label = dataset.get("id", f"dataset-{index + 1}") if isinstance(dataset, dict) else f"dataset-{index + 1}"
        if not isinstance(dataset, dict):
            fail(f"{label}: dataset must be an object.")
            continue
        if not re.fullmatch(r"[a-z0-9][a-z0-9._-]*", str(dataset.get("id", ""))):
            fail(f"{label}: invalid dataset id.")
        if label in ids:
            fail(f"{label}: duplicate dataset id.")
        ids.add(label)
        if dataset.get("status") not in {"public", "embargoed", "internal", "draft"}:
            fail(f"{label}: invalid publication status.")
        assets = dataset.get("assets")
        if not isinstance(assets, list):
            fail(f"{label}: assets must be an array.")
            continue
        for asset in assets:
            asset_label = f"{label}/{asset.get('id', 'unknown')}" if isinstance(asset, dict) else label
            if not isinstance(asset, dict):
                fail(f"{asset_label}: asset must be an object.")
                continue
            if asset.get("type") not in ALLOWED_TYPES:
                fail(f"{asset_label}: unsupported asset type.")
            href = asset.get("href")
            if not safe_href(href):
                fail(f"{asset_label}: unsafe asset URL/path.")
            elif isinstance(href, str) and href.startswith("visualization-data/") and not (ROOT / href).exists():
                fail(f"{asset_label}: local asset is missing ({href}).")
            elif asset.get("type") == "raster" and isinstance(href, str) and href.startswith("visualization-data/") and (ROOT / href).stat().st_size >= 5 * 1024 * 1024:
                fail(f"{asset_label}: browser-facing raster exceeds the 5 MB public-asset threshold; use external COG/STAC hosting.")
            if asset.get("type") == "raster":
                if "units" not in asset:
                    warn(f"{asset_label}: raster units not provided.")
                if "nodata" not in asset:
                    warn(f"{asset_label}: raster nodata not provided.")
        computation = dataset.get("client_computation", {})
        if isinstance(computation, dict) and computation.get("allowed"):
            required = [dataset.get("bands"), dataset.get("sensor"), dataset.get("platform"), dataset.get("crs"), dataset.get("provenance")]
            if not all(required):
                fail(f"{label}: client computation is enabled without complete calibration context.")
            for band in dataset.get("bands", []):
                if not all(key in band and band[key] is not None for key in ("name", "units", "scale", "offset", "nodata")):
                    fail(f"{label}: client computation is enabled with incomplete band metadata.")
    for item in detected or []:
        if not isinstance(item, dict):
            fail("detected_assets entries must be objects.")
            continue
        storage = item.get("storage")
        if storage not in ALLOWED_STORAGE:
            fail(f"Detected asset {item.get('id', 'unknown')} has invalid storage state.")
        href = item.get("href")
        if href is not None and not safe_href(href):
            fail(f"Detected asset {item.get('id', 'unknown')} has unsafe href.")
        if storage == "external_required" and href:
            fail(f"Detected asset {item.get('id', 'unknown')} is external_required but has a browser href.")
        if item.get("client_computation", {}).get("allowed") and item.get("calibration_status") != "complete":
            fail(f"Detected asset {item.get('id', 'unknown')} enables computation without complete calibration.")


def validate_schema() -> None:
    path = DATA / "catalog.schema.json"
    try:
        schema = json.loads(read(path))
    except json.JSONDecodeError as error:
        fail(f"catalog.schema.json is invalid JSON: {error}")
        return
    required = set(schema.get("required", [])) if isinstance(schema, dict) else set()
    expected = {"generated_at", "generated_by", "manual_editing", "source_policy", "status", "readiness_level", "datasets", "detected_assets", "warnings"}
    missing = expected - required
    if missing:
        fail("Catalog schema does not require generated contract fields: " + ", ".join(sorted(missing)))


def validate_gitignore() -> None:
    content = read(ROOT / ".gitignore")
    required = [
        "visualization-data/data-to-import/*", "!visualization-data/data-to-import/.gitkeep",
        "visualization-data/data-imported/*", "!visualization-data/data-imported/.gitkeep",
        "*.zip", "*.tar", "*.tar.gz", "*.7z", "*.rar", "*.tif", "*.tiff", "*.gpkg", "*.h5", "*.hdf5", "*.nc", "*.zarr",
    ]
    for rule in required:
        if rule not in content:
            fail(f".gitignore is missing required rule: {rule}")
    try:
        tracked = subprocess.run(["git", "ls-files", "visualization-data/data-imported", "visualization-data/data-to-import", "*.zip"], cwd=ROOT, text=True, capture_output=True, check=True).stdout.splitlines()
        unsafe = [item for item in tracked if not item.endswith(".gitkeep") and (item.startswith("visualization-data/data-") or "/" not in item)]
        if unsafe:
            fail("Raw import files are tracked by git: " + ", ".join(unsafe))
    except (OSError, subprocess.CalledProcessError) as error:
        warn(f"Could not inspect git tracking state: {error}")


def validate_import_folders() -> None:
    for name in ("data-to-import", "data-imported", "rasters", "vectors", "tables", "spectra", "thumbnails", "provenance", "derived", "external"):
        folder = DATA / name
        if not folder.is_dir() or not (folder / ".gitkeep").exists():
            fail(f"Required folder or .gitkeep is missing: visualization-data/{name}/")
    for folder_name in ("data-to-import", "data-imported"):
        for path in (DATA / folder_name).rglob("*"):
            if path.is_symlink():
                fail(f"Symlink is not allowed in import storage: {path.relative_to(ROOT)}")
            if path.is_file() and path.suffix.lower() in DANGEROUS_EXTENSIONS:
                fail(f"Dangerous file exists in import storage: {path.relative_to(ROOT)}")
            if path.is_file() and any(word in path.name.lower() for word in ("credential", "credentials", "creds", "secret", "password", "passwd", "token", "apikey", "api-key", "private-key")):
                warn(f"Sensitive credential-like filename remains in ignored import storage and will be rejected by the importer: {path.relative_to(ROOT)}")


def validate_pages_and_docs() -> None:
    required = [
        "index.html", "explorer.html", "SECURITY.md", "docs/EO_EXPLORER.md",
        "docs/WEBPAGE_SCIENTIFIC_AUDIT.md", "docs/WEBPAGE_UPGRADE_REPORT.md",
        "docs/EO_EXPLORER_STAGE2_AUDIT.md", "docs/EO_EXPLORER_STAGE2_REPORT.md",
        "visualization-data/README.md", "visualization-data/import-report.md",
        "scripts/import_visualization_data.py",
    ]
    for relative in required:
        if not (ROOT / relative).exists():
            fail(f"Required artifact is missing: {relative}")
    if not (ROOT / "explorer.html").exists():
        return
    index = read(ROOT / "index.html")
    explorer = read(ROOT / "explorer.html")
    if "href=\"explorer.html\"" not in index:
        fail("Homepage does not link to explorer.html.")
    if "href=\"index.html\"" not in explorer:
        fail("Explorer does not link back to index.html.")
    if "assets/js/eo-explorer.js" in index:
        fail("Homepage still loads the heavy Explorer module.")
    positions = []
    for section_id in SECTION_ORDER:
        match = re.search(rf'<section\b[^>]*\bid=["\']{re.escape(section_id)}["\']', index, re.I)
        if not match:
            fail(f"Homepage is missing required section: {section_id}.")
        else:
            positions.append((section_id, match.start()))
    if len(positions) == len(SECTION_ORDER) and [name for name, _ in sorted(positions, key=lambda item: item[1])] != SECTION_ORDER:
        fail("Homepage sections are not in the PLAN.md order.")
    major = re.findall(r'<section\b[^>]*data-major-block=["\']([^"\']+)', index, re.I)
    if major[:2] != ["hero", "explorer"]:
        fail("Explorer must be the second major homepage block immediately after the hero.")
    required_markers = ["Project at a glance", "RQ1", "Crop-stressor matrix", "Observation strategy", "Hybrid RTM + ML methodology", "Data, provenance and readiness", "Scientific outputs and roadmap", "Tools, tutorials and reproducibility", "Consortium, roles and work packages", "No upcoming events listed.", "Funding acknowledgement"]
    for marker in required_markers:
        if marker not in index:
            fail(f"Homepage is missing required scientific content marker: {marker}.")
    for stale in ("Next comming events", "Shiny applicaiton", "airborne-borne", "Public Domain Not Configured", "currently in preparation for the ESA Kick-off"):
        if stale in index:
            fail(f"Homepage contains stale or broken content: {stale}.")
    if "Level 7" not in index or "Publication-ready" not in index:
        fail("Homepage must show the complete Level 0-7 readiness ladder.")
    if "Content-Security-Policy" not in index or "Content-Security-Policy" not in explorer:
        fail("CSP meta tags are required on both public pages.")
    for page_name, source in (("index.html", index), ("explorer.html", explorer)):
        for tag in re.findall(r"<a\b[^>]*target=[\"']_blank[\"'][^>]*>", source, re.I):
            rel = re.search(r"rel=[\"']([^\"']+)[\"']", tag, re.I)
            values = set(rel.group(1).lower().split()) if rel else set()
            if not {"noopener", "noreferrer"}.issubset(values):
                fail(f"{page_name} has target=_blank without rel=noopener noreferrer.")


def validate_browser_security() -> None:
    scan = [ROOT / "index.html", ROOT / "explorer.html"] + sorted((ROOT / "assets" / "js").glob("*.js"))
    forbidden = {
        r"\.innerHTML\s*=": "innerHTML assignment",
        r"insertAdjacentHTML\s*\(": "insertAdjacentHTML",
        r"\beval\s*\(": "eval",
        r"\bnew\s+Function\b": "new Function",
        r"document\.write\s*\(": "document.write",
        r"javascript\s*:": "javascript URL",
        r"\son[a-z]+\s*=": "inline event handler",
    }
    for path in scan:
        if not path.exists():
            continue
        source = read(path)
        for pattern, label in forbidden.items():
            if re.search(pattern, source, re.I):
                fail(f"{path.relative_to(ROOT)} contains forbidden browser construct: {label}.")
    catalog_js = read(ROOT / "assets/js/eo-catalog.js")
    if "data-imported" not in catalog_js or "https:" not in catalog_js:
        fail("Frontend URL policy does not explicitly enforce HTTPS and block data-imported.")


def validate_readiness_docs() -> None:
    for relative in ("visualization-data/README.md", "docs/EO_EXPLORER.md"):
        source = read(ROOT / relative)
        for level in range(8):
            if f"Level {level}" not in source:
                fail(f"{relative} is missing readiness Level {level}.")


def main() -> int:
    validate_catalog()
    validate_schema()
    validate_gitignore()
    validate_import_folders()
    validate_pages_and_docs()
    validate_browser_security()
    validate_readiness_docs()
    for message in warnings:
        print(f"WARNING: {message}")
    for message in errors:
        print(f"ERROR: {message}")
    if errors:
        print(f"Validation failed: {len(errors)} error(s), {len(warnings)} warning(s).")
        return 1
    print(f"Validation passed: 0 errors, {len(warnings)} warning(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
