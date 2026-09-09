"""Build a candidate from one of the zero-data/degraded-data test fixtures
and (for every mode except ``invalid``) serve it locally so browser-level
acceptance (uncaught exceptions, controlled product states) can be checked.

For ``invalid`` this asserts that ``validate_site`` REJECTS the candidate --
that is the actual acceptance criterion for MODE 4 (never that a browser
renders it, since an invalid candidate must never reach promotion/publish).
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from publication.build import build_site  # noqa: E402
from publication.config import default_paths  # noqa: E402
from publication.ingest import ingest  # noqa: E402
from publication.validate import validate_site  # noqa: E402

MODE_TO_FIXTURE = {
    "empty": "empty",
    "dashboard-only": "dashboard-only",
    "partial": "partial",
    "invalid": "invalid",
    "complete": "complete",
}


def _serve_background(directory: Path, port: int) -> http.server.ThreadingHTTPServer:
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(directory))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=list(MODE_TO_FIXTURE))
    parser.add_argument("--port", type=int, default=8770)
    parser.add_argument("--serve-seconds", type=float, default=0.0, help="0 = serve until Ctrl+C")
    args = parser.parse_args()

    fixture = MODE_TO_FIXTURE[args.mode]
    ingest_meta = ingest("fixture", fixture)
    build_meta = build_site()
    paths = default_paths()

    if args.mode == "invalid":
        report = validate_site()
        result = {
            "mode": args.mode,
            "expectation": "validate_site MUST reject this candidate",
            "validate_passed": report.passed,
            "acceptance_passed": not report.passed,
            "failing_checks": [c.name for c in report.checks if not c.passed],
        }
        print(json.dumps(result, indent=2))
        return 0 if result["acceptance_passed"] else 1

    print(json.dumps({"mode": args.mode, "ingest": ingest_meta, "build": build_meta}, indent=2))
    server = _serve_background(paths["candidate"], args.port)
    url = f"http://127.0.0.1:{args.port}/"
    print(f"Serving MODE={args.mode} candidate at {url}")
    print("Use the browser tool against this URL to verify: page shell renders, "
          "navigation renders, zero uncaught JS exceptions, and the correct "
          "controlled product-data state banner.")
    if args.serve_seconds > 0:
        time.sleep(args.serve_seconds)
        server.shutdown()
        print("Preview server stopped.")
    else:
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            server.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
