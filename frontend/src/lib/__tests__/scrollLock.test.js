// skipcq: JS-0833
// The counted background-scroll lock.
//
// The case that motivated it: two overlays open at once, and the OUTER one
// closes first. With the save/restore idiom the inner overlay had saved
// 'hidden' as its "previous" value, so the outer one restoring what IT saved
// handed scrolling back to the page while the inner overlay was still up.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { lockBodyScroll, __resetBodyScrollLock } from '../scrollLock.js';

beforeEach(() => {
  __resetBodyScrollLock();
  document.body.style.overflow = '';
});
afterEach(() => {
  __resetBodyScrollLock();
  document.body.style.overflow = '';
});

describe('lockBodyScroll', () => {
  it('locks on the first acquire and restores on the last release', () => {
    const release = lockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');

    release();
    expect(document.body.style.overflow).toBe('');
  });

  it('preserves whatever the page had set before', () => {
    document.body.style.overflow = 'scroll';
    const release = lockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');

    release();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('stays locked when the OUTER overlay closes first', () => {
    // This is the reported bug. Release order must not matter.
    const releaseOuter = lockBodyScroll();
    const releaseInner = lockBodyScroll();

    releaseOuter();
    expect(document.body.style.overflow).toBe('hidden');

    releaseInner();
    expect(document.body.style.overflow).toBe('');
  });

  it('stays locked when the inner overlay closes first', () => {
    const releaseOuter = lockBodyScroll();
    const releaseInner = lockBodyScroll();

    releaseInner();
    expect(document.body.style.overflow).toBe('hidden');

    releaseOuter();
    expect(document.body.style.overflow).toBe('');
  });

  it('ignores a repeated release rather than stranding the page', () => {
    // A double-invoke must not drive the count negative — that would leave the
    // next release unable to reach zero, and the page permanently unscrollable.
    const releaseA = lockBodyScroll();
    const releaseB = lockBodyScroll();

    releaseA();
    releaseA();
    expect(document.body.style.overflow).toBe('hidden');

    releaseB();
    expect(document.body.style.overflow).toBe('');
  });

  it('captures the real value once, not each overlay’s view of it', () => {
    document.body.style.overflow = 'auto';
    const releaseOuter = lockBodyScroll();
    const releaseInner = lockBodyScroll();

    releaseInner();
    releaseOuter();
    // Not 'hidden', which is what the inner overlay would have saved.
    expect(document.body.style.overflow).toBe('auto');
  });
});
