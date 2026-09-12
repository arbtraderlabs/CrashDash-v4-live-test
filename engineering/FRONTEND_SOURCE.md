# Frontend source

The canonical development source is the CrashDash V4 integration repository
(`CrashDash-integration`, branch `v4-integration`). The publication shell is
synchronized from that source at commit:

    072404c134b667726bcb0ffc12e6ea84db31e8d7

The synchronized files are checked by:

    make check-frontend-sync

The check compares every mapped file and applies only the documented
publication import-path transform.

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

## Synchronization record

On 2026-09-12, the frontend was reconciled with integration commit
`072404c134b667726bcb0ffc12e6ea84db31e8d7`. Shared security and resilience
behavior now lives in both repositories:

| Live-test file | Integration source |
| --- | --- |
| `src/publication/static/browser.js` | `src/crashdash/vnext/browser.js` |
| `src/publication/static/shell.js` | `src/crashdash/vnext/preview/shell.js` |
| `src/publication/static/shell_views.js` | `src/crashdash/vnext/preview/shell_views.js` |
| `src/publication/static/shell_data.js` | `src/crashdash/vnext/preview/shell_data.js` |
| `src/publication/static/shell_state.js` | `src/crashdash/vnext/preview/shell_state.js` |
| `src/publication/static/real_contract.js` | `src/crashdash/vnext/preview/real_contract.js` |
| `src/publication/static/index.html` | `src/crashdash/vnext/preview/shell.html` |
| `tests/test_frontend_rendering.test.js` | `tests/browser/vnext_browser.test.js` |

Both frontend paths enforce the same marker policy: CrashDash signals are circles
(current radius `6.5`, historical radius `4.5`) and RNS events remain rotated
square/diamond markers.

## Publication-only difference

### `../browser.js` → `./browser.js` (path portability fix, required)

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

**Fix applied in the publication copy only:** the four flattened preview
modules import the sibling `browser.js` with `./browser.js`. This is a
mechanical path-portability transform; no application logic is changed. It
is enforced by `make check-frontend-sync` and the publication validator.

## Reconciliation classification

- **SHARED_FRONTEND:** marker rendering, HTTPS-only external links, escaped
  SVG event attributes, zero/degraded-data handling, and common rendering
  behavior now exist in integration and live-test.
- **PUBLICATION_ONLY:** the flattened sibling import paths in the four
  preview modules.
- **STALE/OBSOLETE:** the former live-test-only copies of security,
  resilience, and divergent browser rendering. They were replaced by the
  validated integration source; generated `docs/` is not source.

## What was intentionally NOT copied or forked

- No CSS/asset pipeline beyond what already exists inline in `shell.html`.
- No signal-generation, corporate-action, or MarketCap logic (none exists in
  the frontend shell to begin with — it is a pure consumer of the static
  JSON contract).
- No AI/provider client code.
