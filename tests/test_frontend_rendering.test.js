import test from "node:test";
import assert from "node:assert/strict";
import { renderBeginner } from "../src/publication/static/browser.js";

const model = {
  ticker: "BCG.L",
  signal_state: "DEEP CRASH BOTTOM",
  watch_severity: "ELEVATED",
  accumulation_state: "UNKNOWN",
  local_enrichment: {
    metadata: { quote_unit: "GBX", quote_unit_status: "CERTIFIED_LOCAL_SOURCE" },
    convergence: {
      price_points: [
        { date: "2026-08-26", close: 2.12 },
        { date: "2026-08-28", close: 2.14 },
        { date: "2026-09-08", close: 2.43 },
      ],
      alert_markers: [
        { date: "2026-08-26", signal_type: "EXTREME CRASH BOTTOM", severity: "HIGH", current: false, event_type: "CRASHDASH_SIGNAL" },
        { date: "2026-08-28", signal_type: "ULTRA CRASH BOTTOM", severity: "EXTREME CAUTION", current: false, event_type: "CRASHDASH_SIGNAL" },
        { date: "2026-09-08", signal_type: "DEEP CRASH BOTTOM", severity: "ELEVATED", current: true, event_type: "CRASHDASH_SIGNAL" },
      ],
      rns_markers: [{ date: "2026-08-28", headline: "Announcement", event_type: "RNS" }],
    },
  },
  sharechat_snapshot: {
    analysis_status: "ANALYSIS_PENDING",
    total_posts: 12,
  },
  corporate_actions: {
    status: "AVAILABLE",
    events: [{ type: "stock_split", ratio_display: "1/10", date: "2025-10-14" }],
  },
};

test("live shell renders typed CrashDash and RNS markers separately", () => {
  const markup = renderBeginner(model, { chartRange: "FULL" });
  assert.match(markup, /<polygon class="chart-signal-marker severity-marker-high historical"/);
  assert.match(markup, /<polygon class="chart-signal-marker severity-marker-extreme-caution historical"/);
  assert.match(markup, /class="chart-signal-marker severity-marker-elevated current"/);
  assert.match(markup, /class="chart-rns-marker"[^>]*data-event-type="RNS"/);
  assert.match(markup, /ShareChat posts observed\. Community analysis is pending/);
  assert.match(markup, /stock_split \(1\/10\) on 2025-10-14/);
  assert.doesNotMatch(markup, /GREEN|ORANGE|RED|YELLOW/);
});
