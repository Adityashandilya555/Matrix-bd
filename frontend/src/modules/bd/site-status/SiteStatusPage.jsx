import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../../shared/page-header/PageHeader.jsx';
import Icon from '../../shared/primitives/Icon.jsx';
import { usePageContext } from '../../../App.jsx';
import {
  getBdSiteStatus,
  createChangeRequest,
} from '../../../services/api/changeRequestApi.js';
import { agreementAllowsLicensing, agreementStatusLabel, normalizeAgreementStatus } from '../../../lib/agreementStatus.js';

const DD_CHECKS = [
  { id: 'title_doc',       label: 'Title / ownership' },
  { id: 'sanctioned_plan', label: 'Sanctioned plan' },
  { id: 'oc_cc',           label: 'OC / CC' },
  { id: 'commercial_use',  label: 'Commercial usage' },
  { id: 'property_tax',    label: 'Property tax' },
  { id: 'electricity',     label: 'Electricity connection' },
  { id: 'fire_noc',        label: 'Fire NOC' },
];
const DD_EXTRA = [
  { id: 'other_1', label: 'Other 1' },
  { id: 'other_2', label: 'Other 2' },
];

const LIC_CHECKS = [
  { id: 'fssai',           label: 'FSSAI license' },
  { id: 'health_trade',    label: 'Health / trade license' },
  { id: 'shops_estab_reg', label: 'Shops & establishment' },
  { id: 'fire_noc',        label: 'Fire NOC' },
  { id: 'storage_license', label: 'Storage license' },
];

function tone(value) {
  if (value === 'yes')  return { color: 'var(--zm-success)', label: 'Yes' };
  if (value === 'no')   return { color: 'var(--zm-danger)',  label: 'No'  };
  return { color: 'var(--zm-fg-3)', label: 'Pending' };
}

function ChecklistRow({ row, value, onRequestFlip, pendingRequest }) {
  const t = tone(value);
  const canFlip = value === 'no' && !pendingRequest && onRequestFlip;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'minmax(220px,1fr) 110px 200px',
      gap: 12, padding: '12px 16px', alignItems: 'center',
      borderBottom: '1px solid var(--zm-line-faint)',
    }}>
      <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, color: 'var(--zm-fg)' }}>
        {row.label}
      </span>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        height: 24, padding: '0 10px', borderRadius: 4,
        border: `1px solid ${t.color}`, color: t.color,
        fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 10.5,
        letterSpacing: '0.12em', textTransform: 'uppercase',
      }}>
        {t.label}
      </span>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        {pendingRequest && (
          <span style={{ fontSize: 11, color: 'var(--zm-fg-3)', fontStyle: 'italic' }}>
            Awaiting legal · requested {pendingRequest.requestedValue}
          </span>
        )}
        {canFlip && (
          <button
            type="button"
            onClick={() => onRequestFlip(row.id, value)}
            style={{
              height: 28, padding: '0 12px', border: '1px solid var(--zm-line)',
              borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg)',
              fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Request flip to Yes
          </button>
        )}
      </div>
    </div>
  );
}

function pendingFor(changeRequests, targetTable, fieldName) {
  return changeRequests.find(
    cr => cr.status === 'pending'
      && cr.targetTable === targetTable
      && cr.fieldName === fieldName,
  );
}

export default function SiteStatusPage() {
  const { siteId } = useParams();
  const navigate = useNavigate();
  const { showToast } = usePageContext();

  const [state, setState] = React.useState({ status: 'loading', data: null, error: null });
  const [busyField, setBusyField] = React.useState(null);

  const load = React.useCallback(() => {
    setState((s) => ({ ...s, status: 'loading', error: null }));
    getBdSiteStatus(siteId)
      .then((data) => setState({ status: 'ready', data, error: null }))
      .catch((err) =>
        setState({ status: 'error', data: null, error: err?.detail || err?.message || 'Failed to load status' }),
      );
  }, [siteId]);

  React.useEffect(() => { if (siteId) load(); }, [siteId, load]);

  const requestFlip = async (targetTable, fieldName) => {
    const justification = window.prompt(
      `Why should Legal flip ${targetTable.replace('_', ' ')} / ${fieldName} to "yes"?`,
      '',
    );
    if (justification === null) return; // cancelled
    setBusyField(`${targetTable}.${fieldName}`);
    try {
      await createChangeRequest({
        siteId, targetTable, fieldName, requestedValue: 'yes', justification,
      });
      showToast?.('Change request sent to Legal');
      load();
    } catch (err) {
      showToast?.(err?.detail || err?.message || 'Failed to open change request');
    } finally {
      setBusyField(null);
    }
  };

  if (state.status === 'loading') {
    return <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>Loading status…</div>;
  }
  if (state.status === 'error') {
    return <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger)' }}>{state.error}</div>;
  }

  const d = state.data;
  const dd = d.dd;
  const ddPositive = dd && dd.final_verdict === 'positive';
  const ddNegative = dd && dd.final_verdict === 'negative';
  const agreementStatus = normalizeAgreementStatus(d);
  const agreementReady = agreementAllowsLicensing(agreementStatus);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 06"
        eyebrow={`Site · ${d.siteCode}`}
        title={<>Site <em>status</em></>}
        lede={`${d.siteName} · ${d.city} · drafted by ${d.submittedByName || 'unknown'}`}
        right={
          <HeaderTag
            icon={ddNegative ? 'alert' : ddPositive ? 'check' : 'clock'}
            label={(d.legalDdStatus || 'pending').toUpperCase()}
          />
        }
      />

      {ddNegative && (
        <div className="zm-glass" style={{
          padding: 16, border: '1px solid var(--zm-danger)',
          borderRadius: 12, background: 'rgba(220,38,38,0.05)',
        }}>
          <strong style={{ color: 'var(--zm-danger)' }}>Due diligence failed.</strong>
          {dd.rejection_reason && (
            <div style={{ marginTop: 6, color: 'var(--zm-fg-2)', fontSize: 13 }}>
              Reason: {dd.rejection_reason}
            </div>
          )}
        </div>
      )}

      <section className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--zm-line)',
          background: 'var(--zm-surface-2)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Icon name="shield" size={14}/>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11.5, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            1 · Due diligence
          </span>
        </div>
        {!dd && (
          <div style={{ padding: 18, color: 'var(--zm-fg-3)' }}>
            Legal has not started the due-diligence checklist yet.
          </div>
        )}
        {dd && DD_CHECKS.map(row => (
          <ChecklistRow
            key={row.id} row={row} value={dd[row.id]}
            pendingRequest={pendingFor(d.changeRequests, 'legal_dd_checklist', row.id)}
            onRequestFlip={() => requestFlip('legal_dd_checklist', row.id)}
          />
        ))}
        {dd && DD_EXTRA.filter(r => dd[r.id] && dd[r.id] !== 'pending').map(row => (
          <ChecklistRow
            key={row.id} row={row} value={dd[row.id]}
            pendingRequest={pendingFor(d.changeRequests, 'legal_dd_checklist', row.id)}
            onRequestFlip={() => requestFlip('legal_dd_checklist', row.id)}
          />
        ))}
      </section>

      <section className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--zm-line)',
          background: 'var(--zm-surface-2)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Icon name="file" size={14}/>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11.5, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            2 · Agreement
          </span>
        </div>
        {!ddPositive && (
          <div style={{ padding: 18, color: 'var(--zm-fg-3)', fontStyle: 'italic' }}>
            Agreement details unlock once due diligence is positive.
          </div>
        )}
        {ddPositive && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'minmax(220px,1fr) 160px',
            gap: 12, padding: '14px 16px', alignItems: 'center',
          }}>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13.5, color: 'var(--zm-fg)' }}>
              Agreement status
            </span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              height: 24, padding: '0 10px', borderRadius: 4,
              border: `1px solid ${agreementReady ? 'var(--zm-success)' : 'var(--zm-fg-3)'}`,
              color: agreementReady ? 'var(--zm-success)' : 'var(--zm-fg-3)',
              fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 10.5,
              letterSpacing: '0.12em', textTransform: 'uppercase',
            }}>
              {agreementStatusLabel(agreementStatus)}
            </span>
          </div>
        )}
      </section>

      <section className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--zm-line)',
          background: 'var(--zm-surface-2)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Icon name="shield" size={14}/>
          <span style={{ fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11.5, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            3 · Licenses
          </span>
        </div>
        {!ddPositive && (
          <div style={{ padding: 18, color: 'var(--zm-fg-3)', fontStyle: 'italic' }}>
            Licensing details unlock once due diligence is positive.
          </div>
        )}
        {ddPositive && !agreementReady && (
          <div style={{ padding: 18, color: 'var(--zm-fg-3)', fontStyle: 'italic' }}>
            Licensing is locked until agreement is executed or registered.
          </div>
        )}
        {ddPositive && agreementReady && !d.licensing && (
          <div style={{ padding: 18, color: 'var(--zm-fg-3)' }}>
            Legal has not started the licensing checklist yet.
          </div>
        )}
        {ddPositive && agreementReady && d.licensing && LIC_CHECKS.map(row => (
          <ChecklistRow
            key={row.id} row={row} value={d.licensing[row.id]}
          />
        ))}
      </section>

      {d.changeRequests.length > 0 && (
        <section className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid var(--zm-line)',
            background: 'var(--zm-surface-2)', fontFamily: 'var(--zm-font-body)',
            fontWeight: 800, fontSize: 11.5, letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            Change requests on this site
          </div>
          {d.changeRequests.map(cr => (
            <div key={cr.id} style={{
              display: 'grid', gridTemplateColumns: 'minmax(260px,1fr) 110px 140px',
              gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--zm-line-faint)',
              alignItems: 'center',
            }}>
              <div>
                <div style={{ fontWeight: 700 }}>
                  {cr.targetTable.replace(/_/g, ' ')} · {cr.fieldName}
                </div>
                <div style={{ fontSize: 12, color: 'var(--zm-fg-3)' }}>
                  {cr.currentValue} → {cr.requestedValue}
                  {cr.justification ? ` · ${cr.justification}` : ''}
                </div>
              </div>
              <span style={{
                textTransform: 'uppercase', fontSize: 10.5, fontWeight: 800,
                letterSpacing: '0.12em',
                color:
                  cr.status === 'approved' ? 'var(--zm-success)' :
                  cr.status === 'rejected' ? 'var(--zm-danger)'  :
                  'var(--zm-fg-3)',
              }}>{cr.status}</span>
              <span style={{ textAlign: 'right', fontSize: 11.5, color: 'var(--zm-fg-3)' }}>
                {new Date(cr.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </section>
      )}

      <div>
        <button
          type="button"
          onClick={() => navigate(-1)}
          style={{
            height: 32, padding: '0 14px', border: '1px solid var(--zm-line)',
            borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg)',
            fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          ← Back
        </button>
      </div>
    </div>
  );
}
