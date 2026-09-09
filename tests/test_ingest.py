"""Ingest stage tests: FIXTURE source mode across all five zero-data modes."""

from publication.ingest import ingest, resolve_source_data_root


def test_ingest_complete(tmp_path):
    meta = ingest("fixture", "complete", ingested_root=tmp_path / "ingested")
    assert meta["files_copied"] == 7
    assert meta["current_alerts"] == 2
    assert meta["historical_events"] == 2
    assert meta["required_detail_files"] == 3
    assert meta["generated_detail_files_at_ingest"] == 3


def test_ingest_empty_produces_no_data_directory(tmp_path):
    ingested_root = tmp_path / "ingested"
    meta = ingest("fixture", "empty", ingested_root=ingested_root)
    assert meta["files_copied"] == 0
    assert not (ingested_root / "data").exists()


def test_ingest_dashboard_only_has_no_instruments(tmp_path):
    ingested_root = tmp_path / "ingested"
    meta = ingest("fixture", "dashboard-only", ingested_root=ingested_root)
    assert (ingested_root / "data" / "dashboard.json").is_file()
    assert not (ingested_root / "data" / "instruments").exists()
    assert meta["required_detail_files"] == 3
    assert meta["generated_detail_files_at_ingest"] == 0


def test_ingest_partial_has_some_instruments_missing(tmp_path):
    ingested_root = tmp_path / "ingested"
    meta = ingest("fixture", "partial", ingested_root=ingested_root)
    assert meta["required_detail_files"] == 3
    assert meta["generated_detail_files_at_ingest"] == 1
    assert (ingested_root / "data" / "instruments" / "TEST1.L.json").is_file()
    assert not (ingested_root / "data" / "instruments" / "TEST2.L.json").exists()


def test_ingest_unknown_fixture_raises():
    import pytest
    from publication.ingest import IngestError

    with pytest.raises(IngestError):
        resolve_source_data_root("fixture", "does-not-exist")


def test_ingest_local_mode_resolves_data_subdir(tmp_path):
    source = tmp_path / "local_source"
    (source / "data" / "instruments").mkdir(parents=True)
    (source / "data" / "dashboard.json").write_text("{}", encoding="utf-8")
    (source / "index.html").write_text("<html></html>", encoding="utf-8")  # frontend files must be ignored by ingest
    ingested_root = tmp_path / "ingested"
    meta = ingest("local", str(source), ingested_root=ingested_root)
    assert meta["source_mode"] == "local"
    assert (ingested_root / "data" / "dashboard.json").is_file()
    assert not (ingested_root / "index.html").exists()
