// skipcq: JS-0833
// Two things are locked here.
//
// 1. THE RE-UPLOAD BUG. A rejected deliverable still has a file attached, so the
//    backend mints a fresh Supabase signed URL for it on EVERY response. That URL
//    was in the DeliverableCard reset effect's dep array, and closing the native
//    file dialog fires window 'focus' → a silent refetch → a new URL → the effect
//    → the file the user just picked was wiped and the submit button re-disabled.
//    A *pending* item has no prior file, so its URL stayed null and stable —
//    which is why only the rejected/re-upload path broke.
//
// 2. TWO-STAGE GFC. Approving 3D no longer auto-sends the site to the admin;
//    a supervisor must press "Send for GFC approval".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getDesignReview = vi.fn();
const requestGfcApproval = vi.fn();
let currentRole = 'executive';

vi.mock('../../../services/api/designApi.js', () => ({
  getDesignReview: (...a) => getDesignReview(...a),
  requestGfcApproval: (...a) => requestGfcApproval(...a),
  allocateDesign: vi.fn(),
  revokeDesignAllocation: vi.fn(),
  listDesignDelegationsForSite: async () => ({ items: [] }),
  submitDeliverable: vi.fn(),
  uploadDeliverable: vi.fn(),
  reviewDeliverable: vi.fn(),
}));
vi.mock('../../../services/api/adapters/httpAdapter.js', () => ({ listMyTeam: async () => [] }));
vi.mock('../../../state/SessionContext.jsx', () => ({
  useSession: () => ({ role: currentRole, session: {}, user: { id: 'u1' } }),
}));
vi.mock('../../../App.jsx', () => ({ usePageContext: () => ({ showToast: vi.fn() }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ siteId: 's1' }),
  useNavigate: () => vi.fn(),
}));
// Capture the refresh callback so a test can fire the exact background refetch
// that window 'focus' triggers in production when the file dialog closes.
let fireBackgroundRefresh = null;
vi.mock('../../../hooks/useSiteDataRefresh.js', () => ({
  useSiteDataRefresh: (fn) => { fireBackgroundRefresh = fn; },
}));

import DesignReviewPage from '../DesignReviewPage.jsx';

const deliverable = (over = {}) => ({
  kind: '3d', status: 'pending', fileName: null, downloadUrl: null,
  fileUrl: null, estimatedAmount: null, supervisorComments: null,
  adminStatus: 'pending', adminComments: null, ...over,
});

const review = (over = {}) => ({
  siteId: 's1', siteCode: 'BT-1', siteName: 'Cafe One', city: 'Pune',
  designStatus: 'in_progress', currentStage: '3d', gfcStatus: 'pending',
  gfcComments: null, deliverables: [deliverable()], ...over,
});

beforeEach(() => {
  currentRole = 'executive';
  getDesignReview.mockReset();
  requestGfcApproval.mockReset();
});

// ── 1. Re-upload ────────────────────────────────────────────────────────────

describe('re-upload after a rejection', () => {
  const rejected = (downloadUrl) => review({
    deliverables: [deliverable({
      status: 'rejected', fileName: 'plan-v1.pdf', downloadUrl,
      fileUrl: 'design/s1/3d.pdf', supervisorComments: 'Fix the elevation.',
    })],
  });

  it('keeps the selected file when a refetch only re-signs the download URL', async () => {
    const user = userEvent.setup();
    getDesignReview.mockResolvedValue(rejected('https://storage/signed?token=AAA'));
    render(<DesignReviewPage/>);

    await screen.findByRole('button', { name: /choose file/i });
    const file = new File(['x'], 'plan-v2.pdf', { type: 'application/pdf' });
    await user.upload(document.querySelector('input[type="file"]'), file);
    expect(await screen.findByText('plan-v2.pdf')).toBeInTheDocument();

    // Same deliverable, same status/fileName — ONLY a freshly signed URL, which
    // is what every background refresh produces. This is the exact sequence the
    // closing file dialog causes via window 'focus'.
    getDesignReview.mockResolvedValue(rejected('https://storage/signed?token=ZZZ'));
    await act(async () => { await fireBackgroundRefresh(); });

    // The staged file must survive: this is the bug.
    expect(screen.getByText('plan-v2.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /re-upload/i })).toBeEnabled();
  });

  it('still clears the selection when the deliverable genuinely changes', async () => {
    const user = userEvent.setup();
    getDesignReview.mockResolvedValue(rejected('https://storage/signed?token=AAA'));
    render(<DesignReviewPage/>);

    await screen.findByRole('button', { name: /choose file/i });
    await user.upload(
      document.querySelector('input[type="file"]'),
      new File(['x'], 'plan-v2.pdf', { type: 'application/pdf' }),
    );
    expect(await screen.findByText('plan-v2.pdf')).toBeInTheDocument();

    // A real state change (the upload landed) must still reset the input —
    // proves the fix narrowed the effect rather than disabling it.
    getDesignReview.mockResolvedValue(review({
      deliverables: [deliverable({
        status: 'submitted', fileName: 'plan-v2.pdf',
        downloadUrl: 'https://storage/signed?token=BBB', fileUrl: 'design/s1/3d.pdf',
      })],
    }));
    await act(async () => { await fireBackgroundRefresh(); });

    expect(screen.queryByText('No file selected yet.')).toBeNull(); // input hidden entirely
    expect(screen.queryByRole('button', { name: /re-upload/i })).toBeNull();
  });

  it('labels the action Re-upload for a rejected deliverable', async () => {
    getDesignReview.mockResolvedValue(rejected(null));
    render(<DesignReviewPage/>);
    expect(await screen.findByRole('button', { name: /re-upload/i })).toBeInTheDocument();
  });
});

// ── 2. Two-stage GFC ────────────────────────────────────────────────────────

describe('two-stage GFC', () => {
  const readyToSend = review({ currentStage: 'gfc', designStatus: 'in_progress' });

  it('offers the supervisor the send action once 3D is approved', async () => {
    currentRole = 'supervisor';
    getDesignReview.mockResolvedValue(readyToSend);
    render(<DesignReviewPage/>);

    expect(await screen.findByRole('button', { name: /send for gfc approval/i })).toBeInTheDocument();
    expect(screen.getByText('Ready to send')).toBeInTheDocument();
  });

  it('calls the API with the site id when the supervisor sends', async () => {
    currentRole = 'supervisor';
    const user = userEvent.setup();
    getDesignReview.mockResolvedValue(readyToSend);
    requestGfcApproval.mockResolvedValue(
      review({ currentStage: 'gfc', designStatus: 'gfc_pending' }),
    );
    render(<DesignReviewPage/>);

    await user.click(await screen.findByRole('button', { name: /send for gfc approval/i }));
    expect(requestGfcApproval).toHaveBeenCalledWith('s1');
  });

  it('does not offer the send action to an executive', async () => {
    getDesignReview.mockResolvedValue(readyToSend);
    render(<DesignReviewPage/>);

    await screen.findByText(/waiting for the design supervisor/i);
    expect(screen.queryByRole('button', { name: /send for gfc approval/i })).toBeNull();
  });

  it('hides the send action once the site is already with the admin', async () => {
    currentRole = 'supervisor';
    getDesignReview.mockResolvedValue(
      review({ currentStage: 'gfc', designStatus: 'gfc_pending' }),
    );
    render(<DesignReviewPage/>);

    expect(await screen.findByText('Awaiting admin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send for gfc approval/i })).toBeNull();
  });

  it('tells an executive their 3D upload goes to their supervisor', async () => {
    getDesignReview.mockResolvedValue(review({ currentStage: '3d' }));
    render(<DesignReviewPage/>);
    expect(
      await screen.findByRole('button', { name: /send to supervisor for approval/i }),
    ).toBeInTheDocument();
  });
});
