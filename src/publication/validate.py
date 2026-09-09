"""Validate a static candidate against every product/publication contract.

Every check is independent and reported individually; nothing is silently
skipped. ``validate_site()`` returns a :class:`ValidationReport`; the CLI
(`scripts/validate_site.py`) exits non-zero if any check fails, which is
exactly what stops an ``invalid`` fixture from ever being promoted/published.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

from .config import PublicationConfig, default_paths, load_config

_NAN_INF_TOKEN_RE = re.compile(r"(?<![\w.])(NaN|Infinity|-Infinity)(?![\w])")
_ROOT_RELATIVE_RE = re.compile(r'''(?:src|href|from)\s*=?\s*["'](/(?!/)[^"']*)["']''')
_PARENT_RELATIVE_IMPORT_RE = re.compile(r'''from\s+["']\.\./''')


@dataclass
class CheckResult:
    name: str
    passed: bool
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass
class ValidationReport:
    checks: list[CheckResult] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(check.passed for check in self.checks)

    def to_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "checks": [
                {"name": c.name, "passed": c.passed, "detail": c.detail} for c in self.checks
            ],
        }


def _load_json_text(path: Path) -> tuple[Any, str | None]:
    """Returns (parsed_or_None, error_or_None). Never raises."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return None, f"could not read {path}: {exc}"
    if _NAN_INF_TOKEN_RE.search(text):
        return None, f"{path} contains a bare NaN/Infinity token, which is not valid public JSON"
    try:
        return json.loads(text), None
    except json.JSONDecodeError as exc:
        return None, f"{path} is not valid JSON: {exc}"


def _unwrap(payload: Any) -> Any:
    if isinstance(payload, dict) and "data" in payload and "schema_version" in payload:
        return payload["data"]
    return payload


def check_json_parseable(candidate_root: Path) -> CheckResult:
    data_root = candidate_root / "data"
    if not data_root.is_dir():
        return CheckResult("json_parseable", True, {"note": "no data/ directory (EMPTY mode); nothing to parse"})
    errors: list[str] = []
    checked = 0
    for path in sorted(data_root.rglob("*.json")):
        checked += 1
        _, error = _load_json_text(path)
        if error:
            errors.append(error)
    return CheckResult("json_parseable", not errors, {"files_checked": checked, "errors": errors})


def check_historical_coverage(candidate_root: Path) -> CheckResult:
    dashboard_path = candidate_root / "data" / "dashboard.json"
    if not dashboard_path.is_file():
        return CheckResult("historical_coverage", True, {"note": "no dashboard.json (EMPTY mode)"})
    payload, error = _load_json_text(dashboard_path)
    if error:
        return CheckResult("historical_coverage", False, {"error": error})
    data = _unwrap(payload)
    details = data.get("details", {}) if isinstance(data, dict) else {}
    required = {ticker: ref.get("detail_path") for ticker, ref in details.items() if isinstance(ref, dict)}
    missing = []
    for ticker, detail_path in required.items():
        if not detail_path:
            missing.append(ticker)
            continue
        if not (candidate_root / detail_path).is_file():
            missing.append(ticker)
    instruments_dir = candidate_root / "data" / "instruments"
    generated = len(list(instruments_dir.glob("*.json"))) if instruments_dir.is_dir() else 0
    return CheckResult(
        "historical_coverage",
        not missing,
        {
            "required_detail_files": len(required),
            "generated_detail_files": generated,
            "missing_detail_files": missing,
        },
    )


def _is_finite_number(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if not isinstance(value, (int, float)):
        return False
    return math.isfinite(value)


def check_ohlc_contract(candidate_root: Path) -> CheckResult:
    instruments_dir = candidate_root / "data" / "instruments"
    if not instruments_dir.is_dir():
        return CheckResult("ohlc_contract", True, {"note": "no instruments/ directory"})
    errors: list[str] = []
    checked = 0
    for path in sorted(instruments_dir.glob("*.json")):
        payload, error = _load_json_text(path)
        if error:
            errors.append(error)
            continue
        detail = _unwrap(payload)
        instrument = detail.get("instrument_detail", detail) if isinstance(detail, dict) else {}
        series = instrument.get("price_series") if isinstance(instrument, dict) else None
        if not series:
            continue
        checked += 1
        prior_date: date | None = None
        seen_dates: set[str] = set()
        for index, row in enumerate(series):
            if not isinstance(row, dict):
                errors.append(f"{path.name}: price_series[{index}] is not an object")
                continue
            for field_name in ("open", "high", "low", "close", "volume"):
                if field_name not in row:
                    errors.append(f"{path.name}: price_series[{index}] missing '{field_name}'")
                elif not _is_finite_number(row[field_name]):
                    errors.append(f"{path.name}: price_series[{index}].{field_name} is not a finite number")
            raw_date = row.get("date")
            try:
                parsed = date.fromisoformat(str(raw_date))
            except (ValueError, TypeError):
                errors.append(f"{path.name}: price_series[{index}].date '{raw_date}' is not parseable")
                continue
            if raw_date in seen_dates:
                errors.append(f"{path.name}: price_series contains duplicate date '{raw_date}'")
            seen_dates.add(raw_date)
            if prior_date is not None and parsed < prior_date:
                errors.append(f"{path.name}: price_series dates are not ordered at index {index} ('{raw_date}' < '{prior_date.isoformat()}')")
            prior_date = parsed
    return CheckResult("ohlc_contract", not errors, {"instruments_with_price_series": checked, "errors": errors})


def _iter_alert_entries(instrument: dict) -> list[dict]:
    entries = []
    for key in ("current_alerts", "historical_alerts"):
        for alert in instrument.get(key) or []:
            if isinstance(alert, dict):
                entries.append(alert)
    return entries


def check_alert_price_contract(candidate_root: Path) -> CheckResult:
    instruments_dir = candidate_root / "data" / "instruments"
    if not instruments_dir.is_dir():
        return CheckResult("alert_price_contract", True, {"note": "no instruments/ directory"})
    errors: list[str] = []
    exact_count = 0
    not_available_count = 0
    for path in sorted(instruments_dir.glob("*.json")):
        payload, error = _load_json_text(path)
        if error:
            errors.append(error)
            continue
        detail = _unwrap(payload)
        instrument = detail.get("instrument_detail", detail) if isinstance(detail, dict) else {}
        for alert in _iter_alert_entries(instrument):
            price_context = alert.get("price_context")
            if not isinstance(price_context, dict):
                continue  # absence is legitimate (no price contract asserted for this alert)
            status = price_context.get("status")
            if status == "EXACT":
                exact_count += 1
                if price_context.get("close") is None:
                    errors.append(f"{path.name}: price_context EXACT but close is None ({alert.get('signal_id')})")
                if price_context.get("date") != alert.get("date"):
                    errors.append(
                        f"{path.name}: price_context EXACT date '{price_context.get('date')}' != alert date '{alert.get('date')}' ({alert.get('signal_id')})"
                    )
            elif status == "NOT_AVAILABLE":
                not_available_count += 1
                if price_context.get("close") is not None:
                    errors.append(f"{path.name}: price_context NOT_AVAILABLE but close is substituted ({alert.get('signal_id')})")
            else:
                errors.append(f"{path.name}: price_context.status '{status}' is neither EXACT nor NOT_AVAILABLE ({alert.get('signal_id')})")
    return CheckResult(
        "alert_price_contract", not errors,
        {"exact_count": exact_count, "not_available_count": not_available_count, "errors": errors},
    )


def check_event_type_contract(candidate_root: Path) -> CheckResult:
    instruments_dir = candidate_root / "data" / "instruments"
    if not instruments_dir.is_dir():
        return CheckResult("event_type_contract", True, {"note": "no instruments/ directory"})
    errors: list[str] = []
    for path in sorted(instruments_dir.glob("*.json")):
        payload, error = _load_json_text(path)
        if error:
            errors.append(error)
            continue
        detail = _unwrap(payload)
        instrument = detail.get("instrument_detail", detail) if isinstance(detail, dict) else {}
        for alert in _iter_alert_entries(instrument):
            if "headline" in alert or "body" in alert:
                errors.append(f"{path.name}: alert entry looks like an RNS/ShareChat record, not a signal event ({alert.get('signal_id')})")
            if not (alert.get("signal_type") or (alert.get("evidence") or {}).get("signal_state")):
                errors.append(f"{path.name}: alert entry has no signal_type/evidence.signal_state ({alert.get('signal_id')})")
        for rns_item in instrument.get("rns") or []:
            if isinstance(rns_item, dict) and ("signal_type" in rns_item or "evidence" in rns_item):
                errors.append(f"{path.name}: RNS record has been collapsed into a signal-event shape ({rns_item.get('id')})")
    return CheckResult("event_type_contract", not errors, {"errors": errors})


def check_beginner_pro_contract(candidate_root: Path, config: PublicationConfig) -> CheckResult:
    valid_labels = set(config.beginner_severity_map.values())
    errors: list[str] = []
    dashboard_path = candidate_root / "data" / "dashboard.json"
    if dashboard_path.is_file():
        payload, error = _load_json_text(dashboard_path)
        if error:
            errors.append(error)
        else:
            data = _unwrap(payload)
            for record in (data.get("records") or []) if isinstance(data, dict) else []:
                severity = record.get("watch_severity")
                if severity is not None and severity not in valid_labels:
                    errors.append(f"dashboard.json: record {record.get('instrument_id')} has non-beginner watch_severity '{severity}'")
    instruments_dir = candidate_root / "data" / "instruments"
    pro_raw_evidence_seen = False
    if instruments_dir.is_dir():
        for path in sorted(instruments_dir.glob("*.json")):
            payload, error = _load_json_text(path)
            if error:
                continue
            detail = _unwrap(payload)
            instrument = detail.get("instrument_detail", detail) if isinstance(detail, dict) else {}
            for alert in _iter_alert_entries(instrument):
                evidence = alert.get("evidence")
                if isinstance(evidence, dict) and evidence.get("signal_state"):
                    pro_raw_evidence_seen = True
    return CheckResult(
        "beginner_pro_contract", not errors,
        {"errors": errors, "raw_evidence_retained_in_pro": pro_raw_evidence_seen},
    )


def check_intelligence_bounds(candidate_root: Path, config: PublicationConfig) -> CheckResult:
    bounds = config.intelligence_bounds
    instruments_dir = candidate_root / "data" / "instruments"
    if not instruments_dir.is_dir():
        return CheckResult("intelligence_bounds", True, {"note": "no instruments/ directory"})
    errors: list[str] = []
    for path in sorted(instruments_dir.glob("*.json")):
        payload, error = _load_json_text(path)
        if error:
            errors.append(error)
            continue
        detail = _unwrap(payload)
        instrument = detail.get("instrument_detail", detail) if isinstance(detail, dict) else {}
        if not isinstance(instrument, dict):
            continue
        rns_initial = instrument.get("rns_initial") or []
        rns_detail = instrument.get("rns") or []
        rns_total = instrument.get("rns_total_available", 0)
        if len(rns_initial) > bounds["rns_initial_max"]:
            errors.append(f"{path.name}: rns_initial has {len(rns_initial)} > max {bounds['rns_initial_max']}")
        if len(rns_detail) > bounds["rns_detail_max"]:
            errors.append(f"{path.name}: rns detail has {len(rns_detail)} > max {bounds['rns_detail_max']}")
        if rns_total < len(rns_detail):
            errors.append(f"{path.name}: rns_total_available ({rns_total}) < emitted rns count ({len(rns_detail)})")

        sc_initial = instrument.get("sharechat_initial") or []
        sc_detail = instrument.get("sharechat") or []
        sc_total = instrument.get("sharechat_total_available", 0)
        if len(sc_initial) > bounds["sharechat_initial_max"]:
            errors.append(f"{path.name}: sharechat_initial has {len(sc_initial)} > max {bounds['sharechat_initial_max']}")
        if len(sc_detail) > bounds["sharechat_detail_max"]:
            errors.append(f"{path.name}: sharechat detail has {len(sc_detail)} > max {bounds['sharechat_detail_max']}")
        if sc_total < len(sc_detail):
            errors.append(f"{path.name}: sharechat_total_available ({sc_total}) < emitted sharechat count ({len(sc_detail)})")
    return CheckResult("intelligence_bounds", not errors, {"errors": errors})


def check_public_safety(candidate_root: Path, config: PublicationConfig) -> CheckResult:
    findings: list[str] = []
    allowlist = config.public_safety_allowlist_substrings
    for path in sorted(candidate_root.rglob("*")):
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for pattern in config.public_safety_patterns:
            for match in re.finditer(re.escape(pattern), text):
                start = max(0, match.start() - 40)
                end = min(len(text), match.end() + 40)
                context = text[start:end]
                if any(allowed in context for allowed in allowlist):
                    continue
                findings.append(f"{path.relative_to(candidate_root)}: matched pattern '{pattern}' -> ...{context}...")
    return CheckResult("public_safety_scan", not findings, {"findings": findings})


def check_path_portability(candidate_root: Path) -> CheckResult:
    errors: list[str] = []
    for suffix in (".js", ".html"):
        for path in sorted(candidate_root.rglob(f"*{suffix}")):
            text = path.read_text(encoding="utf-8")
            for match in _ROOT_RELATIVE_RE.finditer(text):
                errors.append(f"{path.relative_to(candidate_root)}: domain-root-relative reference '{match.group(1)}'")
            for match in _PARENT_RELATIVE_IMPORT_RE.finditer(text):
                errors.append(f"{path.relative_to(candidate_root)}: parent-relative import ('../...') breaks GitHub Pages sub-path hosting")
            if "http://localhost" in text or "127.0.0.1" in text or "file://" in text:
                errors.append(f"{path.relative_to(candidate_root)}: contains a localhost/file:// reference")
    return CheckResult("path_portability", not errors, {"errors": errors})


def validate_site(candidate_root: Path | None = None, config: PublicationConfig | None = None) -> ValidationReport:
    paths = default_paths()
    candidate_root = candidate_root or paths["candidate"]
    config = config or load_config()
    report = ValidationReport()
    # JSON parseability first: every other check assumes valid JSON, so a
    # failure here still runs the rest (each check re-checks parseability
    # locally and reports its own errors rather than crashing).
    report.checks.append(check_json_parseable(candidate_root))
    report.checks.append(check_historical_coverage(candidate_root))
    report.checks.append(check_ohlc_contract(candidate_root))
    report.checks.append(check_alert_price_contract(candidate_root))
    report.checks.append(check_event_type_contract(candidate_root))
    report.checks.append(check_beginner_pro_contract(candidate_root, config))
    report.checks.append(check_intelligence_bounds(candidate_root, config))
    report.checks.append(check_public_safety(candidate_root, config))
    report.checks.append(check_path_portability(candidate_root))
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=Path, default=None)
    args = parser.parse_args()
    report = validate_site(args.candidate)
    print(json.dumps(report.to_dict(), indent=2))
    if not report.passed:
        print("VALIDATION FAILED", file=sys.stderr)
        return 1
    print("VALIDATION PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
