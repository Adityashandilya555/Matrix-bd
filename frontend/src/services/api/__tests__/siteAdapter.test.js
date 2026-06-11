// Batch L-frontend — httpAdapter.siteFromServer mapping (#115 SLA, #126 archive).
import { describe, it, expect } from 'vitest';
import { siteFromServer } from '../adapters/httpAdapter.js';

const baseWire = {
  id: 's1', code: 'BT-X', name: 'Site', city: 'Mumbai',
  tenant_id: 't1', status: 'approved', submitted_by: 'u1', created_by: 'Creator',
};

describe('siteFromServer — LOI SLA fields (#115)', () => {
  it('maps expected_loi_days / approved_at / approved_by / loi_uploaded_at', () => {
    const out = siteFromServer({
      ...baseWire,
      expected_loi_days: 21,
      approved_at: '2026-06-01T00:00:00Z',
      approved_by: 'Supervisor Bob',
      loi_uploaded_at: '2026-06-05T00:00:00Z',
    });
    expect(out.expectedLoiDays).toBe(21);
    expect(out._approvedDate).toBe('2026-06-01');
    expect(out._approvedBy).toBe('Supervisor Bob');
    expect(out._loiUploadedAt).toBe('2026-06-05T00:00:00Z');
    // 4 whole days from approval to LOI upload.
    expect(out._daysToLOI).toBe(4);
    expect(typeof out._daysSinceApproval).toBe('number');
  });

  it('does not fabricate SLA fields when the wire omits them', () => {
    const out = siteFromServer(baseWire);
    expect(out.expectedLoiDays).toBeNull();
    expect(out._approvedDate).toBe('');
    expect(out._daysToLOI).toBeNull();
    expect(out._daysSinceApproval).toBe(0);
  });
});

describe('siteFromServer — archive reason/note (#126)', () => {
  it('maps rejection_reason into a reasons array and archive_note', () => {
    const out = siteFromServer({
      ...baseWire, status: 'archived',
      rejection_reason: 'footfall too low', archive_note: 'parked until Q3',
    });
    expect(out.rejectionReasons).toEqual(['footfall too low']);
    expect(out.archiveNote).toBe('parked until Q3');
  });

  it('yields empty reasons when none present', () => {
    const out = siteFromServer(baseWire);
    expect(out.rejectionReasons).toEqual([]);
    expect(out.archiveNote).toBe('');
  });
});
