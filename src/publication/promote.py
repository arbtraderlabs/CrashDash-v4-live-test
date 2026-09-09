"""Atomically promote a validated build/candidate into docs/ (the GitHub
Pages root).

Never mutates docs/ in place: builds a fresh docs.new, then does a rename
swap. Any file that existed in the previous docs/ but is absent from the
candidate (a deleted/renamed instrument, for example) is dropped -- nothing
from a stale release silently survives.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

from .config import default_paths


class PromotionError(RuntimeError):
    pass


def promote(candidate_root: Path | None = None, docs_root: Path | None = None) -> dict[str, Any]:
    paths = default_paths()
    candidate_root = candidate_root or paths["candidate"]
    docs_root = docs_root or paths["docs"]

    if not candidate_root.is_dir() or not any(candidate_root.iterdir()):
        raise PromotionError(f"candidate directory is missing or empty: {candidate_root}")

    docs_new = docs_root.parent / (docs_root.name + ".new")
    docs_old = docs_root.parent / (docs_root.name + ".old")
    for stale in (docs_new, docs_old):
        if stale.exists():
            shutil.rmtree(stale)

    shutil.copytree(candidate_root, docs_new)

    previous_file_count = None
    if docs_root.exists():
        previous_file_count = sum(1 for _ in docs_root.rglob("*") if _.is_file())
        docs_root.rename(docs_old)
    docs_new.rename(docs_root)
    if docs_old.exists():
        shutil.rmtree(docs_old)

    new_file_count = sum(1 for _ in docs_root.rglob("*") if _.is_file())
    return {
        "docs_root": str(docs_root),
        "previous_file_count": previous_file_count,
        "new_file_count": new_file_count,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=Path, default=None)
    parser.add_argument("--docs", type=Path, default=None)
    args = parser.parse_args()
    result = promote(args.candidate, args.docs)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
