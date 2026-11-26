// Text of the platform legal pages, built from the working draft (not legal advice: counsel must review before the first paying customer).
// Every company-specific value comes from LegalConfig. A value that is not set renders as a visible "[not set: NAME]" marker so a draft can
// never be mistaken for final text. Retention: the product does NOT delete collected metrics automatically (the privacy.retention job runs
// as a dry run unless a retention row says otherwise), so every deletion promise below is "on request", never an automatic schedule.
import { LEGAL_ENV, type LegalConfig, type LegalKey } from "./config";

export type Block = string | string[];   // string = paragraph, string[] = bullet list
export interface Section { id: string; heading: string; blocks: Block[] }
export interface LegalDoc { slug: "privacy" | "terms" | "data-deletion"; title: string; intro?: string; sections: Section[] }

export const LEGAL_PATHS = { privacy: "/legal/privacy", terms: "/legal/terms", dataDeletion: "/legal/data-deletion", status: "/legal/data-deletion/status" } as const;

/** Value for display; a missing value is shown as an explicit marker, never as blank or invented text. */
export const val = (c: LegalConfig, k: LegalKey): string => c.values[k] ?? `[not set: ${LEGAL_ENV[k]}]`;

const within = (n: number | null): string => (n ? `within ${n} days` : "without undue delay");

export function privacyDoc(c: LegalConfig): LegalDoc {
  const P = c.productName, name = val(c, "legalName"), mail = val(c, "contactEmail");
  return {
    slug: "privacy", title: `${P} Privacy Policy`,
    sections: [
      { id: "who-we-are", heading: "Who we are", blocks: [
        `${P} ("the Service") is operated by ${name} ("we", "us"), ${val(c, "address")}. Contact: ${mail}.`,
        `The Service is a customer relationship and marketing analytics tool used by businesses ("Customers"). For the data a Customer puts into the Service about its own leads, contacts and social accounts, the Customer decides why and how it is used and we process it on the Customer's behalf. For the account details of the people who sign in to the Service, we decide the purpose and are responsible for it.`,
      ] },
      { id: "what-we-collect", heading: "What we collect", blocks: [
        ["Account data: name, work email, role, organisation name, and sign-in records.",
          "Customer content: leads, contacts, deals, tasks, messages and notes that a Customer or its team enters or imports.",
          "Connected-account data: when a Customer connects a third-party account, we receive only what it authorises.",
          "Access tokens: the credentials Meta and other providers issue so we can read that data. They are stored encrypted in a secrets vault and never shown in the interface.",
          "Technical data: IP address, device and browser type, and logs needed to keep the Service secure."],
        "From Instagram and Facebook (Meta) we receive the Page and Instagram business account the user selects, account name and follower count, post details (caption, link, date, type), post and account metrics (reach, impressions, likes, comment counts, shares, saves, views, profile views, website clicks), ad account and campaign performance, lead form submissions, and Instagram direct messages sent to the connected account. For comments we store counts only, not who commented or what they wrote.",
        "From WhatsApp Business, Google Analytics, Google Ads, Google Sheets, email and payment providers we receive the data each Customer authorises for that connection.",
        "We do not collect data from a Customer's social accounts that the Customer has not connected and approved.",
      ] },
      { id: "how-we-use-it", heading: "How we use it", blocks: [
        ["To show a Customer its own dashboards, social post metrics, ads results and inbox.",
          "To run scheduled updates that refresh metrics from the connected accounts.",
          "To provide, secure, support and improve the Service, and to meet legal obligations."],
        "We do not sell personal data, use Meta data for advertising to others, build profiles of individuals across Customers, or transfer Meta platform data to data brokers.",
      ] },
      { id: "meta-platform-data", heading: "Meta platform data", blocks: [
        "Data we receive through Meta (Facebook and Instagram) is used only to provide the features a Customer connected the account for, as described above. We follow Meta's Platform Terms and Developer Policies. A Customer can disconnect its accounts at any time from Settings, Integrations, and can remove the Service's access from Facebook (Business Integrations) or Instagram (Apps and Websites).",
        `You can ask us to delete the data we hold from your Facebook or Instagram account on the Data Deletion page (${LEGAL_PATHS.dataDeletion}).`,
      ] },
      { id: "where-data-lives", heading: "Where data lives and who sees it", blocks: [
        `Data is stored with our infrastructure providers (for the database and encrypted secrets, and for hosting) in ${val(c, "region")}. Each Customer's data is separated from every other Customer's by access rules enforced in the database. Only the Customer's authorised users, and our staff when the Customer opens a support session, can see it. We share data only with:`,
        ["service providers that process it for us under contract (hosting, email delivery, error monitoring);",
          "the third-party platforms a Customer chooses to connect;",
          "authorities, where the law requires."],
      ] },
      { id: "retention", heading: "How long we keep it", blocks: [
        "We keep a Customer's data while its account is active. When a Customer disconnects a connected account, we stop collecting from it and delete the stored access tokens straight away.",
        `Metrics and other data already collected are not removed automatically at that moment. A Customer, or a person whose Meta data we hold, can ask us to delete them (see the Data Deletion page), and we do so ${within(c.deletionDays)}. After an account is closed, the Customer can ask us to delete its data on the same basis. We keep records we must keep by law (for example invoices).`,
      ] },
      { id: "your-rights", heading: "Your rights", blocks: [
        `Under India's Digital Personal Data Protection Act, 2023 and similar laws, you may ask us to access, correct or delete your personal data, withdraw consent, and nominate someone to act for you. If your data is held by a Customer (for example you are a lead in a Customer's CRM), contact that Customer first; we will help the Customer respond. To contact us, email ${mail}. To delete data we hold, see the Data Deletion page (${LEGAL_PATHS.dataDeletion}).`,
      ] },
      { id: "security", heading: "Security", blocks: [
        "We use encryption in transit and at rest, encrypted storage for access tokens, role-based access, audit logs, and per-Customer data isolation. No system is perfectly secure, and we will notify affected Customers and authorities of a breach as the law requires.",
      ] },
      { id: "children", heading: "Children", blocks: ["The Service is for businesses and is not directed at anyone under 18."] },
      { id: "changes", heading: "Changes", blocks: ["We will post changes here and update the effective date. For material changes we will also notify Customers."] },
      { id: "grievance-officer", heading: "Grievance officer", blocks: [
        `${val(c, "grievanceName")}, ${val(c, "grievanceEmail")}. We reply ${within(c.grievanceDays)}.`,
      ] },
    ],
  };
}

export function termsDoc(c: LegalConfig): LegalDoc {
  const P = c.productName, name = val(c, "legalName");
  const cap = c.liabilityMonths ? `the fees you paid us in the ${c.liabilityMonths} months before the claim` : "the fees you paid us in the period stated in your order";
  return {
    slug: "terms", title: `${P} Terms of Service`,
    sections: [
      { id: "agreement", heading: "Agreement", blocks: [`These terms are between ${name} ("we") and the business or person that creates an account ("you"). By using the Service you agree to them. If you accept on behalf of a business, you confirm you may bind it.`] },
      { id: "the-service", heading: "The Service", blocks: ["We provide a hosted CRM with marketing analytics and integrations with third-party platforms such as Meta (Facebook, Instagram, WhatsApp), Google and email providers. Features may change over time. Some features depend on approvals or availability from those platforms."] },
      { id: "accounts", heading: "Accounts and users", blocks: ["You are responsible for your account, your users and everything done through them. Keep credentials secure and tell us of any unauthorised use. You must give accurate information."] },
      { id: "your-data", heading: "Your data", blocks: ["You own your data. You give us the right to host and process it only to provide the Service to you. You promise that you have the right to put the data into the Service, including a lawful basis and any consent needed to contact your leads (for example for WhatsApp, email or phone), and that your use complies with applicable law."] },
      { id: "connected-accounts", heading: "Connected accounts", blocks: ["When you connect a Facebook Page, Instagram account, ad account or other account, you confirm you are authorised to do so and to allow us to read its data. You can disconnect at any time. You must follow the terms of each platform you connect, including Meta's Platform Terms and Instagram and WhatsApp policies. We are not responsible if a platform changes, limits or withdraws access, or limits data it returns."] },
      { id: "acceptable-use", heading: "Acceptable use", blocks: ["You may not: break the law or others' rights; send spam or contact people without the consent the law or platform requires; attempt to access another customer's data; reverse engineer, overload or disrupt the Service; use the Service to collect data you are not entitled to; or resell the Service without our written agreement."] },
      { id: "fees", heading: "Fees", blocks: ["Paid plans, prices, billing cycle and taxes are set out in your order or on our pricing page. Fees are non-refundable except where the law requires or we agree otherwise. We may suspend the Service for non-payment after notice."] },
      { id: "availability", heading: "Availability and support", blocks: ["We aim for reliable service but do not guarantee uninterrupted or error-free operation. Metrics shown come from third-party platforms and may be delayed, incomplete or revised by them."] },
      { id: "intellectual-property", heading: "Intellectual property", blocks: ["We own the Service and its software and branding. You own your data. We may use anonymised, aggregated usage statistics that do not identify you or your leads."] },
      { id: "privacy", heading: "Privacy", blocks: [`Our Privacy Policy (${LEGAL_PATHS.privacy}) explains how we handle data and forms part of these terms. Where we process personal data for you, we do so on your instructions and will sign a data processing agreement on request.`] },
      { id: "termination", heading: "Termination", blocks: ["You may stop using the Service and close your account at any time. We may suspend or end your access for serious or repeated breach, after notice where practicable. After closure you can ask us to delete your data as set out in the Privacy Policy. You can export your data before closing."] },
      { id: "liability", heading: "Warranties and liability", blocks: [`The Service is provided "as is" to the extent the law allows. We are not liable for indirect or consequential loss, or loss of profit, data or goodwill. Our total liability for any claim is limited to ${cap}. Nothing limits liability that cannot be limited by law.`] },
      { id: "indemnity", heading: "Indemnity", blocks: ["You will cover losses we suffer because of your data, your use of the Service in breach of these terms, or your breach of a third party's rights or platform rules."] },
      { id: "changes", heading: "Changes", blocks: ["We may update these terms. Material changes will be notified in advance. Continued use after the effective date means you accept them."] },
      { id: "governing-law", heading: "Governing law", blocks: [`These terms are governed by the laws of India. Courts at ${val(c, "city")} have exclusive jurisdiction.`] },
      { id: "contact", heading: "Contact", blocks: [`${name}, ${val(c, "address")}, ${val(c, "contactEmail")}.`] },
    ],
  };
}

export function deletionDoc(c: LegalConfig): LegalDoc {
  const P = c.productName, mail = val(c, "contactEmail");
  return {
    slug: "data-deletion", title: `${P} Data Deletion Instructions`,
    intro: "You can ask us to delete the data we hold from your Facebook or Instagram account, or remove our access to it.",
    sections: [
      { id: "disconnect", heading: "Option 1: disconnect from inside the Service", blocks: [
        "Sign in, go to Settings, Integrations, open the Instagram or Facebook connection and choose Disconnect. This stops collection and deletes the stored access token straight away. Data already collected stays until you ask us to delete it (Option 3).",
      ] },
      { id: "remove-app", heading: "Option 2: remove the app from Facebook or Instagram", blocks: [
        ["Facebook: Settings and privacy, Settings, Business integrations (or Apps and websites), find the Service, then Remove.",
          "Instagram: Settings, Apps and websites, find the app, then Remove."],
        "Removing the app revokes our access. It does not by itself delete data we already stored. To have that deleted, use Option 3.",
      ] },
      { id: "ask-us", heading: "Option 3: ask us to delete it", blocks: [
        `Email ${mail} from the address linked to your account with the subject "Delete my data", and include your organisation name and the Instagram or Facebook account name. We will confirm by email and complete deletion ${within(c.deletionDays)}. We give you a confirmation code you can quote when you contact us.`,
      ] },
      { id: "automatic-requests", heading: "Requests sent by Facebook", blocks: [
        `If you remove the app from Facebook and Facebook sends us a deletion request for your account, we record it and show a confirmation code. You can check its status at ${LEGAL_PATHS.status}?code= followed by your confirmation code. We first disconnect and remove the stored access credentials for the matching connection. Stored metrics are then erased by us on that request; the status page shows when that is done.`,
      ] },
    ],
  };
}
