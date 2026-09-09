# fixtures/invalid

MODE 4 — INVALID. Deliberately broken contract used only to prove that
`scripts/validate_site.py` fails the candidate BEFORE promotion/publish:

- `data/dashboard.json` is truncated/malformed JSON.
- `data/instruments/TEST1.L.json` is valid JSON but does not match the
  `{schema_version, data}` envelope contract.
- `data/instruments/TEST3.L.json` is valid JSON with a matching envelope
  but has a price-series row with a missing `volume` field (OHLCV vector
  length/shape contract violation).

This fixture must NEVER be promoted to `docs/` or published. It exists
only for `make test-invalid`, which asserts that `make validate` exits
non-zero against it.
