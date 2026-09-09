# fixtures/dashboard-only

MODE 2 — DASHBOARD_ONLY. `data/dashboard.json`, `beginner.json`, `pro.json`,
and `history.json` exist, but `data/instruments/` does not exist at all, so
every `detail_path` reference 404s.

Expected frontend behaviour: dashboard/navigation/list views render
normally from `dashboard.json`; selecting any instrument shows an explicit
`NOT_AVAILABLE` detail-unavailable panel rather than crashing or hanging.
