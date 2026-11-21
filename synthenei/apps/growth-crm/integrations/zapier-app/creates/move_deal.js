/* eslint-disable @typescript-eslint/no-require-imports -- Zapier Platform CLI apps are CommonJS */
'use strict';
const { normalizeBase } = require('../authentication');

module.exports = {
  key: 'move_deal',
  noun: 'Deal',
  display: { label: 'Move Deal to Stage', description: 'Moves a deal to a pipeline stage (by stage key).' },
  operation: {
    inputFields: [
      { key: 'id', label: 'Deal ID', required: true, type: 'string' },
      { key: 'stage_key', label: 'Stage key', required: true, type: 'string' },
      { key: 'lost_reason', label: 'Lost reason', type: 'string', helpText: 'Only when moving to a lost stage.' },
    ],
    perform: async (z, bundle) => {
      const base = `${normalizeBase(bundle.authData.base_url)}/api/v1/deals/${encodeURIComponent(bundle.inputData.id)}`;
      // The move endpoint needs the deal's current version (optimistic lock): read it first.
      const cur = await z.request({ url: base, method: 'GET' });
      const body = { stage_key: bundle.inputData.stage_key, expected_version: cur.data.data.version };
      if (bundle.inputData.lost_reason) body.lost_reason = bundle.inputData.lost_reason;
      const res = await z.request({ url: `${base}/move`, method: 'POST', body });
      return res.data.data;
    },
    sample: { id: '00000000-0000-4000-8000-000000000002', name: 'Sample deal' },
    outputFields: [{ key: 'id', label: 'Deal ID' }, { key: 'name', label: 'Name' }],
  },
};
