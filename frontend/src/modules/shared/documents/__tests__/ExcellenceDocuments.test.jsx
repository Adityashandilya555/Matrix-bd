// skipcq: JS-0833
// The staged-upload + max-1 + delete UX: selecting a file only STAGES it (no
// network) so a mis-pick can be discarded with the corner ×; an explicit Upload
// commits it; while editable an uploaded doc gets a × that deletes it; the
// picker disappears once one file exists (max-1); read-only mode shows links
// only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

beforeEach(() => {
  listExcellenceDocuments.mockReset().mockResolvedValue({ documents: [] });
  uploadExcellenceDocument.mockReset();
  deleteExcellenceDocument.mockReset();
  if (!global.URL.createObjectURL) global.URL.createObjectURL = vi.fn(() => 'blob:x');
  if (!global.URL.revokeObjectURL) global.URL.revokeObjectURL = vi.fn();
});

it('stages a selected file without uploading, and requires an explicit Upload', async () => {
  const user = userEvent.setup();
  render(<ExcellenceDocuments siteId="s1" kind="excellence" canEdit />);

  await screen.findByRole('button', { name: /choose file/i });
  await user.upload(document.querySelector('input[type="file"]'), png());

  // Staged: card + "not uploaded" label, but NO network call yet.
  expect(await screen.findByText('floor.png')).toBeInTheDocument();
  expect(screen.getByText(/not uploaded/i)).toBeInTheDocument();
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
  // Picker returns.
  expect(screen.getByRole('button', { name: /choose file/i })).toBeInTheDocument();
});

it('hides the picker once one file exists (max-1) and deletes via the corner ×', async () => {
  const user = userEvent.setup();
  listExcellenceDocuments.mockResolvedValue({
    documents: [{ id: 'd1', file_name: 'plan.pdf', file_size_kb: 100, mime_type: 'application/pdf', url: 'u' }],
  });
  deleteExcellenceDocument.mockResolvedValue({ ok: true });
  render(<ExcellenceDocuments siteId="s1" kind="excellence" canEdit />);

  expect(await screen.findByText('plan.pdf')).toBeInTheDocument();
  // Max-1: no "choose file" while a doc exists.
  expect(screen.queryByRole('button', { name: /choose file/i })).toBeNull();

  await user.click(screen.getByRole('button', { name: /delete attachment/i }));
  expect(deleteExcellenceDocument).toHaveBeenCalledWith('s1', 'd1');
});

it('read-only mode shows the link but no picker or delete control', async () => {
  listExcellenceDocuments.mockResolvedValue({
    documents: [{ id: 'd1', file_name: 'plan.pdf', file_size_kb: 100, mime_type: 'application/pdf', url: 'u' }],
  });
  render(<ExcellenceDocuments siteId="s1" kind="excellence" canEdit={false} />);

  expect(await screen.findByText('plan.pdf')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /choose file|upload|delete attachment/i })).toBeNull();
});
