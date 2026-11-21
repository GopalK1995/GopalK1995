// Recorded-shape fixtures: LinkedIn has no public sandbox, so these follow the REST documentation's response shapes with SYNTHETIC ids and
// people (example.invalid addresses, reserved phone numbers). None is a capture from a live LinkedIn account.
import type { LeadResponse, RawAnalytics } from "../gateway";

export const ACCOUNT = "100000001";
export const ACCOUNT_URN = `urn:li:sponsoredAccount:${ACCOUNT}`;
export const FORM_URN = "urn:li:versionedLeadGenForm:(urn:li:leadGenForm:555000,2)";
export const T0 = Date.parse("2026-11-08T05:00:00Z");

/** One element of GET /rest/leadFormResponses?q=owner. */
export const rawLeadResponse = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "resp-0001", owner: { sponsoredAccount: ACCOUNT_URN }, leadType: "SPONSORED", submittedAt: T0, testLead: false,
  versionedLeadGenFormUrn: FORM_URN, associatedEntity: { sponsoredCampaign: "urn:li:sponsoredCampaign:200000001" },
  formResponse: {
    answers: [
      { questionId: 11, answerDetails: { textQuestionAnswer: { answer: "Asha" } } },
      { questionId: 12, answerDetails: { textQuestionAnswer: { answer: "Rao" } } },
      { questionId: 13, answerDetails: { textQuestionAnswer: { answer: "Asha.Rao@Example.invalid" } } },
      { questionId: 14, answerDetails: { textQuestionAnswer: { answer: "+91 98450 00001" } } },
      { questionId: 15, answerDetails: { textQuestionAnswer: { answer: "Rao and Co" } } },
      { questionId: 16, answerDetails: { multipleChoiceAnswer: { options: ["yes"] } } },
    ],
    consentResponses: [{ consentId: 7001, accepted: true }],
  },
  ...over,
});

/** GET /rest/leadForms/{id}: question ids -> predefined field (or none for a custom question). */
export const rawForm = {
  id: 555000, content: { questions: [
    { questionId: 11, predefinedField: "FIRST_NAME" }, { questionId: 12, predefinedField: "LAST_NAME" }, { questionId: 13, predefinedField: "EMAIL" },
    { questionId: 14, predefinedField: "PHONE_NUMBER" }, { questionId: 15, predefinedField: "COMPANY_NAME" }, { questionId: 16 },
  ] },
};
export const QUESTIONS = new Map<string, string>([["11", "first_name"], ["12", "last_name"], ["13", "email"], ["14", "phone_number"], ["15", "company_name"], ["16", "custom_16"]]);

export const leadResponse = (over: Partial<LeadResponse> = {}): LeadResponse => ({
  id: "resp-0001", submittedAt: T0, ownerAccountUrn: ACCOUNT_URN, formUrn: FORM_URN, campaignUrn: "urn:li:sponsoredCampaign:200000001", testLead: false,
  answers: [
    { questionId: "11", value: "Asha" }, { questionId: "12", value: "Rao" }, { questionId: "13", value: "Asha.Rao@Example.invalid" },
    { questionId: "14", value: "+91 98450 00001" }, { questionId: "15", value: "Rao and Co" },
  ],
  consents: [{ id: "7001", accepted: true }], ...over,
});

/** One element of GET /rest/adAnalytics (pivot CAMPAIGN, DAILY). */
export const rawAnalytics = (over: Partial<RawAnalytics> = {}): RawAnalytics => ({
  pivotValues: ["urn:li:sponsoredCampaign:200000001"], dateRange: { start: { year: 2026, month: 11, day: 1 } },
  costInLocalCurrency: "1234.567", impressions: 10000, clicks: 150, oneClickLeads: 4, ...over,
});

export const rawAdAccounts = { elements: [
  { id: 100000001, name: "Synthetic Account A", currency: "INR", status: "ACTIVE" },
  { id: 100000002, name: "Synthetic Account B", currency: "USD", status: "ACTIVE" },
  { id: 100000003, name: "Removed", currency: "INR", status: "REMOVED" },
] };
