// Proof that the read-only guard is actually ATTACHED to both axios instances.
//
// readOnlyGuard.test.js proves the decision; this proves it is reached. There
// are two clients (axiosClient.js and adapters/httpAdapter.js), each with its
// own request interceptor, and a guard wired into only one of them would look
// entirely correct in unit tests while half the app kept writing.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const tokenRole = vi.fn();
vi.mock('../authToken.js', () => ({
  SESSION_EXPIRED_EVENT: 'scale:session-expired',
  getAuthToken: () => 'a.token.here',
  getAuthTokenRole: (...a) => tokenRole(...a),
  isAuthTokenExpiringSoon: () => false,
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
  notifySessionExpired: vi.fn(),
  subscribeAuthToken: () => () => {},
  getAuthTokenExpiryMs: () => Date.now() + 3600_000,
}));
vi.mock('../siteEvents.js', () => ({ notifySiteDataChanged: vi.fn() }));
vi.mock('../adminOverride.js', () => ({
  getActiveOverride: () => ({ role: 'supervisor', module: 'design' }),
  activateOverride: vi.fn(),
  deactivateOverride: vi.fn(),
  getStoredOverride: () => null,
}));

const { createApiClient } = await import('../axiosClient.js');
const { markSiteViewed } = await import('../adapters/httpAdapter.js');

// Never reached on a blocked request — its presence is what proves the block
// happened before the network rather than after it.
const noNetwork = () => { throw new Error('the request reached the network'); };

beforeEach(() => { tokenRole.mockReset().mockReturnValue('observer'); });

describe('the guard is wired into axiosClient', () => {
  it('refuses an observer POST before it leaves the browser', async () => {
    const client = createApiClient();
    client.defaults.adapter = noNetwork;
    await expect(client.post('/sites', {})).rejects.toMatchObject({
      status: 403,
      code: 'READ_ONLY',
    });
  });

  it('keeps the 403 rather than re-wrapping it as a network error', async () => {
    // The response interceptor sees request-interceptor rejections too — axios
    // runs both in one promise chain — and re-wrapping would rewrite the status
    // to 0, which this codebase renders as "Network Error contacting API…".
    const client = createApiClient();
    client.defaults.adapter = noNetwork;
    await expect(client.post('/sites', {})).rejects.toHaveProperty('status', 403);
  });

  it('lets a writable role through to the adapter', async () => {
    tokenRole.mockReturnValue('supervisor');
    const seen = [];
    const client = createApiClient();
    client.defaults.adapter = (cfg) => {
      seen.push(cfg.method);
      return Promise.resolve({ data: {}, status: 200, config: cfg, headers: {} });
    };
    await client.post('/sites', {});
    expect(seen).toEqual(['post']);
  });

  it('lets an observer read', async () => {
    const client = createApiClient();
    client.defaults.adapter = (cfg) =>
      Promise.resolve({ data: { items: [] }, status: 200, config: cfg, headers: {} });
    await expect(client.get('/sites')).resolves.toBeTruthy();
  });
});

describe('the guard is wired into httpAdapter too', () => {
  it('refuses the view-marker POST that plain reading fires', async () => {
    // POST /sites/{id}/viewed — a write the UI triggers by opening a drawer.
    // The call sites skip it for a read-only session; this is what catches the
    // one that forgets.
    await expect(markSiteViewed('s1')).rejects.toMatchObject({ status: 403 });
  });
});

describe('a third client cannot appear unguarded', () => {
  it('finds exactly the two axios instances the tests above cover', async () => {
    // The real risk here is not a hole today, it is that nothing would tell you
    // if one opened tomorrow. Every module API (design, legal, project, …)
    // shares createApiClient(); a new `axios.create` anywhere else would ship a
    // whole surface with no guard on it and no test would notice.
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const found = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry !== '__tests__' && entry !== 'node_modules') walk(full);
        } else if (/\.jsx?$/.test(entry) && !/\.test\.jsx?$/.test(entry)) {
          if (readFileSync(full, 'utf8').includes('axios.create(')) found.push(full);
        }
      }
    };
    walk(join(process.cwd(), 'src'));

    expect(found.map((f) => f.split('/src/')[1]).sort()).toEqual([
      'services/api/adapters/httpAdapter.js',
      'services/api/axiosClient.js',
    ]);
  });
});
