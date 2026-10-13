"use client";
import { useEffect, useState } from "react";
import { captureUtm, getConsent, setConsent, track } from "@/lib/track";

export function ConsentBanner() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    captureUtm();
    const c = getConsent();
    if (c === null) setOpen(true);
    else if (c === "granted") track("page_view");
  }, []);
  if (!open) return null;
  const choose = (v: "granted" | "denied") => { setConsent(v); setOpen(false); if (v === "granted") track("page_view"); };
  return (
    <div className="consent-banner" role="dialog" aria-label="Analytics consent">
      <span>We use privacy-respecting analytics to understand how this page performs. No tracking until you accept. <a href="/privacy" style={{ textDecoration: "underline" }}>Privacy notice</a></span>
      <button className="btn btn-primary" onClick={() => choose("granted")}>Accept</button>
      <button className="btn btn-ghost" onClick={() => choose("denied")}>Decline</button>
    </div>
  );
}
