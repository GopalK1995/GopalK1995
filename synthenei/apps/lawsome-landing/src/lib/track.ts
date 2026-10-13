"use client";
// Consent-gated analytics. Nothing is sent until the visitor accepts.
export type TrackEvent = "page_view" | "cta_click" | "form_start" | "form_submit" | "demo_booked" | "tour_play";
const CONSENT_KEY = "lw_consent";
const UTM_KEY = "lw_utm";

const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

export const getConsent = (): "granted" | "denied" | null =>
  safe(() => (localStorage.getItem(CONSENT_KEY) as "granted" | "denied" | null), null);
export const setConsent = (v: "granted" | "denied") => safe(() => localStorage.setItem(CONSENT_KEY, v), undefined);

export function captureUtm(): Record<string, string> {
  return safe(() => {
    const params = new URLSearchParams(window.location.search);
    const found: Record<string, string> = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((k) => {
      const v = params.get(k);
      if (v) found[k] = v.slice(0, 120);
    });
    if (Object.keys(found).length) sessionStorage.setItem(UTM_KEY, JSON.stringify(found));
    return JSON.parse(sessionStorage.getItem(UTM_KEY) ?? "{}");
  }, {});
}

export function track(event: TrackEvent, props: Record<string, unknown> = {}) {
  if (getConsent() !== "granted") return;
  const payload = { event, ...props, utm: captureUtm(), path: location.pathname, ts: Date.now() };
  safe(() => {
    (window as unknown as { dataLayer?: unknown[] }).dataLayer?.push(payload);
    navigator.sendBeacon("/api/track", new Blob([JSON.stringify(payload)], { type: "application/json" }));
  }, undefined);
}
