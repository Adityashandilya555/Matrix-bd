import React from 'react';

// ViewMoreButton — presentational "View more" pager control for queue / history
// surfaces backed by usePagedList. Renders nothing when there is nothing more to
// load; otherwise a real <button> (keyboard-accessible by default) labelled with
// the loaded-of-total progress. Disabled while a page is in flight.
//
// Styling mirrors the secondary buttons across the module pages (zm-surface fill
// + zm-line border + body font), e.g. the "All metrics" back button on the
// overview pages.
export default function ViewMoreButton({ hasMore, loadingMore, loaded, total, onClick }) {
  if (!hasMore) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 2px' }}>
      <button
        type="button"
        onClick={onClick}
        disabled={loadingMore}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          height: 36, padding: '0 18px', borderRadius: 999,
          border: '1px solid var(--zm-line)',
          background: 'var(--zm-surface)',
          color: 'var(--zm-fg-2)',
          fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 700,
          cursor: loadingMore ? 'default' : 'pointer',
          opacity: loadingMore ? 0.65 : 1,
        }}
      >
        {loadingMore ? 'Loading…' : `View more (showing ${loaded} of ${total})`}
      </button>
    </div>
  );
}
