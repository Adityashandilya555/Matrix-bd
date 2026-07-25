// skipcq: JS-0833
// The staged-upload UX: selecting a file only STAGES it (no network) so a
// mis-pick can be discarded with the corner ×; it's persisted by an explicit
// Upload OR by the parent Save/Submit via the commitStaged() imperative handle
// (so a staged file is never lost). Choosing a new file while one exists
// REPLACES it (old row deleted, new uploaded). Read-only mode shows links only.
import React from 'react';
import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listExcellenceDocuments = vi.fn();
const uploadExcellenceDocument = vi.fn();
const deleteExcellenceDocument = vi.fn();

vi.mock('../../../../services/api/projectExcellenceApi.js', () => ({
  listExcellenceDocuments: (...a) => listExcellenceDocuments(...a),
  uploadExcellenceDocument: (...a) => uploadExcellenceDocument(...a),
  deleteExcellenceDocument: (...a) => deleteExcellenceDocument(...a),
}));
vi.mock('../../../../App.jsx', () => ({ usePageContext: () => ({ showToast: vi.fn() }) }));

import ExcellenceDocuments from '../ExcellenceDocuments.jsx';

const png = () => new File(['x'], 'floor.png', { type: 'image/png' });
const existingDoc = { id: 'd1', file_name: 'plan.pdf', file_size_kb: 100, mime_type: 'application/pdf', url: 'u' };

beforeEach(() => {
  listExcellenceDocuments.mockReset().mockResolvedValue({ documents: [] });
  uploadExcellenceDocument.mockReset();
  deleteExcellenceDocument.mockReset();
  if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
  if (!globalThis.URL.revokeObjectURL) globalThis.URL.revokeObjectURL = vi.fn();
});

it('stages a selected file without uploading, and requires an explicit Upload', async () => {
  const user = userEvent.setup();
  render(<ExcellenceDocuments siteId="s1" kind="excellence" canEdit />);

  await screen.findByRole('button', { name: /choose file/i });
  await user.upload(document.querySelector('input[type="file"]'), png());

  // Staged: card + "uploads on save" hint, but NO network call yet.
  expect(await screen.findByText('floor.png')).toBeInTheDocument();
  expect(screen.getByText(/uploads on save/i)).toBeInTheDocument();
  expect(uploadExcellenceDocument).not.toHaveBeenCalled();

  // Explicit Upload commits it, passing the kind through.
  uploadExcellenceDocument.mockResolvedValue({ id: 'd1', file_name: 'floor.png', file_size_kb: 4, mime_type: 'image/png', url: 'u' });
  await user.click(screen.getByRole('button', { name: /^upload$/i }));
  expect(uploadExcellenceDocument).toHaveBeenCalledWith('s1', expect.any(File), 'excellence');
});

it('discards a staged file via the corner × without uploading', async () => {
  const user = userEvent.setup();
  render(<ExcellenceDocuments siteId="s1" kind="excellence" canEdit />);

  await screen.findByRole('button', { name: /choose file/i });
  await user.upload(document.querySelector('input[type="file"]'), png());
  expect(await screen.findByText('floor.png')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /remove selected file/i }));
  expect(screen.queryByText('floor.png')).toBeNull();
  expect(uploadExcellenceDocument).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /choose file/i })).toBeInTheDocument();
});

it('commitStaged() persists a staged file — the parent Save/Submit hook', async () => {
  const user = userEvent.setup();
  uploadExcellenceDocument.mockResolvedValue({ id: 'd1', file_name: 'floor.png', file_size_kb: 4, mime_type: 'image/png', url: 'u' });
  const ref = React.createRef();
  render(<ExcellenceDocuments ref={ref} siteId="s1" kind="excellence" canEdit />);

  await screen.findByRole('button', { name: /choose file/i });
  await user.upload(document.querySelector('input[type="file"]'), png());
  expect(ref.current.hasStaged()).toBe(true);

  await act(async () => { await ref.current.commitStaged(); });
  expect(uploadExcellenceDocument).toHaveBeenCalledWith('s1', expect.any(File), 'excellence');
});

it('offers Replace when a file exists — replacing deletes the old then uploads the new', async () => {
  const user = userEvent.setup();
  listExcellenceDocuments.mockResolvedValue({ documents: [existingDoc] });
  deleteExcellenceDocument.mockResolvedValue({ ok: true });
  uploadExcellenceDocument.mockResolvedValue({ id: 'd2', file_name: 'floor.png', file_size_kb: 4, mime_type: 'image/png', url: 'u2' });
  render(<ExcellenceDocuments siteId="s1" kind="excellence" canEdit />);

  expect(await screen.findByText('plan.pdf')).toBeInTheDocument();
  // A doc exists → the picker offers Replace (not hidden as before).
  expect(screen.getByRole('button', { name: /replace file/i })).toBeInTheDocument();

  await user.upload(document.querySelector('input[type="file"]'), png());
  expect(await screen.findByText(/will replace on save/i)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /upload replacement/i }));
  // Old row deleted first (must not linger), then the new file uploaded.
  expect(deleteExcellenceDocument).toHaveBeenCalledWith('s1', 'd1');
  expect(uploadExcellenceDocument).toHaveBeenCalledWith('s1', expect.any(File), 'excellence');
});

it('deletes an uploaded file via the corner ×', async () => {
  const user = userEvent.setup();
  listExcellenceDocuments.mockResolvedValue({ documents: [existingDoc] });
  deleteExcellenceDocument.mockResolvedValue({ ok: true });
  render(<ExcellenceDocuments siteId="s1" kind="excellence" canEdit />);

  expect(await screen.findByText('plan.pdf')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /delete attachment/i }));
  expect(deleteExcellenceDocument).toHaveBeenCalledWith('s1', 'd1');
});

it('read-only mode shows the link but no picker or delete control', async () => {
  listExcellenceDocuments.mockResolvedValue({ documents: [existingDoc] });
  render(<ExcellenceDocuments siteId="s1" kind="excellence" canEdit={false} />);

  expect(await screen.findByText('plan.pdf')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /choose file|replace file|upload|delete attachment/i })).toBeNull();
});
