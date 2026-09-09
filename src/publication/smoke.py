"""Live/local smoke test: fetch the served site over HTTP(S) and check the
minimum acceptance contract (root page, dashboard.json, and a handful of
instruments). Works against localhost preview or a real GitHub Pages URL.
"""

from __future__ import annotations

import argparse
import json
import random
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urljoin

from .config import default_paths


class _CheckResult(dict):
    pass


def _get(url: str, timeout: float = 10.0) -> tuple[int, bytes | None, str | None]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:  # noqa: S310 - internal smoke tool
            return response.status, response.read(), None
    except urllib.error.HTTPError as exc:
        return exc.code, None, str(exc)
    except (urllib.error.URLError, TimeoutError) as exc:
        return 0, None, str(exc)


def _check_root(base_url: str) -> dict:
    status, body, error = _get(base_url)
    ok = status == 200 and body is not None and b"<html" in body.lower()
    return {"name": "root_page", "passed": ok, "detail": {"url": base_url, "status": status, "error": error}}


def _check_dashboard(base_url: str) -> tuple[dict, dict | None]:
    url = urljoin(base_url.rstrip("/") + "/", "data/dashboard.json")
    status, body, error = _get(url)
    payload = None
    parse_error = None
    if body is not None:
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            parse_error = str(exc)
    ok = status == 200 and payload is not None and parse_error is None
    return {
        "name": "dashboard_json",
        "passed": ok,
        "detail": {"url": url, "status": status, "error": error or parse_error},
    }, (payload.get("data", payload) if payload else None)


def _check_instrument(base_url: str, ticker: str, detail_path: str | None) -> dict:
    path = detail_path or f"data/instruments/{ticker}.json"
    url = urljoin(base_url.rstrip("/") + "/", path)
    status, body, error = _get(url)
    payload = None
    parse_error = None
    if body is not None:
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            parse_error = str(exc)
    ticker_matches = False
    has_price_series = False
    has_alerts = False
    if payload:
        data = payload.get("data", payload)
        instrument = data.get("instrument_detail", data) if isinstance(data, dict) else {}
        identity = instrument.get("identity") or instrument.get("company_metadata") or {}
        ticker_matches = identity.get("ticker") == ticker
        has_price_series = bool(instrument.get("price_series"))
        has_alerts = bool(instrument.get("current_alerts")) or bool(instrument.get("historical_alerts"))
    ok = status == 200 and payload is not None and parse_error is None
    return {
        "name": f"instrument_{ticker}",
        "passed": ok,
        "detail": {
            "url": url, "status": status, "error": error or parse_error,
            "ticker_matches": ticker_matches, "has_price_series": has_price_series, "has_alerts": has_alerts,
        },
    }


def run_smoke(base_url: str, *, required_tickers: tuple[str, ...] | None = None, random_sample_size: int = 5) -> dict[str, Any]:
    checks: list[dict] = []
    checks.append(_check_root(base_url))
    dashboard_check, dashboard_data = _check_dashboard(base_url)
    checks.append(dashboard_check)

    details = (dashboard_data or {}).get("details", {}) if isinstance(dashboard_data, dict) else {}
    for ticker in (required_tickers or ()):
        ref = details.get(ticker)
        checks.append(_check_instrument(base_url, ticker, ref.get("detail_path") if isinstance(ref, dict) else None))

    historical_only = [
        ticker for ticker, ref in details.items()
        if ticker not in (required_tickers or ()) and isinstance(ref, dict)
    ]
    sample = random.sample(historical_only, k=min(random_sample_size, len(historical_only))) if historical_only else []
    for ticker in sample:
        ref = details[ticker]
        checks.append(_check_instrument(base_url, ticker, ref.get("detail_path")))

    return {
        "base_url": base_url,
        "passed": all(c["passed"] for c in checks),
        "random_historical_sample": sample,
        "checks": checks,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    args = parser.parse_args()
    paths = default_paths()
    from .config import load_config

    config = load_config()
    report = run_smoke(
        args.base_url,
        required_tickers=config.smoke_required_tickers,
        random_sample_size=config.smoke_random_historical_sample_size,
    )
    (paths["reports"] / "smoke_latest.json").parent.mkdir(parents=True, exist_ok=True)
    (paths["reports"] / "smoke_latest.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
