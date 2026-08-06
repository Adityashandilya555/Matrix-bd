// skipcq: JS-0833
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
    mount();
    const banner = screen.getByTestId('read-only-banner');
    const main = document.querySelector('main.zm-app-main');
    expect(main.contains(banner)).toBe(false);
  });

  it('comes immediately before <main> in the column, not after it', () => {
    mount();
    const banner = screen.getByTestId('read-only-banner');
    const main = document.querySelector('main.zm-app-main');
    expect(banner.nextElementSibling).toBe(main);
  });

  it('leaves the sidebar reaching the TopBar for everyone else', () => {
    session = { ...baseSession, isReadOnly: false };
    mount();
    expect(screen.queryByTestId('read-only-banner')).toBeNull();
    expect(document.querySelector('main.zm-app-main')).toBeTruthy();
  });
});
