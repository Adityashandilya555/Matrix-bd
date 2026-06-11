// Batch I — ShortlistPage modal/double-click fixes (#96 #97 #98).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { LOITimelineModal } from '../ShortlistPage.jsx';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../ShortlistPage.jsx'), 'utf8');

describe('LOITimelineModal double-submit guard (#96)', () => {
  it('fires onSubmit once and disables the button on rapid double-click', () => {
    let resolveSubmit;
    const onSubmit = vi.fn(() => new Promise((r) => { resolveSubmit = r; }));
    render(
      <LOITimelineModal site={{ id: 's1', code: 'BT-X', name: 'Site' }} onCancel={() => {}} onSubmit={onSubmit} />,
    );
    const btn = screen.getByText(/Approve & set timeline/).closest('button');
    fireEvent.click(btn);
    fireEvent.click(btn); // second click before the first promise resolves
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(btn).toBeDisabled();
    resolveSubmit?.();
  });
});

describe('ShortlistPage source contracts (#97 #98)', () => {
  it('#97 details modal closes only AFTER a successful submit', () => {
    // The buggy shape closed the modal first (setDetailing(null) before await).
    expect(src).not.toMatch(/onDetailsSubmit = async \(item, formData\) => \{\s*setDetailing\(null\)/);
    // The submit handler now drives the shared saving/error state like save-draft.
    const block = src.slice(src.indexOf('const onDetailsSubmit'), src.indexOf('const onDetailsSaveDraft'));
    expect(block).toContain('setDetailSaving(true)');
    expect(block).toContain('setDetailError');
  });

  it('#98 DelegationModal load has an unmount/cancel guard', () => {
    expect(src).toContain('isCancelled');
    expect(src).toMatch(/let cancelled = false;[\s\S]*return \(\) => \{ cancelled = true; \};/);
  });
});
