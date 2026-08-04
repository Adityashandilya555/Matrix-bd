// skipcq: JS-0833
// The observer portal. Its defining property is what it does NOT have, so most
// of these assert absence — an approval tab, a launch tab, a delete button.
//
// None of this is the security boundary: the backend refuses every non-GET from
// this role at get_current_user. These tests are about not showing a control
// that would 403, and about the role not quietly acquiring one later.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listOrg = vi.fn();
const listSites = vi.fn();
const fetchSiteHistory = vi.fn();

vi.mock('../../../services/api/businessAdminApi.js', () => ({
  getOrg: (...a) => listOrg(...a),
  getAllSites: (...a) => listSites(...a),
  getSiteHistory: (...a) => fetchSiteHistory(...a),
  getAdminSiteDocuments: vi.fn().mockResolvedValue({ documents: [] }),
  getReversibleActions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  undoReversibleAction: vi.fn(),
  deleteSite: vi.fn(),
}));
vi.mock('../../../services/api/adapters/httpAdapter.js', () => ({ reviveSite: vi.fn() }));

import ObserverDashboard from '../ObserverDashboard.jsx';

const SITE = {
  siteId: 's1', siteCode: 'CA-300', siteName: 'Blue Tokai Summit', city: 'Gurugram',
  status: 'legal_review', legalDdStatus: 'in_review',
};

const FETCHERS = {
  listOrg: () => listOrg(),
  listSites: () => listSites(),
  fetchSiteHistory: (...a) => fetchSiteHistory(...a),
};

const renderPortal = async () => {
  const view = render(<ObserverDashboard onLogout={vi.fn()} fetchers={FETCHERS} workspaceName="Acme" />);
  await screen.findByText('Blue Tokai Summit');
  return view;
};

beforeEach(() => {
  listOrg.mockReset().mockResolvedValue([]);
  listSites.mockReset().mockResolvedValue([SITE]);
  fetchSiteHistory.mockReset().mockResolvedValue({ items: [] });
});

describe('ObserverDashboard — what it offers', () => {
  it('opens on Sites, not on an approval queue it does not have', async () => {
    await renderPortal();
    expect(screen.getByText('Blue Tokai Summit')).toBeInTheDocument();
  });

  it('offers exactly three tabs', async () => {
    // Scoped to the sidebar: "Sites" also appears in the page body, and an
    // unscoped query matches both.
    const { container } = await renderPortal();
    const nav = container.querySelector('nav') || container.querySelector('aside');
    const labels = [...(nav || container).querySelectorAll('button')]
      .map((b) => b.textContent.trim())
      .filter(Boolean);
    for (const label of ['Sites', 'Departments', 'Workspace Access']) {
      expect(labels.some((l) => l.includes(label))).toBe(true);
    }
    expect(labels.some((l) => /approval/i.test(l))).toBe(false);
  });

  it('has no Approval Center and no Launch Approvals', async () => {
    // The two tabs the role exists without. If either appears, someone has
    // handed an observer an approval surface.
    await renderPortal();
    expect(screen.queryByText(/approval center/i)).toBeNull();
    expect(screen.queryByText(/launch approvals/i)).toBeNull();
  });

  it('says up front that access is read-only', async () => {
    await renderPortal();
    expect(screen.getByText(/read-only access/i)).toBeInTheDocument();
  });

  it('identifies the role in the header rather than reading as an admin', async () => {
    await renderPortal();
    expect(screen.getByText(/· Observer/)).toBeInTheDocument();
    expect(screen.queryByText(/· Business admin/)).toBeNull();
  });
});

describe('ObserverDashboard — Sites is full but inert', () => {
  it('shows the site with no Delete button', async () => {
    await renderPortal();
    expect(screen.getByText('Blue Tokai Summit')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete site/i })).toBeNull();
  });

  it('still opens the history drawer — the point of the role is seeing the trail', async () => {
    const user = await userEvent.setup();
    const { container } = await renderPortal();
    await user.click(container.querySelector('.ac-pipeline-row'));
    await waitFor(() => expect(fetchSiteHistory).toHaveBeenCalled());
  });
});

describe('ObserverDashboard — Departments is a directory, not a control panel', () => {
  it('drops the approval queues rather than showing them empty', async () => {
    // An empty "Awaiting approval" would imply this role could clear it.
    const user = await userEvent.setup();
    await renderPortal();
    await user.click(screen.getByRole('button', { name: /departments/i }));

    expect(screen.queryByText(/awaiting approval/i)).toBeNull();
    expect(screen.queryByText(/executive access requests/i)).toBeNull();
    expect(screen.queryByText(/observer access/i)).toBeNull();
  });

  it('offers no Rotate and no Remove', async () => {
    const user = await userEvent.setup();
    listOrg.mockResolvedValue([
      { module: 'bd', code: 'ABC', supervisors: [], unassignedExecutives: [], executivesEnabled: true },
    ]);
    await renderPortal();
    await user.click(screen.getByRole('button', { name: /departments/i }));

    expect(screen.queryByRole('button', { name: /rotate/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
  });

  it('shows no department join code, and no placeholder standing in for one', async () => {
    // A join code is a credential: it onboards a supervisor who CAN write, so
    // an observer holding one has a way to cause writes by proxy. The backend
    // blanks it for anyone whose real role is not the business admin — this
    // asserts the portal then shows nothing rather than a permanent, wrong
    // "No code yet" beside every department.
    const user = await userEvent.setup();
    listOrg.mockResolvedValue([
      { module: 'bd', code: null, supervisors: [], unassignedExecutives: [], executivesEnabled: true },
    ]);
    const { container } = await renderPortal();
    await user.click(screen.getByRole('button', { name: /departments/i }));

    expect(container.querySelector('code')).toBeNull();
    expect(screen.queryByText(/no code yet/i)).toBeNull();
  });
});

describe('ObserverDashboard — the shell', () => {
  it('keeps .ac-root and data-theme, which portalled dialogs read for their tokens', async () => {
    // ui/kit.jsx's ModalPortal re-queries .ac-root[data-theme]; without both, a
    // dialog opened from here loses every colour.
    const { container } = await renderPortal();
    const root = container.querySelector('.ac-root');
    expect(root).not.toBeNull();
    expect(root.getAttribute('data-theme')).toBeTruthy();
  });

  it('polls only the two queues it uses', async () => {
    // The admin shell fans out five requests per tick. An observer has no
    // approval queues, so it must not be paying for them.
    await renderPortal();
    expect(listSites).toHaveBeenCalledTimes(1);
    expect(listOrg).toHaveBeenCalledTimes(1);
  });
});
