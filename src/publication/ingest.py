"""Ingest an already-generated V4 product/source contract.

Two safe source modes, no provider calls, no signal recomputation:

FIXTURE
    ``--source-mode fixture --source <name>`` where ``<name>`` is one of the
    directories under ``fixtures/`` (``empty``, ``dashboard-only``,
    ``partial``, ``invalid``, ``complete``). Frozen, checked-in, deterministic.

LOCAL
    ``--source-mode local --source <path>`` where ``<path>`` is an arbitrary,
    explicitly supplied local directory containing a generated V4 product
    artifact (a ``data/`` subdirectory, or being the data root itself).

Ingest only ever copies the ``data/`` contract. The static HTML/CSS/JS shell
lives in ``src/publication/static`` and is owned by this repository, not by
whatever source is ingested (see ``engineering/FRONTEND_SOURCE.md``).
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

from .config import default_paths, repo_root

DATA_FILE_NAMES = ("dashboard.json", "beginner.json", "pro.json", "history.json")

# Any dict key whose value is a string starting with one of these prefixes is
# stripped during ingest: these are internal filesystem provenance paths
# (e.g. RNS/ShareChat snapshot source files, staged OHLC CSV paths) that are
# never part of the public product contract. This is a real, permanent
# safety net discovered by running this pipeline against the actual accepted
# V4 Gate 4 artifact, not a hypothetical concern.
_LOCAL_PATH_PREFIXES = ("/home/",)


def _sanitize_payload(value: Any) -> Any:
    """Recursively strip local-filesystem-path leaves from a JSON payload."""
    if isinstance(value, dict):
        cleaned = {}
        for key, item in value.items():
            if isinstance(item, str) and item.startswith(_LOCAL_PATH_PREFIXES):
                continue  # drop this key entirely: it is not on the public data allowlist
            cleaned[key] = _sanitize_payload(item)
        return cleaned
    if isinstance(value, list):
        return [_sanitize_payload(item) for item in value]
    return value


def _copy_json_sanitized(source_file: Path, target_file: Path) -> None:
    try:
        payload = json.loads(source_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        # Malformed input is not this stage's responsibility to fix -- copy
        # verbatim so validate_site's json_parseable check can reject it
        # (this is exactly the MODE 4 / INVALID acceptance path).
        shutil.copy2(source_file, target_file)
        return
    target_file.write_text(json.dumps(_sanitize_payload(payload), indent=2), encoding="utf-8")


class IngestError(ValueError):
    pass


def resolve_source_data_root(source_mode: str, source: str) -> Path:
    """Resolve a --source-mode/--source pair to a directory that IS the data root
    (i.e. the directory that directly contains dashboard.json, instruments/, etc,
    if those exist at all -- MODE 1/EMPTY legitimately has none of them)."""
    if source_mode == "fixture":
        candidate = repo_root() / "fixtures" / source
        if not candidate.exists():
            raise IngestError(f"unknown fixture '{source}': no such directory under fixtures/")
        data_root = candidate / "data"
        # fixtures/empty has no data/ subdirectory at all -- that is intentional.
        return data_root if data_root.exists() else candidate
    if source_mode == "local":
        candidate = Path(source).expanduser().resolve()
        if not candidate.exists():
            raise IngestError(f"local source path does not exist: {candidate}")
        data_root = candidate / "data"
        return data_root if data_root.exists() else candidate
    raise IngestError(f"unknown source mode: {source_mode!r} (expected 'fixture' or 'local')")


def ingest(source_mode: str, source: str, *, ingested_root: Path | None = None) -> dict[str, Any]:
    paths = default_paths()
    ingested_root = ingested_root or paths["ingested"]
    if ingested_root.exists():
        shutil.rmtree(ingested_root)
    ingested_root.mkdir(parents=True, exist_ok=True)

    data_root = resolve_source_data_root(source_mode, source)
    target_data = ingested_root / "data"
    copied_files: list[str] = []

    def _ensure_target_data() -> None:
        target_data.mkdir(parents=True, exist_ok=True)

    if data_root.exists():
        for name in DATA_FILE_NAMES:
            source_file = data_root / name
            if source_file.is_file():
                _ensure_target_data()
                _copy_json_sanitized(source_file, target_data / name)
                copied_files.append(f"data/{name}")
        instruments_source = data_root / "instruments"
        if instruments_source.is_dir():
            instrument_items = sorted(instruments_source.glob("*.json"))
            if instrument_items:
                _ensure_target_data()
                instruments_target = target_data / "instruments"
                instruments_target.mkdir(parents=True, exist_ok=True)
                for item in instrument_items:
                    _copy_json_sanitized(item, instruments_target / item.name)
                    copied_files.append(f"data/instruments/{item.name}")

    counts = _derive_counts(target_data)
    source_label = source if source_mode == "fixture" else Path(source).expanduser().resolve().name
    meta = {
        "source_mode": source_mode,
        "source_label": source_label,
        "files_copied": len(copied_files),
        "copied_files": copied_files,
        **counts,
    }
    # source_path is intentionally kept only in the (unpublished) ingest
    # metadata for local debugging -- never copied into docs/ or the manifest.
    meta_with_path = {**meta, "source_path": str(data_root)}
    (ingested_root / "ingest_meta.json").write_text(json.dumps(meta_with_path, indent=2), encoding="utf-8")
    return meta


def _derive_counts(target_data: Path) -> dict[str, int]:
    current_alerts = 0
    historical_events = 0
    unique_historical_tickers = 0
    required_detail_files = 0

    dashboard_path = target_data / "dashboard.json"
    if dashboard_path.is_file():
        try:
            dashboard = json.loads(dashboard_path.read_text(encoding="utf-8"))
            data = dashboard.get("data", dashboard)
            current_alerts = len(data.get("records", []))
            required_detail_files = len(data.get("details", {}))
        except (json.JSONDecodeError, AttributeError):
            pass  # malformed contract: validate_site.py is responsible for rejecting this.

    history_path = target_data / "history.json"
    if history_path.is_file():
        try:
            history = json.loads(history_path.read_text(encoding="utf-8"))
            data = history.get("data", history)
            records = data.get("records", [])
            historical_events = len(records)
            unique_historical_tickers = len({record.get("ticker") for record in records if record.get("ticker")})
        except (json.JSONDecodeError, AttributeError):
            pass

    generated_detail_files = len(list((target_data / "instruments").glob("*.json"))) if (target_data / "instruments").is_dir() else 0

    return {
        "current_alerts": current_alerts,
        "historical_events": historical_events,
        "unique_historical_tickers": unique_historical_tickers,
        "required_detail_files": required_detail_files,
        "generated_detail_files_at_ingest": generated_detail_files,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-mode", choices=["fixture", "local"], required=True)
    parser.add_argument("--source", required=True, help="fixture name (fixture mode) or directory path (local mode)")
    args = parser.parse_args()
    try:
        meta = ingest(args.source_mode, args.source)
    except IngestError as exc:
        parser.error(str(exc))
        return 2
    print(json.dumps(meta, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
