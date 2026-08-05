// skipcq: JS-0833
// Where the read-only strip sits in the chrome.
//
// It shipped as a sibling of the sidebar row, spanning the full window. That cut
// a horizontal band across the whole app and pushed the sidebar's top edge below
// the TopBar, so the nav panel read as a slab floating under a stripe instead of
// one continuous column.
//
// It belongs to the CONTENT column: same parent as <main>, with the sidebar
// outside that parent. And it must stay a SIBLING of <main> rather than its
// first child, or it scrolls away with the page — which is the property it was
// given in the first place.
//
// The chrome children are stubbed because this is a test about App's own DOM
// shape, not about what TopBar or Sidebar render.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let session;

vi.mock('../state/SessionContext.jsx', () => ({ useSession: () => session }));
vi.mock('../state/SitesContext.jsx', () => ({
  useSites: () => ({ drafts: [], shortlist: [], staging: [], archive: [], createDraft: vi.fn(), error: null, refresh: vi.fn() }),
}));
vi.mock('../services/api/adapters/httpAdapter.js', () => ({ listPendingUsers: () => Promise.resolve([]) }));
vi.mock('../modules/shared/chrome/TopBar.jsx', () => ({ default: () => <div data-testid="topbar" /> }));
vi.mock('../modules/shared/chrome/Sidebar.jsx', () => ({ default: () => <div data-testid="sidebar" /> }));
vi.mock('../modules/shared/site-drawer/SiteDrawer.jsx', () => ({ default: () => <div /> }));

const App = (await import('../App.jsx')).default;

const baseSession = {
  user: { name: 'Asha', city: 'Mumbai' },
  role: 'supervisor',
  setRole: vi.fn(),
  dark: false,
  toggleDark: vi.fn(),
  authReady: true,
  isBusinessAdmin: false,
  isReadOnly: true,
  effectiveModule: 'design',
  adminOverride: { role: 'supervisor', module: 'design' },
  switchAs: vi.fn(),
};

beforeEach(() => { session = { ...baseSession }; });

const mount = () => render(<MemoryRouter><App /></MemoryRouter>);

describe('the read-only strip in the app chrome', () => {
  it('shares a parent with <main>', () => {
    mount();
    const banner = screen.getByTestId('read-only-banner');
    const main = document.querySelector('main.zm-app-main');
    expect(banner.parentElement).toBe(main.parentElement);
  });

  it('does not share that parent with the sidebar', () => {
    // The regression: full-width, it sat beside the row holding the sidebar and
    // pushed the whole nav column down.
    mount();
    const banner = screen.getByTestId('read-only-banner');
    const sidebar = screen.getByTestId('sidebar');
    expect(banner.parentElement.contains(sidebar)).toBe(false);
  });

  it('sits outside <main>, so the page cannot scroll it away', () => {
    // The property the strip was given in the first place. Moving it INTO main
    // would fix the overlap and silently break this.
    mount();
    const banner = screen.getByTestId('read-only-banner');
    const main = document.querySelector('main.zm-app-main');
    expect(main.contains(banner)).toBe(false);
  });

  it('comes before <main> in the column, not after it', () => {
    mount();
    const banner = screen.getByTestId('read-only-banner');
    const main = document.querySelector('main.zm-app-main');
    expect(banner.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it('leaves the sidebar reaching the TopBar for everyone else', () => {
    // For any non-observer the strip renders nothing at all, so the column it
    // lives in must not introduce a gap or a stray box.
    session = { ...baseSession, isReadOnly: false };
    mount();
    expect(screen.queryByTestId('read-only-banner')).toBeNull();
    expect(document.querySelector('main.zm-app-main')).toBeTruthy();
  });
});
