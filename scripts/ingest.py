#!/usr/bin/env python3
"""CLI entrypoint: ingest an already-generated V4 product/source contract.

See ``src/publication/ingest.py`` for the implementation and source-mode
contract (FIXTURE vs LOCAL). No provider calls, no signal recomputation.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from publication.ingest import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
