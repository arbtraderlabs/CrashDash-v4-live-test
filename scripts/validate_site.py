#!/usr/bin/env python3
"""CLI entrypoint: validate the build/candidate static site against every
product/publication contract. Exits non-zero on any failure."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from publication.validate import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
