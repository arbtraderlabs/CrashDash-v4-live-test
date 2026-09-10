"""Configuration loading for the publication pipeline.

No machine-specific paths (e.g. ``/home/ali``) are embedded here. The
repository root is discovered relative to this file, and every other path
is supplied through CLI flags, environment variables, or ``config/publication.json``.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping


def repo_root() -> Path:
    """Return the repository root (parent of ``src/``), independent of cwd."""
    return Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class PublicationConfig:
    repo_owner: str
    repo_name: str
    branch: str
    pages_source_path: str
    default_source_mode: str
    static_shell_files: tuple[str, ...]
    required_data_files: tuple[str, ...]
    intelligence_bounds: Mapping[str, int]
    beginner_severity_map: Mapping[str, str]
    public_safety_patterns: tuple[str, ...]
    public_safety_allowlist_substrings: tuple[str, ...]
    banned_public_file_suffixes: tuple[str, ...]
    banned_public_dir_names: tuple[str, ...]
    smoke_required_tickers: tuple[str, ...]
    smoke_random_historical_sample_size: int
    pipeline_version: str
    raw: Mapping[str, Any] = field(repr=False)


def _env_override(name: str, default: str) -> str:
    return os.environ.get(f"CRASHDASH_LIVE_TEST_{name}", default)


def load_config(config_path: Path | None = None) -> PublicationConfig:
    path = config_path or (repo_root() / "config" / "publication.json")
    raw = json.loads(path.read_text(encoding="utf-8"))
    return PublicationConfig(
        repo_owner=_env_override("REPO_OWNER", raw["repo_owner"]),
        repo_name=_env_override("REPO_NAME", raw["repo_name"]),
        branch=_env_override("BRANCH", raw["branch"]),
        pages_source_path=raw["pages_source_path"],
        default_source_mode=_env_override("SOURCE_MODE", raw["default_source_mode"]),
        static_shell_files=tuple(raw["static_shell_files"]),
        required_data_files=tuple(raw["required_data_files"]),
        intelligence_bounds=dict(raw["intelligence_bounds"]),
        beginner_severity_map=dict(raw["beginner_severity_map"]),
        public_safety_patterns=tuple(raw["public_safety_patterns"]),
        public_safety_allowlist_substrings=tuple(raw.get("public_safety_allowlist_substrings", [])),
        banned_public_file_suffixes=tuple(raw.get("banned_public_file_suffixes", [
            ".py", ".pyc", ".pyo", ".csv", ".log", ".env", ".pem", ".key",
        ])),
        banned_public_dir_names=tuple(raw.get("banned_public_dir_names", [
            "__pycache__", "tests", "test", "src", "scripts", "staging",
            ".git", ".pytest_cache", "logs", "engineering",
        ])),
        smoke_required_tickers=tuple(raw["smoke_required_tickers"]),
        smoke_random_historical_sample_size=int(raw["smoke_random_historical_sample_size"]),
        pipeline_version=raw["pipeline_version"],
        raw=raw,
    )


def default_paths() -> dict[str, Path]:
    root = repo_root()
    return {
        "root": root,
        "static_shell": root / "src" / "publication" / "static",
        "fixtures": root / "fixtures",
        "build": root / "build",
        "candidate": root / "build" / "candidate",
        "ingested": root / "build" / "ingested",
        "docs": root / "docs",
        "reports": root / "reports",
        "lock_file": root / "build" / ".release.lock",
    }
