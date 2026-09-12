/* Pure view rendering, filtering, and pagination helpers for the CrashDash
 * VNext application shell. These functions take plain data in and return
 * HTML strings or plain values out, so they can be unit tested without a
 * DOM (see tests/browser/vnext_shell.test.js).
 */

import { escapeHtml, formatMarketCap, formatNumber, humanDate, safeExternalUrl } from "./browser.js?v=004j";

export const SEVERITY_ORDER = Object.freeze({
  "EXTREME CAUTION": 0,
  HIGH: 1,
  ELEVATED: 2,
  "CLOSE WATCH": 3,
});

export const SEVERITY_TIERS = Object.freeze([
  "EXTREME CAUTION",
  "HIGH",
  "ELEVATED",
  "CLOSE WATCH",
]);

export const PAGE_SIZE_OPTIONS = Object.freeze([25, 50, 100]);

/* --- Shared small helpers -------------------------------------------- */

function relativeActivityLabel(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? `${numeric}\u00d7 relative activity` : null;
}

function severityRank(record) {
  return SEVERITY_ORDER[record.watch_severity] ?? 99;
}

function ageInDays(signalDate, asOf) {
  if (!signalDate || !asOf) return null;
  const signal = new Date(signalDate);
  const reference = new Date(asOf);
  if (Number.isNaN(signal.valueOf()) || Number.isNaN(reference.valueOf())) return null;
  return Math.round((reference - signal) / 86400000);
}

/* Whether every visible record shares the same value for `field`. When
 * true, showing that value on every row adds no information, so callers
 * should surface it once (a toolbar note) instead of a repeated per-row
 * badge or column (see VN-UI-002 ticket, "data quality" section). */
export function columnHasVariation(records, field) {
  if (records.length === 0) return false;
  const first = records[0][field];
  return records.some((record) => record[field] !== first);
}

/* --- Today ------------------------------------------------------------ */

export function summariseToday(dashboardRecords, asOf, recentWindowDays = 7) {
  const severityCounts = { "EXTREME CAUTION": 0, HIGH: 0, ELEVATED: 0, "CLOSE WATCH": 0 };
  let accumulationCount = 0;
  let recentCount = 0;
  let todayCount = 0;
  for (const record of dashboardRecords) {
    if (record.watch_severity in severityCounts) severityCounts[record.watch_severity] += 1;
    if (record.accumulation_state === "DETECTED") accumulationCount += 1;
    const age = ageInDays(record.signal_date, asOf);
    if (age === 0) todayCount += 1;
    if (age !== null && age >= 0 && age <= recentWindowDays) recentCount += 1;
  }
  return {
    currentCount: dashboardRecords.length,
    todayCount,
    recentCount,
    recentWindowDays,
    severityCounts,
    accumulationCount,
  };
}

export function selectTodayAlerts(dashboardRecords, asOf, limit = 6) {
  const today = dashboardRecords.filter((record) => ageInDays(record.signal_date, asOf) === 0);
  const candidates = today.length ? today : dashboardRecords;
  return candidates
    .slice()
    .sort((left, right) => {
      const dateOrder = String(right.signal_date || "").localeCompare(String(left.signal_date || ""));
      if (dateOrder !== 0) return dateOrder;
      const severityOrder = severityRank(left) - severityRank(right);
      if (severityOrder !== 0) return severityOrder;
      return String(left.ticker).localeCompare(String(right.ticker));
    })
    .slice(0, limit);
}

export function selectFeaturedSignals(dashboardRecords, limit = 5) {
  return dashboardRecords
    .slice()
    .sort((left, right) => {
      const dateOrder = String(right.signal_date || "").localeCompare(String(left.signal_date || ""));
      if (dateOrder !== 0) return dateOrder;
      const severityOrder = severityRank(left) - severityRank(right);
      if (severityOrder !== 0) return severityOrder;
      return String(left.ticker).localeCompare(String(right.ticker));
    })
    .slice(0, limit);
}

export function renderToday(summary, featured) {
  const tierCards = SEVERITY_TIERS.map((tier) => `
    <article class="metric-card">
      <p class="metric-label">${escapeHtml(tier === "CLOSE WATCH" ? "Close watch" : tier.charAt(0) + tier.slice(1).toLowerCase())}</p>
      <p class="metric-value">${summary.severityCounts[tier]}</p>
    </article>`).join("");
  const featuredMarkup = featured.map((record) => {
    const activity = relativeActivityLabel(record.relative_activity);
    const severityClass = String(record.watch_severity || "unavailable").toLowerCase().replace(/[^a-z]+/g, "-");
    const company = record.company_name
      ? `<p class="featured-company">${escapeHtml(record.company_name)}</p>` : "";
    const orientation = [
      record.exchange || record.market ? `${record.exchange || "Exchange unavailable"}${record.market ? ` / ${record.market}` : ""}` : "",
      typeof record.market_cap === "number" ? formatMarketCap(record.market_cap, record.currency) : "",
    ].filter(Boolean).join(" · ");
    const accumulation = record.accumulation_state === "DETECTED"
      ? '<span class="dashboard-chip accumulation">Accumulation Detected</span>' : "";
    return `<li class="featured-card severity-${severityClass}">
      <div class="featured-heading"><div><span class="featured-kicker">Research Alert</span><strong>${escapeHtml(record.ticker)}</strong>${company}</div><span class="featured-severity">${escapeHtml(record.watch_severity || "Context unavailable")}</span></div>
      ${orientation ? `<p class="featured-orientation">${escapeHtml(orientation)}</p>` : ""}
      <p class="featured-meta">Alert created ${escapeHtml(humanDate(record.signal_date) || "date unavailable")}</p>
      ${activity || accumulation ? `<div class="featured-evidence">${activity ? `<span class="dashboard-chip activity">${escapeHtml(activity)}</span>` : ""}${accumulation}</div>` : ""}
      <a class="featured-link" href="?view=current&amp;ticker=${encodeURIComponent(record.instrument_id)}">Continue research &rarr;</a>
    </li>`;
  }).join("");
  const hasToday = summary.todayCount > 0;
  const heading = hasToday ? "Today's Research Alerts" : "No new Research Alerts today.";
  const supportingCopy = hasToday
    ? "CrashDash flagged these companies today."
    : "Here are the most recent companies CrashDash flagged for further research.";
  const recentHeading = hasToday ? "Today's Research Alerts" : "Most recent Research Alerts";
  return `<section class="view-today" aria-labelledby="today-heading">
    <div class="view-heading"><div><p class="eyebrow">Morning briefing</p><h1 id="today-heading">${heading}</h1><p class="briefing-copy">${supportingCopy}</p></div><a class="today-all-link" href="?view=current">View all Research Alerts &rarr;</a></div>
    <div class="metric-grid">
      <article class="metric-card"><p class="metric-label">Current Research Alerts</p><p class="metric-value">${summary.currentCount}</p></article>
      <article class="metric-card"><p class="metric-label">New today</p><p class="metric-value">${summary.todayCount}</p></article>
      <article class="metric-card"><p class="metric-label">New in last ${summary.recentWindowDays} days</p><p class="metric-value">${summary.recentCount}</p></article>
      ${tierCards}
      <article class="metric-card"><p class="metric-label">Accumulation patterns</p><p class="metric-value">${summary.accumulationCount}</p></article>
    </div>
    <div class="view-heading"><h2>${recentHeading}</h2><p class="dashboard-count">Newest alert date first, severity as secondary context</p></div>
    <ul class="featured-list">${featuredMarkup || '<li class="dashboard-empty">No current CrashDash signals are available.</li>'}</ul>
  </section>`;
}

/* --- Current signals workspace ---------------------------------------- */

export function filterCurrentRecords(records, filters) {
  const severity = filters.severity || "ALL";
  const accumulationOnly = filters.accumulationOnly === true;
  const exchange = filters.exchange || "ALL";
  return records.filter((record) =>
    (severity === "ALL" || record.watch_severity === severity) &&
    (!accumulationOnly || record.accumulation_state === "DETECTED") &&
    (exchange === "ALL" || record.exchange === exchange));
}

export function sortCurrentRecords(records, sort) {
  return records.slice().sort((left, right) => {
    if (sort === "newest") {
      return String(right.signal_date || "").localeCompare(String(left.signal_date || "")) ||
        String(left.ticker).localeCompare(String(right.ticker));
    }
    return severityRank(left) - severityRank(right) ||
      String(right.signal_date || "").localeCompare(String(left.signal_date || "")) ||
      String(left.ticker).localeCompare(String(right.ticker));
  });
}

export function availableExchanges(records) {
  return [...new Set(records.map((record) => record.exchange).filter(Boolean))].sort();
}

function severityFilterBar(activeSeverity, dataAttribute) {
  const tiers = [["ALL", "All"], ...SEVERITY_TIERS.map((tier) => [tier, tier === "CLOSE WATCH" ? "Close watch" : tier.charAt(0) + tier.slice(1).toLowerCase()])];
  return tiers.map(([value, label]) =>
    `<button type="button" class="filter-button${activeSeverity === value ? " active" : ""}" data-${dataAttribute}="${value}" aria-pressed="${activeSeverity === value}">${label}</button>`).join("");
}

export function renderCurrentList(allRecords, selectedInstrumentId, filters) {
  if (allRecords.length === 0) {
    return '<section class="status dashboard-empty"><p>No current Research Alerts are available.</p></section>';
  }
  const filtered = filterCurrentRecords(allRecords, filters);
  const visible = sortCurrentRecords(filtered, filters.sort || "severity");
  const showQuality = columnHasVariation(allRecords, "data_quality");
  const exchanges = availableExchanges(allRecords);
  const rows = visible.map((record) => {
    const selected = record.instrument_id === selectedInstrumentId;
    const accumulation = record.accumulation_state === "DETECTED"
      ? '<span class="dashboard-chip accumulation">Accumulation Detected</span>' : "";
    const quality = showQuality && record.data_quality === "PARTIAL"
      ? '<span class="dashboard-chip partial">Partial data</span>' : "";
    const exchangeTag = record.exchange && record.exchange !== "LSE"
      ? `<span class="dashboard-chip exchange">${escapeHtml(record.exchange)}</span>` : "";
    const activity = relativeActivityLabel(record.relative_activity);
    const company = record.company_name ? `<span class="dashboard-company">${escapeHtml(record.company_name)}</span>` : "";
    return `<button class="dashboard-row${selected ? " selected" : ""}" type="button" data-instrument-id="${escapeHtml(record.instrument_id)}" aria-pressed="${selected}">
      <span class="dashboard-identity"><strong>${escapeHtml(record.ticker)}</strong>${company}</span>
      <span class="dashboard-severity severity-${String(record.watch_severity || "unavailable").toLowerCase().replace(/[^a-z]+/g, "-")}">${escapeHtml(record.watch_severity || "Context unavailable")}</span>
      <span class="dashboard-date">Research alert created ${escapeHtml(humanDate(record.signal_date) || "date unavailable")}${activity ? ` &middot; ${escapeHtml(activity)}` : ""}</span>
      <span class="dashboard-chips">${accumulation}${exchangeTag}${quality}<span class="row-research-link">Continue research &rarr;</span></span>
    </button>`;
  }).join("");
  const qualityNote = !showQuality && allRecords[0]?.data_quality === "PARTIAL"
    ? '<p class="toolbar-note">All current signals currently show partial evidence coverage &mdash; see the selected instrument for specifics.</p>' : "";
  const exchangeFilter = exchanges.length > 1
    ? `<label class="sort-control">Exchange <select data-exchange-filter><option value="ALL" ${(!filters.exchange || filters.exchange === "ALL") ? "selected" : ""}>All</option>${exchanges.map((exchange) => `<option value="${escapeHtml(exchange)}" ${filters.exchange === exchange ? "selected" : ""}>${escapeHtml(exchange)}</option>`).join("")}</select></label>` : "";
  return `<section class="dashboard-panel" aria-labelledby="current-signals-heading">
    <div class="dashboard-heading"><div><p class="eyebrow">Current alert universe</p><h2 id="current-signals-heading">Current Research Alerts</h2></div><p class="dashboard-count">${visible.length} of ${allRecords.length} instruments</p></div>
    <div class="dashboard-controls" aria-label="Current signal filters">
      <div class="filter-group">${severityFilterBar(filters.severity || "ALL", "severity-filter")}</div>
      <label class="filter-toggle"><input type="checkbox" data-accumulation-filter ${filters.accumulationOnly ? "checked" : ""}> Accumulation</label>
      ${exchangeFilter}
      <label class="sort-control">Sort <select data-dashboard-sort><option value="severity" ${(filters.sort || "severity") === "severity" ? "selected" : ""}>Severity</option><option value="newest" ${filters.sort === "newest" ? "selected" : ""}>Newest</option></select></label>
    </div>
    ${qualityNote}
    <div class="dashboard-list">${rows || '<p class="dashboard-empty">No instruments match these filters.</p>'}</div>
  </section>`;
}

/* --- Historical signals workspace -------------------------------------- */

export function availableHistoryYears(records) {
  const years = new Set();
  for (const record of records) {
    const year = String(record.signal_date || "").slice(0, 4);
    if (/^\d{4}$/.test(year)) years.add(year);
  }
  return [...years].sort().reverse();
}

export function filterHistoryRecords(records, filters) {
  const severity = filters.severity || "ALL";
  const accumulationOnly = filters.accumulationOnly === true;
  const year = filters.year || "ALL";
  const search = String(filters.search || "").trim().toLowerCase();
  return records.filter((record) =>
    (severity === "ALL" || record.watch_severity === severity) &&
    (!accumulationOnly || record.accumulation_state === "DETECTED") &&
    (year === "ALL" || String(record.signal_date || "").startsWith(year)) &&
    (!search || `${record.ticker || ""} ${record.company_name || ""}`.toLowerCase().includes(search)));
}

export function paginate(records, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    page: safePage,
    totalPages,
    total: records.length,
    items: records.slice(start, start + pageSize),
  };
}

function historyKey(record) {
  return record.signal_id || `${record.ticker}:${record.signal_date}`;
}

export function renderHistoryTable(pageRecords, selectedKey, allowedFieldVariation) {
  if (pageRecords.length === 0) {
    return '<p class="dashboard-empty">No historical signals match these filters.</p>';
  }
  const rows = pageRecords.map((record) => {
    const key = historyKey(record);
    const selected = key === selectedKey;
    const accumulation = record.accumulation_state === "DETECTED"
      ? '<span class="dashboard-chip accumulation">Accumulation Detected</span>' : "";
    const quality = allowedFieldVariation && record.data_quality === "PARTIAL"
      ? '<span class="dashboard-chip partial">Partial data</span>' : "";
    const activity = relativeActivityLabel(record.relative_activity);
    return `<button class="dashboard-row" type="button" data-signal-key="${escapeHtml(key)}" aria-pressed="${selected}">
      <span class="dashboard-identity"><strong>${escapeHtml(record.ticker)}</strong></span>
      <span class="dashboard-severity severity-${String(record.watch_severity || "unavailable").toLowerCase().replace(/[^a-z]+/g, "-")}">${escapeHtml(record.watch_severity || "Context unavailable")}</span>
      <span class="dashboard-date">Research alert created ${escapeHtml(humanDate(record.signal_date) || "date unavailable")}${activity ? ` &middot; ${escapeHtml(activity)}` : ""}</span>
      ${record.signal_type ? `<span class="dashboard-history-type">${escapeHtml(record.signal_type)}</span>` : ""}
      <span class="dashboard-chips">${accumulation}${quality}<span class="row-research-link">Continue research &rarr;</span></span>
    </button>`;
  }).join("");
  return `<div class="dashboard-list history-list">${rows}</div>`;
}

export function renderHistoryToolbar(records, filters, pageInfo) {
  const years = availableHistoryYears(records);
  const companies = new Set(records.map((record) => record.ticker).filter(Boolean)).size;
  const yearOptions = years.map((year) => `<option value="${year}" ${filters.year === year ? "selected" : ""}>${year}</option>`).join("");
  const pageSize = filters.pageSize || PAGE_SIZE_OPTIONS[0];
  return `<div class="dashboard-controls" aria-label="Historical signal filters">
      <div class="filter-group">${severityFilterBar(filters.severity || "ALL", "history-severity-filter")}</div>
      <label class="filter-toggle"><input type="checkbox" data-history-accumulation-filter ${filters.accumulationOnly ? "checked" : ""}> Accumulation</label>
      <label class="sort-control">Date range <select data-history-year-filter><option value="ALL" ${(!filters.year || filters.year === "ALL") ? "selected" : ""}>All</option>${yearOptions}</select></label>
      <label class="sort-control">Rows per page <select data-history-page-size>${PAGE_SIZE_OPTIONS.map((size) => `<option value="${size}" ${pageSize === size ? "selected" : ""}>${size}</option>`).join("")}</select></label>
      <label class="sort-control">View <select data-history-view><option value="all" ${filters.view !== "latest" ? "selected" : ""}>All alerts</option><option value="latest" ${filters.view === "latest" ? "selected" : ""}>Latest alert per company</option></select></label>
      <label class="sort-control">Ticker/company search <input type="search" data-history-search value="${escapeHtml(filters.search || "")}" placeholder="Search alerts"></label>
      <label class="sort-control future-filter" aria-disabled="true">Sector <select disabled><option>Coming in a later build</option></select></label>
      <label class="sort-control future-filter" aria-disabled="true">Market cap <select disabled><option>Coming in a later build</option></select></label>
    </div>
    <p class="dashboard-count">${formatNumber(records.length) || records.length} alerts across ${formatNumber(companies) || companies} companies</p>
    <div class="pagination" aria-label="Historical signal pagination">
      <button type="button" data-history-page="prev" ${pageInfo.page <= 1 ? "disabled" : ""}>Previous</button>
      <span class="pagination-status">Page ${pageInfo.page} of ${pageInfo.totalPages} &middot; ${formatNumber(pageInfo.total) || pageInfo.total} events</span>
      <button type="button" data-history-page="next" ${pageInfo.page >= pageInfo.totalPages ? "disabled" : ""}>Next</button>
    </div>`;
}

export function renderHistoricalDetail(record) {
  if (!record) {
    return '<section class="status dashboard-empty"><p>Select a historical signal to view its detail.</p></section>';
  }

  const accumulation = record.accumulation_state === "DETECTED"
    ? '<p class="context-note">An accumulation-like pattern was detected alongside this historical signal.</p>' : "";
  const activity = relativeActivityLabel(record.relative_activity);
  return `<section class="customer-view historical-detail" data-mode="historical">
    <div class="instrument-heading">
      <div>
        <p class="eyebrow">Historical CrashDash alert</p>
        <h1>${escapeHtml(record.ticker)}</h1>
        <p class="instrument-meta">Signal date ${escapeHtml(humanDate(record.signal_date) || "date unavailable")}</p>
        <p class="instrument-meta">Price ${record.price_at_signal !== null && record.price_at_signal !== undefined ? escapeHtml(String(record.price_at_signal)) : "unavailable"}</p>
        <p class="eyebrow">Crash Severity at signal</p>
        <p class="signal-state">${escapeHtml(record.watch_severity || "Context unavailable")}</p>
      </div>
      <div class="state-chips"><span class="state-chip historical">Historical &mdash; not current</span></div>
    </div>
    <div class="customer-section">
      ${record.signal_type ? `<p class="context-note">Signal classification: ${escapeHtml(record.signal_type)}.</p>` : ""}
      ${activity ? `<p class="context-note">${escapeHtml(activity)} at the time of this signal.</p>` : '<p class="unavailable">Relative activity is not available for this historical signal.</p>'}
      ${accumulation}
      <p class="context-note">Research context only &mdash; not a trading recommendation.</p>
    </div>
  </section>`;
}

export function renderTimeline(records) {
  const events = [];
  for (const record of Array.isArray(records) ? records : []) {
    if (record.signal_date) {
      events.push({ date: record.signal_date, kind: "CrashDash signal", text: `${record.ticker} · ${record.watch_severity || "Signal unavailable"}` });
    }
    for (const rns of Array.isArray(record.rns_records) ? record.rns_records : []) {
      const date = rns.date || rns.published_at || rns.published;
      if (!date) continue;
      events.push({ date: String(date).slice(0, 10), kind: "Official RNS", text: rns.title || rns.headline || `${record.ticker} announcement`, href: safeExternalUrl(rns.url || rns.link || rns.source_url) });
    }
  }
  events.sort((left, right) => right.date.localeCompare(left.date));
  if (!events.length) return '<section class="dashboard-panel"><p class="eyebrow">Timeline</p><h2>Signal Timeline</h2><p class="status">No signal or official RNS events are available.</p></section>';
  return `<section class="dashboard-panel" aria-labelledby="timeline-heading"><p class="eyebrow">Combined evidence</p><h2 id="timeline-heading">Signal Timeline</h2><ol class="timeline">${events.map((event) => `<li class="timeline-event"><time datetime="${escapeHtml(event.date)}">${escapeHtml(humanDate(event.date))}</time><div><strong>${escapeHtml(event.kind)}</strong><p>${event.href ? `<a href="${escapeHtml(event.href)}" target="_blank" rel="noreferrer">${escapeHtml(event.text)}</a>` : escapeHtml(event.text)}</p></div></li>`).join("")}</ol></section>`;
}

/* --- Placeholders and Learn --------------------------------------------- */

export function renderPlaceholder({ eyebrow, title, body, bullets = [], status = "Coming in a later build" }) {
  const bulletMarkup = bullets.length
    ? `<ul class="reason-list">${bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "";
  return `<section class="view-placeholder" aria-labelledby="placeholder-heading">
    <div class="view-heading"><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1 id="placeholder-heading">${escapeHtml(title)}</h1></div>
    <span class="state-chip placeholder">${escapeHtml(status)}</span>
    <p class="context-note">${escapeHtml(body)}</p>
    ${bulletMarkup}
  </section>`;
}

export function renderLearn() {
  return `<section class="view-learn" aria-labelledby="learn-heading">
    <div class="view-heading"><p class="eyebrow">Learn</p><h1 id="learn-heading">Understanding CrashDash</h1></div>
    <div class="customer-section learn-start"><h2>Start Here</h2><p class="context-note">Take a short tour of Research Alerts, company context, charts and evidence-led research.</p><button type="button" class="primary-button" data-tour-replay>Replay Quick Tour</button></div>
    <div class="customer-section"><h2>Reading a Company Profile</h2><p class="context-note">Start with the company context, then review the CrashDash alert, historical chart, official updates and any validated Research Brief sections.</p></div>
    <div class="customer-section"><h2>What is Crash Severity?</h2>
      <p class="context-note">Crash Severity summarises how unusual a share's recent price behaviour is, using four evidence-led tiers: Close Watch, Elevated, High, and Extreme Caution. It reflects observed conditions only.</p>
      <ul class="reason-list">
        <li>Close Watch &mdash; an early, contained crash-style condition.</li>
        <li>Elevated &mdash; a deeper crash-style condition than Close Watch.</li>
        <li>High &mdash; an extreme crash-style condition.</li>
        <li>Extreme Caution &mdash; the most severe crash-style condition CrashDash records.</li>
      </ul>
    </div>
    <div class="customer-section"><h2>What is an Accumulation Pattern?</h2>
      <p class="context-note">An accumulation pattern is a separate, descriptive overlay noting unusual buying-side activity alongside a signal. It is not a claim of institutional or insider buying, and it does not confirm a reversal.</p>
    </div>
    <div class="customer-section"><h2>Why CrashDash exists</h2>
      <p class="context-note">CrashDash surfaces unusual market behaviour so it can be researched further. It presents evidence, not recommendations, and does not rank instruments by expected return.</p>
    </div>
    <div class="customer-section"><h2>How to interpret evidence</h2>
      <p class="context-note">Each signal shows the observed conditions CrashDash detected and, in Pro mode, the underlying evidence categories (price context, trading activity, social attention, historical context, company catalyst, data quality). Missing evidence is shown truthfully rather than estimated.</p>
    </div>
    <div class="customer-section"><h2>What CrashDash does not mean</h2>
      <ul class="reason-list">
        <li>CrashDash is not a trading recommendation and does not predict outcomes.</li>
        <li>A signal is not confirmation of a bottom, a reversal, or future performance.</li>
        <li>Historical observations are descriptive and are not a forecast.</li>
      </ul>
    </div>
    <div class="customer-section"><h2>FAQ</h2><p class="context-note">CrashDash presents observed evidence for further research. It does not predict outcomes or provide trading instructions.</p></div>
    <div class="customer-section"><h2>About CrashDash</h2><p class="context-note">CrashDash is an evidence-led research interface built around deterministic Research Alerts and transparent source limitations.</p></div>
  </section>`;
}
