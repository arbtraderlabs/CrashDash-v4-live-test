/* Static-contract validation for the application shell's data artifacts. */

import { loadBundle } from "./browser.js?v=004j";
import { normaliseDashboard, normaliseRealBundle } from "./real_contract.js";

export { normaliseDashboard, normaliseRealBundle };

export function normaliseHistory(payload) {
  const history = loadBundle(payload);
  if (!Array.isArray(history.records)) {
    throw new Error("invalid historical signal collection contract");
  }
  return history;
}
