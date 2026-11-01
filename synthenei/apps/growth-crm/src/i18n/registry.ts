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
import type { Locale } from "./config";

export type Messages = { [k: string]: string | Messages };
export const BASE: Record<Locale, Messages> = {
  en: { common: enCommon, shell: enShell, auth: enAuth, errors: enErrors,
    leads: enLeads, tasks: enTasks, accounts: enAccounts, pipeline: enPipeline, inbox: enInbox, settingsAccess: enSettingsAccess, admin: enAdmin, audit: enAudit, api: enApi, collab: enCollab, integrations: enIntegrations, campaigns: enCampaigns },
  ta: { common: taCommon, shell: taShell, auth: taAuth, errors: taErrors,
    leads: taLeads, tasks: taTasks, accounts: taAccounts, pipeline: taPipeline, inbox: taInbox, settingsAccess: taSettingsAccess, admin: taAdmin, audit: taAudit, api: taApi, collab: taCollab, integrations: taIntegrations, campaigns: taCampaigns },
};
