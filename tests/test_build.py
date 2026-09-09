"""Static candidate build tests: shell files always present, data/ only when
ingested content exists (MODE 1 / EMPTY must not leave a stray empty data/)."""

import json

from publication.build import build_site
from publication.config import default_paths
from publication.ingest import ingest


def _build(tmp_path, fixture):
    ingested_root = tmp_path / "ingested"
    candidate_root = tmp_path / "candidate"
    ingest("fixture", fixture, ingested_root=ingested_root)
    result = build_site(ingested_root=ingested_root, candidate_root=candidate_root)
    return result, candidate_root


def test_build_complete_has_shell_and_data(tmp_path):
    result, candidate_root = _build(tmp_path, "complete")
    shell_names = set(default_paths()["static_shell"].glob("*"))
    assert result["shell_files_copied"] == len(list(shell_names))
    assert result["has_data"] is True
    assert (candidate_root / "index.html").is_file()
    assert (candidate_root / "data" / "dashboard.json").is_file()
    assert (candidate_root / "data" / "instruments" / "TEST1.L.json").is_file()


def test_build_empty_has_no_data_directory(tmp_path):
    result, candidate_root = _build(tmp_path, "empty")
    assert result["has_data"] is False
    assert (candidate_root / "index.html").is_file()
    assert not (candidate_root / "data").exists()


def test_build_writes_build_json_with_generated_at(tmp_path):
    _, candidate_root = _build(tmp_path, "complete")
    build_json = json.loads((candidate_root / "build.json").read_text())
    assert build_json["schema_version"] == "V1"
    assert "generated_at" in build_json


def test_build_never_leaks_source_path_into_ingest_meta_echo(tmp_path):
    result, _ = _build(tmp_path, "complete")
    assert "source_path" not in result["ingest_meta"]
