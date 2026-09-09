"""Contract validator tests: every check name is exercised directly, both
for the happy path (complete fixture) and for deliberately broken variants
built by mutating a copy of the complete fixture's candidate."""

import json
from pathlib import Path

import pytest

from publication.build import build_site
from publication.ingest import ingest
from publication.validate import validate_site


@pytest.fixture
def complete_candidate(tmp_path):
    ingested_root = tmp_path / "ingested"
    candidate_root = tmp_path / "candidate"
    ingest("fixture", "complete", ingested_root=ingested_root)
    build_site(ingested_root=ingested_root, candidate_root=candidate_root)
    return candidate_root


def _check(report, name):
    matches = [c for c in report.checks if c.name == name]
    assert matches, f"no check named {name!r} ran"
    return matches[0]


def test_complete_fixture_passes_every_check(complete_candidate):
    report = validate_site(complete_candidate)
    assert report.passed, [c for c in report.checks if not c.passed]
    names = {c.name for c in report.checks}
    assert names == {
        "json_parseable", "historical_coverage", "ohlc_contract", "alert_price_contract",
        "event_type_contract", "beginner_pro_contract", "intelligence_bounds",
        "public_safety_scan", "path_portability",
    }


def test_historical_coverage_flags_missing_detail_file(tmp_path):
    ingested_root = tmp_path / "ingested"
    candidate_root = tmp_path / "candidate"
    ingest("fixture", "partial", ingested_root=ingested_root)
    build_site(ingested_root=ingested_root, candidate_root=candidate_root)
    report = validate_site(candidate_root)
    check = _check(report, "historical_coverage")
    assert not check.passed
    assert set(check.detail["missing_detail_files"]) == {"TEST2.L", "TEST3.L"}


def test_json_parseable_rejects_truncated_json(complete_candidate):
    (complete_candidate / "data" / "dashboard.json").write_text('{"schema_version": "V1", "data": {', encoding="utf-8")
    report = validate_site(complete_candidate)
    assert not _check(report, "json_parseable").passed


def test_ohlc_contract_rejects_missing_field(complete_candidate):
    path = complete_candidate / "data" / "instruments" / "TEST1.L.json"
    payload = json.loads(path.read_text())
    del payload["data"]["instrument_detail"]["price_series"][0]["volume"]
    path.write_text(json.dumps(payload), encoding="utf-8")
    report = validate_site(complete_candidate)
    check = _check(report, "ohlc_contract")
    assert not check.passed
    assert any("volume" in e for e in check.detail["errors"])


def test_ohlc_contract_rejects_out_of_order_dates(complete_candidate):
    path = complete_candidate / "data" / "instruments" / "TEST1.L.json"
    payload = json.loads(path.read_text())
    series = payload["data"]["instrument_detail"]["price_series"]
    series[0], series[1] = series[1], series[0]
    path.write_text(json.dumps(payload), encoding="utf-8")
    report = validate_site(complete_candidate)
    assert not _check(report, "ohlc_contract").passed


def test_ohlc_contract_rejects_bare_nan_token(complete_candidate):
    path = complete_candidate / "data" / "instruments" / "TEST1.L.json"
    text = path.read_text()
    text = text.replace("0.83", "NaN", 1) if "0.83" in text else text.replace('"close": 1.02', '"close": NaN', 1)
    path.write_text(text, encoding="utf-8")
    report = validate_site(complete_candidate)
    assert not _check(report, "json_parseable").passed


def test_alert_price_contract_rejects_exact_without_close(complete_candidate):
    path = complete_candidate / "data" / "instruments" / "TEST1.L.json"
    payload = json.loads(path.read_text())
    payload["data"]["instrument_detail"]["current_alerts"][0]["price_context"]["close"] = None
    path.write_text(json.dumps(payload), encoding="utf-8")
    report = validate_site(complete_candidate)
    assert not _check(report, "alert_price_contract").passed


def test_alert_price_contract_rejects_not_available_with_substituted_close(complete_candidate):
    path = complete_candidate / "data" / "instruments" / "TEST2.L.json"
    payload = json.loads(path.read_text())
    payload["data"]["instrument_detail"]["historical_alerts"][0]["price_context"]["close"] = 1.23
    path.write_text(json.dumps(payload), encoding="utf-8")
    report = validate_site(complete_candidate)
    assert not _check(report, "alert_price_contract").passed


def test_alert_price_contract_accepts_exact_and_not_available(complete_candidate):
    report = validate_site(complete_candidate)
    check = _check(report, "alert_price_contract")
    assert check.passed
    assert check.detail["exact_count"] >= 1
    assert check.detail["not_available_count"] >= 1


def test_event_type_contract_rejects_rns_collapsed_into_signal_shape(complete_candidate):
    path = complete_candidate / "data" / "instruments" / "TEST1.L.json"
    payload = json.loads(path.read_text())
    payload["data"]["instrument_detail"]["rns"][0]["signal_type"] = "CRASH ZONE BOTTOM"
    path.write_text(json.dumps(payload), encoding="utf-8")
    report = validate_site(complete_candidate)
    assert not _check(report, "event_type_contract").passed


def test_beginner_pro_contract_rejects_raw_state_leaking_as_watch_severity(complete_candidate):
    path = complete_candidate / "data" / "dashboard.json"
    payload = json.loads(path.read_text())
    payload["data"]["records"][0]["watch_severity"] = "CRASH ZONE BOTTOM"  # raw engine state, not a beginner label
    path.write_text(json.dumps(payload), encoding="utf-8")
    report = validate_site(complete_candidate)
    assert not _check(report, "beginner_pro_contract").passed


def test_beginner_pro_contract_retains_raw_evidence_for_pro(complete_candidate):
    report = validate_site(complete_candidate)
    assert _check(report, "beginner_pro_contract").detail["raw_evidence_retained_in_pro"] is True


def test_intelligence_bounds_rejects_rns_over_detail_max(complete_candidate):
    path = complete_candidate / "data" / "instruments" / "TEST1.L.json"
    payload = json.loads(path.read_text())
    payload["data"]["instrument_detail"]["rns"] = [
        {"id": f"extra-{i}", "date": "2026-01-01", "headline": "x"} for i in range(25)
    ]
    path.write_text(json.dumps(payload), encoding="utf-8")
    report = validate_site(complete_candidate)
    assert not _check(report, "intelligence_bounds").passed


def test_intelligence_bounds_rejects_total_available_lower_than_emitted(complete_candidate):
    path = complete_candidate / "data" / "instruments" / "TEST1.L.json"
    payload = json.loads(path.read_text())
    payload["data"]["instrument_detail"]["sharechat_total_available"] = 1  # emitted count is 10
    path.write_text(json.dumps(payload), encoding="utf-8")
    report = validate_site(complete_candidate)
    assert not _check(report, "intelligence_bounds").passed


def test_public_safety_scan_rejects_leaked_home_path(complete_candidate):
    (complete_candidate / "data" / "leak.json").write_text(
        json.dumps({"note": "debug dump from /home/ali/LSE_scanner/data"}), encoding="utf-8",
    )
    report = validate_site(complete_candidate)
    assert not _check(report, "public_safety_scan").passed


def test_public_safety_scan_rejects_localhost_reference(complete_candidate):
    (complete_candidate / "shell_extra.js").write_text(
        'fetch("http://localhost:8767/data/dashboard.json")', encoding="utf-8",
    )
    report = validate_site(complete_candidate)
    assert not _check(report, "public_safety_scan").passed


def test_path_portability_rejects_parent_relative_import(complete_candidate):
    (complete_candidate / "broken.js").write_text('import { x } from "../browser.js";', encoding="utf-8")
    report = validate_site(complete_candidate)
    assert not _check(report, "path_portability").passed


def test_path_portability_rejects_domain_root_relative_src(complete_candidate):
    (complete_candidate / "index.html").write_text(
        (complete_candidate / "index.html").read_text() + '\n<script src="/browser.js"></script>\n',
        encoding="utf-8",
    )
    report = validate_site(complete_candidate)
    assert not _check(report, "path_portability").passed


def test_static_shell_source_has_no_parent_relative_imports():
    """The actually-shipped shell files (not a mutated copy) must already be
    sub-path-safe -- this is the real portability fix, not just a test mutation."""
    static_shell = Path(__file__).resolve().parents[1] / "src" / "publication" / "static"
    for js_file in static_shell.glob("*.js"):
        text = js_file.read_text(encoding="utf-8")
        assert '"../browser.js' not in text, f"{js_file.name} still imports browser.js via a parent-relative path"
