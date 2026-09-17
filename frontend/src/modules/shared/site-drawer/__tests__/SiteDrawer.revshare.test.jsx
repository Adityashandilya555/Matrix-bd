// skipcq: JS-0833
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('../../../../services/api/siteService.js', () => ({
  getSiteDocuments: vi.fn().mockResolvedValue({ documents: [] }),
}));
vi.mock('../../../../services/api/audit.js', () => ({
  getSiteActivity: vi.fn().mockResolvedValue({ items: [] }),
  colorForAction: () => 'var(--zm-fg)',
  labelForEntry: () => 'did a thing',
}));
vi.mock('../../../../state/SessionContext.jsx', () => ({
  useSession: () => ({ role: 'supervisor', session: {}, user: { id: 'u1' } }),
}));
vi.mock('../../../../state/SitesContext.jsx', () => ({
  useSites: () => ({ sites: [], refresh: vi.fn() }),
}));

import SiteDrawer from '../SiteDrawer.jsx';

const base = { id: 's1', code: 'BT-1', name: 'Cafe One', city: 'Pune', status: 'approved', photos: [] };

const revshareText = (site) => {
  render(<SiteDrawer site={{ ...base, ...site }} onClose={vi.fn()}/>);
  return screen.getByText('Revenue share').nextSibling.textContent;
};

describe('revenue share field', () => {
  it('shows the flat percentage when present', () => {
    expect(revshareText({ rentType: 'revshare', revshare: 8 })).toBe('8% of sales');
  });

  it('shows Yes for a fixed rent with a Dine-in / Delivery split', () => {
    expect(revshareText({ rentType: 'fixed', revshareDinein: 7, revshareDelivery: 3 })).toBe('Yes');
  });

  it('shows Yes for a staggered rent with a per-year split', () => {
    expect(revshareText({
      rentType: 'staggered',
      staggeredEscalation: [{ year: 1, percent: 5, dine_in_pct: 6, delivery_pct: 4 }],
    })).toBe('Yes');
  });

  it('stays NA when no revenue share applies', () => {
    expect(revshareText({ rentType: 'fixed' })).toBe('NA');
  });
});

describe('drawer tabs', () => {
  it('no longer offers a Payments tab', () => {
    render(<SiteDrawer site={base} onClose={vi.fn()}/>);
    const overview = screen.getByRole('button', { name: 'Overview' });
    const tabs = within(overview.parentElement).getAllByRole('button').map((b) => b.textContent);
    expect(tabs).toEqual(['Overview', 'Activity', 'Documents']);
  });
});
