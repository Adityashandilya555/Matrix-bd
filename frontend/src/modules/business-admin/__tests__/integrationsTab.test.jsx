// skipcq: JS-0833
// Business admin → Integrations → NSO platform. Pins the two things that matter
// to the admin: the signing secret is shown once (and gone after "saved it"),
// and the server-side key being absent produces an explanation, not a form.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  getNsoIntegration: vi.fn(),
  saveNsoIntegration: vi.fn(),
  rotateNsoSecret: vi.fn(),
  sendNsoTest: vi.fn(),
  backfillNso: vi.fn(),
  listNsoDead: vi.fn(),
  replayNsoEvent: vi.fn(),
  searchNsoEvents: vi.fn(),
  getNsoEvent: vi.fn(),
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

  it('names the site, shows NSO\'s reply and opens the exact data sent', async () => {
    const site = { id: 's1', name: 'Indiranagar 100ft', code: 'BT-BLR-01', deleted: false };
    api.getNsoIntegration.mockResolvedValue(cfg({
      configured: true, enabled: true, endpointUrl: 'https://x.example',
      recentDeliveries: [
        { outboxId: 'ev9', attemptNo: 1, seq: 9, eventType: 'site.updated', httpStatus: 400, durationMs: 840,
          responseSnippet: '{"error":"city is required"}', site, attemptedAt: null },
        { outboxId: 'ev10', attemptNo: 1, seq: 10, eventType: 'site.test', httpStatus: 200, durationMs: 300,
          responseSnippet: 'ok', site: null, attemptedAt: null },
      ],
    }));
    api.getNsoEvent.mockResolvedValue({
      id: 'ev9', seq: 9, eventType: 'site.updated', status: 'dead', site,
      attempts: [{ attemptNo: 1, httpStatus: 400, responseSnippet: '{"error":"city is required"}', attemptedAt: null }],
      body: { event_id: 'ev9', site: { cafe_code: 'CC1', name: 'Indiranagar 100ft' } },
    });
    const user = userEvent.setup();
    render(<IntegrationsTab />);

    expect(await screen.findByText('Indiranagar 100ft')).toBeInTheDocument();
    expect(screen.getByText('Test event')).toBeInTheDocument();
    expect(screen.getByText(/NSO said: \{"error":"city is required"\}/)).toBeInTheDocument();
    expect(screen.queryByText(/NSO said: ok/)).not.toBeInTheDocument(); // replies shown for failures only

    await user.click(screen.getAllByRole('button', { name: 'View data' })[0]);
    await waitFor(() => expect(api.getNsoEvent).toHaveBeenCalledWith('ev9'));
    const dialog = await screen.findByRole('dialog');
    // Keys stay as NSO received them (snake_case), not camelised.
    expect(dialog.textContent).toContain('"cafe_code": "CC1"');
    expect(dialog.textContent).toContain('"event_id": "ev9"');
  });

  it('finds what was sent for a site', async () => {
    api.getNsoIntegration.mockResolvedValue(cfg({ configured: true, enabled: true, endpointUrl: 'https://x.example' }));
    api.searchNsoEvents.mockResolvedValue([
      { id: 'ev3', seq: 3, eventType: 'site.updated', status: 'sent', lastHttpStatus: 200, createdAt: null,
        site: { id: 's2', name: 'Koramangala', code: null, deleted: false } },
    ]);
    const user = userEvent.setup();
    render(<IntegrationsTab />);
    await user.type(await screen.findByLabelText(/site name or code/i), 'kora');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(api.searchNsoEvents).toHaveBeenCalledWith('kora');
    expect(await screen.findByText('Koramangala')).toBeInTheDocument();
    expect(screen.getByText('Sent · 200')).toBeInTheDocument();
  });
});
