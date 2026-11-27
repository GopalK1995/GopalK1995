"use client";
import { useEffect } from "react";

/**
 * Sets `data-hydrated="true"` on <body> once React has hydrated and the first effects have run. Renders nothing,
 * so it cannot cause a server/client mismatch. Used by Cypress (`cy.hydrated()`) instead of hard waits: a click that
 * lands before this attribute exists can be dropped because the handlers are not attached yet.
 */
export function HydrationMarker() {
  useEffect(() => {
    document.body.setAttribute("data-hydrated", "true");
    return () => document.body.removeAttribute("data-hydrated");
  }, []);
  return null;
}
