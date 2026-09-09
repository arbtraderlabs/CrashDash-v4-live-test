#!/usr/bin/env python3
"""CLI entrypoint: build a static candidate from ingested product data.

Builds into ``build/candidate/`` only -- never directly into ``docs/``.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from publication.build import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
