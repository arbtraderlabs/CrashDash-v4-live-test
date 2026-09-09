"""Manifest generation tests: required fields present, hashes correct, and
no local/private paths embedded."""

import json

from publication.build import build_site
from publication.ingest import ingest
from publication.manifest import build_manifest
from publication.promote import promote


def test_manifest_has_required_fields_and_no_local_paths(tmp_path):
    ingested_root = tmp_path / "ingested"
    candidate_root = tmp_path / "candidate"
    docs_root = tmp_path / "docs"
    ingest("fixture", "complete", ingested_root=ingested_root)
    build_site(ingested_root=ingested_root, candidate_root=candidate_root)
    promote(candidate_root=candidate_root, docs_root=docs_root)
    manifest = build_manifest(docs_root, ingested_root=ingested_root)

    for field in (
        "generated_at", "pipeline_version", "source_mode", "source_identifier",
        "current_signal_count", "historical_event_count", "instrument_count",
        "file_count", "total_bytes", "artifact_sha256",
    ):
        assert field in manifest

    assert manifest["instrument_count"] == 3
    assert manifest["source_identifier"] == "complete"

    serialized = json.dumps(manifest)
    assert "/home/" not in serialized
    assert str(tmp_path) not in serialized


def test_manifest_hashes_match_actual_file_content(tmp_path):
    import hashlib

    ingested_root = tmp_path / "ingested"
    candidate_root = tmp_path / "candidate"
    docs_root = tmp_path / "docs"
    ingest("fixture", "complete", ingested_root=ingested_root)
    build_site(ingested_root=ingested_root, candidate_root=candidate_root)
    promote(candidate_root=candidate_root, docs_root=docs_root)
    manifest = build_manifest(docs_root, ingested_root=ingested_root)

    actual = hashlib.sha256((docs_root / "data" / "dashboard.json").read_bytes()).hexdigest()
    assert manifest["artifact_sha256"]["data/dashboard.json"] == actual
