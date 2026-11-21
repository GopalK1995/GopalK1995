/* eslint-disable @typescript-eslint/no-require-imports -- Zapier Platform CLI apps are CommonJS */
'use strict';
const { normalizeBase } = require('../authentication');

const FIELDS = ['name', 'value_inr', 'next_step', 'next_step_at', 'expected_close_on', 'plan', 'seats'];

module.exports = {
  key: 'update_deal',
  noun: 'Deal',
  display: { label: 'Update Deal', description: 'Changes fields of an existing deal. To change its stage use Move Deal.' },
  operation: {
    inputFields: [
      { key: 'id', label: 'Deal ID', required: true, type: 'string' },
      { key: 'name', label: 'Name', type: 'string' },
      { key: 'value_inr', label: 'Value (INR)', type: 'number' },
      { key: 'next_step', label: 'Next step', type: 'string' },
      { key: 'next_step_at', label: 'Next step at', type: 'datetime' },
      { key: 'expected_close_on', label: 'Expected close date', type: 'string', helpText: 'YYYY-MM-DD' },
      { key: 'plan', label: 'Plan', type: 'string' },
      { key: 'seats', label: 'Seats', type: 'integer' },
    ],
    perform: async (z, bundle) => {
      const body = {};
      for (const k of FIELDS) if (bundle.inputData[k] !== undefined && bundle.inputData[k] !== '') body[k] = bundle.inputData[k];
      const res = await z.request({
        url: `${normalizeBase(bundle.authData.base_url)}/api/v1/deals/${encodeURIComponent(bundle.inputData.id)}`,
        method: 'PATCH',
        body,
      });
      return res.data.data;
    },
    sample: { id: '00000000-0000-4000-8000-000000000002', name: 'Sample deal', value_inr: 50000 },
    outputFields: [{ key: 'id', label: 'Deal ID' }, { key: 'name', label: 'Name' }, { key: 'value_inr', label: 'Value (INR)' }],
  },
};
