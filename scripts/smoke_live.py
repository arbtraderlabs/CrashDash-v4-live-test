#!/usr/bin/env python3
"""CLI entrypoint: live/local smoke test against a served static site."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from publication.smoke import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
