// skipcq: JS-0833
// useDialogFocus — which overlay owns Escape and the Tab trap when more than one
// is open.
//
// The hook took keys in the capture phase at window and called stopPropagation,
// which is POSITIONAL: whoever registered in the earliest phase wins, not
// whoever is on top. An overlay opened INSIDE a consumer of the hook (the image
// preview inside ClosureDetailsDrawer) is the topmost thing on screen yet lost
// every key to the drawer behind it — Escape closed the drawer instead of the
// preview, and Tab was confined to the drawer's panel while the preview was over
// it (#497). These pin the ordering, which is the part that regresses silently.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useDialogFocus } from '../a11y.js';

function Overlay({ label, onEscape, children }) {
  const ref = React.useRef(null);
  useDialogFocus(true, ref, onEscape);
  return (
    <div ref={ref} role="dialog" aria-label={label} tabIndex={-1}>
      <button type="button">{label} one</button>
      <button type="button">{label} two</button>
      {children}
    </div>
  );
}

// The inner overlay is OPENED from the outer one rather than rendered alongside
// it, which is how this happens for real: the drawer is already up when the
// reader clicks a document to preview it. The distinction matters — React runs
// child effects before parent ones, so two overlays mounted in the same commit
// register inner-first. Nothing opens that way (a lightbox with no photo does
// not arm the hook), and modelling it here would test a flow that cannot occur.
function Nested({ outerEscape, innerEscape }) {
  const [inner, setInner] = React.useState(false);
  return (
    <Overlay label="outer" onEscape={outerEscape}>
      <button type="button" onClick={() => setInner(true)}>open inner</button>
      {inner && (
        <Overlay label="inner" onEscape={() => { innerEscape(); setInner(false); }} />
      )}
    </Overlay>
  );
}

const openInner = (user) => user.click(screen.getByRole('button', { name: 'open inner' }));

let bubbleSpy;
beforeEach(() => {
  // Stands in for kit.jsx's Drawer and ImageLightbox's old handler: a plain
  // bubble-phase Escape listener on window, belonging to the surface underneath.
  bubbleSpy = vi.fn();
  window.addEventListener('keydown', bubbleSpy);
});
afterEach(() => window.removeEventListener('keydown', bubbleSpy));

describe('useDialogFocus — the topmost overlay owns Escape', () => {
  it('gives Escape to the inner overlay, not the one it was opened from', async () => {
    // The reported bug: Escape over the image preview closed the whole closure
    // drawer behind it, because the drawer's capture listener was registered
    // first and killed the rest of the propagation path (#497).
    const outer = vi.fn();
    const inner = vi.fn();
    const user = userEvent.setup();
    render(<Nested outerEscape={outer} innerEscape={inner} />);
    await openInner(user);

    await user.keyboard('{Escape}');

    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('hands Escape back to the outer overlay once the inner one closes', async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const user = userEvent.setup();
    render(<Nested outerEscape={outer} innerEscape={inner} />);
    await openInner(user);

    await user.keyboard('{Escape}');   // closes the inner overlay
    await user.keyboard('{Escape}');   // now the outer one owns the key

    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('stops Escape reaching a plain window listener on the surface below', async () => {
    // The admin surface's Drawer keeps a bubble-phase handler. One press must
    // not dismiss both the dialog and the drawer it sits on.
    const user = userEvent.setup();
    render(<Overlay label="outer" onEscape={vi.fn()} />);

    await user.keyboard('{Escape}');

    expect(bubbleSpy).not.toHaveBeenCalled();
  });

  it('leaves Escape alone when no dialog is open', async () => {
    const user = userEvent.setup();
    render(<div />);

    await user.keyboard('{Escape}');

    expect(bubbleSpy).toHaveBeenCalled();
  });
});

describe('useDialogFocus — the topmost overlay owns the Tab trap', () => {
  it('confines Tab to the inner overlay while it is open', async () => {
    // Symptom 2 of #497: the preview portals to body, i.e. outside the drawer's
    // panelRef, so while the drawer owned the trap, tabbing pulled focus back
    // into the drawer behind it — and aria-modal on the preview was a lie.
    const user = userEvent.setup();
    render(<Nested outerEscape={vi.fn()} innerEscape={vi.fn()} />);
    await openInner(user);
    const innerPanel = screen.getByRole('dialog', { name: 'inner' });
    await waitFor(() => expect(innerPanel.contains(document.activeElement)).toBe(true));

    // Past the inner overlay's last focusable, which must wrap rather than fall
    // back into the outer panel behind it.
    await user.tab();
    await user.tab();
    await user.tab();

    expect(innerPanel.contains(document.activeElement)).toBe(true);
  });
});
