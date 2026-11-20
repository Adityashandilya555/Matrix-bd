// skipcq: JS-0833
// NSO platform integration — business-admin controls (Integrations tab).
//   GET/PUT /business-admin/integrations/nso               settings, counts, recent deliveries
//   POST    /business-admin/integrations/nso/rotate-secret new signing secret (shown once)
//   POST    /business-admin/integrations/nso/test          queue a site.test event
//   POST    /business-admin/integrations/nso/backfill      queue every eligible site
//   GET     /business-admin/integrations/nso/dead          events that gave up
//   POST    /business-admin/integrations/nso/dead/{id}/replay
import { createApiClient } from './axiosClient.js';
import { camelize } from './vendorCase.js';

const client = createApiClient();
const BASE = '/business-admin/integrations/nso';
const get = async (url) => camelize((await client.get(url)).data);
const post = async (url, body) => camelize((await client.post(url, body)).data);

export const getNsoIntegration = () => get(BASE);
export const saveNsoIntegration = async ({ endpointUrl, enabled }) =>
  camelize((await client.put(BASE, { endpoint_url: endpointUrl, enabled })).data);
export const rotateNsoSecret = () => post(`${BASE}/rotate-secret`);
export const sendNsoTest = () => post(`${BASE}/test`);
export const backfillNso = () => post(`${BASE}/backfill`);
export const listNsoDead = () => get(`${BASE}/dead`);
export const replayNsoEvent = (outboxId) => post(`${BASE}/dead/${encodeURIComponent(outboxId)}/replay`);
