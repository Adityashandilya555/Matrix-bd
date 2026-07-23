// skipcq: JS-0833
// #5a — the QA push box must let a supervisor/executive VIEW the uploaded
// before/after report PDFs (click-through to the signed URL), not just
// re-upload. The signed URL comes from getPEQAReports, fetched when the dialog
// opens.
import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getPEQualityAuditQueue = vi.fn();
const getPEQAReports = vi.fn();

vi.mock('../../../services/api/projectExcellenceApi.js', () => ({
  getPEQualityAuditQueue: (...a) => getPEQualityAuditQueue(...a),
  getPEQAReports: (...a) => getPEQAReports(...a),
  uploadQAReport: vi.fn(),
  pushQAReport: vi.fn(),
  listQADelegations: async () => ({ items: [] }),
  allocateQA: vi.fn(),
  revokeQAAllocation: vi.fn(),
}));
vi.mock('../../../services/api/adapters/httpAdapter.js', () => ({ listMyTeam: async () => [] }));
vi.mock('../../../state/SessionContext.jsx', () => ({
  useSession: () => ({ role: 'supervisor', session: { userId: 'u1' } }),
}));
vi.mock('../../../App.jsx', () => ({ usePageContext: () => ({ showToast: vi.fn() }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../../hooks/useSiteDataRefresh.js', () => ({ useSiteDataRefresh: () => {} }));

import ProjectExcellenceQualityAuditPage from '../ProjectExcellenceQualityAuditPage.jsx';

const row = (over = {}) => ({
  siteId: 's1', siteCode: 'BT-1', siteName: 'Cafe One', city: 'Pune', inspectionDate: '2026-07-01',
  qaBeforeUploadedAt: '2026-07-20T09:00:00Z', qaBeforePushedAt: null,
  qaAfterUploadedAt: null, qaAfterPushedAt: null,
  qaReportUnread: false, qaReportDelegateName: null, ...over,
});

beforeEach(() => {
  getPEQualityAuditQueue.mockReset().mockResolvedValue({ items: [row()], total: 1 });
  getPEQAReports.mockReset().mockResolvedValue({
    siteId: 's1',
    before: { kind: 'before', fileName: 'before.pdf', uploadedAt: '2026-07-20T09:00:00Z', pushedAt: null, downloadUrl: 'https://signed/before.pdf' },
    after: null,
  });
});

it('shows a View PDF link to the uploaded before-report in the push box', async () => {
  const user = userEvent.setup();
  render(<ProjectExcellenceQualityAuditPage/>);

  // Open the push box for the site.
  const manage = await screen.findByRole('button', { name: /manage/i });
  await user.click(manage);

  // The before slot is "uploaded", so a View PDF link to the signed URL appears.
  const link = await screen.findByRole('link', { name: /view pdf/i });
  expect(link).toHaveAttribute('href', 'https://signed/before.pdf');
  expect(getPEQAReports).toHaveBeenCalledWith('s1');
});

it('offers no View link for a not-yet-uploaded report', async () => {
  getPEQualityAuditQueue.mockResolvedValue({ items: [row({ qaBeforeUploadedAt: null })], total: 1 });
  getPEQAReports.mockResolvedValue({ siteId: 's1', before: null, after: null });
  const user = userEvent.setup();
  render(<ProjectExcellenceQualityAuditPage/>);

  await user.click(await screen.findByRole('button', { name: /manage/i }));
  // Manage controls are present (both slots offer Choose PDF), but no View link.
  expect((await screen.findAllByRole('button', { name: /choose pdf/i })).length).toBeGreaterThan(0);
  expect(screen.queryByRole('link', { name: /view pdf/i })).toBeNull();
});
