import { loadBundle } from "./browser.js";

export function normaliseRealBundle(beginnerPayload, proPayload) {
  return {
    beginner: loadBundle(beginnerPayload),
    pro: loadBundle(proPayload),
  };
}

export function normaliseDashboard(payload) {
  const dashboard = loadBundle(payload);
  if (!Array.isArray(dashboard.records) || !dashboard.details || typeof dashboard.details !== "object") {
    throw new Error("invalid current-signal dashboard contract");
  }
  return dashboard;
}
