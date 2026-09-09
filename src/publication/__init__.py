"""CrashDash V4 public live-test static publication vertical.

This package intentionally contains NO signal generation, corporate-action
logic, MarketCap calculation, provider fetching, or AI-provider calls. It
consumes an already-generated product/source contract (a directory shaped
like ``data/dashboard.json`` + ``data/instruments/<ticker>.json`` + the
top-level ``beginner.json`` / ``pro.json`` / ``history.json`` payloads) and
turns it into a deterministic, portable static website.
"""
