#!/usr/bin/env python3
"""Single orchestration entrypoint for the publication pipeline.

The Makefile calls this for every target. Each stage is explicit: start
time, end time, duration, status, input, output, counts, and errors are
recorded via ``publication.reporting.StageRunner`` -- no hidden magic, no
swallowed exceptions. A failed required stage stops ``release`` immediately.

Usage:
    scripts/orchestrate.py doctor
    scripts/orchestrate.py ingest --source-mode fixture --source complete
    scripts/orchestrate.py build
    scripts/orchestrate.py validate
    scripts/orchestrate.py promote
    scripts/orchestrate.py manifest
    scripts/orchestrate.py publish [--dry-run]
    scripts/orchestrate.py smoke --base-url http://127.0.0.1:8770
    scripts/orchestrate.py release --source-mode fixture --source complete [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from publication.build import build_site  # noqa: E402
from publication.config import default_paths, load_config  # noqa: E402
from publication.ingest import ingest  # noqa: E402
from publication.lock import LockHeldError, release_lock  # noqa: E402
from publication.manifest import build_manifest  # noqa: E402
from publication.promote import promote  # noqa: E402
from publication.publish import PublishGuardError, publish as publish_impl  # noqa: E402
from publication.reporting import StageFailure, StageRunner  # noqa: E402
from publication.smoke import run_smoke  # noqa: E402
from publication.validate import validate_site  # noqa: E402


def _write_report(report: dict) -> None:
    paths = default_paths()
    paths["reports"].mkdir(parents=True, exist_ok=True)
    (paths["reports"] / "latest.json").write_text(json.dumps(report, indent=2), encoding="utf-8")


def stage_doctor(runner: StageRunner) -> None:
    with runner.stage("doctor") as stage:
        paths = default_paths()
        config = load_config()
        checks = {
            "static_shell_exists": paths["static_shell"].is_dir(),
            "fixtures_exist": paths["fixtures"].is_dir(),
            "config_loaded": config.repo_name == "CrashDash-v4-live-test",
        }
        missing_shell_files = [
            name for name in config.static_shell_files
            if not (paths["static_shell"] / name).is_file()
        ]
        checks["all_shell_files_present"] = not missing_shell_files
        stage.output = checks
        stage.counts = {"checks_run": len(checks)}
        if not all(checks.values()):
            stage.errors.append(f"doctor checks failed: {checks}, missing shell files: {missing_shell_files}")
            raise RuntimeError(stage.errors[-1])


def stage_ingest(runner: StageRunner, source_mode: str, source: str) -> None:
    with runner.stage("ingest", input={"source_mode": source_mode, "source": source}) as stage:
        meta = ingest(source_mode, source)
        stage.output = meta
        stage.counts = {
            "files_copied": meta["files_copied"],
            "current_alerts": meta["current_alerts"],
            "historical_events": meta["historical_events"],
        }


def stage_build(runner: StageRunner) -> None:
    with runner.stage("build") as stage:
        result = build_site()
        stage.output = result
        stage.counts = {"shell_files_copied": result["shell_files_copied"], "data_files_copied": result["data_files_copied"]}


def stage_validate(runner: StageRunner, *, target: Path | None = None) -> None:
    with runner.stage("validate", input=str(target) if target else "build/candidate") as stage:
        report = validate_site(target)
        stage.output = report.to_dict()
        stage.counts = {"checks_run": len(report.checks), "checks_passed": sum(1 for c in report.checks if c.passed)}
        if not report.passed:
            failed = [c.name for c in report.checks if not c.passed]
            stage.errors.append(f"validation failed: {failed}")
            raise RuntimeError(stage.errors[-1])


def stage_promote(runner: StageRunner) -> None:
    with runner.stage("promote") as stage:
        result = promote()
        stage.output = result
        stage.counts = {"new_file_count": result["new_file_count"]}


def stage_manifest(runner: StageRunner) -> None:
    with runner.stage("manifest") as stage:
        manifest = build_manifest()
        stage.output = manifest
        stage.counts = {"instrument_count": manifest["instrument_count"], "file_count": manifest["file_count"]}


def stage_publish(runner: StageRunner, *, dry_run: bool, allow_dirty_outside_docs: bool) -> None:
    with runner.stage("publish", input={"dry_run": dry_run}) as stage:
        try:
            result = publish_impl(dry_run=dry_run, allow_dirty_outside_docs=allow_dirty_outside_docs)
        except PublishGuardError as exc:
            stage.errors.append(str(exc))
            raise
        stage.output = result


def stage_smoke(runner: StageRunner, *, base_url: str) -> None:
    with runner.stage("smoke", input={"base_url": base_url}) as stage:
        config = load_config()
        report = run_smoke(
            base_url,
            required_tickers=config.smoke_required_tickers,
            random_sample_size=config.smoke_random_historical_sample_size,
        )
        stage.output = report
        stage.counts = {"checks_run": len(report["checks"]), "checks_passed": sum(1 for c in report["checks"] if c["passed"])}
        if not report["passed"]:
            stage.errors.append(f"smoke test failed: {[c['name'] for c in report['checks'] if not c['passed']]}")
            raise RuntimeError(stage.errors[-1])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "command",
        choices=["doctor", "clean", "ingest", "build", "validate", "promote", "manifest", "publish", "smoke", "release"],
    )
    parser.add_argument("--source-mode", default=None)
    parser.add_argument("--source", default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--allow-dirty-outside-docs", action="store_true")
    parser.add_argument("--base-url", default="http://127.0.0.1:8770")
    parser.add_argument("--validate-target", type=Path, default=None)
    args = parser.parse_args()

    config = load_config()
    source_mode = args.source_mode or config.default_source_mode
    source = args.source or ("complete" if source_mode == "fixture" else None)

    paths = default_paths()
    runner = StageRunner()
    exit_code = 0
    try:
        if args.command == "clean":
            with runner.stage("clean") as stage:
                removed = []
                for target in (paths["build"], ):
                    if target.exists():
                        shutil.rmtree(target)
                        removed.append(str(target))
                paths["build"].mkdir(parents=True, exist_ok=True)
                stage.output = {"removed": removed}
        elif args.command == "doctor":
            stage_doctor(runner)
        elif args.command == "ingest":
            if not source:
                parser.error("--source is required (or provide --source-mode local --source <path>)")
            stage_ingest(runner, source_mode, source)
        elif args.command == "build":
            stage_build(runner)
        elif args.command == "validate":
            stage_validate(runner, target=args.validate_target)
        elif args.command == "promote":
            stage_promote(runner)
        elif args.command == "manifest":
            stage_manifest(runner)
        elif args.command == "publish":
            stage_publish(runner, dry_run=args.dry_run, allow_dirty_outside_docs=args.allow_dirty_outside_docs)
        elif args.command == "smoke":
            stage_smoke(runner, base_url=args.base_url)
        elif args.command == "release":
            if not source:
                parser.error("--source is required (or provide --source-mode local --source <path>)")
            with release_lock(paths["lock_file"]):
                stage_doctor(runner)
                stage_ingest(runner, source_mode, source)
                stage_build(runner)
                stage_validate(runner)
                stage_promote(runner)
                stage_manifest(runner)
                stage_publish(runner, dry_run=args.dry_run, allow_dirty_outside_docs=args.allow_dirty_outside_docs)
                if not args.dry_run:
                    stage_smoke(runner, base_url=args.base_url)
    except (StageFailure, LockHeldError, PublishGuardError) as exc:
        print(f"PIPELINE STOPPED: {exc}", file=sys.stderr)
        exit_code = 1
    except Exception as exc:  # noqa: BLE001 - surfaced via report/exit code, not swallowed
        print(f"UNEXPECTED FAILURE: {exc}", file=sys.stderr)
        exit_code = 1

    report = runner.to_report(extra={"command": args.command})
    _write_report(report)
    print(json.dumps(report, indent=2))
    if report["overall_status"] != "PASS":
        exit_code = exit_code or 1
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
