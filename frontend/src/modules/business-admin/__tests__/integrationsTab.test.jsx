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

    expect(api.saveNsoIntegration).toHaveBeenCalledWith(expect.objectContaining({
      endpointUrl: 'https://nso.example.com/hook', enabled: true,
    }));
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
});
