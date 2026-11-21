// skipcq: JS-0833
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { toViewModel, activityCells } from '../toViewModel.js';
import LiveDashboard from '../LiveDashboard.jsx';
import { POLL_MS } from '../../../../hooks/useDashboard.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const tiles = (pairs) => pairs.map(([key, label, value]) => ({ key, label, value }));

const ADMIN = {
  role: 'admin', module: null, scope: 'tenant', simulated: false,
  kpis: { tiles: tiles([['total', 'Total sites', 20], ['awaiting', 'Awaiting approval', 1], ['launched', 'Completed sites', 4], ['open', 'In progress', 15]]) },
  inbox: { queues: [{ key: 'finance', label: 'Finance approvals', count: 2, oldest_days: 3 }, { key: 'budgets', label: 'Budget approvals', count: 0, oldest_days: null }], total: 2 },
  funnel: { steps: [{ key: 'drafted', label: 'Drafted', count: 20 }, { key: 'approved', label: 'Approved', count: 9 }], source: ['sites.*_at'] },
  cycle_times: { steps: [{ from: 'drafted', to: 'approved', label: 'Drafted → Approved', median_days: 12.5 }] },
  money: { rent_live: 450000, rent_pipeline: 2500000, finance_approved: 0, finance_pending: 0, budgets: [] },
  people: { roles: [{ role: 'executive', active: 7, inactive: 1 }], seat_limit: 25 },
  activity: { days: [{ date: '2026-11-20', count: 4 }] },
};

const BD_EXEC_EMPTY = {
  role: 'executive', module: 'bd', scope: 'personal', simulated: false,
  kpis: { tiles: tiles([['details', 'Need details', 0], ['loi_due', 'LOI due', 0]]) },
  inbox: { total: 0, items: [] },
  funnel: { steps: [{ key: 'drafted', label: 'Drafted', count: 0 }] },
  cities: { items: [] },
};

describe('toViewModel', () => {
  it('maps admin queues to inbox rows and skips empty queues', () => {
    const vm = toViewModel(ADMIN);
    expect(vm.inbox.items.map((i) => i.name)).toEqual(['Finance approvals']);
    expect(vm.kpis.some((k) => k.hot)).toBe(false);
    expect(vm.funnel.steps[0]).toMatchObject({ label: 'Drafted', value: 20, days: 12.5 });
    expect(vm.people.seats).toEqual([7, 25]);
    expect(vm.scopes).toBeUndefined();
  });

  it('never adds a section the server left out', () => {
    const vm = toViewModel(BD_EXEC_EMPTY);
    expect(vm.money).toBeUndefined();
    expect(vm.people).toBeUndefined();
    expect(vm.workload).toBeUndefined();
    expect(vm.launches).toBeUndefined();
  });

  it('shows an empty state instead of zeros for an executive with no sites', () => {
    const vm = toViewModel(BD_EXEC_EMPTY);
    expect(vm.empty.title).toBe('No sites yet');
    expect(vm.funnel).toBeUndefined();
  });

  it('offers the team toggle to real supervisors only', () => {
    const sup = { ...ADMIN, role: 'supervisor', module: 'legal', scope: 'module', money: undefined, people: undefined };
    expect(toViewModel(sup).scopes.map((s) => s.key)).toEqual(['module', 'team']);
    expect(toViewModel({ ...sup, simulated: true }).scopes).toBeUndefined();
  });

  it('turns an NSO executive notice into the empty card', () => {
    const vm = toViewModel({ role: 'executive', module: 'nso', kpis: { tiles: [] }, notice: { title: 'NSO is run by supervisors', body: 'Ask your supervisor.' } });
    expect(vm.empty.title).toBe('NSO is run by supervisors');
    expect(vm.kpis).toEqual([]);
  });

  it('labels each inbox row with the action it waits for', () => {
    const vm = toViewModel({ role: 'supervisor', module: 'design', kpis: { tiles: [] },
      inbox: { total: 1, items: [{ site_id: 's1', code: 'BT-1', name: 'A', city: 'Pune', reason: 'Deliverables to review', waiting_days: 2 }] } });
    expect(vm.inbox.items[0]).toMatchObject({ id: 's1', code: 'BT-1', kind: 'Deliverables to review', age: '2 days' });
  });

  it('lays activity out as 7 days × 12 weeks with levels 0-3', () => {
    const today = new Date(Date.UTC(2026, 10, 20));
    const cells = activityCells([{ date: '2026-11-20', count: 9 }], today);
    expect(cells).toHaveLength(84);
    expect(cells.filter((c) => c > 0)).toEqual([3]);
    expect(Math.max(...cells)).toBe(3);
  });
});

describe('LiveDashboard', () => {
  it('reloads the summary only when the version changes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getDashboardSummary = vi.fn().mockResolvedValue(ADMIN);
    let version = '"v1"';
    const getDashboardVersion = vi.fn(async (etag) => ({ changed: etag !== version, etag: version }));
    render(<LiveDashboard deps={{ getDashboardSummary, getDashboardVersion }} />);
    await screen.findByText(/^Good (morning|afternoon|evening)/);
    expect(getDashboardSummary).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(getDashboardSummary).toHaveBeenCalledTimes(1);

    version = '"v2"';
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    await waitFor(() => expect(getDashboardSummary).toHaveBeenCalledTimes(2));
  });

  it('greets the viewer by first name and shows tile history when present', async () => {
    const withSeries = { ...ADMIN, kpis: { tiles: [{ key: 'total', label: 'Total sites', value: 20, series: [1, 2, 3, 4, 5], delta: 4 }] } };
    const getDashboardSummary = vi.fn().mockResolvedValue(withSeries);
    const getDashboardVersion = vi.fn().mockResolvedValue({ changed: false, etag: '"v1"' });
    render(<LiveDashboard viewer="Priya Shah" deps={{ getDashboardSummary, getDashboardVersion }} />);
    expect(await screen.findByText(/, Priya$/)).toBeTruthy();
    expect(screen.getByText('▲ 4 in 4 wk')).toBeTruthy();
  });

  it('shows a retry card when the first load fails', async () => {
    const getDashboardSummary = vi.fn().mockRejectedValue(new Error('Network down'));
    const getDashboardVersion = vi.fn().mockResolvedValue({ changed: false, etag: '"v1"' });
    render(<LiveDashboard deps={{ getDashboardSummary, getDashboardVersion }} />);
    expect(await screen.findByText('The dashboard didn’t load')).toBeTruthy();
    expect(screen.getByText('Network down')).toBeTruthy();
  });
});
