import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../../shared/page-header/PageHeader.jsx';
import Icon from '../../shared/primitives/Icon.jsx';
import { usePageContext } from '../../../App.jsx';
import { useSession } from '../../../state/SessionContext.jsx';
import { getLegalReview, saveAgreement } from '../../../services/api/legalApi.js';
import { ROUTES, legalSiteDdrRoute, legalSiteLicensingRoute } from '../../../router/routes.js';
import {
  agreementAllowsLicensing,
  agreementSavePayload,
  agreementStatusLabel,
  normalizeAgreementStatus,
} from '../../../lib/agreementStatus.js';

const AGREEMENT_STATES = [
  {
    key: 'pending',
    label: 'Pending',
    desc: 'Agreement has not been executed yet. Licensing stays locked.',
    icon: 'clock',
  },
  {
    key: 'executed',
    label: 'Executed',
    desc: 'Agreement is executed and ready for the licensing checklist.',
    icon: 'file',
  },
  {
    key: 'registered',
    label: 'Registered',
    desc: 'Agreement is fully registered and downstream-safe.',
    icon: 'check',
  },
];

const STATUS_RANK = { pending: 0, executed: 1, registered: 2 };

function StepButton({ item, active, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'grid',
        gridTemplateColumns: '40px minmax(0, 1fr)',
        gap: 12,
        alignItems: 'center',
        width: '100%',
        padding: '16px 18px',
        borderRadius: 12,
        border: `1px solid ${active ? 'var(--zm-accent)' : 'var(--zm-line)'}`,
        background: active ? 'var(--zm-accent-soft)' : 'var(--zm-surface)',
        color: active ? 'var(--zm-accent)' : 'var(--zm-fg)',
        boxShadow: active ? 'var(--zm-shadow-1)' : 'none',
        opacity: disabled && !active ? 0.45 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: active ? 'var(--zm-accent)' : 'var(--zm-surface-2)',
        color: active ? '#fff' : 'var(--zm-fg-3)',
        border: `1px solid ${active ? 'var(--zm-accent)' : 'var(--zm-line)'}`,
      }}>
        <Icon name={item.icon} size={18}/>
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{
          display: 'block',
          fontFamily: 'var(--zm-font-body)',
          fontSize: 14,
          fontWeight: 850,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          {item.label}
        </span>
        <span style={{
          display: 'block',
          marginTop: 4,
          fontFamily: 'var(--zm-font-body)',
          fontSize: 12.5,
          lineHeight: 1.45,
          color: active ? 'var(--zm-fg-2)' : 'var(--zm-fg-3)',
        }}>
          {item.desc}
        </span>
      </span>
    </button>
  );
}

function TrailItem({ label, value, active }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 9 }}>
      <span style={{
        width: 9,
        height: 9,
        marginTop: 5,
        borderRadius: 999,
        background: active ? 'var(--zm-accent)' : 'var(--zm-line-strong)',
        boxShadow: active ? '0 0 0 4px var(--zm-accent-soft)' : 'none',
      }}/>
      <span>
        <span style={{
          display: 'block',
          fontFamily: 'var(--zm-font-body)',
          fontSize: 12.5,
          fontWeight: 750,
          color: 'var(--zm-fg)',
        }}>
          {label}
        </span>
        <span style={{
          display: 'block',
          marginTop: 2,
          fontFamily: 'var(--zm-font-mono)',
          fontSize: 10.5,
          color: 'var(--zm-fg-3)',
        }}>
          {value}
        </span>
      </span>
    </div>
  );
}

export default function AgreementPage() {
  const { siteId } = useParams();
  const navigate = useNavigate();
  const { showToast } = usePageContext();
  const { role } = useSession();

  const [review, setReview] = React.useState(null);
  const [selected, setSelected] = React.useState('pending');
  const [loadState, setLoadState] = React.useState('loading');
  const [error, setError] = React.useState(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!siteId) return;
    let cancelled = false;
    setLoadState('loading');
    getLegalReview(siteId)
      .then((data) => {
        if (cancelled) return;
        setReview(data);
        setSelected(normalizeAgreementStatus(data));
        setLoadState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.detail || err?.message || 'Failed to load agreement');
        setLoadState('error');
      });
    return () => { cancelled = true; };
  }, [siteId]);

  if (!siteId) {
    return <div className="zm-glass" style={{ padding: 24, margin: 24, color: 'var(--zm-danger)' }}>Missing site id.</div>;
  }

  if (loadState === 'loading') {
    return <div className="zm-glass" style={{ padding: 24, margin: 24, color: 'var(--zm-fg-3)' }}>Loading agreement...</div>;
  }

  if (loadState === 'error') {
    return (
      <div className="zm-glass" style={{ padding: 24, margin: 24, color: 'var(--zm-danger)' }}>
        {error}
        <div style={{ marginTop: 12 }}>
          <button type="button" onClick={() => navigate(ROUTES.LEGAL)} className="zm-btn"
            style={{ height: 32, padding: '0 12px', borderRadius: 7, border: '1px solid var(--zm-line)', background: 'var(--zm-surface)', color: 'var(--zm-fg)', cursor: 'pointer' }}>
            Back to legal queue
          </button>
        </div>
      </div>
    );
  }

  const ddReady = (review?.dd?.stage || 'published') === 'published' && review?.dd?.final_verdict === 'positive';
  const currentStatus = normalizeAgreementStatus(review);
  const canSave = role === 'supervisor' && ddReady;
  const selectedRank = STATUS_RANK[selected] ?? 0;
  const currentRank = STATUS_RANK[currentStatus] ?? 0;
  const licensingReady = agreementAllowsLicensing(currentStatus);
  const hasChanged = selected !== currentStatus;
  const saveDisabled = !canSave || saving || !hasChanged || selectedRank < currentRank;

  const site = {
    code: review?.siteCode || review?.siteId?.slice(0, 8).toUpperCase() || 'SITE',
    name: review?.siteName || `Site ${review?.siteId?.slice(0, 8) || ''}`,
    city: review?.city || '-',
  };

  const handleSave = async () => {
    if (saveDisabled) return;
    try {
      setSaving(true);
      const next = await saveAgreement(siteId, agreementSavePayload(selected));
      setReview(next);
      setSelected(normalizeAgreementStatus(next));
      showToast?.(`Agreement marked ${agreementStatusLabel(selected).toLowerCase()}.`, 'success');
    } catch (err) {
      showToast?.(err?.detail || err?.message || 'Agreement save failed', 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="agreement-page" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 06"
        eyebrow="Legal module · Agreement"
        title={<>Agreement <em>status</em></>}
        lede="Confirm execution before the licensing checklist opens for downstream clearance."
        right={<HeaderTag icon="file" label={agreementStatusLabel(currentStatus).toUpperCase()}/>}
      />

      {!ddReady && (
        <div className="zm-glass" style={{
          padding: 14,
          borderRadius: 10,
          border: '1px solid var(--zm-copper-line)',
          background: 'var(--zm-warning-soft)',
          color: 'var(--zm-fg-2)',
          fontFamily: 'var(--zm-font-body)',
          fontSize: 13,
        }}>
          Agreement opens after DDR is published with a positive verdict.
        </div>
      )}

      <div
        className="agreement-shell"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
          gap: 18,
          alignItems: 'start',
        }}
      >
        <section className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '36px minmax(0, 1fr) minmax(90px, 150px)',
            gap: 14,
            alignItems: 'center',
            padding: '12px 16px',
            background: 'var(--zm-surface-2)',
            borderBottom: '1px solid var(--zm-line)',
            fontFamily: 'var(--zm-font-body)',
            fontWeight: 800,
            fontSize: 10.5,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--zm-fg-3)',
          }}>
            <span>No.</span>
            <span>Agreement state</span>
            <span style={{ textAlign: 'right' }}>Current</span>
          </div>

          <div style={{ padding: 16, display: 'grid', gap: 10 }}>
            {AGREEMENT_STATES.map((item, index) => {
              const disabled = !canSave || STATUS_RANK[item.key] < currentRank;
              return (
                <div
                  key={item.key}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '42px minmax(0, 1fr)',
                    gap: 12,
                    alignItems: 'center',
                  }}
                >
                  <span style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    border: '1px solid var(--zm-line)',
                    background: 'var(--zm-surface-2)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'var(--zm-font-mono)',
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--zm-fg-3)',
                  }}>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <StepButton
                    item={item}
                    active={selected === item.key}
                    disabled={disabled}
                    onClick={() => setSelected(item.key)}
                  />
                </div>
              );
            })}
          </div>
        </section>

        <aside
          className="zm-glass"
          style={{
            borderRadius: 12,
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            position: 'sticky',
            top: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'var(--zm-copper-soft)',
              color: 'var(--zm-copper)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Icon name="file" size={20}/>
            </span>
            <div style={{ minWidth: 0 }}>
              <h2 style={{
                margin: 0,
                fontFamily: 'var(--zm-font-display)',
                fontSize: 16,
                lineHeight: 1.2,
                color: 'var(--zm-fg)',
              }}>
                {site.name}
              </h2>
              <p style={{
                margin: '4px 0 0',
                fontFamily: 'var(--zm-font-mono)',
                fontSize: 11,
                color: 'var(--zm-fg-3)',
              }}>
                {site.code} / {site.city}
              </p>
            </div>
          </div>

          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: 12,
            borderRadius: 8,
            border: '1px solid var(--zm-line)',
            background: 'var(--zm-surface)',
          }}>
            <TrailItem label="DDR" value={ddReady ? 'Positive / published' : 'Pending'} active={ddReady}/>
            <TrailItem label="Agreement" value={agreementStatusLabel(selected)} active={selected !== 'pending'}/>
            <TrailItem label="Licensing" value={licensingReady ? 'Open' : 'Locked'} active={licensingReady}/>
          </div>

          {!canSave && (
            <div style={{
              padding: 10,
              borderRadius: 8,
              background: 'var(--zm-warning-soft)',
              border: '1px solid var(--zm-copper-line)',
              fontFamily: 'var(--zm-font-body)',
              fontSize: 12,
              lineHeight: 1.45,
              color: 'var(--zm-fg-2)',
            }}>
              {ddReady
                ? 'Only legal supervisors can update the agreement status.'
                : 'Complete positive DDR before saving agreement status.'}
            </div>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={saveDisabled}
            className="zm-btn-primary"
            style={{
              height: 40,
              borderRadius: 8,
              border: 'none',
              background: saveDisabled ? 'var(--zm-surface-sunken)' : 'var(--zm-accent)',
              color: saveDisabled ? 'var(--zm-fg-4)' : '#fff',
              fontFamily: 'var(--zm-font-body)',
              fontSize: 13,
              fontWeight: 850,
              cursor: saveDisabled ? 'not-allowed' : 'pointer',
              boxShadow: saveDisabled ? 'none' : 'var(--zm-shadow-1)',
            }}
          >
            {saving ? 'Saving agreement...' : 'Save agreement status'}
          </button>

          {licensingReady && (
            <button
              type="button"
              onClick={() => navigate(legalSiteLicensingRoute(siteId))}
              className="zm-btn"
              style={{
                height: 38,
                borderRadius: 8,
                border: '1px solid var(--zm-line)',
                background: 'var(--zm-surface)',
                color: 'var(--zm-fg)',
                fontFamily: 'var(--zm-font-body)',
                fontSize: 13,
                fontWeight: 750,
                cursor: 'pointer',
              }}
            >
              Open licensing
            </button>
          )}

          <button
            type="button"
            onClick={() => navigate(ddReady ? ROUTES.LEGAL : legalSiteDdrRoute(siteId))}
            className="zm-btn"
            style={{
              height: 34,
              borderRadius: 8,
              border: '1px solid var(--zm-line)',
              background: 'transparent',
              color: 'var(--zm-fg-2)',
              fontFamily: 'var(--zm-font-body)',
              fontSize: 12,
              fontWeight: 750,
              cursor: 'pointer',
            }}
          >
            {ddReady ? 'Back to legal queue' : 'Back to DDR'}
          </button>
        </aside>
      </div>
    </div>
  );
}
