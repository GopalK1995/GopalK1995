// Static namespace registry. A later task adds its namespace with two lines here and two JSON files.
import enCommon from "../../messages/en/common.json";
import enShell from "../../messages/en/shell.json";
import enAuth from "../../messages/en/auth.json";
import enErrors from "../../messages/en/errors.json";
import enLeads from "../../messages/en/leads.json";
import enTasks from "../../messages/en/tasks.json";
import enAccounts from "../../messages/en/accounts.json";
import enPipeline from "../../messages/en/pipeline.json";
import enInbox from "../../messages/en/inbox.json";
import enSettingsAccess from "../../messages/en/settings-access.json";
import enAdmin from "../../messages/en/admin.json";
import enAudit from "../../messages/en/audit.json";
import enApi from "../../messages/en/api.json";
import enCollab from "../../messages/en/collab.json";
import enIntegrations from "../../messages/en/integrations.json";
import enCampaigns from "../../messages/en/campaigns.json";
import enFields from "../../messages/en/fields.json";
import enWebhooks from "../../messages/en/webhooks.json";
import enImports from "../../messages/en/imports.json";
import enObjects from "../../messages/en/objects.json";
import enWhatsapp from "../../messages/en/whatsapp.json";
import enCrmSync from "../../messages/en/crmSync.json";
import enMetaAds from "../../messages/en/metaAds.json";
import enRazorpay from "../../messages/en/razorpay.json";
import enCalendly from "../../messages/en/calendly.json";
import enReviews from "../../messages/en/reviews.json";
import enOta from "../../messages/en/ota.json";
import enEmail from "../../messages/en/email.json";
import enSlack from "../../messages/en/slack.json";
import enGoogle from "../../messages/en/google.json";
import enSocial from "../../messages/en/social.json";
import enGmail from "../../messages/en/gmail.json";
import enLinkedin from "../../messages/en/linkedin.json";
import enSearch from "../../messages/en/search.json";
import enAi from "../../messages/en/ai.json";
import taCommon from "../../messages/ta/common.json";
import taShell from "../../messages/ta/shell.json";
import taAuth from "../../messages/ta/auth.json";
import taErrors from "../../messages/ta/errors.json";
import taLeads from "../../messages/ta/leads.json";
import taTasks from "../../messages/ta/tasks.json";
import taAccounts from "../../messages/ta/accounts.json";
import taPipeline from "../../messages/ta/pipeline.json";
import taInbox from "../../messages/ta/inbox.json";
import taSettingsAccess from "../../messages/ta/settings-access.json";
import taAdmin from "../../messages/ta/admin.json";
import taAudit from "../../messages/ta/audit.json";
import taApi from "../../messages/ta/api.json";
import taCollab from "../../messages/ta/collab.json";
import taIntegrations from "../../messages/ta/integrations.json";
import taCampaigns from "../../messages/ta/campaigns.json";
import taFields from "../../messages/ta/fields.json";
import taWebhooks from "../../messages/ta/webhooks.json";
import taObjects from "../../messages/ta/objects.json";
import taWhatsapp from "../../messages/ta/whatsapp.json";
import taMetaAds from "../../messages/ta/metaAds.json";
import taRazorpay from "../../messages/ta/razorpay.json";
import taCalendly from "../../messages/ta/calendly.json";
import taReviews from "../../messages/ta/reviews.json";
import taOta from "../../messages/ta/ota.json";
import taEmail from "../../messages/ta/email.json";
import taGoogle from "../../messages/ta/google.json";
import taSocial from "../../messages/ta/social.json";
import taGmail from "../../messages/ta/gmail.json";
import taLinkedin from "../../messages/ta/linkedin.json";
import taSearch from "../../messages/ta/search.json";
import taAi from "../../messages/ta/ai.json";
import taSlack from "../../messages/ta/slack.json";
import type { Locale } from "./config";

export type Messages = { [k: string]: string | boolean | Messages };
/** Feature-task namespace files carry a `_review` marker; the Tamil review gate is tracked in review.json, so drop it from the tree. */
const clean = (m: Messages): Messages => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith("_")));
const RAW: Record<Locale, Messages> = {
  en: { common: enCommon, shell: enShell, auth: enAuth, errors: enErrors,
    leads: enLeads, tasks: enTasks, accounts: enAccounts, pipeline: enPipeline, inbox: enInbox, settingsAccess: enSettingsAccess, admin: enAdmin, audit: enAudit, api: enApi, collab: enCollab, integrations: enIntegrations, campaigns: enCampaigns, fields: enFields, webhooks: enWebhooks, objects: enObjects, imports: enImports, whatsapp: enWhatsapp, razorpay: enRazorpay, metaAds: enMetaAds, crmSync: enCrmSync, email: enEmail, google: enGoogle, social: enSocial, linkedin: enLinkedin, gmail: enGmail, calendly: enCalendly, reviews: enReviews, ai: enAi, search: enSearch, slack: enSlack, ota: enOta },
  ta: { common: taCommon, shell: taShell, auth: taAuth, errors: taErrors,
    leads: taLeads, tasks: taTasks, accounts: taAccounts, pipeline: taPipeline, inbox: taInbox, settingsAccess: taSettingsAccess, admin: taAdmin, audit: taAudit, api: taApi, collab: taCollab, integrations: taIntegrations, campaigns: taCampaigns, fields: taFields, webhooks: taWebhooks, objects: taObjects, whatsapp: taWhatsapp, razorpay: taRazorpay, metaAds: taMetaAds, email: taEmail, google: taGoogle, social: taSocial, linkedin: taLinkedin, gmail: taGmail, calendly: taCalendly, reviews: taReviews, ai: taAi, search: taSearch, slack: taSlack, ota: taOta },
};
export const BASE: Record<Locale, Messages> = {
  en: Object.fromEntries(Object.entries(RAW.en).map(([k, v]) => [k, clean(v as Messages)])),
  ta: Object.fromEntries(Object.entries(RAW.ta).map(([k, v]) => [k, clean(v as Messages)])),
};
