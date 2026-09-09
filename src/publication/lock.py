"""A simple file-based lock preventing two publication processes from
running concurrently. No database; a lock file with the current PID is
sufficient, per the mission's LOCKING section."""

from __future__ import annotations

import contextlib
import os
import time
from pathlib import Path
from typing import Iterator


class LockHeldError(RuntimeError):
    pass


@contextlib.contextmanager
def release_lock(lock_path: Path, *, stale_after_seconds: float = 3600) -> Iterator[None]:
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    if lock_path.exists():
        age = time.time() - lock_path.stat().st_mtime
        if age < stale_after_seconds:
            held_by = lock_path.read_text(encoding="utf-8").strip()
            raise LockHeldError(
                f"another publication process appears to be running (lock={lock_path}, held_by={held_by!r}, age={age:.0f}s)"
            )
        lock_path.unlink()  # stale lock: safe to reclaim
    lock_path.write_text(f"pid={os.getpid()} time={time.time()}", encoding="utf-8")
    try:
        yield
    finally:
        with contextlib.suppress(FileNotFoundError):
            lock_path.unlink()
