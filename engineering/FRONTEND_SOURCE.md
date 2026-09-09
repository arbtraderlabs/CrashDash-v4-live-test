# Frontend source

The static application shell in `src/publication/static/` was copied
verbatim from the CrashDash V4 integration repository
(`CrashDash-integration`, branch `v4-integration`) at commit:

    ec00dde14374614578f25ef908709211dc25383f

(This is the same commit tagged `v4-product-gate4-20260909` — the Gate 4
release checkpoint.)

## Files copied

| File in this repo | Source path in CrashDash-integration |
| --- | --- |
| `index.html` | `src/crashdash/vnext/preview/shell.html` |
| `browser.js` | `src/crashdash/vnext/browser.js` |
| `shell.js` | `src/crashdash/vnext/preview/shell.js` |
| `shell_views.js` | `src/crashdash/vnext/preview/shell_views.js` |
| `shell_data.js` | `src/crashdash/vnext/preview/shell_data.js` |
| `shell_state.js` | `src/crashdash/vnext/preview/shell_state.js` |
| `real_contract.js` | `src/crashdash/vnext/preview/real_contract.js` |

Nothing else was copied. No CSS files exist separately (styles are inline
in `index.html`, as in the source).

## Deviations from the source (and why)

### 1. `../browser.js` → `./browser.js` (path portability fix, required)

In the source repository, `shell.js`, `shell_views.js`, `shell_data.js`, and
`real_contract.js` import `browser.js` via a **parent-relative** path
(`from "../browser.js"`), because in the source repo's own build layout
`preview/shell.js` lives one directory below `vnext/browser.js`.

When the *built* artifact is produced (by `frontend.py` / `build_vnext_preview.py`
in the source repo), all of these files are flattened into a single directory
alongside `browser.js` — so the import target is a *sibling*, not a parent.
This "works" today only by accident: `../browser.js` resolves relative to
the file's own URL, and when the site root and the file's directory happen
to be the same (`/`), `../` from `/` is clamped back to `/` by URL
resolution rules, so it still finds `/browser.js`.

This breaks the moment the site is hosted under a **project sub-path**,
exactly as GitHub Pages hosts this repository
(`https://arbtraderlabs.github.io/CrashDash-v4-live-test/`). There,
`shell.js` lives at `.../CrashDash-v4-live-test/shell.js`, and
`../browser.js` resolves to `https://arbtraderlabs.github.io/browser.js` —
outside the project entirely. 404.

**Fix applied in this repo only** (never in `CrashDash-integration`, which
remains untouched and is treated as read-only): every `from "../browser.js"`
was changed to `from "./browser.js"` in `shell.js`, `shell_views.js`,
`shell_data.js`, and `real_contract.js`. This is a one-line-per-file,
mechanical path fix — no application logic was changed. It is covered by
`tests/test_validate.py::test_static_shell_source_has_no_parent_relative_imports`
and by the `path_portability` validator, which fails any candidate that
reintroduces a parent-relative import.

### 2. Zero-data / degraded-data resilience (added in this repo only)

The source `shell.js` was written assuming the backend/data feed is always
present: `bootstrap()` fetched `dashboard.json`/`beginner.json`/`pro.json`
with `Promise.all` and no per-file failure handling, and
`loadInstrumentBundle()` let a failed per-instrument `fetch()` propagate as
an unhandled promise rejection.

This repository's mission requires the static site to render correctly with
no data published at all, with only a dashboard, with some instruments
missing, and with malformed data rejected before publication (see the
"Zero-data / degraded-data contract" in the main README). The following
functions were added or rewritten in `src/publication/static/shell.js`
(again: only in this repository's copy, never upstream):

- `safeFetchJson()` — classifies every top-level fetch as `AVAILABLE`,
  `NOT_AVAILABLE` (404), or `CONTRACT_ERROR` (non-2xx or invalid JSON)
  instead of throwing.
- `fetchInstrumentDetail()` — same classification for one instrument's
  detail file, isolating its failure from every other instrument.
- `bootstrap()` — now always calls `attachNav()` first (navigation must
  never depend on data loading succeeding), then uses `safeFetchJson()` for
  every top-level artifact and sets an explicit `productDataStatus`
  (`LOADING` / `AVAILABLE` / `EMPTY` / `CONTRACT_ERROR`).
- `renderProductStatusBanner()` / `renderInstrumentUnavailablePanel()` —
  explicit, honest copy per failure reason, never a bare "unknown" and never
  a page crash.
- `ensureHistoryLoaded()` — now classifies 404 vs. contract errors the same
  way, with matching explicit copy.

No rendering logic for *available* data was changed; these are additive
resilience paths only, exercised by `make test-empty` /
`test-dashboard-only` / `test-partial` / `test-invalid` and this
repository's fixtures.

## What was intentionally NOT copied or forked

- No CSS/asset pipeline beyond what already exists inline in `shell.html`.
- No signal-generation, corporate-action, or MarketCap logic (none exists in
  the frontend shell to begin with — it is a pure consumer of the static
  JSON contract).
- No AI/provider client code.
