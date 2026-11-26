import { cache } from "react";
import { getMessages } from "./server";
import { I18nProvider } from "./provider";
import { APP_NS, pickNamespaces } from "./namespaces";

const catalogue = cache(() => getMessages());

/** Client provider with an explicit namespace subset (nested providers replace the parent's messages, so pass the full set). */
export async function NamespaceProvider({ ns, children }: { ns: readonly string[]; children: React.ReactNode }) {
  const { locale, messages } = await catalogue();
  return <I18nProvider locale={locale} messages={pickNamespaces(messages, ns)}>{children}</I18nProvider>;
}
/** Section layouts: the app base plus the namespaces that section's client components use. */
export const SectionMessages = ({ extra, children }: { extra: readonly string[]; children: React.ReactNode }) => (
  <NamespaceProvider ns={[...APP_NS, ...extra]}>{children}</NamespaceProvider>
);
