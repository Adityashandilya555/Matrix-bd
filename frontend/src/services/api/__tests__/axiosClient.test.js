// PR #255 — regression tests for the axiosClient response interceptor.
//
// Two guarantees we never want to silently lose:
//   1. A status-0 "Network Error" (CORS-masked backend 500 / backend down)
//      is wrapped in an ApiError whose `detail` explains it is a network /
//      CORS problem contacting the API — not a generic "Request failed".
//   2. A 401 on a request that carried a token triggers EXACTLY ONE
//      refresh + retry. The retried request is tagged `_retriedAfterRefresh`
//      so a second 401 can't loop forever.
//
// We mock axios so that `axios.create()` hands back a fake client whose
// response-interceptor error handler we capture and drive directly, and so
// the module-level `axios.post` used by the token refresh is observable.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the (onFulfilled, onRejected) registered on the response interceptor
// and expose a spy-able `request` (used by the retry path).
let capturedResponseErrorHandler = null;
const clientRequestMock = vi.fn();
const axiosPostMock = vi.fn();

vi.mock('axios', () => {
  const create = () => ({
    request: clientRequestMock,
    interceptors: {
      request: { use: vi.fn() },
      response: {
        use: (_onFulfilled, onRejected) => {
          capturedResponseErrorHandler = onRejected;
        },
      },
    },
  });
  return {
    default: { create, post: axiosPostMock },
    create,
    post: axiosPostMock,
  };
});

// Control the token the client believes it holds.
let currentToken = 'tok-abc';
vi.mock('../authToken.js', () => ({
  getAuthToken: () => currentToken,
  setAuthToken: vi.fn((t) => { currentToken = t; }),
  notifySessionExpired: vi.fn(),
  SESSION_EXPIRED_EVENT: 'scale:session-expired',
}));

async function buildClientAndHandler() {
  const { createApiClient } = await import('../axiosClient.js');
  createApiClient(); // registers the interceptors → fills capturedResponseErrorHandler
  return capturedResponseErrorHandler;
}

beforeEach(() => {
  capturedResponseErrorHandler = null;
  clientRequestMock.mockReset();
  axiosPostMock.mockReset();
  currentToken = 'tok-abc';
  vi.resetModules();
});

describe('axiosClient — network error mapping', () => {
  it('maps a status-0 "Network Error" to an ApiError explaining the network/CORS failure', async () => {
    const onError = await buildClientAndHandler();
    const networkErr = {
      // No `response` ⇒ status resolves to 0; axios sets message "Network Error".
      message: 'Network Error',
      config: { url: '/sites', headers: {} },
    };

    await expect(onError(networkErr)).rejects.toMatchObject({ name: 'ApiError', status: 0 });
    await onError(networkErr).catch((e) => {
      expect(e.detail).toContain('Network Error contacting API');
    });
  });
});

describe('axiosClient — 401 refresh + retry loop-safety', () => {
  it('refreshes once and retries the original request exactly once', async () => {
    const onError = await buildClientAndHandler();

    // refresh endpoint hands back a brand-new token.
    axiosPostMock.mockResolvedValueOnce({ data: { access_token: 'tok-new' } });
    // the retried request resolves successfully.
    clientRequestMock.mockResolvedValueOnce({ data: { ok: true } });

    const err401 = {
      response: { status: 401, data: {} },
      // requestCarriedToken() looks for an Authorization header.
      config: { url: '/sites', headers: { Authorization: 'Bearer tok-abc' } },
    };

    const result = await onError(err401);

    // Exactly one refresh POST and one retry.
    expect(axiosPostMock).toHaveBeenCalledTimes(1);
    expect(clientRequestMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: { ok: true } });

    // The retry is tagged so a subsequent 401 cannot re-enter the refresh path.
    const retryConfig = clientRequestMock.mock.calls[0][0];
    expect(retryConfig._retriedAfterRefresh).toBe(true);
    expect(retryConfig.headers.Authorization).toBe('Bearer tok-new');
  });

  it('does not refresh again if the retried (already-flagged) request 401s — no loop', async () => {
    const onError = await buildClientAndHandler();

    const alreadyRetried401 = {
      response: { status: 401, data: {} },
      config: {
        url: '/sites',
        headers: { Authorization: 'Bearer tok-new' },
        _retriedAfterRefresh: true,
      },
    };

    await expect(onError(alreadyRetried401)).rejects.toMatchObject({ name: 'ApiError', status: 401 });
    // The loop guard means we never hit the refresh endpoint or re-request.
    expect(axiosPostMock).not.toHaveBeenCalled();
    expect(clientRequestMock).not.toHaveBeenCalled();
  });
});
