/* eslint-disable @typescript-eslint/no-require-imports -- Zapier Platform CLI apps are CommonJS */
'use strict';
// REST-hook trigger factory. Subscribing creates a webhook endpoint through POST /api/v1/webhooks (https URL only, the signing secret is
// returned once and kept by Zapier as subscribeData); unsubscribing deletes it. Deliveries are the CRM's signed, retried envelope
// (id, type, created_at, org_id, workspace_id, object_type, object_id, actor, data). Events carry ids and changed field names, not
// personal data: use a Find step to read the record under the same API key.
const { normalizeBase } = require('../authentication');

const api = (bundle, path) => `${normalizeBase(bundle.authData.base_url)}/api/v1${path}`;

function flatten(envelope) {
  return {
    id: envelope.id,
    type: envelope.type,
    created_at: envelope.created_at,
    workspace_id: envelope.workspace_id,
    object_type: envelope.object_type || null,
    object_id: envelope.object_id || null,
    actor_kind: envelope.actor ? envelope.actor.kind : null,
    changed_fields: envelope.data && Array.isArray(envelope.data.changed_fields) ? envelope.data.changed_fields.join(', ') : '',
    data: envelope.data || {},
  };
}

function hookTrigger(def) {
  return {
    key: def.key,
    noun: def.noun,
    display: { label: def.label, description: def.description },
    operation: {
      type: 'hook',
      performSubscribe: async (z, bundle) => {
        const res = await z.request({
          url: api(bundle, '/webhooks'),
          method: 'POST',
          // One subscription per Zap hook URL: a retried subscribe replays instead of creating a second endpoint.
          headers: { 'Idempotency-Key': z.hash('sha256', bundle.targetUrl) },
          body: { url: bundle.targetUrl, event_types: def.events, description: 'Zapier' },
        });
        return res.data.data;
      },
      performUnsubscribe: async (z, bundle) => {
        const id = bundle.subscribeData && bundle.subscribeData.id;
        if (!id) return {};
        const res = await z.request({ url: api(bundle, `/webhooks/${encodeURIComponent(id)}`), method: 'DELETE', skipThrowForStatus: true });
        // 404 = already gone: that is the goal.
        if (res.status >= 400 && res.status !== 404) res.throwForStatus();
        return {};
      },
      perform: (z, bundle) => {
        const body = bundle.cleanedRequest;
        if (!body || body.type === 'webhook.test') return [];
        return [flatten(body)];
      },
      // Sample data for the editor: the latest records of the object (or the static sample below).
      performList: async (z, bundle) => {
        if (!def.listPath) return [flatten(def.sampleEnvelope)];
        const res = await z.request({ url: api(bundle, `${def.listPath}?limit=3`), method: 'GET' });
        const rows = (res.data && res.data.data) || [];
        if (!rows.length) return [flatten(def.sampleEnvelope)];
        return rows.map((r) => flatten({ ...def.sampleEnvelope, id: `sample-${r.id}`, object_id: r.id }));
      },
      sample: flatten(def.sampleEnvelope),
      outputFields: [
        { key: 'id', label: 'Event ID' }, { key: 'type', label: 'Event type' }, { key: 'created_at', label: 'Occurred at', type: 'datetime' },
        { key: 'workspace_id', label: 'Workspace ID' }, { key: 'object_type', label: 'Object type' }, { key: 'object_id', label: 'Object ID' },
        { key: 'actor_kind', label: 'Done by' }, { key: 'changed_fields', label: 'Changed fields' },
      ],
    },
  };
}

module.exports = { hookTrigger, flatten };
