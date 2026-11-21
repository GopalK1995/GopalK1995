'use strict';
// Custom authentication: the tenant pastes an API key created under Settings > API keys, and the base URL of their CRM.
// The key's role and scopes decide what Zapier can see and do (the same rules as the app). No default URL is baked in.

const normalizeBase = (u) => String(u || '').trim().replace(/\/+$/, '');

module.exports = {
  normalizeBase,
  authentication: {
    type: 'custom',
    fields: [
      { key: 'base_url', label: 'CRM URL', required: true, type: 'string', helpText: 'The https address your CRM runs on, e.g. https://crm.your-company.example (no trailing path).' },
      { key: 'api_key', label: 'API key', required: true, type: 'password', helpText: 'Create one in the CRM under Settings > API keys. Scopes needed: leads:write, deals:write, webhooks:write (plus the read scopes of the objects you trigger on).' },
    ],
    test: async (z, bundle) => {
      const res = await z.request({ url: `${normalizeBase(bundle.authData.base_url)}/api/v1/me`, method: 'GET' });
      return res.data;
    },
    connectionLabel: (z, bundle) => (bundle.inputData && bundle.inputData.data && (bundle.inputData.data.workspace_name || bundle.inputData.data.workspace_id)) || 'Growth CRM',
  },
};
