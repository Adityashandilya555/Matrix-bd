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
// COMMENT STYLE: line comments only, no JSDoc blocks — see launchRentAdapter.js.

let depth = 0;
let saved = null;

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
