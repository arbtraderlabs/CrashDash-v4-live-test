/* Lightweight URL/view state for the CrashDash VNext application shell.
 *
 * State is carried in the query string (?view=current&ticker=PREM.L) so a
 * link can be shared or reloaded directly against the static site without a
 * server-side router. Only the fields that are straightforward to keep in
 * the URL are persisted here; in-panel filters and pagination stay in
 * memory (see the shell ticket for the documented rationale).
 */

export const VIEWS = Object.freeze([
  "today",
  "current",
  "historical",
  "timeline",
  "watchlist",
  "research",
  "learn",
]);

export const DEFAULT_VIEW = "today";
export const DEFAULT_MODE = "beginner";

export function parseState(search) {
  const params = new URLSearchParams(search || "");
  const requestedView = params.get("view");
  const view = VIEWS.includes(requestedView) ? requestedView : DEFAULT_VIEW;
  const mode = params.get("mode") === "pro" ? "pro" : DEFAULT_MODE;
  return {
    view,
    ticker: params.get("ticker") || "",
    signal: params.get("signal") || "",
    mode,
  };
}

export function serializeState(state) {
  const params = new URLSearchParams();
  params.set("view", state.view || DEFAULT_VIEW);
  if (state.ticker) params.set("ticker", state.ticker);
  if (state.signal) params.set("signal", state.signal);
  if (state.mode && state.mode !== DEFAULT_MODE) params.set("mode", state.mode);
  const query = params.toString();
  return query ? `?${query}` : `?view=${DEFAULT_VIEW}`;
}

export function withState(state, patch) {
  return serializeState({ ...state, ...patch });
}
