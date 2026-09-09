"""Commit and push an already-validated docs/ directory. Fails closed:
refuses to run any git command unless every guard passes.

Guards (all required):
    - docs/build-manifest.json exists (manifest stage ran)
    - re-validation of docs/ passes (defense in depth vs promotion bugs)
    - public safety scan of docs/ finds nothing
    - current git branch matches the configured branch
    - configured remote is reachable/set (if a remote is configured)
    - no unexpected dirty files outside docs/
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any

from .config import default_paths, load_config, repo_root
from .validate import validate_site


class PublishGuardError(RuntimeError):
    pass


def _run_git(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, timeout=30)


def _current_branch(root: Path) -> str:
    result = _run_git(["rev-parse", "--abbrev-ref", "HEAD"], root)
    return result.stdout.strip()


def _dirty_files_outside_docs(root: Path, docs_relative: str) -> list[str]:
    result = _run_git(["status", "--porcelain"], root)
    outside = []
    for line in result.stdout.splitlines():
        path = line[3:].strip()
        if not path.startswith(f"{docs_relative}/") and path != docs_relative:
            outside.append(line)
    return outside


def check_publish_guards(*, allow_dirty_outside_docs: bool = False) -> dict[str, Any]:
    paths = default_paths()
    config = load_config()
    root = repo_root()
    docs_root = paths["docs"]
    guard_report: dict[str, Any] = {}

    manifest_path = docs_root / "build-manifest.json"
    guard_report["manifest_present"] = manifest_path.is_file()
    if not guard_report["manifest_present"]:
        raise PublishGuardError("docs/build-manifest.json is missing: run `make manifest` before publish")

    revalidation = validate_site(docs_root, config)
    guard_report["revalidation_passed"] = revalidation.passed
    guard_report["revalidation_failures"] = [c.name for c in revalidation.checks if not c.passed]
    if not revalidation.passed:
        raise PublishGuardError(f"re-validation of docs/ failed: {guard_report['revalidation_failures']}")

    branch = _current_branch(root)
    guard_report["current_branch"] = branch
    guard_report["expected_branch"] = config.branch
    if branch != config.branch:
        raise PublishGuardError(f"current branch '{branch}' != expected '{config.branch}'")

    remote_result = _run_git(["remote", "get-url", "origin"], root)
    guard_report["remote_url"] = remote_result.stdout.strip() if remote_result.returncode == 0 else None
    expected_repo_fragment = f"{config.repo_owner}/{config.repo_name}"
    if guard_report["remote_url"] and expected_repo_fragment.lower() not in guard_report["remote_url"].lower():
        raise PublishGuardError(
            f"origin remote '{guard_report['remote_url']}' does not reference expected repo '{expected_repo_fragment}'"
        )

    if not allow_dirty_outside_docs:
        outside = _dirty_files_outside_docs(root, config.pages_source_path)
        guard_report["dirty_outside_docs"] = outside
        if outside:
            raise PublishGuardError(f"worktree has unexpected changes outside {config.pages_source_path}/: {outside}")

    return guard_report


def publish(*, dry_run: bool = False, allow_dirty_outside_docs: bool = False) -> dict[str, Any]:
    config = load_config()
    root = repo_root()
    guard_report = check_publish_guards(allow_dirty_outside_docs=allow_dirty_outside_docs)

    if dry_run:
        return {"dry_run": True, "guards": guard_report, "committed": False, "pushed": False}

    add_result = _run_git(["add", config.pages_source_path], root)
    if add_result.returncode != 0:
        raise PublishGuardError(f"git add failed: {add_result.stderr}")

    status_result = _run_git(["status", "--porcelain", "--", config.pages_source_path], root)
    if not status_result.stdout.strip():
        return {"dry_run": False, "guards": guard_report, "committed": False, "pushed": False, "note": "no changes to commit"}

    commit_result = _run_git(["commit", "-m", "chore(publish): update generated static site"], root)
    if commit_result.returncode != 0:
        raise PublishGuardError(f"git commit failed: {commit_result.stderr}")
    commit_sha = _run_git(["rev-parse", "HEAD"], root).stdout.strip()

    push_result = _run_git(["push", "origin", config.branch], root)
    if push_result.returncode != 0:
        raise PublishGuardError(f"git push failed: {push_result.stderr}")

    return {
        "dry_run": False, "guards": guard_report, "committed": True, "pushed": True,
        "commit_sha": commit_sha,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--allow-dirty-outside-docs", action="store_true", help="for local test runs only")
    args = parser.parse_args()
    try:
        result = publish(dry_run=args.dry_run, allow_dirty_outside_docs=args.allow_dirty_outside_docs)
    except PublishGuardError as exc:
        print(json.dumps({"error": str(exc)}, indent=2))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
