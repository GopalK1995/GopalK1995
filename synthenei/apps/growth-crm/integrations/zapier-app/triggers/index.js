/* eslint-disable @typescript-eslint/no-require-imports -- Zapier Platform CLI apps are CommonJS */
'use strict';
const { hookTrigger } = require('./_hook');

const envelope = (type, objectType) => ({
  id: 'evt_sample_0001', type, created_at: '2026-01-01T09:00:00.000Z', org_id: 'org_sample', workspace_id: 'ws_sample',
  object_type: objectType, object_id: '00000000-0000-4000-8000-000000000001', actor: { kind: 'user', id: null }, version: 1,
  data: { changed_fields: [] },
});

const DEFS = [
  { key: 'new_lead', noun: 'Lead', label: 'New Lead', description: 'Triggers when a lead is created.', events: ['lead.created'], listPath: '/leads', sampleEnvelope: envelope('lead.created', 'lead') },
  { key: 'lead_stage_changed', noun: 'Lead', label: 'Lead Status Changed', description: 'Triggers when a lead moves to another status.', events: ['lead.stage_changed'], listPath: '/leads', sampleEnvelope: envelope('lead.stage_changed', 'lead') },
  { key: 'new_deal', noun: 'Deal', label: 'New Deal', description: 'Triggers when a deal is created.', events: ['deal.created'], listPath: '/deals', sampleEnvelope: envelope('deal.created', 'deal') },
  { key: 'deal_stage_changed', noun: 'Deal', label: 'Deal Stage Changed', description: 'Triggers when a deal moves to another stage.', events: ['deal.stage_changed'], listPath: '/deals', sampleEnvelope: envelope('deal.stage_changed', 'deal') },
  { key: 'deal_won', noun: 'Deal', label: 'Deal Won', description: 'Triggers when a deal is marked won.', events: ['deal.won'], listPath: '/deals', sampleEnvelope: envelope('deal.won', 'deal') },
  { key: 'payment_received', noun: 'Payment', label: 'Payment Received', description: 'Triggers when a payment is received.', events: ['payment.paid'], listPath: null, sampleEnvelope: envelope('payment.paid', 'payment') },
];

module.exports = Object.fromEntries(DEFS.map((d) => [d.key, hookTrigger(d)]));
