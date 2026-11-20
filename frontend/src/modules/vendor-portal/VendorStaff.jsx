// skipcq: JS-0833
// Owner-only: the vendor company's staff code, people waiting to join, and the
// active team. Whether the owner may approve depends on the workspace's
// admission setting — when the client approves everyone, the owner sees the
// queue but the decision buttons are replaced by a note.
import React from 'react';
import { decideVendorStaff, getVendorStaff, rotateVendorStaffCode } from '../../services/api/vendorPortalApi.js';
import { fmtDate } from './format.js';

export default function VendorStaff() {
  const [state, setState] = React.useState({ status: 'loading' });
  const [busy, setBusy] = React.useState(null);
  const [msg, setMsg] = React.useState(null);

  const load = React.useCallback(() => {
    getVendorStaff().then((data) => setState({ status: 'ready', data }))
      .catch((err) => setState({ status: 'error', message: err?.detail || 'Could not load your team.' }));
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const act = async (key, fn, done) => {
    setBusy(key); setMsg(null);
    try { await fn(); setMsg(done); load(); } catch (err) { setMsg(err?.detail || 'That did not work. Try again.'); }
    finally { setBusy(null); }
  };

  if (state.status === 'loading') return <p className="vp-muted">Loading your team…</p>;
  if (state.status === 'error') return <div className="vp-card"><p className="vp-error">{state.message}</p></div>;
  const { staff = [], pending = [], staffCode, canApprove } = state.data;

  return (
    <div className="vp-stack">
      <div><div className="vp-eyebrow">Your company</div><h1 className="vp-h1">Team</h1></div>
      {msg && <div className="vp-note" role="status">{msg}</div>}
      <div className="vp-card"><h3>Staff code</h3>
        <p className="vp-small vp-muted">Site staff enter this on the sign-in page&#39;s Join tab with their work email. Rotate it if it has been shared too widely; people already on the team are not affected.</p>
        {staffCode
          ? <div className="vp-codebox"><code>{staffCode}</code>
              <button type="button" className="vp-btn sm" disabled={busy === 'rotate'} onClick={() => act('rotate', rotateVendorStaffCode, 'Staff code rotated. The old code no longer works.')}>Rotate code</button></div>
          : <p className="vp-muted">Your client has not issued a staff code yet.</p>}
      </div>
      <div className="vp-card"><h3>Waiting to join ({pending.length})</h3>
        {!canApprove && pending.length > 0 && <div className="vp-note">Your client approves new staff for this workspace. They will see these requests.</div>}
        {pending.length ? (
          <div className="vp-tbl"><table><tbody>{pending.map((u) => (
            <tr key={u.id}><td>{u.email}<div className="vp-small vp-muted">Requested {fmtDate(u.createdAt)}</div></td>
              <td style={{ textAlign: 'right' }}>{canApprove && (
                <div className="vp-row" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="vp-btn sm primary" disabled={busy === u.id} onClick={() => act(u.id, () => decideVendorStaff(u.id, true), `${u.email} can now sign in and set a password.`)}>Approve</button>
                  <button type="button" className="vp-btn sm" disabled={busy === u.id} onClick={() => act(u.id, () => decideVendorStaff(u.id, false), `${u.email}'s request was removed.`)}>Reject</button>
                </div>)}</td></tr>
          ))}</tbody></table></div>
        ) : <p className="vp-muted">No one is waiting.</p>}
      </div>
      <div className="vp-card"><h3>Active team</h3>
        <div className="vp-tbl"><table><thead><tr><th>Person</th><th>Role</th><th>Since</th></tr></thead><tbody>
          {staff.map((u) => (
            <tr key={u.id}><td>{u.name || u.email}<div className="vp-small vp-muted">{u.email}</div></td>
              <td>{u.vendorRole === 'owner' ? 'Owner' : 'Site supervisor'}</td><td>{fmtDate(u.approvedAt)}</td></tr>
          ))}
        </tbody></table></div>
      </div>
    </div>
  );
}
