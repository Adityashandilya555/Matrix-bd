// skipcq: JS-0833
// Business admin → Integrations → NSO platform. Pins the two things that matter
// to the admin: the signing secret is shown once (and gone after "saved it"),
// and the server-side key being absent produces an explanation, not a form.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  getNsoIntegration: vi.fn(),
  saveNsoIntegration: vi.fn(),
  rotateNsoSecret: vi.fn(),
  sendNsoTest: vi.fn(),
  backfillNso: vi.fn(),
  listNsoDead: vi.fn(),
  replayNsoEvent: vi.fn(),
  listNsoSites: vi.fn(),
  getNsoSiteHistory: vi.fn(),
  getNsoEvent: vi.fn(),
  lookupNsoSite: vi.fn(),
  resendNsoSite: vi.fn(),
}));
vi.mock('../../../services/api/integrationsApi.js', () => api);

import IntegrationsTab from '../integrations/IntegrationsTab.jsx';

const counts = { pending: 0, sending: 0, sent: 0, failed: 0, dead: 0 };
const cfg = (over = {}) => ({
  configured: false, keyConfigured: true, enabled: false, endpointUrl: null,
  rotationInProgress: false, counts, recentDeliveries: [], ...over,
});

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.listNsoDead.mockResolvedValue([]);
  api.listNsoSites.mockResolvedValue(page([]));
});

function page(sites, total = sites.length) {
  return { total, page: 1, pageSize: 25, sites };
}
const latest = (over = {}) => ({
  id: 'ev1', seq: 1, eventType: 'site.updated', status: 'sent', attempts: 1, lastHttpStatus: 200,
  lastError: null, nextAttemptAt: null, createdAt: null, sentAt: null, ...over,
});
const siteRow = (site, over = {}) => ({
  siteId: site ? site.id : '00000000-0000-0000-0000-000000000000', site, events: 1,
  firstAt: null, firstSentAt: null, state: 'up_to_date', latest: latest(), ...over,
});
const historyEvent = (over = {}) => ({
  id: 'ev1', seq: 1, eventType: 'site.updated', status: 'sent', attempts: 1, lastHttpStatus: 200,
  lastError: null, nextAttemptAt: null, createdAt: null, sentAt: null, changes: null, first: false, tries: [], ...over,
});

describe('IntegrationsTab', () => {
  it('shows the secret once after the first save', async () => {
    api.getNsoIntegration.mockResolvedValueOnce(cfg())
      .mockResolvedValue(cfg({ configured: true, enabled: true, endpointUrl: 'https://nso.example.com/hook' }));
    api.saveNsoIntegration.mockResolvedValue({ enabled: true, endpointUrl: 'https://nso.example.com/hook', secret: 'whsec_abc' });
    const user = userEvent.setup();
    render(<IntegrationsTab />);

    await user.type(await screen.findByLabelText(/endpoint url/i), 'https://nso.example.com/hook');
    await user.click(screen.getByLabelText(/send site updates/i));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(api.saveNsoIntegration).toHaveBeenCalledWith({ endpointUrl: 'https://nso.example.com/hook', enabled: true });
    expect(await screen.findByText('whsec_abc')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /saved it/i }));
    expect(screen.queryByText('whsec_abc')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /send all current sites/i })).toBeInTheDocument();
  });

  it('explains a missing server key instead of showing the form', async () => {
    api.getNsoIntegration.mockResolvedValue(cfg({ keyConfigured: false }));
    render(<IntegrationsTab />);
    expect(await screen.findByText(/INTEGRATION_SECRET_KEY/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/endpoint url/i)).not.toBeInTheDocument();
  });

  it('replays a dead event', async () => {
    api.getNsoIntegration.mockResolvedValue(cfg({ configured: true, enabled: true, endpointUrl: 'https://x.example' }));
    api.listNsoDead.mockResolvedValue([{ id: 'ev1', seq: 4, eventType: 'site.updated', lastHttpStatus: 400, createdAt: null }]);
    api.replayNsoEvent.mockResolvedValue({ replayed: true });
    const user = userEvent.setup();
    render(<IntegrationsTab />);
    await user.click(await screen.findByRole('button', { name: 'Replay' }));
    await waitFor(() => expect(api.replayNsoEvent).toHaveBeenCalledWith('ev1'));
  });

  it('keeps an unsaved URL edit when another action reloads the page', async () => {
    api.getNsoIntegration.mockResolvedValue(cfg({ configured: true, enabled: true, endpointUrl: 'https://old.example' }));
    api.sendNsoTest.mockResolvedValue({ queued: true });
    const user = userEvent.setup();
    render(<IntegrationsTab />);
    const input = await screen.findByLabelText(/endpoint url/i);
    await user.clear(input);
    await user.type(input, 'https://new.example');
    await user.click(screen.getByRole('button', { name: 'Send test' }));
    await screen.findByText(/test event queued/i);
    expect(screen.getByLabelText(/endpoint url/i)).toHaveValue('https://new.example');
  });

  it('prompts for a backfill right after switching on', async () => {
    api.getNsoIntegration.mockResolvedValue(cfg({ configured: true, enabled: false, endpointUrl: 'https://x.example' }));
    api.saveNsoIntegration.mockResolvedValue({ enabled: true, endpointUrl: 'https://x.example', secret: null, justEnabled: true });
    const user = userEvent.setup();
    render(<IntegrationsTab />);
    await user.click(await screen.findByLabelText(/send site updates/i));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/were not sent/i)).toBeInTheDocument();
  });

  it('can still switch off when the server key is missing', async () => {
    api.getNsoIntegration.mockResolvedValue(cfg({ keyConfigured: false, configured: true, enabled: true, endpointUrl: 'https://x.example' }));
    api.saveNsoIntegration.mockResolvedValue({ enabled: false, endpointUrl: 'https://x.example', secret: null, justEnabled: false });
    const user = userEvent.setup();
    render(<IntegrationsTab />);
    await user.click(await screen.findByRole('button', { name: /switch off sending/i }));
    expect(api.saveNsoIntegration).toHaveBeenCalledWith({ endpointUrl: 'https://x.example', enabled: false });
  });

  it('keeps the one-time secret on screen if the refresh after saving fails', async () => {
    api.getNsoIntegration.mockResolvedValueOnce(cfg()).mockRejectedValue(new Error('network down'));
    api.saveNsoIntegration.mockResolvedValue({ enabled: false, endpointUrl: 'https://x.example', secret: 'whsec_keep', justEnabled: false });
    const user = userEvent.setup();
    render(<IntegrationsTab />);
    await user.type(await screen.findByLabelText(/endpoint url/i), 'https://x.example');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('whsec_keep')).toBeInTheDocument();
  });

  it('keeps an edit made while a save is still in flight', async () => {
    let finish;
    api.getNsoIntegration.mockResolvedValue(cfg({ configured: true, enabled: true, endpointUrl: 'https://a.example' }));
    api.saveNsoIntegration.mockImplementation(() => new Promise((r) => { finish = r; }));
    const user = userEvent.setup();
    render(<IntegrationsTab />);
    const input = await screen.findByLabelText(/endpoint url/i);
    await user.clear(input);
    await user.type(input, 'https://b.example');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.type(input, '/later');  // typed while the save is pending
    finish({ enabled: true, endpointUrl: 'https://b.example', secret: null, justEnabled: false });
    await screen.findByText('Saved.');
    expect(screen.getByLabelText(/endpoint url/i)).toHaveValue('https://b.example/later');
  });

  it('lists each site once, with its state, and test events as one row', async () => {
    const site = { id: 's1', name: 'Indiranagar 100ft', code: 'BT-BLR-01', deleted: false };
    api.getNsoIntegration.mockResolvedValue(cfg({ configured: true, enabled: true, endpointUrl: 'https://x.example' }));
    api.listNsoSites.mockResolvedValue(page([
      siteRow(site, { events: 5, state: 'retrying', latest: latest({ status: 'failed', lastHttpStatus: 503 }) }),
      siteRow(null, { events: 4 }),
    ]));
    render(<IntegrationsTab />);
    expect(await screen.findByText('Indiranagar 100ft')).toBeInTheDocument();
    expect(screen.getByText('Test events')).toBeInTheDocument();
    expect(screen.getByText('Retrying')).toBeInTheDocument();
    expect(screen.getByText(/NSO answered 503 · next try/)).toBeInTheDocument();
    expect(screen.getByText(/· 5 events/)).toBeInTheDocument();
    expect(screen.getAllByText(/First queued .* not received yet/)).toHaveLength(2); // never delivered: not "First sent"
    expect(api.listNsoSites).toHaveBeenCalledWith('', 1);
  });

  it('opens a site to show what changed each time, NSO\'s reply and the exact data sent', async () => {
    const site = { id: 's1', name: 'Punjabi Bagh', code: 'CA-400', deleted: false };
    api.getNsoIntegration.mockResolvedValue(cfg({ configured: true, enabled: true, endpointUrl: 'https://x.example' }));
    api.listNsoSites.mockResolvedValue(page([siteRow(site, { events: 3 })]));
    api.getNsoSiteHistory.mockResolvedValue({
      site, state: 'up_to_date', reason: null, truncated: false,
      events: [
        historyEvent({ id: 'ev3', seq: 3, changes: [{ field: 'licences.fssai_status', from: null, to: 'yes' }],
          tries: [{ attemptNo: 1, httpStatus: 200 }] }),
        historyEvent({ id: 'ev2', seq: 2, status: 'dead', lastHttpStatus: 400,
          changes: [{ field: 'site.status', from: 'legal_review', to: 'legal_approved' }],
          tries: [{ attemptNo: 1, httpStatus: 400, responseSnippet: '{"error":"city is required"}' }] }),
        historyEvent({ id: 'ev1', seq: 1, first: true, tries: [{ attemptNo: 1, httpStatus: 201 }] }),
      ],
    });
    api.getNsoEvent.mockResolvedValue({
      id: 'ev3', seq: 3, eventType: 'site.updated', status: 'sent', site, attempts: [],
      body: { event_id: 'ev3', site: { cafe_code: 'CA-400' } },
    });
    const user = userEvent.setup();
    render(<IntegrationsTab />);
    const row = await screen.findByRole('button', { name: /Punjabi Bagh/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    await user.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(api.getNsoSiteHistory).toHaveBeenCalledWith('s1'));
    expect(await screen.findByText('FSSAI: — → yes')).toBeInTheDocument();
    expect(screen.getByText('Status: legal_review → legal_approved')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'History' })).getByText('First sent')).toBeInTheDocument();
    expect(screen.getByText(/NSO said: \{"error":"city is required"\}/)).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'View data' })[0]);
    await waitFor(() => expect(api.getNsoEvent).toHaveBeenCalledWith('ev3'));
    const dialog = await screen.findByRole('dialog');
    // Keys stay as NSO received them (snake_case), not camelised.
    expect(dialog.textContent).toContain('"cafe_code": "CA-400"');
  });

  it('searches the sites list by name or code', async () => {
    api.getNsoIntegration.mockResolvedValue(cfg({ configured: true, enabled: true, endpointUrl: 'https://x.example' }));
    const user = userEvent.setup();
    render(<IntegrationsTab />);
    await user.type(await screen.findByLabelText(/site name or code/i), 'kora');
    api.listNsoSites.mockResolvedValue(page([siteRow({ id: 's2', name: 'Koramangala', code: null, deleted: false })]));
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(api.listNsoSites).toHaveBeenCalledWith('kora', 1));
    expect(await screen.findByText('Koramangala')).toBeInTheDocument();
  });

  it('sends a site\'s current data again from its history, but not for test events', async () => {
    const site = { id: 's1', name: 'Punjabi Bagh', code: 'CA-400', deleted: false };
    api.getNsoIntegration.mockResolvedValue(cfg({ configured: true, enabled: true, endpointUrl: 'https://x.example' }));
    api.listNsoSites.mockResolvedValue(page([siteRow(site), siteRow(null)]));
    api.getNsoSiteHistory.mockImplementation(async (id) => (id === 's1'
      ? { site, state: 'up_to_date', reason: null, truncated: false, events: [historyEvent({ first: true })] }
      : { site: null, state: 'up_to_date', reason: null, truncated: false, events: [historyEvent({ eventType: 'site.test' })] }));
    api.resendNsoSite.mockResolvedValue({ queued: true, site });
    const user = userEvent.setup();
    render(<IntegrationsTab />);
    await user.click(await screen.findByRole('button', { name: /Test events/ }));
    expect(await screen.findByText('Test event')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send again' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Punjabi Bagh/ }));
    await user.click(await screen.findByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(api.resendNsoSite).toHaveBeenCalledWith('s1'));
    expect(await screen.findByText(/Punjabi Bagh queued again/)).toBeInTheDocument();
  });

  it('says why a site in the list can\'t be sent now', async () => {
    const site = { id: 's4', name: 'Old Site', code: 'CA-4', deleted: false };
    api.getNsoIntegration.mockResolvedValue(cfg({ configured: true, enabled: true, endpointUrl: 'https://x.example' }));
    api.listNsoSites.mockResolvedValue(page([siteRow(site)]));
    api.getNsoSiteHistory.mockResolvedValue({
      site, state: 'up_to_date', truncated: false, events: [historyEvent({ first: true })],
      reason: "This site is archived or rejected, so it isn't shared with NSO.",
    });
    const user = userEvent.setup();
    render(<IntegrationsTab />);
    await user.click(await screen.findByRole('button', { name: /Old Site/ }));
    expect(await screen.findByText(/archived or rejected/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send again' })).not.toBeInTheDocument();
  });

  it('checks a CA code, then sends that site', async () => {
    api.getNsoIntegration.mockResolvedValue(cfg({ configured: true, enabled: true, endpointUrl: 'https://x.example' }));
    const site = { id: 's9', name: 'Rajouri Garden', city: 'Delhi', code: 'CA-401' };
    api.lookupNsoSite.mockResolvedValue({
      site, shareable: true, reason: null,
      lastEvent: { seq: 7, status: 'sent', lastHttpStatus: 200, sentAt: null, createdAt: null },
    });
    api.resendNsoSite.mockResolvedValue({ queued: true, site });
    const user = userEvent.setup();
    render(<IntegrationsTab />);
    await user.type(await screen.findByLabelText('CA code'), 'ca-401');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(api.lookupNsoSite).toHaveBeenCalledWith('ca-401');
    expect(await screen.findByText('Rajouri Garden')).toBeInTheDocument();
    expect(screen.getByText(/Last event #7: Sent \(200\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send to NSO' }));
    await waitFor(() => expect(api.resendNsoSite).toHaveBeenCalledWith('s9'));
    expect(await screen.findByText(/Queued\. It goes out/)).toBeInTheDocument();
  });

  it('explains a CA code that can\'t be sent and offers no Send button', async () => {
    api.getNsoIntegration.mockResolvedValue(cfg({ configured: true, enabled: true, endpointUrl: 'https://x.example' }));
    api.lookupNsoSite.mockResolvedValue({
      site: { id: 's3', name: 'Draft Site', city: 'Pune', code: 'CA-9' }, shareable: false,
      reason: "This site hasn't been sent to Legal yet, so it isn't shared with NSO.", lastEvent: null,
    });
    const user = userEvent.setup();
    render(<IntegrationsTab />);
    await user.type(await screen.findByLabelText('CA code'), 'CA-9');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/hasn't been sent to Legal yet/)).toBeInTheDocument();
    expect(screen.getByText('Never sent to NSO.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to NSO' })).not.toBeInTheDocument();
  });

  it('shows the reason when a CA code is not found', async () => {
    api.getNsoIntegration.mockResolvedValue(cfg({ configured: true, enabled: true, endpointUrl: 'https://x.example' }));
    api.lookupNsoSite.mockRejectedValue({ detail: 'No site in this workspace has CA code CA-0.' });
    const user = userEvent.setup();
    render(<IntegrationsTab />);
    await user.type(await screen.findByLabelText('CA code'), 'CA-0');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No site in this workspace has CA code CA-0.');
  });

  it('offers no Send again while the integration is switched off, but still shows history', async () => {
    const site = { id: 's2', name: 'Koramangala', code: 'CA-2', deleted: false };
    api.getNsoIntegration.mockResolvedValue(cfg({ configured: true, enabled: false, endpointUrl: 'https://x.example' }));
    api.listNsoSites.mockResolvedValue(page([siteRow(site, { state: 'sending', latest: latest({ status: 'pending', lastHttpStatus: null }) })]));
    api.getNsoSiteHistory.mockResolvedValue({ site, state: 'sending', reason: null, truncated: false, events: [historyEvent({ first: true })] });
    const user = userEvent.setup();
    render(<IntegrationsTab />);
    expect(await screen.findByText('Waiting: sending is switched off')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Koramangala/ }));
    expect(await screen.findByRole('button', { name: 'View data' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send again' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('CA code')).not.toBeInTheDocument();
  });

  it('clears a checked CA code result when the code is edited', async () => {
    api.getNsoIntegration.mockResolvedValue(cfg({ configured: true, enabled: true, endpointUrl: 'https://x.example' }));
    api.lookupNsoSite.mockResolvedValue({
      site: { id: 's9', name: 'Rajouri Garden', city: 'Delhi', code: 'CA-401' }, shareable: true, reason: null, lastEvent: null,
    });
    const user = userEvent.setup();
    render(<IntegrationsTab />);
    const input = await screen.findByLabelText('CA code');
    await user.type(input, 'CA-401');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByRole('button', { name: 'Send to NSO' })).toBeInTheDocument();
    await user.type(input, '2');
    expect(screen.queryByRole('button', { name: 'Send to NSO' })).not.toBeInTheDocument();
    expect(screen.queryByText('Rajouri Garden')).not.toBeInTheDocument();
  });
});
