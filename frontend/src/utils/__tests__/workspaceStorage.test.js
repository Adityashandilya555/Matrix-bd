// skipcq: JS-0833
// Workspace-code persistence. Pure logic over localStorage: most-recent-first,
// deduped, capped at 3, and never allowed to throw — a corrupt or unavailable
// store must degrade to "no history", not break the login dialog.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getStoredWorkspaceCodes,
  getLastWorkspaceCode,
  addWorkspaceCode,
} from '../workspaceStorage.js';

const KEY = 'zm_workspace_codes';

// jsdom runs on an opaque origin here, so it exposes `localStorage` as a global
// KEY whose VALUE is undefined — reading it doesn't ReferenceError, it
// TypeErrors on property access. (workspaceStorage.js survives that by design:
// every access is inside a try/catch, which is why the dialog still works in
// private-mode browsers. These tests need a real store to assert against.)
class MemoryStorage {
  #map = new Map();
  getItem(k) { return this.#map.has(k) ? this.#map.get(k) : null; }
  setItem(k, v) { this.#map.set(k, String(v)); }
  removeItem(k) { this.#map.delete(k); }
  clear() { this.#map.clear(); }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('addWorkspaceCode', () => {
  it('stores a code uppercased and trimmed', () => {
    addWorkspaceCode('  btokai-7x9f  ');
    expect(getStoredWorkspaceCodes()).toEqual(['BTOKAI-7X9F']);
  });

  it('keeps most-recent first', () => {
    addWorkspaceCode('AAAA');
    addWorkspaceCode('BBBB');
    expect(getStoredWorkspaceCodes()).toEqual(['BBBB', 'AAAA']);
  });

  it('promotes an existing code instead of duplicating it', () => {
    addWorkspaceCode('AAAA');
    addWorkspaceCode('BBBB');
    addWorkspaceCode('AAAA');
    expect(getStoredWorkspaceCodes()).toEqual(['AAAA', 'BBBB']);
  });

  it('dedupes case-insensitively', () => {
    addWorkspaceCode('AAAA');
    addWorkspaceCode('aaaa');
    expect(getStoredWorkspaceCodes()).toEqual(['AAAA']);
  });

  it('caps the list at 3, dropping the oldest', () => {
    ['AAAA', 'BBBB', 'CCCC', 'DDDD'].forEach(addWorkspaceCode);
    expect(getStoredWorkspaceCodes()).toEqual(['DDDD', 'CCCC', 'BBBB']);
  });

  it('ignores empty and whitespace-only input', () => {
    addWorkspaceCode('');
    addWorkspaceCode('   ');
    addWorkspaceCode(null);
    expect(getStoredWorkspaceCodes()).toEqual([]);
  });

  it('does not throw when storage rejects the write', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => addWorkspaceCode('AAAA')).not.toThrow();
  });
});

describe('getStoredWorkspaceCodes', () => {
  it('returns an empty list when nothing is stored', () => {
    expect(getStoredWorkspaceCodes()).toEqual([]);
  });

  it('survives corrupt JSON', () => {
    localStorage.setItem(KEY, '{not json');
    expect(getStoredWorkspaceCodes()).toEqual([]);
  });

  it('survives a non-array payload', () => {
    localStorage.setItem(KEY, '{"a":1}');
    expect(getStoredWorkspaceCodes()).toEqual([]);
  });

  it('truncates an over-long stored list', () => {
    localStorage.setItem(KEY, JSON.stringify(['A', 'B', 'C', 'D', 'E']));
    expect(getStoredWorkspaceCodes()).toEqual(['A', 'B', 'C']);
  });
});

describe('getLastWorkspaceCode', () => {
  it('returns null when there is no history', () => {
    expect(getLastWorkspaceCode()).toBeNull();
  });

  it('returns the most recently added code', () => {
    addWorkspaceCode('AAAA');
    addWorkspaceCode('BBBB');
    expect(getLastWorkspaceCode()).toBe('BBBB');
  });
});
