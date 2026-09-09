# Pipeline

Engineering reference for the publication pipeline. (`docs/` is the GitHub
Pages root — generated site content only — so this document deliberately
lives under `engineering/`, not `docs/`.)

## Stages

Every stage is implemented once in `src/publication/<stage>.py` and exposed
two ways:

1. A thin CLI wrapper in `scripts/<stage>.py` (for direct/manual use and for
   the Makefile).
2. A function called by `scripts/orchestrate.py`, which wraps every stage in
   `publication.reporting.StageRunner` so start/end/duration/status/
   input/output/counts/errors are always recorded, printed, and persisted to
   `reports/latest.json`. No stage swallows an exception: a failure raises
   `StageFailure`, which stops `release` immediately.

```
doctor -> ingest -> build -> validate -> promote -> manifest -> publish -> smoke
```

`clean` only removes `build/` (the generated candidate + ingested data); it
never touches `docs/`, `fixtures/`, or `config/`.

## Why validate runs on build/candidate, not docs/

`build/candidate/` is the pre-promotion output; `promote` swaps it into
`docs/` atomically. `publish` re-runs the same validators against `docs/`
right before committing (defense in depth against a promotion-stage bug),
via `check_publish_guards()` in `src/publication/publish.py`. If either
validation fails, nothing is committed or pushed.

## Locking

`release` acquires a simple PID-stamped lock file at `build/.release.lock`
(see `src/publication/lock.py`) for its entire duration, so two publication
processes cannot run concurrently. A lock older than one hour is treated as
stale and reclaimed automatically (crash recovery) rather than requiring
manual intervention.

## Idempotence

Running `ingest` + `build` twice against the same source data produces
byte-identical `data/*.json` content (see
`tests/test_promote.py::test_promote_is_idempotent_content`). The only
expected differences between two releases of the same source data are:

- `build.json` (`generated_at`/`refreshed_at` timestamps)
- `build-manifest.json` (`generated_at`, and `publication_repo_sha` once this
  repo's own HEAD changes)

Neither of these is treated as a product-data difference by any validator.

## Manifest fields

See `src/publication/manifest.py::build_manifest`. `source_identifier` is a
short label (fixture name, or the source directory's basename for LOCAL
mode) — never a full local path. `publication_repo_sha` is this repository's
own `git rev-parse HEAD` at manifest time (best-effort; `None` before the
first commit).
