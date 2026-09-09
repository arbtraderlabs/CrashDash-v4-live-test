# Fixtures

This directory contains a small, entirely synthetic, deterministic product
dataset used for `SOURCE_MODE=fixture` builds (`make build SOURCE_MODE=fixture`
or the default when no `--source` is supplied).

It is **not** derived from any real CrashDash instrument, price, RNS, or
ShareChat data. Tickers `TEST1.L`, `TEST2.L`, and `TEST3.L` do not exist.

## Layout

```
fixtures/data/
├── dashboard.json           # lightweight nav/index + 2 current-alert records
├── beginner.json            # single featured-alert beginner projection
├── pro.json                 # single featured-alert pro projection
├── history.json             # historical signal event records (2 records)
└── instruments/
    ├── TEST1.L.json          # current alert, EXACT price_context, bounded RNS/ShareChat
    ├── TEST2.L.json          # historical-only, NOT_AVAILABLE price_context case
    └── TEST3.L.json          # second current alert, EXACT price_context
```

## Why it exists

The fixture exercises every contract this pipeline validates without needing
any real accepted V4 build artifact present:

- `detail_path` references that must resolve to real files.
- Exact-date `price_context.status = EXACT` with a present `close`.
- `price_context.status = NOT_AVAILABLE` with no substituted price.
- Bounded RNS (`rns_initial` <= `rns` <= `rns_total_available`) and ShareChat
  (`sharechat_initial` <= `sharechat` <= `sharechat_total_available`) with
  `*_total_available` counts preserved even though only a bounded subset is
  emitted.
- A ticker with no price series or current alerts at all (historical-only
  coverage), matching real-world 258-of-262 style coverage in production V4
  builds.

Regenerate or extend this fixture by hand-editing the JSON files directly;
there is no code generator checked into this repository (the historical
generator script used to create it was a throwaway `/tmp` script, not part of
the pipeline).

## fixtures/complete

MODE 5 — COMPLETE. The full synthetic dataset (see file listing above):
dashboard + beginner/pro/history + all three instrument detail files.
Used as the default `SOURCE_MODE=fixture` build and for `make test-complete`.
