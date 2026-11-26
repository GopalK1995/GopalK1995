import { SectionMessages } from "@/i18n/section";

// Client i18n for this section: app base + the `social` namespace (see src/i18n/namespaces.ts).
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionMessages extra={["social"]}>{children}</SectionMessages>;
}
