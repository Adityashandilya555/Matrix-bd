import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosPostMock = vi.fn();

vi.mock('axios', () => ({
  default: { post: axiosPostMock },
}));

vi.mock('../authToken.js', () => ({
  clearAuthToken: vi.fn(),
  setAuthToken: vi.fn(),
}));

describe('supabaseAuth account-state routing', () => {
  beforeEach(() => {
    axiosPostMock.mockReset();
    vi.resetModules();
  });

  it('sends the first-party marker when checking account state', async () => {
    axiosPostMock.mockResolvedValueOnce({ data: { account_state: 'active', password_set: true } });
    const { checkAccountState } = await import('../supabaseAuth.js');

    await expect(checkAccountState('a@b.co', 'ACME-CODE1')).resolves.toBe('active');

    expect(axiosPostMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/login/check'),
      { email: 'a@b.co', workspace_code: 'ACME-CODE1' },
      { headers: { 'X-Matrix-Internal': '1' } },
    );
  });

  it('treats opaque checked responses as password entry, not password setup', async () => {
    axiosPostMock.mockResolvedValueOnce({ data: { account_state: 'checked' } });
    const { checkAccountState } = await import('../supabaseAuth.js');

    await expect(checkAccountState('a@b.co', 'ACME-CODE1')).resolves.toBe('active');
  });
});
