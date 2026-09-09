#!/usr/bin/env python3
"""CLI entrypoint: publish stage of the publication pipeline."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from publication.publish import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
