import { SectionMessages } from "@/i18n/section";

// Client i18n for this section: app base + the `ai` and `imports` namespaces (see src/i18n/namespaces.ts).
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SectionMessages extra={["ai", "imports"]}>{children}</SectionMessages>;
}
