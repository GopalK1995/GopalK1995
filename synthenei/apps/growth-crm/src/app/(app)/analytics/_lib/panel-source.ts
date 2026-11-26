// AUD-102 (part): decide, per data source, what /analytics may show. Pure so it can be unit-tested.
// Demo workspace  -> everything is a labelled sample series (demo behaviour is unchanged).
// Real workspace  -> CRM panels read the CRM; GA4 panels read GA4 only when GA4 is connected, otherwise they are
//                    EMPTY (named "Not connected") and never draw a sample series next to a real KPI.
export type PanelSource = "crm" | "ga4" | "sample" | "none";
export interface DataModeInput { demo: boolean; ga4Connected: boolean }
export interface PanelSources { ga4: PanelSource; crm: PanelSource }

export function panelSources({ demo, ga4Connected }: DataModeInput): PanelSources {
  if (demo) return { ga4: "sample", crm: "sample" };
  return { ga4: ga4Connected ? "ga4" : "none", crm: "crm" };
}

export const SOURCE_LABEL: Record<PanelSource, string> = { crm: "Source: CRM", ga4: "Source: GA4", sample: "Source: sample data", none: "Source: GA4 (not connected)" };

/** Banner copy. null = no banner needed (everything is live). */
export function modeBanner(s: PanelSources, siteName: string): string | null {
  if (s.ga4 === "sample") return `This is a demo workspace. Every number here is a sample series shaped like a GA4 property for the ${siteName} site.`;
  if (s.ga4 === "none") return `GA4 is not connected, so the web traffic panels are empty. Panels labelled CRM below are real counts from your CRM.`;
  return null;
}
