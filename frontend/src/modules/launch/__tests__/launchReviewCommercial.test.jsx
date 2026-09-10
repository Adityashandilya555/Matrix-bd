// skipcq: JS-0833
// Commercial terms on the BD launch-review surface.
//
// The asymmetry under test: the supervisor edits all six, while the creating
// executive may set ONLY the rent start date — the field they are on the ground
// to know, and the one the admin's final confirm refuses to commit without.
// Getting this wrong either locks the exec out of the date or hands them five
// money fields the backend would 422.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { getLaunchApproval, saveLaunchRentFields, execReview, supervisorReview } = vi.hoisted(() => ({
  getLaunchApproval: vi.fn(),
  saveLaunchRentFields: vi.fn(),
  execReview: vi.fn(),
  supervisorReview: vi.fn(),
}));

vi.mock('../../../services/api/launchApprovalApi.js', () => ({
  getLaunchApproval, saveLaunchRentFields, execReview, supervisorReview,
}));

const record = (over = {}) => ({
  site_id: 's1', site_code: 'CA-9887', site_name: 'Powai', city: 'Mumbai',
  tenant_id: 't1', status: 'under_supervisor_review',
  rent_type: 'fixed', expected_rent: 120000, escalation_pct: 5, expected_escalation_years: 1,
  staggered_escalation: null, rev_share_pct: null,
  carpet_area_sqft: 1200, cam_charges: 0, capex: 0,
  security_deposit: 1350000, brokerage: 120950, rent_start_date: null,
  details: {}, departments: {}, events: [],
  ...over,
});

async function renderModal(props) {
  vi.resetModules();
  const { default: LaunchReviewModal } = await import('../LaunchReviewModal.jsx');
  return render(<LaunchReviewModal siteId="s1" onClose={vi.fn()} onDone={vi.fn()} {...props} />);
}

const numberBoxes = () => Array.from(document.querySelectorAll('input[type="number"]'));
const dateBox = () => document.querySelector('input[type="date"]');
// The commercial money inputs are the last five number boxes on the surface —
// the rent form owns the ones before them.
const commercialBoxes = () => numberBoxes().slice(-5);

beforeEach(() => {
  getLaunchApproval.mockReset();
  saveLaunchRentFields.mockReset();
  execReview.mockReset();
  supervisorReview.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('LaunchReviewModal — commercial terms', () => {
  it('supervisor: every commercial field is editable', async () => {
    getLaunchApproval.mockResolvedValue(record());
    await renderModal({ role: 'supervisor' });
    await screen.findByText(/Commercial terms/);

    expect(commercialBoxes().every((b) => !b.readOnly)).toBe(true);
    expect(dateBox().disabled).toBe(false);
  });

  it('executive: the five money fields are locked but the date is not', async () => {
    getLaunchApproval.mockResolvedValue(record({ status: 'under_exec_review' }));
    await renderModal({ role: 'exec' });
    await screen.findByText(/Commercial terms/);

    expect(commercialBoxes().every((b) => b.readOnly)).toBe(true);
    expect(dateBox().disabled).toBe(false);
  });

  it('executive: Save appears only after the date is actually changed', async () => {
    getLaunchApproval.mockResolvedValue(record({ status: 'under_exec_review' }));
    await renderModal({ role: 'exec' });
    await screen.findByText(/Commercial terms/);

    // Nothing touched yet — an always-on Save on a read-only surface would read
    // as "submit the review", which this button does not do.
    expect(screen.queryByRole('button', { name: /Save commercial changes/i })).toBeNull();

    fireEvent.change(dateBox(), { target: { value: '2026-05-01' } });
    expect(await screen.findByRole('button', { name: /Save commercial changes/i })).toBeTruthy();
  });

  it('executive: saving sends rent_start_date in the PATCH body', async () => {
    getLaunchApproval.mockResolvedValue(record({ status: 'under_exec_review' }));
    saveLaunchRentFields.mockImplementation(async (_id, body) => record({ ...body }));
    await renderModal({ role: 'exec' });
    await screen.findByText(/Commercial terms/);

    fireEvent.change(dateBox(), { target: { value: '2026-05-01' } });
    fireEvent.click(await screen.findByRole('button', { name: /Save commercial changes/i }));

    await waitFor(() => expect(saveLaunchRentFields).toHaveBeenCalled());
    expect(saveLaunchRentFields.mock.calls[0][1].rent_start_date).toBe('2026-05-01');
  });

  it('renders the staged commercial values, not the canonical details copy', async () => {
    getLaunchApproval.mockResolvedValue(record({
      carpet_area_sqft: 1400,
      details: { carpet_area_sqft: 1200 },
    }));
    await renderModal({ role: 'supervisor' });
    await screen.findByText(/Commercial terms/);

    expect(commercialBoxes()[0].value).toBe('1400');
  });
});
