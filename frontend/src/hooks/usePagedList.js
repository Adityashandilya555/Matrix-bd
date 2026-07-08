import { useCallback, useEffect, useRef, useState } from 'react';

// usePagedList — shared "View more" batch pager for queue / history surfaces.
//
//   const { items, total, status, error, hasMore, loadingMore, loadMore, reload } =
//     usePagedList(({ limit, offset }) => getXQueue({ limit, offset, ...params }),
//                   { pageSize: 50, deps: [params] });
//
// `fetchPage` is called as `fetchPage({ limit, offset })` and must resolve to
// `{ items, total }` where `total` is the server's COUNT(*) of the filtered set
// (NOT the page size). On mount and whenever `deps` change the list reloads from
// offset 0 (items replaced, total refreshed). `loadMore` fetches the next page
// at `offset = items.length`, APPENDS the rows, and keeps the latest total.
//
// `hasMore` is `items.length < total`. Concurrent loadMore calls are guarded by
// the `loadingMore` flag, and an `alive` ref prevents setState after unmount —
// matching the unmount-guard pattern used elsewhere in this codebase
// (e.g. useLaunchSites.js / ModuleHistoryPage.jsx).
export function usePagedList(fetchPage, { pageSize = 50, deps = [] } = {}) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // alive guards every async setState; a monotonic request id makes sure a slow
  // first-page response from a previous deps value can never clobber a newer one.
  const aliveRef = useRef(true);
  const reqIdRef = useRef(0);
  // items.length without re-creating loadMore on every append.
  const lengthRef = useRef(0);
  lengthRef.current = items.length;
  const loadingMoreRef = useRef(false);

  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;

  const reload = useCallback((silent = false) => {
    const reqId = ++reqIdRef.current;
    if (!silent) {
      setStatus('loading');
      setError(null);
    }
    Promise.resolve(fetchPageRef.current({ limit: pageSize, offset: 0 }))
      .then((data) => {
        if (!aliveRef.current || reqId !== reqIdRef.current) return;
        setItems(data?.items || []);
        setTotal(data?.total ?? 0);
        setStatus('ready');
      })
      .catch((err) => {
        if (!aliveRef.current || reqId !== reqIdRef.current) return;
        if (silent && err?.code === 'TIMEOUT') return;
        if (silent && items.length > 0) {
          setError(err?.detail || err?.message || 'Failed to load');
          return;
        }
        setError(err?.detail || err?.message || 'Failed to load');
        setStatus('error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize, items.length]);

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current) return; // guard double-fire
    if (lengthRef.current >= total) return; // nothing more to fetch
    const reqId = reqIdRef.current; // tie to the current reload generation
    loadingMoreRef.current = true;
    setLoadingMore(true);
    Promise.resolve(fetchPageRef.current({ limit: pageSize, offset: lengthRef.current }))
      .then((data) => {
        if (!aliveRef.current || reqId !== reqIdRef.current) return;
        setItems((prev) => [...prev, ...(data?.items || [])]);
        // Keep the latest total — the filtered count can move between pages.
        setTotal(data?.total ?? 0);
      })
      .catch((err) => {
        if (!aliveRef.current || reqId !== reqIdRef.current) return;
        setError(err?.detail || err?.message || 'Failed to load more');
      })
      .finally(() => {
        loadingMoreRef.current = false;
        if (aliveRef.current && reqId === reqIdRef.current) setLoadingMore(false);
      });
  }, [pageSize, total]);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  // Reload on mount and whenever the caller's deps change.
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const hasMore = items.length < total;

  return { items, total, status, error, hasMore, loadingMore, loadMore, reload };
}

export default usePagedList;
