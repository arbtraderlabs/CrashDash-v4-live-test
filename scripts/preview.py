#!/usr/bin/env python3
"""Dumb static-only local preview server.

No Flask/Streamlit/API endpoints, no runtime transformation, no backend
data fetches -- files only, exactly like ``python3 -m http.server``. This
IS effectively a thin wrapper around ``http.server`` so the acceptance
criteria ("must render successfully without requiring any backend process
... alive") can be tested honestly.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from publication.config import default_paths  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8770)
    parser.add_argument(
        "--root", choices=["candidate", "docs"], default="candidate",
        help="serve build/candidate (default, for pre-promotion testing) or docs/ (post-promotion)",
    )
    parser.add_argument("--bind", default="127.0.0.1")
    args = parser.parse_args()

    paths = default_paths()
    directory = paths[args.root]
    if not directory.is_dir():
        parser.error(f"{directory} does not exist -- run `make build` (or `make promote`) first")

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(directory))
    server = http.server.ThreadingHTTPServer((args.bind, args.port), handler)
    url = f"http://{args.bind}:{args.port}/"
    print(f"Serving {directory} (static files only, no API/backend) at {url}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
