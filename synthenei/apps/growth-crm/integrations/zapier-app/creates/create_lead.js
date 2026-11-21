/* eslint-disable @typescript-eslint/no-require-imports -- Zapier Platform CLI apps are CommonJS */
'use strict';
const { normalizeBase } = require('../authentication');

const FIELDS = ['full_name', 'email', 'phone', 'city', 'district', 'source', 'firm_name', 'practice_area', 'role_title'];

module.exports = {
  key: 'create_lead',
  noun: 'Lead',
  display: { label: 'Create Lead', description: 'Creates a lead in the CRM.' },
  operation: {
    inputFields: [
      { key: 'full_name', label: 'Full name', required: true, type: 'string' },
      { key: 'email', label: 'Email', type: 'string' },
      { key: 'phone', label: 'Phone', type: 'string', helpText: 'With country code, e.g. +91...' },
      { key: 'city', label: 'City', type: 'string' },
      { key: 'district', label: 'District', type: 'string' },
      { key: 'source', label: 'Source', type: 'string', helpText: 'Where the lead came from, e.g. the name of the form or ad.' },
      { key: 'firm_name', label: 'Firm name', type: 'string' },
      { key: 'practice_area', label: 'Practice area', type: 'string' },
      { key: 'role_title', label: 'Role title', type: 'string' },
    ],
    perform: async (z, bundle) => {
      const body = {};
      for (const k of FIELDS) if (bundle.inputData[k] !== undefined && bundle.inputData[k] !== '') body[k] = bundle.inputData[k];
      const res = await z.request({
        url: `${normalizeBase(bundle.authData.base_url)}/api/v1/leads`,
        method: 'POST',
        // A retried step must not create a second lead: the key is stable for one Zap and one input.
        headers: { 'Idempotency-Key': z.hash('sha256', `${(bundle.meta && bundle.meta.zap && bundle.meta.zap.id) || 'zap'}:${JSON.stringify(body)}`) },
        body,
      });
      return res.data.data;
    },
    sample: { id: '00000000-0000-4000-8000-000000000001', full_name: 'Sample Lead', source: 'zapier', status: 'new' },
    outputFields: [{ key: 'id', label: 'Lead ID' }, { key: 'full_name', label: 'Full name' }, { key: 'source', label: 'Source' }, { key: 'status', label: 'Status' }],
  },
};
