"""Explicit, inspectable stage reporting for the orchestrator.

Every stage records its own start/end/duration/status/input/output/counts/
errors. No stage swallows an exception silently: a raised exception inside
``stage()`` is captured into the report, re-raised, and (by contract) stops
the orchestrator's ``release`` pipeline.
"""

from __future__ import annotations

import contextlib
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterator


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class StageResult:
    name: str
    start_time: str
    end_time: str | None = None
    duration_seconds: float | None = None
    status: str = "RUNNING"
    input: Any = None
    output: Any = None
    counts: dict[str, int] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "duration_seconds": self.duration_seconds,
            "status": self.status,
            "input": self.input,
            "output": self.output,
            "counts": self.counts,
            "errors": self.errors,
        }


class StageFailure(RuntimeError):
    """Raised (after recording) when a required stage fails."""

    def __init__(self, stage: StageResult):
        super().__init__(f"stage '{stage.name}' failed: {'; '.join(stage.errors) or 'unknown error'}")
        self.stage = stage


class StageRunner:
    """Collects an ordered list of :class:`StageResult` for one pipeline run."""

    def __init__(self) -> None:
        self.stages: list[StageResult] = []

    @contextlib.contextmanager
    def stage(self, name: str, *, input: Any = None) -> Iterator[StageResult]:
        result = StageResult(name=name, start_time=_now_iso(), input=input)
        self.stages.append(result)
        started = time.monotonic()
        try:
            yield result
        except Exception as exc:  # noqa: BLE001 - intentionally broad: report then re-raise
            result.status = "FAILED"
            result.errors.append(f"{type(exc).__name__}: {exc}")
            result.errors.append(traceback.format_exc())
            result.end_time = _now_iso()
            result.duration_seconds = time.monotonic() - started
            print(f"[STAGE FAILED] {name}: {exc}")
            raise StageFailure(result) from exc
        else:
            if result.status == "RUNNING":
                result.status = "PASS"
            result.end_time = _now_iso()
            result.duration_seconds = time.monotonic() - started
            print(f"[STAGE {result.status}] {name} ({result.duration_seconds:.3f}s)")

    def to_report(self, *, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        return {
            "generated_at": _now_iso(),
            "stages": [stage.to_dict() for stage in self.stages],
            "overall_status": "PASS" if all(stage.status == "PASS" for stage in self.stages) else "FAIL",
            **(extra or {}),
        }
