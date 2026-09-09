# fixtures/partial

MODE 3 — PARTIAL. `dashboard.json` references three instruments
(`TEST1.L`, `TEST2.L`, `TEST3.L`); only `TEST1.L.json` actually exists
under `data/instruments/`. `TEST2.L` and `TEST3.L` are deliberately absent.

Expected frontend behaviour: `TEST1.L` renders normally; selecting
`TEST2.L` or `TEST3.L` shows an explicit `NOT_AVAILABLE` panel for that
instrument only, while `TEST1.L`, the dashboard list, and navigation
remain fully operational (instrument failure isolation).
