// skipcq: JS-0833
// A join code, masked until revealed.
//
// Every code on this tab is a credential: a department code onboards a
// supervisor who can write, and the observer code mints workspace-wide readers.
// The realistic leak is not an attacker — it is the admin screen-sharing the
// Departments tab, or someone reading over their shoulder. Masking by default
// costs one click and removes that.
//
// One component for all of them. The observer code shipped masked and the six
// department codes shipped in plain text, which is the wrong way round if
// anything: the department code is the more dangerous of the two.
import React from 'react';
import { T, TABULAR } from '../ui/kit.jsx';

const box = {
  fontFamily: T.mono, fontSize: 14, fontWeight: 700, letterSpacing: '0.06em',
  padding: '8px 12px', borderRadius: T.radiusSm, background: T.surfaceInset,
  border: `1px solid ${T.line}`, ...TABULAR,
};

export default function CodeChip({ code, loading, emptyLabel = 'No code yet' }) {
  const [revealed, setRevealed] = React.useState(false);

  if (loading) return <code style={{ ...box, color: T.textFaint }}>…</code>;
  if (!code) return <code style={{ ...box, color: T.textFaint }}>{emptyLabel}</code>;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
      {/* The dots are the same count as the code, so the chip does not resize
          on reveal and shift the Rotate button out from under the cursor. */}
      <code style={{ ...box, color: T.text }}>
        {revealed ? code : '•'.repeat(code.length)}
      </code>
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        aria-pressed={revealed}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
          fontSize: 11.5, fontWeight: 650, color: T.accent, fontFamily: 'inherit' }}
      >
        {revealed ? 'Hide' : 'Reveal'}
      </button>
    </span>
  );
}
