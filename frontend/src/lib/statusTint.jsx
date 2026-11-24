// skipcq: JS-0833
// One meaning per colour for rows and cards that are highlighted by status.
// Before this, each page picked its own: amber meant "supervisor edited" on
// Shortlist but "overdue" in Staging, overdue was red on Drafts and amber in
// Staging, and none of them said what the colour meant.
//
//   problem   red    something is late or failed (overdue, answered "No")
//   attention amber  someone needs to look at it (not started, edited by a supervisor)
//   done      green  finished for this step (pushed on, stage complete)
//
// Every tinted row or card shows the same two things: a soft fill and a
// 3px stripe on its left edge in the status colour, plus a text label on the
// row itself so the colour is never the only signal.
import React from 'react';

export const TINT = {
  problem: { color: 'var(--zm-danger)', label: 'Overdue' },
  attention: { color: 'var(--zm-warning)', label: 'Needs attention' },
  done: { color: 'var(--zm-success)', label: 'Done' },
};

// The fill for a row that sits on a white list (transparent when no status).
export function tintFill(kind) {
  return kind ? `color-mix(in srgb, ${TINT[kind].color} 7%, transparent)` : 'transparent';
}

// Fill and border for a standalone card (opaque, so it reads on the canvas).
export function tintCard(kind) {
  if (!kind) return { background: 'var(--zm-surface)', borderColor: 'var(--zm-line)' };
  const c = TINT[kind].color;
  return {
    background: `color-mix(in srgb, ${c} 6%, var(--zm-surface))`,
    borderColor: `color-mix(in srgb, ${c} 45%, transparent)`,
  };
}

// The left-edge stripe. The row or card needs position: relative.
export function TintStripe({ kind, inset = 12 }) {
  if (!kind) return null;
  return (
    <span aria-hidden="true" style={{
      position: 'absolute', left: 0, top: inset, bottom: inset, width: 3, borderRadius: 3,
      background: TINT[kind].color,
    }} />
  );
}
