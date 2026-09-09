"""Generate the deterministic public release manifest.

Never includes local/private paths (see "Do NOT include local private
paths" in the mission spec) -- only a safe source label, counts, sizes,
and content hashes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import default_paths, load_config, repo_root


def _git_head(path: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(path), "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_manifest(target_root: Path | None = None, *, ingested_root: Path | None = None) -> dict[str, Any]:
    paths = default_paths()
    target_root = target_root or paths["docs"]
    ingested_root = ingested_root or paths["ingested"]
    config = load_config()

    ingest_meta_path = ingested_root / "ingest_meta.json"
    ingest_meta = json.loads(ingest_meta_path.read_text(encoding="utf-8")) if ingest_meta_path.is_file() else {}
    source_label = ingest_meta.get("source_label", "unknown")
    source_mode = ingest_meta.get("source_mode", "unknown")

    important_artifacts = ["data/dashboard.json", "data/beginner.json", "data/pro.json", "data/history.json"]
    hashes: dict[str, str] = {}
    for relative in important_artifacts:
        target = target_root / relative
        if target.is_file():
            hashes[relative] = _sha256(target)

    all_files = [path for path in target_root.rglob("*") if path.is_file() and path.name != "build-manifest.json"]
    total_bytes = sum(path.stat().st_size for path in all_files)
    instruments_dir = target_root / "data" / "instruments"
    instrument_count = len(list(instruments_dir.glob("*.json"))) if instruments_dir.is_dir() else 0

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "pipeline_version": config.pipeline_version,
        "source_mode": source_mode,
        "source_identifier": source_label,
        "source_sha": None,  # fixtures/local dirs are not necessarily their own git checkout
        "publication_repo_sha": _git_head(repo_root()),
        "current_signal_count": ingest_meta.get("current_alerts", 0),
        "historical_event_count": ingest_meta.get("historical_events", 0),
        "instrument_count": instrument_count,
        "file_count": len(all_files),
        "total_bytes": total_bytes,
        "artifact_sha256": hashes,
    }
    (target_root / "build-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", type=Path, default=None, help="defaults to docs/ (post-promotion)")
    args = parser.parse_args()
    manifest = build_manifest(args.target)
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
