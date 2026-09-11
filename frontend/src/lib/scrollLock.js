// skipcq: JS-0833
// A counted lock on background scrolling, shared by every overlay that needs it.
//
// The obvious idiom — save body.style.overflow, set 'hidden', restore the saved
// value on unmount — is wrong as soon as two overlays are open at once. The
// second one saves 'hidden' as its "previous" value, and whichever closes FIRST
// restores what it saved: if that is the outer one, the page starts scrolling
// again behind an overlay that is still open.
//
// Counting fixes it. The real value is captured once, when the first lock is
// taken, and restored once, when the last is released. Order of release stops
// mattering.
//
// FILE SHAPE: the first statement must be an import or an export. DeepSource's
// JavaScript analyzer parses a file that opens with anything else as a SCRIPT
// and fails at the first export — a parse error, which skipcq cannot suppress.
// The module state therefore sits at the bottom; function declarations are
// hoisted, so nothing depends on the ordering at runtime. Same shape as
// lib/displayCode.js and lib/mime.js.
//
// COMMENT STYLE: line comments only, no JSDoc blocks — see launchRentAdapter.js.

// Take a lock and get back a release function. The releaser is idempotent, so a
// double-invoke (StrictMode's double effect, a defensive caller) cannot drive the
// count negative and strand the page unscrollable.
export function lockBodyScroll() {
  if (typeof document === 'undefined') return () => {};

  if (depth === 0) {
    saved = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  depth += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    depth -= 1;
    if (depth === 0) {
      document.body.style.overflow = saved;
      saved = null;
    }
  };
}

// Test seam: the module holds process-wide state, so a suite that unmounts
// mid-lock would otherwise leak it into the next test.
export function __resetBodyScrollLock() {
  depth = 0;
  saved = null;
}

// How many overlays currently hold the lock, and the page's own overflow value
// captured when the first of them took it. See FILE SHAPE above for why these
// are declared here rather than at the top.
let depth = 0;
let saved = null;
