# CrashDash V4 — Public Live-Test Publication Vertical

This repository is **PROD-TEST-LIVE**: a real, public GitHub Pages site used
to prove out the CrashDash V4 static-publication architecture end to end,
independently of the private production backend. It is **not** the real
CrashDash production website (`arbtraderlabs/CrashDash`).

https://arbtraderlabs.github.io/CrashDash-v4-live-test/

## What this proves

```
accepted V4 product source (already generated, read-only to this repo)
        -> ingest (FIXTURE or LOCAL)
        -> build          (build/candidate/, static shell + data/)
        -> validate        (every contract below)
        -> promote          (atomic docs/ swap, stale files removed)
        -> manifest          (docs/build-manifest.json)
        -> publish            (git commit + push, fails closed)
        -> GitHub Pages
```

This repository does **not**:
- generate signals, corporate actions, or MarketCap
- call any market-data provider or AI provider
- modify Production or the real `CrashDash` repository
- require any backend/server process to render (see "Zero-data contract" below)

## Architecture

- `src/publication/` — the pipeline implementation (ingest, build, validate,
  promote, manifest, publish, smoke, reporting, lock). No signal logic lives
  here; it only consumes an already-generated product/source contract.
- `src/publication/static/` — the CrashDash VNext application shell (HTML/CSS/JS),
  copied from the current accepted V4 frontend. See
  [engineering/FRONTEND_SOURCE.md](engineering/FRONTEND_SOURCE.md) for exactly
  what was copied, from which commit, and what was changed (one path-portability
  fix; see that file).
- `fixtures/` — five deterministic, synthetic test datasets: `empty`,
  `dashboard-only`, `partial`, `invalid`, `complete`. See
  [fixtures/README.md](fixtures/README.md).
- `build/` — generated only, never committed (`.gitignore`'d). `build/candidate/`
  is the pre-promotion static site; `build/ingested/` is the ingested data
  contract before it becomes part of the candidate.
- `docs/` — the actual GitHub Pages root (`main` branch, `/docs`). Only ever
  written by `make promote` (atomic swap), never edited by hand.
- `reports/` — machine-readable pipeline/smoke reports (not published;
  diagnostic only).

## Source contract (two safe modes)

**FIXTURE** — `make ingest SOURCE_MODE=fixture SOURCE=complete` (or any of
`empty`, `dashboard-only`, `partial`, `invalid`). Frozen, checked-in,
deterministic; no dependency on any external system.

**LOCAL** — `make ingest SOURCE_MODE=local SOURCE=/path/to/accepted/v4/build`.
Consumes an already-generated V4 product artifact (a directory containing a
`data/` subdirectory with `dashboard.json`, `beginner.json`, `pro.json`,
`history.json`, and `data/instruments/<ticker>.json`). Only the `data/`
contract is read; any HTML/JS alongside it in that directory is ignored —
this repository owns its own frontend shell (see above).

No provider calls, no AI calls, in either mode.

## Contracts validated (`make validate`)

- **json_parseable** — every published `data/*.json` file parses; bare
  `NaN`/`Infinity` tokens are rejected.
- **historical_coverage** — every `detail_path` referenced by
  `dashboard.json` resolves to a real file (no broken clickable tickers).
- **ohlc_contract** — `price_series` rows have finite open/high/low/close/volume,
  parseable and ordered dates, no duplicates.
- **alert_price_contract** — `price_context.status = EXACT` requires a
  present `close` and a date matching the alert date; `NOT_AVAILABLE`
  requires no substituted price.
- **event_type_contract** — CrashDash signal events and RNS/ShareChat records
  are never collapsed into the same shape.
- **beginner_pro_contract** — Beginner `watch_severity` values are always
  translated labels (never a raw engine state); Pro retains raw evidence.
- **intelligence_bounds** — RNS (5 initial / 20 detail) and ShareChat
  (10 initial / 50 detail) stay within POC bounds while `*_total_available`
  is preserved.
- **public_safety_scan** — no local paths, secrets, tokens, or credentials
  reach the candidate. (This caught a real leak of internal
  `/home/.../source_file` provenance paths in the accepted V4 artifact during
  development; `ingest` now strips any field whose value is a local
  filesystem path before it ever reaches `build/candidate`.)
- **path_portability** — no `../` parent-relative imports, no domain-root
  `/...` references, no `localhost`/`file://` references — required for
  GitHub Pages **project** sites hosted under a sub-path.

## Zero-data / degraded-data contract

The static site must render without any backend alive, in five test modes
(see [fixtures/README.md](fixtures/README.md) and `make test-empty` /
`test-dashboard-only` / `test-partial` / `test-invalid` / `test-complete`):

1. **EMPTY** — no `data/` directory at all.
2. **DASHBOARD_ONLY** — `dashboard.json` exists, no instrument details.
3. **PARTIAL** — some instrument files exist, some referenced ones don't.
4. **INVALID** — malformed contract; must be rejected by `make validate`,
   never promoted/published.
5. **COMPLETE** — the full dataset.

The frontend distinguishes `LOADING` / `AVAILABLE` / `EMPTY` /
`NOT_AVAILABLE` / `CONTRACT_ERROR` explicitly (never a bare "unknown"), and
one instrument's failure never breaks the dashboard, navigation, or any
other instrument. See the `loadInstrumentBundle` / `bootstrap` changes noted
in [engineering/FRONTEND_SOURCE.md](engineering/FRONTEND_SOURCE.md).

## Local preview

`make preview` serves `build/candidate/` with a dumb static HTTP server
(`python3 -m http.server`-equivalent) on `http://127.0.0.1:8770/` — files
only, no API endpoints, no backend.

## Makefile

Run `make help` for the full command list. The common path:

```sh
make doctor
make ingest SOURCE_MODE=fixture SOURCE=complete
make build
make validate
make preview            # inspect at http://127.0.0.1:8770/
make promote
make manifest
make publish            # fails closed unless every guard passes
make smoke BASE_URL=https://arbtraderlabs.github.io/CrashDash-v4-live-test/
```

or all at once: `make release SOURCE=complete` (add `--dry-run`/`make dry-run`
to run everything except the actual git push).

## Publish guards (fail closed)

`make publish` refuses to run any git command unless **all** of the
following hold: `docs/build-manifest.json` exists, re-validation of `docs/`
passes, the current branch matches the configured branch (`main`), the
`origin` remote references the expected repo, and the worktree has no
unexpected changes outside `docs/`.

## Rollback

1. Identify the previous known-good commit on `main` (e.g. via
   `git log -- docs/`).
2. `git revert <bad-commit>` (never a force-push) or check out the prior
   `docs/` tree from that commit and commit it forward.
3. `git push origin main`.
4. `make smoke BASE_URL=<live pages url>` to confirm recovery.

## Safety

- `PROVIDER_CALLS = 0`, `AI_CALLS = 0` — always.
- `V4_SIGNAL_ENGINE_CHANGED = NO`, `PRODUCTION_CHANGED = NO`,
  `CRASHDASH_PROD_REPO_CHANGED = NO`, `V4_SCHEDULE_CHANGED = NO`.
- No machine-specific paths (e.g. `/home/ali`) are embedded in pipeline
  logic; every path is supplied via CLI, environment variable, or
  `config/publication.json`.
