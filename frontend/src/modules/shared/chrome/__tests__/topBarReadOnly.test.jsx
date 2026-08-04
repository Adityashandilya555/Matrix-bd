// "New pipeline" is the one write control in the app chrome, so unlike a
// per-page button it follows the user onto every screen. An observer must not
// carry it around.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const session = vi.fn();
vi.mock('../../../../state/SessionContext.jsx', () => ({ useSession: () => session() }));
vi.mock('../../../../services/api/authService.js', () => ({ requestExecutiveAccess: vi.fn() }));

import TopBar from '../TopBar.jsx';

const USER = { name: 'Asha', email: 'asha@example.com' };

const ctx = (over = {}) => ({
  signOut: vi.fn(),
  switchAs: vi.fn(),
  session: { realRole: 'supervisor', module: 'bd' },
  effectiveModule: 'bd',
  isReadOnly: false,
  ...over,
});

const mount = (over) => {
  session.mockReturnValue(ctx(over));
  return render(<TopBar user={USER} role="supervisor" dark={false}
    onToggleDark={vi.fn()} onNewPipeline={vi.fn()} onToggleSidebar={vi.fn()} />);
};

beforeEach(() => { session.mockReset(); });

describe('TopBar — the New pipeline CTA', () => {
  it('is there for a BD supervisor', () => {
    mount();
    expect(screen.getByRole('button', { name: /new pipeline/i })).toBeInTheDocument();
  });

  it('is gone for a read-only session, even on BD', () => {
    mount({ isReadOnly: true, session: { realRole: 'observer', module: null } });
    expect(screen.queryByRole('button', { name: /new pipeline/i })).toBeNull();
  });

  it('is gone for a read-only session with no module at all', () => {
    // The no-module case is the one that would otherwise slip through:
    // `!effectiveModule` is the fallback that shows the CTA to anyone whose
    // module claim is empty — and an observer's is.
    mount({ isReadOnly: true, effectiveModule: null, session: { realRole: 'observer', module: null } });
    expect(screen.queryByRole('button', { name: /new pipeline/i })).toBeNull();
  });

  it('is still hidden from a non-BD module, as before', () => {
    mount({ effectiveModule: 'legal' });
    expect(screen.queryByRole('button', { name: /new pipeline/i })).toBeNull();
  });
});
