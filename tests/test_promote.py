"""Promotion tests: atomic swap and stale-file cleanup (a deleted instrument
must not silently survive from a previous release)."""

import json

from publication.build import build_site
from publication.ingest import ingest
from publication.promote import PromotionError, promote
import pytest


def _build_and_promote(tmp_path, fixture, docs_root):
    ingested_root = tmp_path / f"ingested-{fixture}"
    candidate_root = tmp_path / f"candidate-{fixture}"
    ingest("fixture", fixture, ingested_root=ingested_root)
    build_site(ingested_root=ingested_root, candidate_root=candidate_root)
    return promote(candidate_root=candidate_root, docs_root=docs_root)


def test_promote_refuses_empty_candidate(tmp_path):
    with pytest.raises(PromotionError):
        promote(candidate_root=tmp_path / "does-not-exist", docs_root=tmp_path / "docs")


def test_promote_stale_file_removed_on_next_release(tmp_path):
    docs_root = tmp_path / "docs"
    _build_and_promote(tmp_path, "complete", docs_root)
    assert (docs_root / "data" / "instruments" / "TEST2.L.json").is_file()

    # Second release uses a source that no longer has TEST2.L/TEST3.L at all.
    _build_and_promote(tmp_path, "partial", docs_root)
    assert (docs_root / "data" / "instruments" / "TEST1.L.json").is_file()
    assert not (docs_root / "data" / "instruments" / "TEST2.L.json").exists()
    assert not (docs_root / "data" / "instruments" / "TEST3.L.json").exists()


def test_promote_is_idempotent_content(tmp_path):
    docs_root = tmp_path / "docs"
    _build_and_promote(tmp_path, "complete", docs_root)
    first = json.loads((docs_root / "data" / "dashboard.json").read_text())
    _build_and_promote(tmp_path, "complete", docs_root)
    second = json.loads((docs_root / "data" / "dashboard.json").read_text())
    assert first == second  # same source data -> semantically identical product artifact
