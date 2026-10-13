"use client";
import type { ReactNode } from "react";
import { track } from "@/lib/track";

// Every primary CTA points at the same lead-capture flow (#demo).
export function CtaLink({ children, where, className = "btn btn-primary", href = "#demo" }: { children: ReactNode; where: string; className?: string; href?: string }) {
  return <a href={href} className={className} onClick={() => track("cta_click", { where })}>{children}</a>;
}
