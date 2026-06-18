import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePagedList } from '../usePagedList.js';

// Build a fetchPage mock backed by a fixed-size dataset. Each call slices the
// dataset by { limit, offset } and returns the constant server total — exactly
// the shape the backend queue/history endpoints return.
function makeFetchPage(totalCount, { failOnOffset } = {}) {
  const dataset = Array.from({ length: totalCount }, (_, i) => ({ id: `site-${i}` }));
  return vi.fn(({ limit, offset }) => {
    if (failOnOffset != null && offset === failOnOffset) {
      return Promise.reject(new Error('boom'));
    }
    return Promise.resolve({
      items: dataset.slice(offset, offset + limit),
      total: totalCount,
    });
  });
}

describe('usePagedList', () => {
  it('loads the first page (pageSize items + server total) on mount', async () => {
    const fetchPage = makeFetchPage(130);
    const { result } = renderHook(() => usePagedList(fetchPage, { pageSize: 50 }));

    // First render is the loading state, before the promise resolves.
    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.items).toHaveLength(50);
    expect(result.current.total).toBe(130);
    expect(result.current.hasMore).toBe(true);
    // First fetch is offset 0, limit = pageSize.
    expect(fetchPage).toHaveBeenCalledWith({ limit: 50, offset: 0 });
  });

  it('appends the next batch on loadMore and keeps the latest total', async () => {
    const fetchPage = makeFetchPage(130);
    const { result } = renderHook(() => usePagedList(fetchPage, { pageSize: 50 }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items).toHaveLength(50);

    await act(async () => { result.current.loadMore(); });
    await waitFor(() => expect(result.current.items).toHaveLength(100));

    // Page 2 fetched at offset = current length (50).
    expect(fetchPage).toHaveBeenCalledWith({ limit: 50, offset: 50 });
    expect(result.current.total).toBe(130);
    expect(result.current.hasMore).toBe(true);
  });

  it('flips hasMore false once items.length reaches total', async () => {
    const fetchPage = makeFetchPage(120);
    const { result } = renderHook(() => usePagedList(fetchPage, { pageSize: 50 }));

    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => { result.current.loadMore(); }); // → 100
    await waitFor(() => expect(result.current.items).toHaveLength(100));
    expect(result.current.hasMore).toBe(true);

    await act(async () => { result.current.loadMore(); }); // → 120 (last 20)
    await waitFor(() => expect(result.current.items).toHaveLength(120));

    expect(result.current.hasMore).toBe(false);
    expect(result.current.total).toBe(120);
  });

  it('does not fetch beyond total when loadMore is called with nothing more to load', async () => {
    const fetchPage = makeFetchPage(40); // single page covers everything
    const { result } = renderHook(() => usePagedList(fetchPage, { pageSize: 50 }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items).toHaveLength(40);
    expect(result.current.hasMore).toBe(false);

    await act(async () => { result.current.loadMore(); });
    // Only the initial page request was made — no second fetch.
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('surfaces a load error as status "error"', async () => {
    const fetchPage = makeFetchPage(10, { failOnOffset: 0 });
    const { result } = renderHook(() => usePagedList(fetchPage, { pageSize: 50 }));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('boom');
  });
});
