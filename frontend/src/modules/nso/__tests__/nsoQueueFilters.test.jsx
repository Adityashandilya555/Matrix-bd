// skipcq: JS-0833
// The NSO sites table's search + filter bar.
//
// Search and the three dropdowns narrow together (AND), and they narrow WITH the
// KPI tile filter rather than replacing it — a tile stays meaningful while a
// search is running. Filtering is client-side over the loaded rows, the same
// scope the KPI tile counts have always used.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const { getNsoQueue } = vi.hoisted(() => ({ getNsoQueue: vi.fn() }));
vi.mock('../../../services/api/nsoApi.js', () => ({ getNsoQueue }));

import NsoQueuePage from '../NsoQueuePage.jsx';

const row = (over = {}) => ({
  siteId: 's1', siteCode: 'CA-1', siteName: 'Powai', city: 'Mumbai',
  projectStatus: 'done', currentStage: 'stage_one', nsoStatus: 'in_progress',
  nextAction: 'Property readiness', ...over,
});

const rows = [
  row(),
  row({ siteId: 's2', siteCode: 'CA-2', siteName: 'Koramangala', city: 'Bengaluru', currentStage: 'stage_two' }),
  row({ siteId: 's3', siteCode: 'CA-3', siteName: 'Bandra', city: 'Mumbai', projectStatus: 'in_progress', currentStage: 'done', nsoStatus: 'complete' }),
];

const renderPage = () => render(<MemoryRouter><NsoQueuePage /></MemoryRouter>);

const siteNames = () => rows
  .map((r) => r.siteName)
  .filter((name) => screen.queryByText(name) !== null);

beforeEach(() => {
  getNsoQueue.mockReset();
  getNsoQueue.mockResolvedValue({ items: rows, total: rows.length });
});

describe('NSO sites table — search and filters', () => {
  it('searches across site name, code, and city', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Powai');

    await user.type(screen.getByLabelText('Search by site name, code, or city'), 'bandra');
    await waitFor(() => expect(siteNames()).toEqual(['Bandra']));

    await user.clear(screen.getByLabelText('Search by site name, code, or city'));
    await user.type(screen.getByLabelText('Search by site name, code, or city'), 'CA-2');
    await waitFor(() => expect(siteNames()).toEqual(['Koramangala']));
  });

  it('filters by city', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Powai');

    await user.selectOptions(screen.getByLabelText('Filter by city'), 'Bengaluru');
    await waitFor(() => expect(siteNames()).toEqual(['Koramangala']));
  });

  it('filters by project status and by NSO stage', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Powai');

    await user.selectOptions(screen.getByLabelText('Filter by project status'), 'in_progress');
    await waitFor(() => expect(siteNames()).toEqual(['Bandra']));

    await user.selectOptions(screen.getByLabelText('Filter by project status'), 'all');
    // 'done' / nsoStatus complete both normalise to the one 'complete' bucket.
    await user.selectOptions(screen.getByLabelText('Filter by NSO stage'), 'complete');
    await waitFor(() => expect(siteNames()).toEqual(['Bandra']));
  });

  it('says so when nothing matches, rather than showing an empty table', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Powai');

    await user.type(screen.getByLabelText('Search by site name, code, or city'), 'nowhere');
    expect(await screen.findByText('No NSO sites match this filter.')).toBeTruthy();
  });

  it('clears every filter at once', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Powai');

    await user.type(screen.getByLabelText('Search by site name, code, or city'), 'bandra');
    await user.selectOptions(screen.getByLabelText('Filter by city'), 'Mumbai');
    await waitFor(() => expect(siteNames()).toEqual(['Bandra']));

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() => expect(siteNames()).toEqual(['Powai', 'Koramangala', 'Bandra']));
  });
});
