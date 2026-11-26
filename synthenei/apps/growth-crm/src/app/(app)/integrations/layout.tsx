import { SectionMessages } from "@/i18n/section";

// Client i18n for this section: app base + the `social` namespace (the Instagram and Facebook step list embeds the Page picker).
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionMessages extra={["social"]}>{children}</SectionMessages>;
}
