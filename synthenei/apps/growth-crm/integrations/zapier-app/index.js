/* eslint-disable @typescript-eslint/no-require-imports -- Zapier Platform CLI apps are CommonJS */
'use strict';
// Zapier Platform CLI app definition (private app). Validate with `zapier validate`, upload with `zapier push`.
const { authentication } = require('./authentication');
const triggers = require('./triggers');
const create_lead = require('./creates/create_lead');
const update_deal = require('./creates/update_deal');
const move_deal = require('./creates/move_deal');
const pkg = require('./package.json');

module.exports = {
  version: pkg.version,
  platformVersion: pkg.dependencies['zapier-platform-core'],
  authentication,
  // Every request carries the key as a Bearer token and asks for JSON; the key's scopes decide what is allowed.
  beforeRequest: [
    (request, z, bundle) => {
      if (bundle.authData && bundle.authData.api_key) request.headers.Authorization = `Bearer ${bundle.authData.api_key}`;
      request.headers.Accept = 'application/json';
      return request;
    },
  ],
  afterResponse: [],
  triggers,
  creates: { [create_lead.key]: create_lead, [update_deal.key]: update_deal, [move_deal.key]: move_deal },
  searches: {},
  resources: {},
};
