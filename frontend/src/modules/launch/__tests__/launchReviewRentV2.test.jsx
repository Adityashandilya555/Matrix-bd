// skipcq: JS-0833
// End-to-end lock for RentTermsFormV2 in the BD launch-review surface. The bug
// this fixes: the launch Edit tab rendered the OLD four-card RentTermsForm, and
// even after a naive swap the escalation edit silently no-op'd (V2 emits
// expected_escalation_pct, the launch row/PATCH use escalation_pct). The flag is
// read at module load, so flag-on cases stubEnv + resetModules + dynamic import.
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
  details: {}, departments: {}, events: [],
  ...over,
});

async function renderModal(props) {
  vi.resetModules();
  const { default: LaunchReviewModal } = await import('../LaunchReviewModal.jsx');
  return render(<LaunchReviewModal siteId="s1" onClose={vi.fn()} onDone={vi.fn()} {...props} />);
}

beforeEach(() => {
  getLaunchApproval.mockReset();
  saveLaunchRentFields.mockReset();
  execReview.mockReset();
  supervisorReview.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('LaunchReviewModal — rent v2', () => {
  it('flag ON: hydrates escalation_pct into the V2 escalation field', async () => {
    vi.stubEnv('VITE_FEATURE_RENT_V2', 'true');
    getLaunchApproval.mockResolvedValue(record());
    await renderModal({ role: 'supervisor' });
    await screen.findByText('Is the rent staggered?');   // V2 renders, not the V1 cards
    expect(screen.getByDisplayValue('5')).toBeTruthy();   // escalation_pct -> V2 field
  });

  it('flag ON: saving sends escalation_pct — not expected_escalation_pct (the silent no-op fix)', async () => {
    vi.stubEnv('VITE_FEATURE_RENT_V2', 'true');
    getLaunchApproval.mockResolvedValue(record());
    saveLaunchRentFields.mockImplementation(async (_id, body) => record({ escalation_pct: body.escalation_pct }));
    await renderModal({ role: 'supervisor' });
    await screen.findByText('Is the rent staggered?');

    fireEvent.change(screen.getByDisplayValue('5'), { target: { value: '7' } });
    fireEvent.click(screen.getByText('Save rent changes'));

    await waitFor(() => expect(saveLaunchRentFields).toHaveBeenCalled());
    const body = saveLaunchRentFields.mock.calls[0][1];
    expect(body.escalation_pct).toBe(7);
    expect(body).not.toHaveProperty('expected_escalation_pct');
  });

  it('flag ON: an mg_revshare row stays editable in place (not read-only convert)', async () => {
    vi.stubEnv('VITE_FEATURE_RENT_V2', 'true');
    getLaunchApproval.mockResolvedValue(record({
      rent_type: 'mg_revshare', expected_rent: 80000, rev_share_pct: 12, escalation_pct: 4,
    }));
    await renderModal({ role: 'supervisor' });
    await screen.findByText(/Legacy rent type/);
    expect(screen.getByDisplayValue('80000')).toBeTruthy();          // editable MG box
    expect(screen.getByText('Convert to staggered')).toBeTruthy();    // convert still offered
  });

  it('flag ON: the exec view is read-only with no Save button', async () => {
    vi.stubEnv('VITE_FEATURE_RENT_V2', 'true');
    getLaunchApproval.mockResolvedValue(record());
    await renderModal({ role: 'exec' });
    await screen.findByText('Is the rent staggered?');
    expect(screen.queryByText('Save rent changes')).toBeNull();
  });

  it('flag OFF: renders the V1 four-card radiogroup (rollback)', async () => {
    getLaunchApproval.mockResolvedValue(record());
    await renderModal({ role: 'supervisor' });
    await screen.findByRole('radiogroup', { name: 'Rent type' });
    expect(screen.queryByText('Is the rent staggered?')).toBeNull();
  });
});
