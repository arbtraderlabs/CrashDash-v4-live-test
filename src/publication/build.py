"""Build a deterministic static candidate from ingested product data.

Never builds directly into ``docs/``: always into ``build/candidate/``.
Combines the repository-owned static shell (``src/publication/static``)
with whatever product data was ingested (``build/ingested/data``). If no
data was ingested (MODE 1 / EMPTY), the candidate still contains a complete,
working static shell with no ``data/`` directory at all.
"""

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import default_paths


def build_site(*, ingested_root: Path | None = None, candidate_root: Path | None = None) -> dict[str, Any]:
    paths = default_paths()
    ingested_root = ingested_root or paths["ingested"]
    candidate_root = candidate_root or paths["candidate"]
    static_shell = paths["static_shell"]

    if candidate_root.exists():
        shutil.rmtree(candidate_root)
    candidate_root.mkdir(parents=True, exist_ok=True)

    shell_files_copied = []
    for item in sorted(static_shell.iterdir()):
        if item.is_file():
            shutil.copy2(item, candidate_root / item.name)
            shell_files_copied.append(item.name)

    ingested_data = ingested_root / "data"
    data_files_copied = 0
    has_data = ingested_data.is_dir() and any(ingested_data.rglob("*.json"))
    if has_data:
        target_data = candidate_root / "data"
        shutil.copytree(ingested_data, target_data)
        data_files_copied = sum(1 for _ in target_data.rglob("*.json"))

    generated_at = datetime.now(timezone.utc).isoformat()
    (candidate_root / "build.json").write_text(
        json.dumps({"schema_version": "V1", "generated_at": generated_at, "refreshed_at": generated_at}, indent=2),
        encoding="utf-8",
    )

    ingest_meta_path = ingested_root / "ingest_meta.json"
    ingest_meta = json.loads(ingest_meta_path.read_text(encoding="utf-8")) if ingest_meta_path.is_file() else {}

    return {
        "shell_files_copied": len(shell_files_copied),
        "shell_files": shell_files_copied,
        "data_files_copied": data_files_copied,
        "has_data": has_data,
        "generated_at": generated_at,
        "ingest_meta": {key: value for key, value in ingest_meta.items() if key != "source_path"},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    result = build_site()
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
