// Batch K — #114: route guards must wait for authReady, not judge the
// pre-hydration default session.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockSession = { value: {} };
vi.mock('../../state/SessionContext.jsx', () => ({
  useSession: () => mockSession.value,
}));

import { RequireModule, RequireRole } from '../guards.jsx';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => { mockSession.value = {}; });

describe('RequireModule (#114)', () => {
  it('shows a loader (no redirect) until authReady', () => {
    mockSession.value = { authReady: false, role: 'supervisor', session: {} };
    wrap(<RequireModule modules={['legal']}><div>module-page</div></RequireModule>);
    expect(screen.queryByText('module-page')).toBeNull();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders children once authReady and the module matches', () => {
    mockSession.value = { authReady: true, role: 'supervisor', effectiveModule: 'legal', isBusinessAdmin: false, session: { module: 'legal' } };
    wrap(<RequireModule modules={['legal']}><div>module-page</div></RequireModule>);
    expect(screen.getByText('module-page')).toBeInTheDocument();
  });
});

describe('RequireRole (#114)', () => {
  it('shows a loader until authReady instead of redirecting an exec away', () => {
    // Pre-hydration role is the default 'supervisor'; an exec route must not
    // redirect to overview before the real role is known.
    mockSession.value = { authReady: false, role: 'supervisor' };
    wrap(<RequireRole roles={['exec']}><div>exec-only</div></RequireRole>);
    expect(screen.queryByText('exec-only')).toBeNull();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders children when authReady and role allowed (exec/executive alias)', () => {
    mockSession.value = { authReady: true, role: 'executive' };
    wrap(<RequireRole roles={['exec']}><div>exec-only</div></RequireRole>);
    expect(screen.getByText('exec-only')).toBeInTheDocument();
  });
});
