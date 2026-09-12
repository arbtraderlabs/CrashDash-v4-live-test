/* Lightweight browser consumer for the versioned VNext static contract. */

export function loadBundle(bundle, expectedSchema = "V1") {
  if (!bundle || bundle.schema_version !== expectedSchema ||
      (!bundle.data && !bundle.beginner && !bundle.pro)) {
    throw new Error("unsupported static contract schema version");
  }
  return bundle.data || bundle;
}

function evidenceLabel(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return `<span class="unavailable">${fallback}</span>`;
  }
  return String(value);
}

export function escapeHtml(value) {
  return evidenceLabel(value, "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

export function safeExternalUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function formatPercent(value) {
  return typeof value === "number" ? `${value.toFixed(1)}%` : null;
}

export function formatNumber(value) {
  return typeof value === "number" ? value.toLocaleString("en-GB") : null;
}

export function formatMarketCap(value, currency = "GBP") {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const symbol = currency === "GBP" ? "£" : "";
  const absolute = Math.abs(value);
  const suffix = absolute >= 1e9 ? "bn" : absolute >= 1e6 ? "m" : absolute >= 1e3 ? "k" : "";
  const divisor = suffix === "bn" ? 1e9 : suffix === "m" ? 1e6 : suffix === "k" ? 1e3 : 1;
  const digits = suffix ? (absolute / divisor >= 10 ? 1 : 2) : 0;
  return `${symbol}${(value / divisor).toFixed(digits)}${suffix}`;
}

function trimTrailingZeros(text) {
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

function cleanDisplayText(value, fallback = "") {
  const text = String(value ?? "")
    .replace(/(?:<|&lt;)span\b[^>]*?(?:>|&gt;)(?:<\/span>|&lt;\/span&gt;)?/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;[^&]*&gt;/g, "")
    .trim();
  return text || fallback;
}

/*
 * Single authoritative customer price-display policy, shared by the header,
 * chart axis, and chart inspection panel (docs/architecture/AIM_MARKETCAP_CONTRACT.md;
 * docs/architecture/PRODUCTION_BEHAVIOUR_RATIONALE_REGISTER.md — "Quote unit versus
 * currency"). Never silently rounds a fractional price to an integer, and fails
 * closed (returns null) for units this policy does not certify.
 *
 * quoteUnit:
 *   "GBX" — pence. The certified quote/display unit for LSE/AIM/AQSE instruments
 *           whose currency is GBP. Rendered with a trailing "p".
 *   "GBP" — pounds, already a decimal customer currency value.
 */
export function formatQuotePrice(rawValue, quoteUnit) {
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) return null;
  if (quoteUnit === "GBX") {
    const decimals = Math.abs(rawValue) > 0 && Math.abs(rawValue) < 1 ? 4 : 2;
    return `${trimTrailingZeros(rawValue.toFixed(decimals))}p`;
  }
  if (quoteUnit === "GBP") {
    return trimTrailingZeros(rawValue.toFixed(2));
  }
  return null;
}

export function formatPriceForHeader(rawValue, quoteUnit) {
  return formatQuotePrice(rawValue, quoteUnit);
}

export function formatPriceForInspection(rawValue, quoteUnit) {
  return formatQuotePrice(rawValue, quoteUnit);
}


export function humanDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function card(label, value, detail = "") {
  if (value === null || value === undefined || value === "") return "";
  return `<article class="evidence-card"><p class="card-label">${escapeHtml(label)}</p><p class="card-value">${escapeHtml(value)}</p>${detail ? `<p class="card-detail">${escapeHtml(detail)}</p>` : ""}</article>`;
}

function section(title, content) {
  return content ? `<div class="customer-section"><p class="eyebrow">${escapeHtml(title)}</p>${content}</div>` : "";
}

function socialDescription(evidence) {
  const status = evidence.social_comparison_status;
  if (status === "NO_CHATTER") return "No recorded discussion in the comparison period";
  if (status === "NO_DATA") return "Social discussion data is not currently available";
  if (status === "BASELINE_ZERO") return "Discussion appeared after a period with no recorded chatter";
  if (typeof evidence.social_change_pct === "number") {
    const direction = evidence.social_change_pct >= 0 ? "increased" : "decreased";
    return `Discussion activity ${direction} ${formatPercent(Math.abs(evidence.social_change_pct))}`;
  }
  return "Recorded discussion context is available";
}

function sourceNote(model) {
  if (model.source_quality === "PARTIAL") return "Some supporting information has limited coverage.";
  if (model.source_quality === "PROXY") return "Some activity information comes from an estimated source.";
  if (model.source_quality === "STALE") return "Some supporting information may be out of date.";
  if (model.source_quality === "USABLE_WITH_CAVEAT") return "Some supporting information has limited coverage.";
  return "";
}

function renderMethodologyDetails(model, evidence) {
  const historical = evidence.historical_context;
  const activityDetail = evidence.current_activity !== null && evidence.baseline_activity !== null
    ? `${formatNumber(evidence.current_activity)} versus ${formatNumber(evidence.baseline_activity)}`
    : evidence.activity_multiple !== null
      ? "Production supplied the relative-volume ratio; component volumes are unavailable in this source record."
      : "";
  const activitySource = evidence.activity_ratio_source || evidence.volume_source;
  const details = [
    card("High selection", evidence.high_selection_method, `Reference window: ${evidence.reference_window || "not supplied"}`),
    card("Relative activity ratio", evidence.activity_multiple !== null ? `${evidence.activity_multiple}×` : null, activityDetail),
    card("Activity source", activitySource, "Source and validation detail"),
    card("Historical detail", historical?.methodology_version, historical?.price_basis ? `Price basis: ${historical.price_basis}` : ""),
    card("Historical excursions", historical ? `${formatPercent(historical.median_mfe_pct) || "Unavailable"} / ${formatPercent(historical.median_mae_pct) || "Unavailable"}` : null, "MFE / MAE"),
    card("Historical hit rate", historical ? formatPercent(historical.hit_rate_pct) : null, historical?.truncated_count ? `${historical.truncated_count} truncated observation(s)` : ""),
    card("Historical filters", historical?.filters ? JSON.stringify(historical.filters) : null, "Comparison filters"),
    card("Catalyst source tier", evidence.catalyst?.source_tier, evidence.catalyst?.validation_state || ""),
    card("Validation state", model.source_quality, "Detailed data-quality state"),
    card("Provenance reference", (model.provenance_refs || []).join(", "), "Lineage identifier"),
    card("Temporal classification", model.temporal_class, "Internal temporal context"),
  ].join("");
  return `<details class="methodology-details"><summary>Methodology &amp; data details</summary><p class="context-note">Technical detail is provided for research transparency and is not required to interpret the Pro view.</p><div class="evidence-grid">${details || '<p class="unavailable">Detailed methodology is not currently available.</p>'}</div></details>`;
}

function renderProEvidence(model, evidence) {
  const price = [
    card("Distance from recent high", formatPercent(evidence.price_dislocation_pct), evidence.reference_window ? `Highest price over ${evidence.reference_window}` : ""),
    card("Price change since signal", formatPercent(evidence.return_since_signal_pct)),
  ].join("");
  const activity = [
    card("Trading activity", evidence.activity_multiple ? `${evidence.activity_multiple}× normal activity` : null, evidence.current_activity !== null && evidence.baseline_activity !== null ? `${formatNumber(evidence.current_activity)} versus a recent baseline of ${formatNumber(evidence.baseline_activity)}` : ""),
  ].join("");
  const social = evidence.social_comparison_status
    ? card("Discussion activity", socialDescription(evidence), evidence.social_current_count !== null && evidence.social_previous_count !== null ? `${formatNumber(evidence.social_current_count)} recent mentions versus ${formatNumber(evidence.social_previous_count)} previously` : "")
    : "";
  const historical = evidence.historical_context;
  const horizon = historical?.horizon
    ? historical.horizon.replace(/\s+sessions?$/i, "-session horizon")
    : "Defined comparison horizon";
  const history = historical ? [
    card("Historical comparisons", historical.sample_size === null || historical.sample_size === undefined ? null : `${historical.sample_size} comparable historical observations`, horizon),
    card("Median outcome", formatPercent(historical.median_return_pct)),
    card("Typical middle range", historical.return_quantiles_pct ? `${formatPercent(historical.return_quantiles_pct.p25) || "Unavailable"} to ${formatPercent(historical.return_quantiles_pct.p75) || "Unavailable"}` : null),
  ].join("") : "";
  const catalyst = evidence.catalyst;
  const catalystContent = catalyst ? [
    card("Announcement", `Recent ${catalyst.event_type || "company"} announcement`),
    card("Published", humanDate(catalyst.announced_at)),
    card("Expected event", humanDate(catalyst.expected_date), catalyst.date_certainty === "CONFIRMED" ? "Company-confirmed timing" : "Timing is indicative"),
  ].join("") : "";
  return section("Price context", `<div class="evidence-grid">${price}</div>`) +
    section("Trading activity", `<div class="evidence-grid">${activity}</div>`) +
    section("Social attention", `<div class="evidence-grid">${social || '<p class="unavailable">Social attention evidence is not currently available.</p>'}</div>`) +
    section("Historical context", history ? `<div class="evidence-grid">${history}</div><p class="context-note">Historical observations are descriptive and are not a forecast.</p>` : '<p class="unavailable">Historical context is not currently available.</p>') +
    section("Company catalyst", catalystContent ? `<div class="evidence-grid">${catalystContent}</div><p class="context-note">Company announcement evidence is descriptive. Catalyst Watch remains inactive.</p>` : '<p class="unavailable">Company catalyst evidence is not currently available.</p>');
}

function stateLabel(value) {
  if (!value) return "Context is being assembled";
  return String(value || "Signal context unavailable")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function uniqueMessages(messages) {
  const seen = new Set();
  return messages.filter((message) => {
    const key = message.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function customerMessage(message) {
  const lower = message.toLowerCase();
  if (lower.includes("evidence is unavailable")) return "Some evidence is not currently available.";
  if (lower.includes("mapped from a legacy compatibility field") ||
      lower.includes("activity multiple derived") ||
      lower === "descriptive state only.") return "";
  if (/^\d+(?:\.\d+)?% below the relevant high$/i.test(message)) {
    return message.replace(/the relevant high$/i, "its recent high");
  }
  if (/^trading activity is .+x the baseline$/i.test(message)) {
    return message
      .replace(/^trading activity is /i, "Trading activity is ")
      .replace(/x the baseline$/i, "× its recent normal level");
  }
  if (lower === "an accumulation-like condition was detected") {
    return "An accumulation-like pattern was detected";
  }
  return message;
}

function isImplementationMessage(message) {
  const lower = message.toLowerCase();
  return lower.includes("compatibility") ||
    lower.includes("mapped") ||
    lower.includes("derived") ||
    lower.includes("baseline calculation") ||
    lower.includes("source compatibility record") ||
    lower.includes("compares current activity with a recent baseline") ||
    lower.includes("descriptive research context");
}

function isDataQualityMessage(message) {
  const lower = message.toLowerCase();
  return lower.includes("supporting evidence is incomplete") ||
    lower.includes("supporting information is incomplete");
}

function severityClass(severity) {
  return String(severity || "unavailable")
    .toLowerCase()
    .replace(/[^a-z]+/g, "-")
    .replace(/^-|-$/g, "");
}

/* Metadata styling only — an exchange/market tier colour carries no risk or quality meaning. */
function exchangeTierClass(value) {
  const token = String(value || "").toUpperCase();
  if (token === "LSE") return "lse";
  if (token === "AIM") return "aim";
  if (token === "MAIN") return "main";
  return "other";
}

function enrichment(model) {
  return model.local_enrichment || {};
}

// The three "Company in 30 Seconds" fields are independent: a missing field
// never hides the whole component, and each has its own honest fallback
// copy (never a raw provider string, never fabricated content).
const COMPANY_30S_FIELDS = [
  ["what_they_do", "What they do", "Company description is not currently available."],
  ["why_it_matters", "Why it matters", "Market-relevance context is not currently available."],
  ["current_state", "Current state", "Current company-state evidence is limited."],
];

function isMissingBriefText(text) {
  const lowered = text.toLowerCase();
  return !text || lowered.startsWith("unavailable") || lowered.startsWith("insufficient");
}

function renderCompanyIn30Seconds(brief) {
  const quick = (brief && brief.validation_state === "VALIDATED" && brief.quick_read) || {};
  const cards = COMPANY_30S_FIELDS.map(([key, label, fallback], index) => {
    const item = quick[key] && typeof quick[key] === "object" ? quick[key] : {};
    const rawText = typeof item.text === "string" ? item.text : "";
    const missing = isMissingBriefText(rawText);
    const text = missing ? fallback : rawText;
    const refs = !missing && Array.isArray(item.evidence_refs) ? item.evidence_refs : [];
    const number = String(index + 1).padStart(2, "0");
    return `<article class="c30-card${missing ? " c30-card-missing" : ""}" id="c30-panel-${index}" data-c30-card="${index}" role="tabpanel" aria-labelledby="c30-tab-${index}"><p class="c30-number" aria-hidden="true">${number}</p><h3>${escapeHtml(label)}</h3><p class="c30-text">${escapeHtml(text)}</p>${refs.length ? `<p class="brief-evidence"><a href="#rns-0">View supporting evidence</a> <span>${refs.length} evidence reference(s)</span></p>` : ""}</article>`;
  }).join("");
  const progress = COMPANY_30S_FIELDS.map(([, label], index) =>
    `<button type="button" class="c30-progress-item${index === 0 ? " active" : ""}" data-c30-goto="${index}" role="tab" id="c30-tab-${index}" aria-selected="${index === 0}" aria-controls="c30-panel-${index}"><span class="c30-progress-dot" aria-hidden="true"></span>${escapeHtml(label)}</button>`).join("");
  return `<section class="company-30s" aria-labelledby="company-30s-heading">
    <div class="section-heading"><div><p class="eyebrow">3 things to know</p><h2 id="company-30s-heading">Company in 30 Seconds</h2></div></div>
    <div class="c30-progress" role="tablist" aria-label="Company in 30 Seconds sections">${progress}</div>
    <div class="c30-viewport">
      <button type="button" class="c30-arrow c30-arrow-prev" data-c30-prev aria-label="Previous company summary" disabled>&lsaquo;</button>
      <div class="c30-track" data-c30-track tabindex="0">${cards}</div>
      <button type="button" class="c30-arrow c30-arrow-next" data-c30-next aria-label="Next company summary">&rsaquo;</button>
    </div>
  </section>`;
}

const CHART_PLOT = { left: 44, right: 696, top: 20, bottom: 150 };

/*
 * One shared, deterministic Y-scale used by the price line, every marker
 * type, the inspection hit-targets, and the Y-axis ticks, so all of them
 * agree on where a given price sits vertically. Uses a small fixed padding
 * around the real visible min/max rather than forcing the axis to zero,
 * per the documented Y-axis scale rule (never fabricates a wider/narrower
 * range to exaggerate or flatten real price movement).
 */
function computeYScale(points) {
  const values = (Array.isArray(points) ? points : []).map((point) => Number(point.close)).filter(Number.isFinite);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const padding = span > 0 ? span * 0.08 : Math.max(Math.abs(min), Math.abs(max), 1) * 0.05;
  const paddedMin = min - padding;
  const paddedMax = max + padding;
  const paddedSpan = paddedMax - paddedMin || 1;
  const plotHeight = CHART_PLOT.bottom - CHART_PLOT.top;
  return {
    min, max, paddedMin, paddedMax,
    toY(value) {
      return CHART_PLOT.bottom - ((value - paddedMin) / paddedSpan) * plotHeight;
    },
  };
}

function toX(index, count) {
  return CHART_PLOT.left + ((CHART_PLOT.right - CHART_PLOT.left) * index) / Math.max(1, count - 1);
}

function renderPricePath(points, scale) {
  if (!Array.isArray(points) || points.length < 2 || !scale) return null;
  return points.map((point, index) => {
    const value = Number(point.close);
    if (!Number.isFinite(value)) return "";
    const x = toX(index, points.length);
    const y = scale.toY(value);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).filter(Boolean).join(" ");
}

/* Approximately 4-6 evenly spaced ticks across the real (padded) visible range. */
export function computeYAxisTicks(points, quoteUnit, { tickCount = 5 } = {}) {
  const scale = computeYScale(points);
  if (!scale) return [];
  const ticks = [];
  for (let i = 0; i < tickCount; i += 1) {
    const value = scale.paddedMax - ((scale.paddedMax - scale.paddedMin) * i) / (tickCount - 1);
    const label = formatQuotePrice(value, quoteUnit);
    if (label === null) return [];
    ticks.push({ value, y: scale.toY(value), label });
  }
  return ticks;
}

function xAxisFormat(range) {
  return range === "3M" || range === "6M"
    ? new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" })
    : new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}

/* Sparse, non-overlapping date labels sampled from the real visible points only.
 * Consecutive duplicate labels (e.g. a short visible range landing entirely in
 * one month) are collapsed to a single label rather than repeating it. */
export function computeXAxisLabels(points, range, { labelCount = 5 } = {}) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const format = xAxisFormat(range);
  const count = Math.min(labelCount, points.length);
  const labels = [];
  for (let i = 0; i < count; i += 1) {
    const index = count === 1 ? 0 : Math.round((i * (points.length - 1)) / (count - 1));
    const point = points[index];
    const date = new Date(`${point.date}T00:00:00Z`);
    if (Number.isNaN(date.valueOf())) continue;
    const label = format.format(date);
    if (labels.length && labels[labels.length - 1].label === label) continue;
    labels.push({ index, x: toX(index, points.length), label });
  }
  return labels;
}

/* Maps each price-point index to the Research Alert / RNS events anchored to
 * it, so the fixed inspection panel can show every fact at a shared point
 * (never forcing the reader to hit several overlapping tiny markers). */
function buildPointEvents(points, alertMarkers, rnsMarkers) {
  const byIndex = points.map(() => ({ alert: null, rns: [] }));
  for (const marker of alertMarkers || []) {
    const index = previousPriceIndex(points, marker.date);
    if (index < 0) continue;
    byIndex[index].alert = marker;
  }
  for (const marker of rnsMarkers || []) {
    const index = previousPriceIndex(points, marker.date);
    if (index < 0) continue;
    byIndex[index].rns.push(marker);
  }
  return byIndex;
}

/* Human-readable inspection context for one point's events, shared by the
 * default (server-rendered) panel state and the shell's crosshair/scrub
 * interaction (which reconstructs `point`/`events` from data-chart-* DOM
 * attributes and calls this same function, so the two never disagree). */
export function renderPointEventContext(point, events, quoteUnit) {
  const parts = [];
  if (events?.alert) {
    const severityLabel = escapeHtml(events.alert.severity || "Context unavailable");
    parts.push(`<p class="inspection-alert severity-${severityClassName(events.alert.severity)}">${severityLabel} Research Alert${events.alert.signal_type ? ` · ${escapeHtml(events.alert.signal_type)}` : ""}</p>`);
    if (events.alert.signal_type) {
      parts.push(`<p class="inspection-signal-type">Classification: ${escapeHtml(events.alert.signal_type)}</p>`);
    }
    const priceContext = events.alert.price_context;
    const exactAlertPrice = priceContext?.status === "EXACT"
      ? formatQuotePrice(Number(priceContext.close), quoteUnit)
      : (priceContext?.date === point.date ? formatQuotePrice(Number(point.close), quoteUnit) : null);
    parts.push(
      exactAlertPrice !== null
        ? `<p class="inspection-price-context">Price at alert: ${escapeHtml(exactAlertPrice)}</p>`
        : '<p class="inspection-price-context">Price at alert: unavailable for this exact date.</p>',
    );
    if (events.alert.relative_activity) {
      parts.push(`<p class="inspection-activity">Relative Activity ${escapeHtml(String(events.alert.relative_activity))}×</p>`);
    }
    if (events.alert.accumulation || events.accumulation) {
      parts.push('<p class="inspection-accumulation">Accumulation Detected · Potential accumulation; unusual activity may be appearing around the weakness.</p>');
    }
  } else if (events?.accumulation) {
    parts.push('<p class="inspection-accumulation">Accumulation Detected</p>');
  }
  const rnsEvents = events?.rns || [];
  if (rnsEvents.length) {
    // Root cause of the historical "<span class="unavailable">" leak: escapeHtml()
    // doubles as an "empty value -> visible unavailable placeholder" helper
    // (see evidenceLabel()), which is correct for genuinely-missing fields but
    // wrong for a suffix that is deliberately blank (same-session RNS has no
    // extra date to show). Every optional segment below is filtered out
    // *before* escaping, so escapeHtml() is never called with "".
    const first = rnsEvents[0];
    const firstDateValue = cleanDisplayText(first.date, "");
    const sameSession = firstDateValue === point.date;
    const headline = cleanDisplayText(first.headline, "Company update");
    const extraCount = rnsEvents.length - 1;
    const label = extraCount > 0 ? `${rnsEvents.length} RNS updates` : "RNS";
    const dateText = sameSession ? "" : (humanDate(firstDateValue) || firstDateValue);
    const headlineText = extraCount > 0 ? `${headline} +${extraCount} more` : headline;
    const segments = [label, dateText, headlineText].filter(Boolean).map(escapeHtml);
    // All evidence_ids for this point (not just the first) so the single
    // compact action can expand every RNS anchored here, not only one.
    const evidenceIds = rnsEvents.map((rns) => rns.chart_id).filter(Boolean);
    const openLabel = evidenceIds.length > 1 ? "Open updates" : "Open update";
    const openLink = evidenceIds.length
      ? `<a class="inspection-rns-link" href="#${escapeHtml(evidenceIds[0])}" data-chart-open-rns="${escapeHtml(evidenceIds.join(","))}">${openLabel}</a>`
      : "";
    const line = [...segments, openLink].filter(Boolean).join(" · ");
    parts.push(`<p class="inspection-rns">◆ ${line}</p>`);
    if (!sameSession) {
      const priceLabel = formatQuotePrice(Number(point.close), quoteUnit);
      parts.push(`<p class="inspection-rns-session">Previous session · ${escapeHtml(humanDate(point.date) || point.date)}${priceLabel !== null ? ` · ${escapeHtml(priceLabel)}` : ""}</p>`);
    }
  }
  return parts.join("");
}

function renderInspectionPanel(points, byIndexEvents, quoteUnit) {
  if (!Array.isArray(points) || !points.length) return "";
  const lastIndex = points.length - 1;
  const point = points[lastIndex];
  const price = formatQuotePrice(Number(point.close), quoteUnit);
  const context = renderPointEventContext(point, byIndexEvents[lastIndex], quoteUnit);
  return `<div class="chart-inspection" data-chart-inspection>
    <p class="inspection-date" data-chart-inspection-date>${escapeHtml(humanDate(point.date) || point.date)}</p>
    <p class="inspection-price" data-chart-inspection-price>${price !== null ? escapeHtml(price) : "Exact alert-date price unavailable"}</p>
    <div class="inspection-context" data-chart-inspection-context>${context}</div>
  </div>`;
}

function renderChartInspection(points, byIndexEvents, scale) {
  if (!Array.isArray(points) || points.length < 2 || !scale) return "";
  const hits = points.map((point, index) => {
    const close = Number(point.close);
    if (!Number.isFinite(close)) return "";
    const x = toX(index, points.length);
    const y = scale.toY(close);
    const events = byIndexEvents[index] || {};
    const attrs = [
      `data-chart-date="${escapeHtml(point.date)}"`,
      `data-chart-close="${escapeHtml(String(close))}"`,
    ];
    if (events.alert) {
      attrs.push(`data-chart-severity="${escapeHtml(events.alert.severity || "")}"`);
      if (events.alert.signal_type) attrs.push(`data-chart-signal-type="${escapeHtml(events.alert.signal_type)}"`);
      if (events.alert.relative_activity) attrs.push(`data-chart-activity="${escapeHtml(String(events.alert.relative_activity))}"`);
      if (events.alert.accumulation || events.accumulation) attrs.push('data-chart-accumulation="true"');
    }
    if (events.rns && events.rns.length) {
      const payload = events.rns.map((rns) => ({ headline: rns.headline || "Company update", date: rns.date, chart_id: rns.chart_id, sameSession: rns.date === point.date }));
      attrs.push(`data-chart-rns='${escapeHtml(JSON.stringify(payload))}'`);
    }
    return `<circle class="chart-point-hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" ${attrs.join(" ")}></circle>`;
  }).join("");
  return `${hits}
    <line class="chart-crosshair" data-chart-crosshair x1="0" x2="0" y1="${CHART_PLOT.top}" y2="${CHART_PLOT.bottom}" hidden></line>
    <circle class="chart-crosshair-point" data-chart-crosshair-point r="5" hidden></circle>
    <rect class="chart-scrub-target" x="${CHART_PLOT.left}" y="0" width="${CHART_PLOT.right - CHART_PLOT.left}" height="190" data-chart-scrub></rect>`;
}

const CHART_RANGES = [["1M", 31], ["3M", 92], ["6M", 183], ["1Y", 365], ["2Y", 730], ["FULL", null]];

function chartDataForRange(convergence, range) {
  const points = Array.isArray(convergence.price_points) ? convergence.price_points : [];
  if (!points.length) return { points: [], alerts: [], rns: [], earlierAlerts: 0 };
  const end = points[points.length - 1].date;
  const days = CHART_RANGES.find(([key]) => key === range)?.[1];
  const startDate = days === null
    ? points[0].date
    : new Date(new Date(`${end}T00:00:00Z`).getTime() - days * 86400000).toISOString().slice(0, 10);
  const inRange = (event) => event.date >= startDate && event.date <= end;
  return {
    points: points.filter(inRange),
    alerts: (convergence.alert_markers || []).filter(inRange),
    rns: (convergence.rns_markers || []).filter(inRange),
    earlierAlerts: (convergence.alert_markers || []).filter((event) => event.date < startDate).length,
  };
}

function previousPriceIndex(points, eventDate) {
  let selected = -1;
  for (let index = 0; index < points.length; index += 1) {
    if (points[index].date > eventDate) break;
    selected = index;
  }
  return selected;
}

function renderChartMarkers(points, markers, className, label, scale) {
  if (!Array.isArray(points) || !points.length || !Array.isArray(markers) || !scale) return "";
  return markers.map((marker) => {
    const index = previousPriceIndex(points, marker.date);
    if (index < 0) return "";
    const x = toX(index, points.length);
    const y = scale.toY(Number(points[index].close));
    const severityClass = marker.severity ? ` severity-marker-${severityClassName(marker.severity)}` : "";
    const title = `${label}: ${marker.date}${marker.severity ? ` - ${marker.severity}` : ""}${marker.signal_type ? ` - ${marker.signal_type}` : ""}${marker.relative_activity ? ` - ${marker.relative_activity}x activity` : ""}${marker.accumulation ? " - Accumulation Detected" : ""}`;
    const markerState = marker.current ? " current" : " historical";
    const eventType = marker.event_type || marker.marker_type || (className === "chart-rns-marker" ? "RNS" : "CRASHDASH_SIGNAL");
    const safeEventType = escapeHtml(eventType);
    const shape = className === "chart-rns-marker"
      ? `<rect class="${className}" data-event-type="${safeEventType}" x="${(x - 5).toFixed(1)}" y="${(y - 5).toFixed(1)}" width="10" height="10" transform="rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})" tabindex="0" data-chart-event="${escapeHtml(marker.chart_id || "")}" data-chart-x="${x.toFixed(1)}"><title>${escapeHtml(title)}</title></rect>`
      : marker.current
        ? `<circle class="${className}${severityClass}${markerState}" data-event-type="${safeEventType}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${className === "chart-accumulation-marker" ? "8" : "6.5"}" tabindex="0" data-chart-event="${escapeHtml(marker.chart_id || "")}" data-chart-x="${x.toFixed(1)}"><title>${escapeHtml(title)}</title></circle>`
        : `<circle class="${className}${severityClass}${markerState}" data-event-type="${safeEventType}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${className === "chart-accumulation-marker" ? "8" : "4.5"}" tabindex="0" data-chart-event="${escapeHtml(marker.chart_id || "")}" data-chart-x="${x.toFixed(1)}"><title>${escapeHtml(title)}</title></circle>`;
    return marker.chart_id ? `<a href="#${escapeHtml(marker.chart_id)}" aria-label="${escapeHtml(title)}">${shape}</a>` : shape;
  }).join("");
}

const CHART_SEVERITIES = [
  ["CLOSE WATCH", "Close Watch"],
  ["ELEVATED", "Elevated"],
  ["HIGH", "High"],
  ["EXTREME CAUTION", "Extreme Caution"],
];

function chartFilterState(filters = {}) {
  const severities = filters.severities || {};
  return {
    severities: Object.fromEntries(CHART_SEVERITIES.map(([value]) => [value, severities[value] !== false])),
    accumulation: filters.accumulation !== false,
    rns: filters.rns !== false,
  };
}

function renderChartLegend(filters) {
  const state = chartFilterState(filters);
  const severityButtons = CHART_SEVERITIES.map(([value, label]) => {
    const active = state.severities[value];
    return `<button type="button" class="chart-legend-filter${active ? " active" : ""}" data-chart-filter="severity" data-chart-filter-value="${value}" aria-pressed="${active}" aria-label="Show or hide ${label} Research Alerts" title="Show/hide ${label} Research Alerts"><i class="legend-shape severity-marker-${severityClassName(value)} legend-alert" aria-hidden="true">●</i>${label}</button>`;
  }).join("");
  const accumulation = `<button type="button" class="chart-legend-filter${state.accumulation ? " active" : ""}" data-chart-filter="accumulation" aria-pressed="${state.accumulation}" aria-label="Show or hide accumulation detections" title="Show/hide accumulation detections"><i class="legend-shape legend-accumulation" aria-hidden="true">◉</i>Accumulation</button>`;
  const rns = `<button type="button" class="chart-legend-filter${state.rns ? " active" : ""}" data-chart-filter="rns" aria-pressed="${state.rns}" aria-label="Show or hide company announcements" title="Show/hide company announcements"><i class="legend-shape legend-rns" aria-hidden="true">◆</i>RNS</button>`;
  return `${severityButtons}${accumulation}${rns}<button type="button" class="chart-legend-reset" data-chart-filter-reset>Reset</button>`;
}

function severityClassName(severity) {
  return String(severity || "").toLowerCase().replace(/[^a-z]+/g, "-");
}

function renderAlertHistoryRow(marker) {
  return `<li class="alert-history-row">
        <time datetime="${escapeHtml(marker.date || "")}">${escapeHtml(humanDate(marker.date) || marker.date || "Date unavailable")}</time>
        <span class="alert-history-severity severity-${severityClassName(marker.severity)}">${escapeHtml(marker.severity || "Context unavailable")}</span>
        ${marker.signal_type ? `<span class="alert-history-type">${escapeHtml(marker.signal_type)}</span>` : ""}
        ${marker.relative_activity ? `<span class="alert-history-activity">Relative Activity ${escapeHtml(String(marker.relative_activity))}x</span>` : ""}
        ${marker.accumulation ? '<span class="state-chip accumulation">Accumulation Detected</span>' : ""}
      </li>`;
}

const ALERT_HISTORY_COLLAPSED_COUNT = 5;

/* Collapsed by default (latest 5, newest first) so the history no longer
 * dominates the page. A native <details>/<summary> disclosure holds the
 * remaining rows -- no JS wiring, no modal/popup, and every row stays in
 * the DOM at all times (nothing is discarded, only visually collapsed). */
function renderAlertHistory(markers) {
  if (!Array.isArray(markers) || !markers.length) return "";
  const sorted = markers.slice().sort((left, right) =>
    String(right.date || "").localeCompare(String(left.date || "")));
  const visible = sorted.slice(0, ALERT_HISTORY_COLLAPSED_COUNT);
  const remainder = sorted.slice(ALERT_HISTORY_COLLAPSED_COUNT);
  const visibleRows = visible.map(renderAlertHistoryRow).join("");
  const disclosure = remainder.length
    ? `<details class="alert-history-more"><summary><span class="alert-history-show-all">Show all ${sorted.length} ↓</span><span class="alert-history-collapse">Collapse ↑</span></summary><ol class="alert-history-hidden">${remainder.map(renderAlertHistoryRow).join("")}</ol></details>`
    : "";
  return `<section class="alert-history" aria-labelledby="alert-history-heading"><div class="section-heading"><div><p class="eyebrow">Research Alerts</p><h2 id="alert-history-heading">Research Alert History</h2></div><span class="state-chip placeholder">${sorted.length} recorded</span></div><ol class="alert-history-visible">${visibleRows}</ol>${disclosure}</section>`;
}

function eventDateValue(item) {
  return item?.timestamp || item?.datetime || item?.date || "";
}

function compareNewestFirst(left, right) {
  const normalize = (value) => String(value || "").replace(/^(\d{1,2})(st|nd|rd|th)\b/i, "$1");
  const rightValue = normalize(eventDateValue(right));
  const leftValue = normalize(eventDateValue(left));
  const difference = Date.parse(rightValue) - Date.parse(leftValue);
  return Number.isNaN(difference) || difference === 0
    ? rightValue.localeCompare(leftValue)
    : difference;
}

function renderResearchSections(model, chartRange = "1Y", primaryContext = "", filters = {}) {
  const accumulation = model.accumulation_state === "DETECTED";
  const local = enrichment(model);
  const profile = model.profile && typeof model.profile === "object" ? model.profile : {};
  const metadata = local.metadata || {};
  const convergence = local.convergence || {};
  const chartData = chartDataForRange(convergence, chartRange);
  const points = Array.isArray(convergence.price_points) ? chartData.points : (local.price_history || []);
  const quoteUnit = metadata.quote_unit_status === "CERTIFIED_LOCAL_SOURCE" ? metadata.quote_unit : null;
  const scale = computeYScale(points);
  const pricePath = renderPricePath(points, scale);
  const filterState = chartFilterState(filters);
  const alertMarkers = chartData.alerts
    .filter((marker) => filterState.severities[marker.severity])
    .map((marker) => ({ ...marker, accumulation: filterState.accumulation && marker.accumulation }));
  const profileRns = Array.isArray(profile.rns?.records) ? profile.rns.records : [];
  const rnsRecords = profileRns.length ? profileRns : chartData.rns;
  const rnsMarkers = filterState.rns
    ? rnsRecords.map((item, index) => ({ ...item, chart_id: `rns-${index}` }))
    : [];
  const byIndexEvents = buildPointEvents(points, alertMarkers, rnsMarkers);
  if (filterState.accumulation) {
    for (const marker of chartData.alerts.filter((item) => item.accumulation)) {
      const index = previousPriceIndex(points, marker.date);
      if (index >= 0) byIndexEvents[index].accumulation = true;
    }
  }
  const chartMarkers = renderChartMarkers(points, alertMarkers, "chart-signal-marker", "Research Alert", scale);
  const hasAccumulationMarker = accumulation || alertMarkers.some((item) => item.accumulation);
  const accumulationMarkers = renderChartMarkers(
    points,
    filterState.accumulation ? chartData.alerts.filter((marker) => marker.accumulation) : [],
    "chart-accumulation-marker",
    "Accumulation",
    scale,
  );
  const rnsChartMarkers = renderChartMarkers(points, rnsMarkers, "chart-rns-marker", "RNS", scale);
  const inspectionHits = renderChartInspection(points, byIndexEvents, scale);
  const inspectionPanel = renderInspectionPanel(points, byIndexEvents, quoteUnit);
  const yAxisTicks = computeYAxisTicks(points, quoteUnit);
  const xAxisLabels = computeXAxisLabels(points, chartRange, { labelCount: 4 });
  const yAxisMarkup = yAxisTicks.map((tick) => `<text class="chart-axis-label chart-y-axis-label" x="${CHART_PLOT.left - 6}" y="${tick.y.toFixed(1)}" text-anchor="end" dominant-baseline="middle">${escapeHtml(tick.label)}</text>`).join("");
  const xAxisMarkup = xAxisLabels.map((tick) => `<text class="chart-axis-label chart-x-axis-label" x="${tick.x.toFixed(1)}" y="${CHART_PLOT.bottom + 16}" text-anchor="middle">${escapeHtml(tick.label)}</text>`).join("");
  const gridlineMarkup = yAxisTicks.map((tick) => `M${CHART_PLOT.left} ${tick.y.toFixed(1)}H${CHART_PLOT.right}`).join("");
  const sourceDate = local.source_as_of ? `Source refreshed ${escapeHtml(local.source_as_of)}` : "Local source date unavailable";
  const rangeControls = CHART_RANGES.map(([key]) => `<button type="button" class="chart-range${chartRange === key ? " active" : ""}" data-chart-range="${key}" aria-pressed="${chartRange === key}">${key === "FULL" ? "ALL" : key}</button>`).join("");
  const earlierNote = chartData.earlierAlerts ? `<p class="chart-note">${chartData.earlierAlerts} earlier Research Alert(s) exist outside this range.</p>` : "";
  const socialRecords = Array.isArray(model.social_records) ? model.social_records : [];
  const socialSnapshot = (model.sharechat_snapshot || profile.sharechat_snapshot) &&
    typeof (model.sharechat_snapshot || profile.sharechat_snapshot) === "object"
    ? (model.sharechat_snapshot || profile.sharechat_snapshot) : null;
  const socialStatus = model.social_status || "NO_DATA";
  const socialText = socialSnapshot?.analysis_status === "AVAILABLE"
    ? `${socialSnapshot.total_posts || 0} ShareChat posts observed. ${socialSnapshot.sentiment ? `Sentiment: ${socialSnapshot.sentiment}.` : ""} ${socialSnapshot.summary || "No stored community summary is available."}`
    : socialSnapshot?.analysis_status === "ANALYSIS_PENDING"
      ? `${socialSnapshot.total_posts || 0} ShareChat posts observed. Community analysis is pending.`
      : socialSnapshot?.analysis_status === "NOT_AVAILABLE"
        ? "ShareChat community analysis is not currently available."
        : socialStatus === "READY"
    ? `${socialRecords.length} recorded discussion item(s) are available.`
    : socialStatus === "STALE"
      ? "Stored discussion context is stale and should not be read as current."
      : socialStatus === "UNAVAILABLE"
        ? "ShareChat discussion data is not currently available."
        : "No recorded discussion is available for this view.";
  const storedResearch = profile.research && typeof profile.research === "object"
    ? profile.research : null;
  const ai = model.ai_analysis || storedResearch?.data;
  const aiText = ai && typeof ai === "object"
    ? (ai.summary || ai.text || ai.analysis || "Stored analysis is available.")
    : model.ai_status === "ANALYSIS_PENDING"
      ? "Analysis has not run for this signal."
      : model.ai_status === "INTELLIGENCE_UNAVAILABLE"
        ? "Stored analysis is not currently available."
        : "No stored analysis is available.";
  const aiTimestamp = ai && typeof ai === "object" ? (ai.completed_at || ai.updated_at || ai.source_timestamp) : null;
  const rnsVisible = rnsMarkers.slice().sort(compareNewestFirst).slice(0, 20);
  const rnsAvailable = Math.max(
    rnsVisible.length,
    Number.isFinite(Number(profile.rns?.total_available))
      ? Number(profile.rns.total_available)
      : Number.isFinite(Number(model.rns_total_available)) ? Number(model.rns_total_available) : 0,
  );
  const rnsInitial = rnsVisible.slice(0, 5);
  const rnsRemaining = rnsVisible.slice(5);
  const renderRns = (item) => {
    const dateValue = cleanDisplayText(eventDateValue(item), "");
    const rating = ["BULLISH", "NEUTRAL", "BEARISH"].includes(String(item.category || item.rating || item.sentiment).toUpperCase())
      ? String(item.category || item.rating || item.sentiment).toUpperCase()
      : "";
    const sourceUrl = safeExternalUrl(item.url || item.source_url);
    return `<details class="rns-evidence" id="${escapeHtml(item.chart_id || "")}"><summary>${escapeHtml(cleanDisplayText(item.headline, "Company update"))} &middot; ${escapeHtml(humanDate(dateValue) || dateValue || "Date unavailable")}</summary><p class="rns-meta">Official company announcement · ${escapeHtml(item.source || "RNS")}${rating ? ` · Rating: ${escapeHtml(rating)}` : ""}${item.rns_number ? ` · ${escapeHtml(item.rns_number)}` : ""}</p><div class="rns-content">${escapeHtml(item.content || item.full_content || "Full announcement text is not available in this local evidence record.")}</div>${sourceUrl ? `<p class="research-source"><a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">Original source</a></p>` : ""}</details>`;
  };
  const rnsSummary = rnsRemaining.length
    ? `<details class="evidence-more"><summary><span class="rns-show-more">Show more</span><span class="rns-showing-expanded">Showing latest ${rnsVisible.length} of ${rnsAvailable} · Show less</span></summary>${rnsRemaining.map(renderRns).join("")}</details>`
    : "";
  const socialTotal = Number.isFinite(Number(model.sharechat_total_available)) ? Number(model.sharechat_total_available) : socialRecords.length;
  const socialInitial = socialRecords.slice(0, 10);
  const socialRemaining = socialRecords.slice(10);
  const renderSocial = (item) => `<li>${escapeHtml(item.text || item.content || item.headline || "Community discussion item")}${item.date ? ` · ${escapeHtml(String(item.date))}` : ""}</li>`;
  const corporateActions = model.corporate_actions && typeof model.corporate_actions === "object"
    ? model.corporate_actions : null;
  const corporateActionText = corporateActions?.status === "AVAILABLE" && Array.isArray(corporateActions.events) && corporateActions.events.length
    ? corporateActions.events.map((event) => `${event.type || "Corporate action"}${event.ratio_display ? ` (${event.ratio_display})` : ""}${event.date ? ` on ${event.date}` : ""}`).join("; ")
    : corporateActions?.status === "VALID_EMPTY"
      ? "No corporate actions are recorded in the public profile."
      : "Corporate-action history is not currently available.";
  return `<section class="chart-card" aria-label="CrashDash History chart">
      <div class="section-heading"><div><p class="eyebrow">CrashDash History</p><h2>CrashDash History</h2><p class="chart-subtitle">Price · Research Alerts · Accumulation · Company Announcements</p></div><div class="chart-legend" aria-label="Chart event filters">${renderChartLegend(filterState)}</div></div>
      <div class="chart-ranges" aria-label="Chart history range">${rangeControls}</div>
      ${inspectionPanel}
      <div class="signal-chart chart-plot" data-chart-quote-unit="${escapeHtml(quoteUnit || "")}">
        <svg viewBox="0 0 720 190" role="img" aria-label="${pricePath ? "CrashDash History price line with signal markers" : "Illustrative CrashDash History line; source price history unavailable"}">
          <defs><linearGradient id="chart-area-gradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#70c3ff"></stop><stop offset="1" stop-color="#70c3ff" stop-opacity="0"></stop></linearGradient></defs>
          <path class="chart-gridline" d="${gridlineMarkup || `M${CHART_PLOT.left} 44H${CHART_PLOT.right}M${CHART_PLOT.left} 85H${CHART_PLOT.right}M${CHART_PLOT.left} 126H${CHART_PLOT.right}`}"></path>
          ${pricePath ? `<path class="chart-area" d="${pricePath} L${CHART_PLOT.right} ${CHART_PLOT.bottom} L${CHART_PLOT.left} ${CHART_PLOT.bottom} Z"></path>` : ""}
          <path class="chart-line" d="${pricePath || `M${CHART_PLOT.left} 108 C112 98, 138 122, 194 82 S278 54, 334 88 S422 32, 478 56 S580 102, ${CHART_PLOT.right} 22`}"></path>
          ${chartMarkers || (!pricePath ? `<circle class="chart-signal-marker" cx="${CHART_PLOT.right}" cy="22" r="7"></circle>` : "")}
          ${accumulationMarkers}
          ${rnsChartMarkers}
          ${yAxisMarkup}
          ${xAxisMarkup}
          ${inspectionHits}
        </svg>
        ${hasAccumulationMarker ? '<span class="chart-accessibility-note">Accumulation patterns are shown with purple halos.</span>' : ""}
      </div>
      <p class="chart-note">${pricePath ? `Source price history shown for context only. ${sourceDate}.` : "Illustrative signal path. A source price series is not currently available, so CrashDash does not infer values."}</p>${earlierNote}
    </section>${renderAlertHistory(convergence.alert_markers)}${primaryContext}
    <section class="research-cards" aria-labelledby="research-intelligence-heading">
      <div class="section-heading"><div><p class="eyebrow">AI-enhanced research</p><h2 id="research-intelligence-heading">Research intelligence</h2></div><span class="state-chip placeholder">Evidence-led summary</span></div>
      <article class="research-card"><h3>CrashDash intelligence</h3><p>CrashDash noticed this instrument because the evidence listed above aligned with a ${escapeHtml(model.watch_severity || "current")} signal.</p></article>
      <article class="research-card"><h3>Official RNS evidence</h3><p>${rnsAvailable ? `${rnsAvailable} announcements found · showing latest ${rnsInitial.length}` : "RNS announcements are not currently available."}</p>${rnsInitial.map(renderRns).join("")}${rnsSummary}</article>
      <article class="research-card"><h3>ShareChat context</h3><p>${escapeHtml(socialText)}${socialSnapshot ? "" : (socialTotal ? ` Showing the latest ${Math.min(10, socialInitial.length)} of ${socialTotal}.` : "")}</p>${socialInitial.length ? `<ol class="community-list">${socialInitial.map(renderSocial).join("")}</ol>` : ""}${socialRemaining.length ? `<details class="evidence-more"><summary>Show more community discussion</summary><ol class="community-list">${socialRemaining.map(renderSocial).join("")}</ol></details>` : ""}</article>
      ${corporateActions ? `<article class="research-card"><h3>Corporate actions</h3><p>${escapeHtml(corporateActionText)}</p></article>` : ""}
      <article class="research-card"><h3>Stored AI analysis</h3><p>${escapeHtml(aiText)}</p>${aiTimestamp ? `<p class="research-source">Source timestamp: ${escapeHtml(String(aiTimestamp))}</p>` : ""}</article>
      <article class="research-card"><h3>Risk flags</h3><p>Review the data-quality note and unavailable evidence before drawing conclusions.</p></article>
    </section>`;
}

export function renderBeginner(model, { forPro = false, chartRange = "1Y", chartFilters = {} } = {}) {
  const reasons = uniqueMessages(
    (model.why_crashdash_noticed || [])
      .filter(Boolean)
      .map(customerMessage)
      .filter(Boolean)
      .filter((message) => !isDataQualityMessage(message))
      .filter((message) => !isImplementationMessage(message)),
  );
  const notices = uniqueMessages([
    ...reasons,
    ...(model.limitations || []).filter(Boolean).map(customerMessage).filter(Boolean),
  ]);
  const reasonMarkup = reasons
    .map((reason) => `<li>${escapeHtml(reason)}</li>`)
    .join("");
  const stale = model.freshness === "STALE" ? '<span class="state-chip stale">Data may be out of date</span>' : "";
  const missing = notices.some((item) => item.toLowerCase().includes("not currently available"))
    ? '<span class="state-chip partial">Some evidence is not currently available</span>' : "";
  const partial = model.data_quality === "PARTIAL" ||
    notices.some((item) => item.toLowerCase().includes("incomplete"))
    ? '<span class="state-chip partial">Some evidence is incomplete</span>' : "";
  const proxy = notices.some((item) => item.toLowerCase().includes("estimated"))
    ? '<span class="state-chip proxy">Estimated activity source</span>' : "";
  const caveat = model.freshness === "STALE" || partial || proxy
    ? '<p class="context-note">CrashDash shows the available evidence and flags where it may need more context.</p>' : "";
  const severity = model.watch_severity || "UNAVAILABLE";
  const severityToken = severityClass(severity);
  const accumulationBadge = model.accumulation_state === "DETECTED"
    ? '<span class="state-chip accumulation-badge">Accumulation Detected</span><span class="accumulation-helper">Potential accumulation: unusual activity may be appearing around the weakness.</span>' : "";
  const dataNote = partial ? '<p class="data-note"><strong>Data note</strong> Some supporting information is incomplete.</p>' : "";
  const localMetadata = model.local_enrichment?.metadata || {};
  const companyName = localMetadata.company_name
    ? `<p class="instrument-company" title="${escapeHtml(localMetadata.company_name)}">${escapeHtml(localMetadata.company_name)}</p>`
    : "";
  const priceCertified = localMetadata.current_close !== null && localMetadata.current_close !== undefined &&
    (localMetadata.quote_unit_status === "CERTIFIED_LOCAL_SOURCE" || (!localMetadata.quote_unit_status && localMetadata.currency === "GBP"));
  // Missing quote_unit on an otherwise-certified GBP record is treated as plain
  // decimal GBP (the pre-existing, conservative fallback); only an explicit
  // "GBX" quote_unit is displayed in pence. This never guesses pence.
  const effectiveQuoteUnit = localMetadata.quote_unit || (localMetadata.currency === "GBP" ? "GBP" : null);
  const priceDisplay = priceCertified ? formatQuotePrice(localMetadata.current_close, effectiveQuoteUnit) : null;
  const priceCurrencyLabel = localMetadata.currency || localMetadata.quote_unit;
  const priceMetric = priceDisplay
    ? `<div class="instrument-metric metric-price"><p class="metric-heading">Price <span class="metric-currency">${escapeHtml(priceCurrencyLabel)}</span></p><p class="metric-value">${escapeHtml(priceDisplay)}</p></div>`
    : "";
  const capMetric = typeof localMetadata.market_cap === "number"
    ? `<div class="instrument-metric metric-cap"><p class="metric-heading">Cap</p><p class="metric-value metric-cap-value">${escapeHtml(formatMarketCap(localMetadata.market_cap, localMetadata.currency))}</p></div>`
    : "";
  const exchangeParts = [
    localMetadata.exchange ? `<span class="exchange-primary exchange-${exchangeTierClass(localMetadata.exchange)}">${escapeHtml(localMetadata.exchange)}</span>` : "",
    localMetadata.market ? `<span class="exchange-tier exchange-${exchangeTierClass(localMetadata.market)}">${escapeHtml(localMetadata.market)}</span>` : "",
  ].filter(Boolean).join(" ");
  const exchangeMetric = exchangeParts
    ? `<div class="instrument-metric metric-exchange"><p class="metric-heading">Exchange</p><p class="metric-value">${exchangeParts}</p></div>`
    : "";
  const metricsRow = [priceMetric, capMetric, exchangeMetric].filter(Boolean).join("");
  const contextItems = [
    localMetadata.sector ? `<span class="context-item"><span class="context-label">Sector:</span> <span class="context-value">${escapeHtml(localMetadata.sector)}</span></span>` : "",
    localMetadata.industry ? `<span class="context-item"><span class="context-label">Ind:</span> <span class="context-value">${escapeHtml(localMetadata.industry)}</span></span>` : "",
  ].filter(Boolean).join("");
  const contextRow = contextItems ? `<div class="instrument-context-row">${contextItems}</div>` : "";
  const signalDate = model.signal_date
    ? `<p class="instrument-meta">Signal detected ${escapeHtml(humanDate(model.signal_date))}</p>`
    : "";
  const primaryContext = `<div class="customer-section"><p class="eyebrow">Primary context</p><h2>Why CrashDash noticed this</h2><ul class="reason-list">${reasonMarkup || "<li>Some evidence is not currently available.</li>"}</ul>${caveat}${!forPro ? dataNote : ""}<p class="context-note">Research context only — not a trading recommendation.</p></div>`;
  return `<section class="customer-view severity-${severityToken}" data-mode="beginner">
    <div class="instrument-heading">
      <div class="instrument-identity"><p class="eyebrow">Instrument profile</p><h1>${escapeHtml(model.ticker || "Unknown instrument")}</h1>${companyName}</div>
      ${metricsRow ? `<div class="instrument-metrics">${metricsRow}</div>` : ""}
    </div>
    ${contextRow}
    <div class="instrument-state">
      ${signalDate}
      <p class="eyebrow">Crash Severity</p>
      <div class="instrument-state-row"><p class="signal-state">${escapeHtml(severity === "UNAVAILABLE" ? "Context is being assembled" : severity)}</p>${accumulationBadge}</div>
      <div class="state-chips">${stale}${proxy}${missing}${partial}</div>
    </div>
    ${renderCompanyIn30Seconds(model.research_brief)}
    ${renderResearchSections(model, chartRange, primaryContext, chartFilters)}
  </section>`;
}

export function renderPro(model, { chartRange = "1Y", chartFilters = {} } = {}) {
  const evidence = model.exact_evidence || {};
  const note = sourceNote(model);
  return `<section class="customer-view mode-pro" data-mode="pro">
    ${renderBeginner(model, { forPro: true, chartRange, chartFilters })}
    <div class="customer-section"><p class="eyebrow">Pro research context</p><h2>Useful evidence for experienced readers</h2>${renderProEvidence(model, evidence)}${note ? `<p class="data-note"><strong>Data note</strong> ${escapeHtml(note)}</p>` : ""}${renderMethodologyDetails(model, evidence)}</div>
  </section>`;
}

export function renderDashboard(records, selectedInstrument = "", filters = {}) {
  if (!records.length) {
    return '<section class="status dashboard-empty"><p>No current CrashDash signals are available.</p></section>';
  }
  const severity = filters.severity || "ALL";
  const accumulationOnly = filters.accumulationOnly === true;
  const sort = filters.sort || "severity";
  const severityOrder = {
    "EXTREME CAUTION": 0,
    HIGH: 1,
    ELEVATED: 2,
    "CLOSE WATCH": 3,
  };
  const visibleRecords = records
    .filter((record) => severity === "ALL" || record.watch_severity === severity)
    .filter((record) => !accumulationOnly || record.accumulation_state === "DETECTED")
    .slice()
    .sort((left, right) => {
      if (sort === "newest") {
        return String(right.signal_date || "").localeCompare(String(left.signal_date || "")) ||
          String(left.ticker).localeCompare(String(right.ticker));
      }
      return (severityOrder[left.watch_severity] ?? 99) - (severityOrder[right.watch_severity] ?? 99) ||
        String(right.signal_date || "").localeCompare(String(left.signal_date || "")) ||
        String(left.ticker).localeCompare(String(right.ticker));
    });
  const rows = visibleRecords.map((record) => {
    const selected = record.instrument_id === selectedInstrument;
    const accumulation = record.accumulation_state === "DETECTED"
      ? '<span class="dashboard-chip accumulation">Accumulation Detected</span>'
      : "";
    const quality = record.data_quality === "PARTIAL"
      ? '<span class="dashboard-chip partial">Partial data</span>'
      : "";
    const company = record.company_name
      ? `<span class="dashboard-company">${escapeHtml(record.company_name)}</span>`
      : "";
   return `<button class="dashboard-row${selected ? " selected" : ""}" type="button" data-instrument-id="${escapeHtml(record.instrument_id)}" aria-pressed="${selected}">
     <span class="dashboard-identity"><strong>${escapeHtml(record.ticker)}</strong>${company}</span>
     <span class="dashboard-severity severity-${severityClass(record.watch_severity)}">${escapeHtml(record.watch_severity || "Context unavailable")}</span>
     <span class="dashboard-date">Signal detected ${escapeHtml(humanDate(record.signal_date) || "date unavailable")}</span>
      <span class="dashboard-chips">${accumulation}${quality}<span class="row-research-link">View research →</span></span>
    </button>`;
  }).join("");
  const filterButton = (value, label) =>
   `<button type="button" class="filter-button${severity === value ? " active" : ""}" data-severity-filter="${value}" aria-pressed="${severity === value}">${label}</button>`;
  return `<section class="dashboard-panel" aria-labelledby="current-signals-heading">
    <div class="dashboard-heading"><div><p class="eyebrow">Current signal universe</p><h2 id="current-signals-heading">Current CrashDash signals</h2></div><p class="dashboard-count">${visibleRecords.length} of ${records.length} instruments</p></div>
    <div class="dashboard-controls" aria-label="Dashboard filters">
      <div class="filter-group">${filterButton("ALL", "All")}${filterButton("EXTREME CAUTION", "Extreme caution")}${filterButton("HIGH", "High")}${filterButton("ELEVATED", "Elevated")}${filterButton("CLOSE WATCH", "Close watch")}</div>
      <label class="filter-toggle"><input type="checkbox" data-accumulation-filter ${accumulationOnly ? "checked" : ""}> Accumulation</label>
      <label class="sort-control">Sort <select data-dashboard-sort><option value="severity" ${sort === "severity" ? "selected" : ""}>Severity</option><option value="newest" ${sort === "newest" ? "selected" : ""}>Newest</option></select></label>
    </div>
    <div class="dashboard-list">${rows || '<p class="dashboard-empty">No instruments match these filters.</p>'}</div>
  </section>`;
}

export function renderMode(bundle, mode = "beginner") {
  const model = loadBundle(bundle);
  if (mode === "beginner") return renderBeginner(model.beginner || model);
  if (mode === "pro") return renderPro(model.pro || model);
  throw new Error("unsupported presentation mode");
}
