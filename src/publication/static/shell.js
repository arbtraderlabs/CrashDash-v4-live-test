/* CrashDash VNext application shell: router, data loading, and view wiring.
 *
 * This file is intentionally the only module that touches the DOM/fetch;
 * every rendering, filtering, and pagination decision lives in
 * shell_views.js as pure, independently testable functions.
 */

import { formatQuotePrice, humanDate, renderBeginner, renderPointEventContext, renderPro } from "./browser.js?v=004j";
import { normaliseDashboard, normaliseHistory, normaliseRealBundle } from "./shell_data.js?v=004j";
import { parseState, serializeState } from "./shell_state.js";
import {
  filterHistoryRecords,
  paginate,
  PAGE_SIZE_OPTIONS,
  renderCurrentList,
  renderHistoricalDetail,
  renderHistoryTable,
  renderHistoryToolbar,
  renderTimeline,
  renderLearn,
  renderPlaceholder,
  renderToday,
  selectTodayAlerts,
  summariseToday,
} from "./shell_views.js?v=004j";

function cleanChartEventText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;[^&]*&gt;/g, "")
    .trim();
}

const root = document.querySelector("#app-view");
const status = document.querySelector("#load-status");
const buildNote = document.querySelector("#build-status");
const navLinks = [...document.querySelectorAll("[data-nav-view]")];

let state = parseState(location.search);
/* Empty-but-valid shape used whenever dashboard.json is absent or invalid so
 * every view function can keep operating on real arrays/objects instead of
 * null-checking throughout the render tree. */
const EMPTY_DASHBOARD = { as_of: null, details: {}, records: [] };

let dashboard = EMPTY_DASHBOARD;
const instrumentDetails = new Map();
/* instrumentId -> "NOT_AVAILABLE" | "CONTRACT_ERROR", tracked separately from
 * instrumentDetails so a failed fetch is remembered without polluting the
 * successful-detail cache. */
const instrumentFailures = new Map();
let bundle = null;
let historyData = null;
let historyLoadPromise = null;
let loadedInstrumentId = null;
let instrumentUnavailableReason = null;
/* One of: "LOADING" | "AVAILABLE" | "EMPTY" | "CONTRACT_ERROR". Drives the
 * product-data-unavailable banner; never collapsed into a generic crash. */
let productDataStatus = "LOADING";
let chartRange = "1Y";
let selectedChartDate = null;
let chartFilters = { severities: {}, accumulation: true, rns: true };
let company30sIndex = 0;

const currentFilters = { severity: "ALL", accumulationOnly: false, sort: "severity", exchange: "ALL" };
const historyFilters = { severity: "ALL", accumulationOnly: false, year: "ALL", search: "", view: "all", pageSize: PAGE_SIZE_OPTIONS[0], page: 1 };
const SIGNAL_SEVERITIES = Object.freeze({
  "CRASH ZONE BOTTOM": "CLOSE WATCH",
  "DEEP CRASH BOTTOM": "ELEVATED",
  "EXTREME CRASH BOTTOM": "HIGH",
  "ULTRA CRASH BOTTOM": "EXTREME CAUTION",
});

function productSeverity(alert) {
  const signalType = String(alert.signal_type || alert.signal_state || "").trim();
  const supplied = String(alert.severity || alert.watch_severity || "").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(SIGNAL_SEVERITIES, signalType)
    ? SIGNAL_SEVERITIES[signalType]
    : (["CLOSE WATCH", "ELEVATED", "HIGH", "EXTREME CAUTION"].includes(supplied) ? supplied : "UNAVAILABLE");
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/* Smoothly (~300ms total: 150ms fade-out + 150ms fade-in) swaps the chart
 * plot's content for a new range without inventing any interpolated price
 * data -- this is a presentation-only crossfade between the old and new
 * real-data renders (never a geometry morph of the SVG `d` path, which is
 * not guaranteed safe across differing point counts). The current selected
 * inspection point is preserved if its date remains visible in the new
 * range; otherwise the newly rendered latest-point default is kept. */
function transitionChartRange(newRange) {
  if (newRange === chartRange) return;
  const reduceMotion = prefersReducedMotion();
  const chartPlot = root.querySelector(".chart-plot");
  chartRange = newRange;
  if (!chartPlot || reduceMotion) {
    renderCurrentView();
    return;
  }
  chartPlot.classList.add("chart-range-fade");
  window.setTimeout(() => {
    renderCurrentView();
    const nextChartPlot = root.querySelector(".chart-plot");
    if (!nextChartPlot) return;
    nextChartPlot.classList.add("chart-range-fade");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => nextChartPlot.classList.remove("chart-range-fade"));
    });
  }, 150);
}

document.addEventListener("click", (event) => {
  const rangeButton = event.target.closest("[data-chart-range]");
  if (!rangeButton) return;
  transitionChartRange(rangeButton.dataset.chartRange);
}, true);

function navigate(patch, { replace = false } = {}) {
  state = { ...state, ...patch };
  const query = serializeState(state);
  if (replace) history.replaceState(state, "", query);
  else history.pushState(state, "", query);
  render();
}

function updateNav() {
  for (const link of navLinks) {
    const active = link.dataset.navView === state.view;
    link.setAttribute("aria-current", active ? "page" : "false");
    link.classList.toggle("active", active);
  }
}

/* Fetches one instrument detail file, isolating any failure (missing file,
 * network error, malformed JSON) to this single instrument: it must never
 * throw, and a failure here must never prevent other instruments, the
 * dashboard, or navigation from working. */
async function fetchInstrumentDetail(detailPath) {
  try {
    const response = await fetch(`./${detailPath}`);
    if (response.status === 404) return { status: "NOT_AVAILABLE", detail: null };
    if (!response.ok) return { status: "CONTRACT_ERROR", detail: null };
    const payload = await response.json();
    const detail = payload?.data || payload;
    if (!detail || typeof detail !== "object") return { status: "CONTRACT_ERROR", detail: null };
    return { status: "AVAILABLE", detail };
  } catch {
    return { status: "CONTRACT_ERROR", detail: null };
  }
}

async function loadInstrumentBundle(instrumentId) {
  const reference = dashboard.details[instrumentId];
  let detail = instrumentDetails.get(instrumentId);
  if (detail === undefined) {
    if (instrumentFailures.has(instrumentId)) {
      detail = null;
    } else if (reference?.detail_path) {
      const result = await fetchInstrumentDetail(reference.detail_path);
      if (result.status === "AVAILABLE") {
        detail = result.detail;
        instrumentDetails.set(instrumentId, detail);
      } else {
        detail = null;
        instrumentFailures.set(instrumentId, result.status);
      }
    } else {
      detail = reference || null;
      if (!detail) instrumentFailures.set(instrumentId, "NOT_AVAILABLE");
    }
  }
  instrumentUnavailableReason = detail ? null : (instrumentFailures.get(instrumentId) || "NOT_AVAILABLE");
  const record = dashboard.records.find((item) => item.instrument_id === instrumentId);
  if (!detail) {
    bundle = null;
    loadedInstrumentId = instrumentId;
    return true;
  }
  bundle = normaliseRealBundle({ schema_version: "V1", data: detail.beginner }, { schema_version: "V1", data: detail.pro });
  const instrument = detail.instrument_detail;
  if (instrument && typeof instrument === "object") {
    const metadata = instrument.company_metadata || instrument.identity || {};
    const priceSeries = Array.isArray(instrument.price_series) ? instrument.price_series : [];
    const alerts = [
      ...(Array.isArray(instrument.current_alerts) ? instrument.current_alerts : []).map((alert) => ({ ...alert, current: true })),
      ...(Array.isArray(instrument.historical_alerts) ? instrument.historical_alerts : []).map((alert) => ({ ...alert, current: false })),
    ].map((alert) => ({
      ...alert,
      event_type: alert.event_type || alert.marker_type || "CRASHDASH_SIGNAL",
      marker_type: alert.marker_type || alert.event_type || "CRASHDASH_SIGNAL",
      severity: productSeverity(alert),
      signal_type: alert.signal_type || alert.signal_state,
      accumulation: alert.accumulation === "DETECTED" || alert.accumulation === true,
    }));
    const rns = Array.isArray(instrument.rns) ? instrument.rns : [];
    const initialSharechat = Array.isArray(instrument.sharechat_initial)
      ? instrument.sharechat_initial : (instrument.sharechat || []).slice(0, 10);
    for (const model of [bundle.beginner, bundle.pro]) {
      const local = model.local_enrichment && typeof model.local_enrichment === "object"
        ? model.local_enrichment : {};
      model.local_enrichment = {
        ...local,
        metadata: { ...(local.metadata || {}), ...metadata },
        price_history: priceSeries,
        convergence: {
          ...(local.convergence || {}),
          price_points: priceSeries,
          alert_markers: alerts,
          rns_markers: rns,
        },
      };
      model.rns_total_available = instrument.rns_total_available
        ?? instrument.profile?.rns?.total_available
        ?? rns.length;
      model.social_records = initialSharechat;
      model.sharechat_snapshot = instrument.sharechat_snapshot || null;
      if (model.sharechat_snapshot) {
        model.sharechat_total_available = model.sharechat_snapshot.total_posts;
        model.social_status = model.sharechat_snapshot.analysis_status;
      }
      model.corporate_actions = instrument.corporate_actions || null;
      model.ai_analysis = instrument.research?.data || model.ai_analysis;
      model.ai_status = instrument.research?.status || model.ai_status;
      const summary = instrument.company_summary;
      if (summary && (summary.what_they_do || summary.why_it_matters || summary.current_state)) {
        model.research_brief = {
          validation_state: "VALIDATED",
          quick_read: Object.fromEntries(["what_they_do", "why_it_matters", "current_state"].map((key) => [
            key, { text: summary[key], evidence_refs: [] },
          ])),
        };
      }
    }
  }
  bundle.beginner.signal_date = record?.signal_date;
  bundle.pro.signal_date = record?.signal_date;
  loadedInstrumentId = instrumentId;
  selectedChartDate = null;
  chartFilters = { severities: {}, accumulation: true, rns: true };
  company30sIndex = 0;
  return true;
}

async function selectCurrentInstrument(instrumentId) {
  if (!await loadInstrumentBundle(instrumentId)) return;
  navigate({ ticker: instrumentId }, { replace: true });
}

function renderTodayView() {
  const summary = summariseToday(dashboard.records, dashboard.as_of);
  const featured = selectTodayAlerts(dashboard.records, dashboard.as_of);
  root.innerHTML = renderProductStatusBanner() + renderToday(summary, featured);
}

/* Distinct, honest copy per failure reason -- never a bare "unknown" and
 * never a page crash. Selecting an instrument that legitimately has no
 * detail attempt yet (no selection made) still gets the original neutral
 * prompt. */
function renderInstrumentUnavailablePanel(selectedId) {
  if (!selectedId || loadedInstrumentId !== selectedId) {
    return '<section class="status dashboard-empty"><p>Select a current signal to view research.</p></section>';
  }
  if (instrumentUnavailableReason === "CONTRACT_ERROR") {
    return `<section class="status error-panel"><p>Instrument detail for ${selectedId} could not be read (CONTRACT_ERROR): the published file was not valid JSON or did not match the expected contract.</p></section>`;
  }
  return `<section class="status dashboard-empty"><p>Instrument detail for ${selectedId} is not available (NOT_AVAILABLE). Other instruments are unaffected.</p></section>`;
}

function renderProductStatusBanner() {
  if (productDataStatus === "EMPTY") {
    return '<section class="status dashboard-empty" data-product-status="EMPTY"><p>No product data has been published yet.</p></section>';
  }
  if (productDataStatus === "CONTRACT_ERROR") {
    return '<section class="status error-panel" data-product-status="CONTRACT_ERROR"><p>The product data feed returned an invalid contract and could not be loaded.</p></section>';
  }
  return "";
}

async function renderCurrentView() {
  const selectedId = state.ticker || dashboard.records[0]?.instrument_id || "";
  if (selectedId && selectedId !== loadedInstrumentId) {
    if (!instrumentDetails.has(selectedId)) {
      root.innerHTML = '<section class="status dashboard-empty" aria-busy="true"><p>Loading instrument detail...</p></section>';
    }
    await loadInstrumentBundle(selectedId);
  }
  const listMarkup = renderCurrentList(dashboard.records, selectedId, currentFilters);
  const detailModel = state.mode === "pro" ? bundle?.pro : bundle?.beginner;
  const detailMarkup = detailModel
    ? (state.mode === "pro" ? renderPro(detailModel, { chartRange, chartFilters }) : renderBeginner(detailModel, { chartRange, chartFilters }))
    : renderInstrumentUnavailablePanel(selectedId);
  root.innerHTML = `${renderProductStatusBanner()}<div class="research-workspace">
    <aside class="signal-panel">${listMarkup}</aside>
    <section class="detail-panel">
      <nav class="segmented mode-switch" aria-label="Presentation mode">
        <button type="button" data-mode-button="beginner" aria-pressed="${state.mode !== "pro"}">Beginner</button>
        <button type="button" data-mode-button="pro" aria-pressed="${state.mode === "pro"}">Pro</button>
      </nav>
      ${detailMarkup}
    </section>
  </div>`;
  root.querySelectorAll("[data-instrument-id]").forEach((button) => {
    button.addEventListener("click", () => selectCurrentInstrument(button.dataset.instrumentId));
  });
  root.querySelectorAll("[data-severity-filter]").forEach((button) => {
    button.addEventListener("click", () => { currentFilters.severity = button.dataset.severityFilter; renderCurrentView(); });
  });
  root.querySelector("[data-accumulation-filter]")?.addEventListener("change", (event) => {
    currentFilters.accumulationOnly = event.target.checked; renderCurrentView();
  });
  root.querySelector("[data-exchange-filter]")?.addEventListener("change", (event) => {
    currentFilters.exchange = event.target.value; renderCurrentView();
  });
  root.querySelector("[data-dashboard-sort]")?.addEventListener("change", (event) => {
    currentFilters.sort = event.target.value; renderCurrentView();
  });
  root.querySelectorAll("[data-mode-button]").forEach((button) => {
    button.addEventListener("click", () => navigate({ mode: button.dataset.modeButton }));
  });
  root.querySelectorAll("[data-chart-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.chartFilter;
      if (kind === "severity") {
        const value = button.dataset.chartFilterValue;
        chartFilters = { ...chartFilters, severities: { ...chartFilters.severities, [value]: chartFilters.severities[value] === false } };
      } else {
        chartFilters = { ...chartFilters, [kind]: chartFilters[kind] === false };
      }
      renderCurrentView();
    });
  });
  root.querySelector("[data-chart-filter-reset]")?.addEventListener("click", () => {
    chartFilters = { severities: {}, accumulation: true, rns: true };
    renderCurrentView();
  });
  wireChartInspection(root);
  wireCompanyIn30Seconds(root);
}

/* Company in 30 Seconds: desktop shows all three cards in a CSS grid (no JS
 * needed there); mobile uses a scroll-snap carousel with real Previous/Next
 * buttons and labelled, clickable progress. No auto-advance -- navigation is
 * only ever a direct result of a click/tap/swipe/keyboard action. The active
 * card index is preserved across a Beginner/Pro re-render for the same
 * ticker (module-level state reset only in loadInstrumentBundle()). */
function wireCompanyIn30Seconds(scopeRoot) {
  const section = scopeRoot.querySelector(".company-30s");
  const track = section?.querySelector("[data-c30-track]");
  const cards = track ? [...track.querySelectorAll("[data-c30-card]")] : [];
  if (!section || !track || !cards.length) return;
  const prevButton = section.querySelector("[data-c30-prev]");
  const nextButton = section.querySelector("[data-c30-next]");
  const progressItems = [...section.querySelectorAll("[data-c30-goto]")];

  function applyActiveState(index) {
    cards.forEach((card, cardIndex) => card.classList.toggle("active", cardIndex === index));
    progressItems.forEach((item, itemIndex) => {
      const active = itemIndex === index;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    if (prevButton) prevButton.disabled = index <= 0;
    if (nextButton) nextButton.disabled = index >= cards.length - 1;
  }

  function goTo(index, { behavior = "smooth" } = {}) {
    const clamped = Math.max(0, Math.min(cards.length - 1, index));
    company30sIndex = clamped;
    applyActiveState(clamped);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    cards[clamped].scrollIntoView({ block: "nearest", inline: "start", behavior: reducedMotion ? "auto" : behavior });
  }

  prevButton?.addEventListener("click", () => goTo(company30sIndex - 1));
  nextButton?.addEventListener("click", () => goTo(company30sIndex + 1));
  progressItems.forEach((item, index) => {
    item.addEventListener("click", () => goTo(index));
  });

  // Swipe/scroll is a first-class way to move between cards (not just the
  // arrows): reading the nearest card from scroll position keeps progress
  // and the arrows' disabled state truthful after a manual swipe.
  let scrollFrame = null;
  track.addEventListener("scroll", () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      const trackLeft = track.getBoundingClientRect().left;
      let nearestIndex = 0;
      let nearestDistance = Infinity;
      cards.forEach((card, index) => {
        const distance = Math.abs(card.getBoundingClientRect().left - trackLeft);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });
      company30sIndex = nearestIndex;
      applyActiveState(nearestIndex);
    });
  }, { passive: true });

  // On first wire (including a fresh Beginner/Pro re-render for the same
  // ticker) only actually scroll if a non-default card was preserved --
  // scrolling to card 0 is a no-op everywhere, and skipping it avoids ever
  // nudging page-level scroll position on an unrelated re-render (e.g. a
  // desktop grid layout where the track itself never scrolls).
  if (company30sIndex > 0) goTo(company30sIndex, { behavior: "auto" });
  else applyActiveState(0);
}

/* Fixed inspection panel + crosshair scrub/touch + keyboard-focusable event
 * markers for the CrashDash History chart. All formatting/text logic is
 * delegated to the same renderPointEventContext()/formatQuotePrice() used to
 * server-render the default (latest-point) state, so hovering, touching, and
 * focusing an event never disagree with the initial render. */
function wireChartInspection(scopeRoot) {
  const chart = scopeRoot.querySelector(".signal-chart");
  if (!chart) return;
  const svg = chart.querySelector("svg");
  const scrub = chart.querySelector("[data-chart-scrub]");
  const hits = [...chart.querySelectorAll("[data-chart-date]")];
  const crosshairLine = chart.querySelector("[data-chart-crosshair]");
  const crosshairPoint = chart.querySelector("[data-chart-crosshair-point]");
  const panel = chart.parentElement?.querySelector("[data-chart-inspection]")
    || scopeRoot.querySelector("[data-chart-inspection]");
  if (!panel || !hits.length) return;
  const dateEl = panel.querySelector("[data-chart-inspection-date]");
  const priceEl = panel.querySelector("[data-chart-inspection-price]");
  const contextEl = panel.querySelector("[data-chart-inspection-context]");
  const quoteUnit = chart.dataset.chartQuoteUnit || null;
  const defaultState = {
    date: dateEl?.textContent || "",
    price: priceEl?.textContent || "",
    context: contextEl?.innerHTML || "",
  };

  function eventsFromHit(hit) {
    const events = { alert: null, rns: [] };
    if (hit.dataset.chartSeverity) {
      events.alert = {
        severity: hit.dataset.chartSeverity,
        relative_activity: hit.dataset.chartActivity ? Number(hit.dataset.chartActivity) : null,
        accumulation: hit.dataset.chartAccumulation === "true",
      };
    }
    events.accumulation = hit.dataset.chartAccumulation === "true";
    if (hit.dataset.chartRns) {
      try {
        events.rns = JSON.parse(hit.dataset.chartRns).map((rns) => ({
          ...rns,
          date: cleanChartEventText(rns.date),
          headline: cleanChartEventText(rns.headline),
        }));
      } catch {
        events.rns = [];
      }
    }
    return events;
  }

  function showHit(hit) {
    const point = { date: hit.dataset.chartDate, close: Number(hit.dataset.chartClose) };
    const price = formatQuotePrice(point.close, quoteUnit);
    selectedChartDate = point.date;
    if (dateEl) dateEl.textContent = humanDate(point.date) || point.date;
    if (priceEl) priceEl.textContent = price !== null ? price : "Exact alert-date price unavailable";
    if (contextEl) contextEl.innerHTML = renderPointEventContext(point, eventsFromHit(hit), quoteUnit);
    if (crosshairLine) {
      crosshairLine.setAttribute("x1", hit.getAttribute("cx"));
      crosshairLine.setAttribute("x2", hit.getAttribute("cx"));
      crosshairLine.removeAttribute("hidden");
    }
    if (crosshairPoint) {
      crosshairPoint.setAttribute("cx", hit.getAttribute("cx"));
      crosshairPoint.setAttribute("cy", hit.getAttribute("cy"));
      crosshairPoint.removeAttribute("hidden");
    }
  }

  // A range change re-renders (and re-wires) the whole chart; if the point
  // last inspected before the change is still visible in the new range,
  // restore that exact selection rather than silently reverting to latest.
  const preserved = selectedChartDate && hits.find((hit) => hit.dataset.chartDate === selectedChartDate);
  if (preserved) showHit(preserved);
  else if (hits.length) selectedChartDate = hits[hits.length - 1].dataset.chartDate;

  function restoreDefault() {
    if (dateEl) dateEl.textContent = defaultState.date;
    if (priceEl) priceEl.textContent = defaultState.price;
    if (contextEl) contextEl.innerHTML = defaultState.context;
    crosshairLine?.setAttribute("hidden", "");
    crosshairPoint?.setAttribute("hidden", "");
  }

  function nearestHit(clientX) {
    const bounds = scrub.getBoundingClientRect();
    const ratio = bounds.width ? Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)) : 0;
    const targetCx = Number(scrub.getAttribute("x")) + ratio * Number(scrub.getAttribute("width"));
    return hits.reduce((nearest, candidate) =>
      Math.abs(Number(candidate.getAttribute("cx")) - targetCx) <
      Math.abs(Number(nearest.getAttribute("cx")) - targetCx) ? candidate : nearest, hits[0]);
  }

  // Opens every in-app RNS <details> named by a comma-separated evidence_id
  // list (a compact multi-RNS summary anchors more than one id to its single
  // "Open update(s)" action) and scrolls to the first one that exists.
  function openRnsDetails(rawIds) {
    const targetIds = String(rawIds || "").replace(/^#/, "").split(",").map((id) => id.trim()).filter(Boolean);
    let first = null;
    for (const targetId of targetIds) {
      const details = document.getElementById(targetId);
      if (details && "open" in details) {
        details.open = true;
        first = first || details;
      }
    }
    if (first) first.scrollIntoView({ block: "center", behavior: "smooth" });
    return Boolean(first);
  }

  const onScrub = (event) => showHit(nearestHit(event.clientX));
  scrub?.addEventListener("pointerenter", onScrub);
  scrub?.addEventListener("pointermove", onScrub);
  if (svg) svg.style.touchAction = "none";

  // RNS diamonds are visually on top of the chart but the transparent scrub
  // rect sits above them in paint/hit-test order (so drag-scrubbing works
  // anywhere over the plot). A click/tap still needs to feel like it landed
  // on the diamond: on pointerdown we check whether the pointer is within a
  // marker's rendered width of an RNS event and, if so, select that exact
  // point and open its evidence directly -- no separate trip to a tiny
  // "Open update" link is required.
  const rnsHitTargets = [...chart.querySelectorAll(".chart-rns-marker[data-chart-event]")]
    .filter((el) => el.dataset.chartEvent)
    .map((el) => ({ chartId: el.dataset.chartEvent, x: Number(el.dataset.chartX) }));

  function rnsMarkerNear(clientX, tolerancePx = 9) {
    if (!rnsHitTargets.length) return null;
    const bounds = scrub.getBoundingClientRect();
    const ratio = bounds.width ? Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)) : 0;
    const targetCx = Number(scrub.getAttribute("x")) + ratio * Number(scrub.getAttribute("width"));
    const nearest = rnsHitTargets.reduce((closest, candidate) =>
      Math.abs(candidate.x - targetCx) < Math.abs(closest.x - targetCx) ? candidate : closest, rnsHitTargets[0]);
    return Math.abs(nearest.x - targetCx) <= tolerancePx ? nearest : null;
  }

  scrub?.addEventListener("pointerdown", (event) => {
    const hit = nearestHit(event.clientX);
    showHit(hit);
    const rnsHit = rnsMarkerNear(event.clientX);
    if (rnsHit) {
      // Open every RNS anchored to this exact point (not only the one the
      // pointer happened to land nearest), matching the compact summary's
      // own "Open update(s)" action when several updates share one marker.
      const anchoredIds = eventsFromHit(hit).rns.map((rns) => rns.chart_id).filter(Boolean);
      openRnsDetails(anchoredIds.length ? anchoredIds.join(",") : rnsHit.chartId);
    }
  });

  chart.querySelectorAll("[data-chart-event]").forEach((marker) => {
    marker.addEventListener("focus", () => {
      const markerX = Number(marker.dataset.chartX);
      const nearest = hits.reduce((closest, candidate) =>
        Math.abs(Number(candidate.getAttribute("cx")) - markerX) <
        Math.abs(Number(closest.getAttribute("cx")) - markerX) ? candidate : closest, hits[0]);
      if (nearest) showHit(nearest);
    });
    // Enter/Space on a focused marker is the keyboard equivalent of clicking
    // it directly: RNS markers additionally open every update anchored to
    // the same point (not only the one this marker itself represents).
    marker.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (!marker.classList.contains("chart-rns-marker") || !marker.dataset.chartEvent) return;
      const markerX = Number(marker.dataset.chartX);
      const nearest = hits.reduce((closest, candidate) =>
        Math.abs(Number(candidate.getAttribute("cx")) - markerX) <
        Math.abs(Number(closest.getAttribute("cx")) - markerX) ? candidate : closest, hits[0]);
      const anchoredIds = nearest ? eventsFromHit(nearest).rns.map((rns) => rns.chart_id).filter(Boolean) : [];
      openRnsDetails(anchoredIds.length ? anchoredIds.join(",") : marker.dataset.chartEvent);
    });
  });

  // Event delegation on the whole chart card (not just the SVG): both the
  // static SVG RNS markers (rendered once, at load) and the "Open update"
  // link (rendered fresh into the sibling inspection panel on every
  // scrub/hover) are covered by this single handler, so a freshly-injected
  // link is never missed by a one-time querySelectorAll binding.
  const chartCard = chart.closest(".chart-card") || chart.parentElement || chart;
  chartCard.addEventListener("click", (event) => {
    const link = event.target.closest("[data-chart-open-rns], a[href^='#rns-']");
    if (!link) return;
    if (openRnsDetails(link.dataset.chartOpenRns || link.getAttribute("href"))) {
      event.preventDefault();
    }
  });
}

function renderHistoricalView() {
  if (!historyData) {
    root.innerHTML = '<section class="status dashboard-empty" aria-busy="true"><p>Loading historical signals...</p></section>';
    return;
  }
  const filteredRecords = filterHistoryRecords(historyData.records, historyFilters)
    .slice()
    .sort((left, right) => String(right.signal_date || "").localeCompare(String(left.signal_date || "")));
  const filtered = historyFilters.view === "latest"
    ? filteredRecords.filter((record, index, records) => records.findIndex((item) => item.ticker === record.ticker) === index)
    : filteredRecords;
  const pageInfo = paginate(filtered, historyFilters.page, historyFilters.pageSize);
  const selectedKey = state.signal || "";
  const selectedRecord = selectedKey
    ? historyData.records.find((record) => (record.signal_id || `${record.ticker}:${record.signal_date}`) === selectedKey)
    : null;
  const showQuality = false; // Validation state is uniformly PARTIAL for this real-data source; see ticket.
  const listMarkup = `<section class="dashboard-panel" aria-labelledby="historical-signals-heading">
    <div class="dashboard-heading"><div><p class="eyebrow">Historical alert archive</p><h2 id="historical-signals-heading">Historical CrashDash alerts</h2></div><p class="dashboard-count">${pageInfo.total} of ${historyData.records.length} events</p></div>
    ${renderHistoryToolbar(historyData.records, historyFilters, pageInfo)}
    ${renderHistoryTable(pageInfo.items, selectedKey, showQuality)}
  </section>`;
  root.innerHTML = `<div class="research-workspace">
    <aside class="signal-panel">${listMarkup}</aside>
    <section class="detail-panel">${renderHistoricalDetail(selectedRecord)}</section>
  </div>`;
  root.querySelectorAll("[data-signal-key]").forEach((button) => {
    button.addEventListener("click", () => navigate({ signal: button.dataset.signalKey }, { replace: true }));
  });
  root.querySelectorAll("[data-history-severity-filter]").forEach((button) => {
    button.addEventListener("click", () => { historyFilters.severity = button.dataset.historySeverityFilter; historyFilters.page = 1; renderHistoricalView(); });
  });
  root.querySelector("[data-history-accumulation-filter]")?.addEventListener("change", (event) => {
    historyFilters.accumulationOnly = event.target.checked; historyFilters.page = 1; renderHistoricalView();
  });
  root.querySelector("[data-history-year-filter]")?.addEventListener("change", (event) => {
    historyFilters.year = event.target.value; historyFilters.page = 1; renderHistoricalView();
  });
  root.querySelector("[data-history-search]")?.addEventListener("input", (event) => {
    historyFilters.search = event.target.value; historyFilters.page = 1; renderHistoricalView();
  });
  root.querySelector("[data-history-view]")?.addEventListener("change", (event) => {
    historyFilters.view = event.target.value; historyFilters.page = 1; renderHistoricalView();
  });
  root.querySelector("[data-history-page-size]")?.addEventListener("change", (event) => {
    historyFilters.pageSize = Number(event.target.value); historyFilters.page = 1; renderHistoricalView();
  });
  root.querySelectorAll("[data-history-page]").forEach((button) => {
    button.addEventListener("click", () => {
      historyFilters.page += button.dataset.historyPage === "next" ? 1 : -1;
      renderHistoricalView();
    });
  });
}

async function ensureHistoryLoaded() {
  if (historyData || historyLoadPromise) return historyLoadPromise;
  historyLoadPromise = fetch("./data/history.json")
    .then((response) => {
      if (response.status === 404) throw Object.assign(new Error("not found"), { reason: "NOT_AVAILABLE" });
      if (!response.ok) throw Object.assign(new Error("request failed"), { reason: "CONTRACT_ERROR" });
      return response.json();
    })
    .then((payload) => {
      historyData = normaliseHistory(payload);
      if (state.view === "historical") renderHistoricalView();
    })
    .catch((error) => {
      const reason = error?.reason || "CONTRACT_ERROR";
      const message = reason === "NOT_AVAILABLE"
        ? "Historical signal data is not available (NOT_AVAILABLE)."
        : "Historical signal data could not be read (CONTRACT_ERROR): the published file was not valid JSON or did not match the expected contract.";
      root.innerHTML = `<section class="status ${reason === "NOT_AVAILABLE" ? "dashboard-empty" : "error-panel"}" data-history-status="${reason}"><p>${message}</p></section>`;
    });
  return historyLoadPromise;
}

function render() {
  updateNav();
  if (state.view === "today") return renderTodayView();
  if (state.view === "current") return renderCurrentView();
  if (state.view === "historical") {
    renderHistoricalView();
    return ensureHistoryLoaded();
  }
  if (state.view === "timeline") {
    if (!historyData) {
      root.innerHTML = '<section class="status dashboard-empty" aria-busy="true"><p>Loading signal timeline...</p></section>';
      return ensureHistoryLoaded().then(() => render());
    }
    root.innerHTML = renderTimeline(historyData.records);
    return null;
  }
  if (state.view === "watchlist") {
    root.innerHTML = renderPlaceholder({
      eyebrow: "Watchlist",
      title: "Watchlist",
      body: "Crash Watch will let you monitor companies even when they do not currently have a CrashDash signal.",
    });
    return;
  }
  if (state.view === "research") {
    root.innerHTML = renderPlaceholder({
      eyebrow: "Research",
      title: "Research",
      body: "Research reports, historical outcome studies, and methodology notes will appear here.",
      bullets: [
        "Signal outcome studies",
        "Methodology explainers",
        "Calibration research",
      ],
    });
    return;
  }
  if (state.view === "learn") {
    root.innerHTML = renderLearn();
    const replay = root.querySelector("[data-tour-replay]");
    if (replay) replay.addEventListener("click", () => showTour(true));
    return;
  }
}

const TOUR_STORAGE_KEY = "crashdash_onboarding_v1";
const TOUR_STEPS = [
  ["Research Alerts", "Current Signals shows the latest evidence-led alerts and their severity."],
  ["Crash Severity", "Severity colours describe the observed alert state. Accumulation is shown separately."],
  ["Company context", "Open View research to review the company profile, chart history and data-quality notes."],
  ["Official updates", "Company announcements appear as temporal context with links to the in-app evidence."],
  ["Research Brief", "Validated evidence summaries are clearly labelled; unavailable information stays unavailable."],
];

function tourSeen() {
  return typeof localStorage !== "undefined" && localStorage.getItem(TOUR_STORAGE_KEY) === "seen";
}

function markTourSeen() {
  if (typeof localStorage !== "undefined") localStorage.setItem(TOUR_STORAGE_KEY, "seen");
}

function showTour(replay = false) {
  if (!replay && tourSeen()) return;
  let index = 0;
  const backdrop = document.createElement("div");
  backdrop.className = "tour-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  const draw = () => {
    const [title, text] = TOUR_STEPS[index];
    backdrop.innerHTML = `<div class="tour-dialog"><p class="eyebrow">CrashDash quick tour · ${index + 1}/${TOUR_STEPS.length}</p><h2>${title}</h2><p>${text}</p><div class="tour-actions"><button type="button" data-tour-skip>Skip</button><span><button type="button" data-tour-prev ${index === 0 ? "disabled" : ""}>Back</button> <button type="button" data-tour-next>${index === TOUR_STEPS.length - 1 ? "Done" : "Next"}</button></span></div></div>`;
    backdrop.querySelector("[data-tour-skip]").addEventListener("click", close);
    backdrop.querySelector("[data-tour-prev]").addEventListener("click", () => { index -= 1; draw(); });
    backdrop.querySelector("[data-tour-next]").addEventListener("click", () => { if (index === TOUR_STEPS.length - 1) close(); else { index += 1; draw(); } });
  };
  const close = () => { markTourSeen(); backdrop.remove(); };
  backdrop.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
    if (event.key === "ArrowLeft" && index > 0) { index -= 1; draw(); }
    if (event.key === "ArrowRight" && index < TOUR_STEPS.length - 1) { index += 1; draw(); }
  });
  document.body.appendChild(backdrop);
  draw();
  backdrop.querySelector("[data-tour-next]")?.focus();
}

function attachNav() {
  navLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigate({ view: link.dataset.navView, ticker: "", signal: "" });
    });
  });
  root.addEventListener("click", (event) => {
    const anchor = event.target.closest("a.featured-link, a.today-all-link");
    if (!anchor) return;
    event.preventDefault();
    const params = new URLSearchParams(new URL(anchor.href).search);
    navigate({ view: params.get("view") || "current", ticker: params.get("ticker") || "" });
  });
}

window.addEventListener("popstate", () => {
  state = parseState(location.search);
  render();
  showTour();
});

/* Fetches and parses one top-level JSON artifact, classifying every
 * failure mode instead of throwing, so bootstrap can render a controlled
 * product-data-unavailable state and still attach navigation. */
async function safeFetchJson(path) {
  try {
    const response = await fetch(path);
    if (response.status === 404) return { status: "NOT_AVAILABLE", payload: null };
    if (!response.ok) return { status: "CONTRACT_ERROR", payload: null };
    try {
      return { status: "AVAILABLE", payload: await response.json() };
    } catch {
      return { status: "CONTRACT_ERROR", payload: null };
    }
  } catch {
    return { status: "CONTRACT_ERROR", payload: null };
  }
}

async function bootstrap() {
  /* Navigation is static markup; wiring it up must never depend on whether
   * any product data successfully loads (MODE 1/EMPTY requirement). */
  attachNav();

  const dashboardResult = await safeFetchJson("./data/dashboard.json");
  if (dashboardResult.status === "AVAILABLE") {
    try {
      dashboard = normaliseDashboard(dashboardResult.payload);
      productDataStatus = "AVAILABLE";
    } catch {
      dashboard = EMPTY_DASHBOARD;
      productDataStatus = "CONTRACT_ERROR";
    }
  } else {
    dashboard = EMPTY_DASHBOARD;
    productDataStatus = dashboardResult.status === "NOT_AVAILABLE" ? "EMPTY" : "CONTRACT_ERROR";
  }

  const [beginnerResult, proResult, buildInfoResult] = await Promise.all([
    safeFetchJson("./data/beginner.json"),
    safeFetchJson("./data/pro.json"),
    safeFetchJson("./build.json"),
  ]);
  try {
    bundle = (beginnerResult.status === "AVAILABLE" && proResult.status === "AVAILABLE")
      ? normaliseRealBundle(beginnerResult.payload, proResult.payload)
      : null;
  } catch {
    bundle = null;
  }

  if (!state.ticker && dashboard.records[0]) state.ticker = dashboard.records[0].instrument_id;
  if (buildInfoResult.status === "AVAILABLE" && buildInfoResult.payload?.generated_at && buildNote) {
    buildNote.textContent = `Data generated ${new Date(buildInfoResult.payload.generated_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`;
  }
  status.textContent = productDataStatus === "AVAILABLE"
    ? "Real REDPILL Production signals"
    : "Product data unavailable";
  render();
  if (state.view === "historical") ensureHistoryLoaded();
}

bootstrap();
