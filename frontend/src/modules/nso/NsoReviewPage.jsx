import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../shared/page-header/PageHeader.jsx';
import Icon from '../shared/primitives/Icon.jsx';
import { usePageContext } from '../../App.jsx';
import {
  finalApproveNso,
  getNso,
  saveNsoStageOne,
  saveNsoStageThree,
} from '../../services/api/nsoApi.js';
import { ROUTES } from '../../router/routes.js';
import { safeHref } from '../../lib/safeHref.js';
import { useSiteDataRefresh } from '../../hooks/useSiteDataRefresh.js';

const LICENSE_FIELDS = [
  ['fssai', 'FSSAI'],
  ['healthTrade', 'Health Trade'],
  ['shopsEstabReg', 'Shops & Establishment'],
  ['fireNoc', 'Fire NOC'],
  ['storageLicense', 'Storage License'],
];

function pretty(value) {
  if (value == null || value === '') return 'Pending';
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function statusTone(done, unlocked) {
  if (done) return { bg: 'rgba(47, 125, 82, 0.1)', border: 'rgba(47, 125, 82, 0.5)', color: 'var(--zm-success)', label: 'Done' };
  if (unlocked) return { bg: 'rgba(174, 111, 36, 0.1)', border: 'rgba(174, 111, 36, 0.45)', color: 'var(--zm-copper)', label: 'Open' };
  return { bg: 'var(--zm-surface-2)', border: 'var(--zm-line)', color: 'var(--zm-fg-3)', label: 'Locked' };
}

function licenseTone(value) {
  if (value === 'yes') return { label: 'Yes', color: 'var(--zm-success)', bg: 'rgba(47, 125, 82, 0.1)', border: 'rgba(47, 125, 82, 0.35)' };
  if (value === 'no') return { label: 'No', color: 'var(--zm-danger)', bg: 'rgba(160, 42, 42, 0.08)', border: 'rgba(160, 42, 42, 0.28)' };
  return { label: 'Pending', color: 'var(--zm-fg-3)', bg: 'var(--zm-surface)', border: 'var(--zm-line)' };
}

function FieldLabel({ children }) {
  return (
    <label style={{
      display: 'block',
      marginBottom: 7,
      color: 'var(--zm-fg)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      fontWeight: 850,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    }}>
      {children}
    </label>
  );
}

function inputStyle(disabled = false) {
  return {
    width: '100%',
    minHeight: 42,
    boxSizing: 'border-box',
    borderRadius: 9,
    border: '1px solid var(--zm-line)',
    background: disabled ? 'var(--zm-surface-2)' : 'var(--zm-surface)',
    color: disabled ? 'var(--zm-fg-3)' : 'var(--zm-fg)',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 14,
    fontWeight: 700,
    padding: '10px 12px',
  };
}

function snapshotValue(value, suffix = '') {
  if (value == null || value === '') return '—';
  return `${value}${suffix}`;
}

function money(value) {
  if (value == null || value === '') return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(num);
}

function percent(value) {
  if (value == null || value === '') return '—';
  return `${value}%`;
}

function SnapshotItem({ label, value, mono = false, wide = false }) {
  return (
    <div style={{
      minWidth: 0,
      gridColumn: wide ? 'span 2' : 'auto',
      padding: '10px 12px',
      borderRadius: 9,
      border: '1px solid var(--zm-line)',
      background: 'var(--zm-surface-2)',
    }}>
      <div style={{
        color: 'var(--zm-fg-3)',
        fontSize: 10,
        fontWeight: 850,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        marginBottom: 5,
      }}>{label}</div>
      <div style={{
        color: 'var(--zm-fg)',
        fontSize: 13,
        fontWeight: 760,
        lineHeight: 1.35,
        fontFamily: mono ? 'var(--zm-font-mono)' : 'var(--zm-font-body)',
        overflowWrap: 'anywhere',
      }}>{value}</div>
    </div>
  );
}

function PropertySnapshotPanel({ snapshot = {} }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 10,
      }}>
        <SnapshotItem label="Site" value={snapshotValue(snapshot.siteName)} />
        <SnapshotItem label="City" value={snapshotValue(snapshot.city)} />
        <SnapshotItem label="Visit date" value={snapshotValue(snapshot.visitDate)} mono />
        <SnapshotItem label="Model" value={snapshotValue(snapshot.model)} />
        <SnapshotItem label="CA code" value={snapshotValue(snapshot.caCode)} mono />
        <SnapshotItem label="Finance amount" value={money(snapshot.financeAmount)} mono />
        <SnapshotItem label="KYC" value={snapshot.kycVerified ? 'Verified' : 'Pending'} />
        <SnapshotItem label="Rent type" value={snapshot.rentType ? pretty(snapshot.rentType) : '—'} />
        <SnapshotItem label="Rent / MG" value={money(snapshot.expectedRent)} mono />
        <SnapshotItem label="Revenue share" value={percent(snapshot.expectedRevsharePct)} mono />
        <SnapshotItem
          label="Escalation"
          value={
            snapshot.expectedEscalationPct != null
              ? `${snapshot.expectedEscalationPct}% every ${snapshot.expectedEscalationYears || 1} yr`
              : '—'
          }
          mono
        />
        <SnapshotItem label="Score" value={snapshotValue(snapshot.score)} mono />
        <SnapshotItem label="Est. sales" value={money(snapshot.estimatedMonthlySales)} mono />
        <SnapshotItem label="Carpet area" value={snapshotValue(snapshot.carpetAreaSqft, ' sqft')} mono />
        <SnapshotItem label="CAM" value={money(snapshot.camCharges)} mono />
        <SnapshotItem label="Deposit" value={money(snapshot.securityDeposit)} mono />
        <SnapshotItem label="Brokerage" value={money(snapshot.brokerage)} mono />
        <SnapshotItem label="Lock-in" value={snapshotValue(snapshot.lockInMonths, ' months')} mono />
        <SnapshotItem label="Tenure" value={snapshotValue(snapshot.tenureMonths, ' months')} mono />
        <SnapshotItem label="Rent-free" value={snapshotValue(snapshot.rentFreeDays, ' days')} mono />
        <SnapshotItem label="Nearest Starbucks" value={snapshotValue(snapshot.nearestStarbucksM, ' m')} mono />
        <SnapshotItem label="Nearest TWC" value={snapshotValue(snapshot.nearestTwcM, ' m')} mono />
        <SnapshotItem label="Google pin" value={snapshotValue(snapshot.googleMapsPin)} mono wide />
        {safeHref(snapshot.googleMapsUrl) && (
          <SnapshotItem
            label="Maps link"
            value={<a href={safeHref(snapshot.googleMapsUrl)} target="_blank" rel="noreferrer" style={{ color: 'var(--zm-accent)' }}>Open Google Maps</a>}
            wide
          />
        )}
      </div>
      <div style={{
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid var(--zm-line)',
        background: 'rgba(10, 91, 74, 0.06)',
        color: 'var(--zm-fg-2)',
        fontSize: 12.5,
        lineHeight: 1.45,
      }}>
        Property details are inherited from BD, Add Details, and Finance / CA. NSO can review this snapshot but should not overwrite upstream property data.
      </div>
    </div>
  );
}

function LegalLicenseSnapshotPanel({ snapshot = {} }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid rgba(10, 91, 74, 0.22)',
        background: 'rgba(10, 91, 74, 0.06)',
        color: 'var(--zm-fg-2)',
        fontSize: 12.5,
        lineHeight: 1.45,
        fontWeight: 650,
      }}>
        License statuses are pulled from Legal Licensing. NSO can review them here, but Legal remains the source of truth.
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 10,
        border: '1px solid var(--zm-line)',
        background: 'var(--zm-surface-2)',
      }}>
        <div>
          <div style={{
            color: 'var(--zm-fg-3)',
            fontSize: 10,
            fontWeight: 850,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>Overall Licensing</div>
          <div style={{ marginTop: 3, color: 'var(--zm-fg)', fontWeight: 850 }}>
            {pretty(snapshot.overallStatus)}
            {snapshot.stage ? <span style={{ color: 'var(--zm-fg-3)', fontWeight: 700 }}> · {pretty(snapshot.stage)}</span> : null}
          </div>
        </div>
        <StatusChip value={snapshot.complete ? 'Complete' : 'Pending'} tone={snapshot.complete ? 'var(--zm-success)' : 'var(--zm-copper)'}/>
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {LICENSE_FIELDS.map(([key, label]) => {
          const tone = licenseTone(snapshot[key] || 'pending');
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 14,
                padding: 12,
                borderRadius: 10,
                border: `1px solid ${tone.border}`,
                background: tone.bg,
              }}
            >
              <span style={{ color: 'var(--zm-fg)', fontWeight: 850 }}>{label}</span>
              <span style={{
                height: 28,
                minWidth: 92,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                border: `1px solid ${tone.border}`,
                background: 'var(--zm-surface)',
                color: tone.color,
                fontSize: 11,
                fontWeight: 850,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}>
                {tone.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusChip({ value, tone = 'var(--zm-accent)' }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      height: 22,
      padding: '0 9px',
      borderRadius: 5,
      border: `1px solid ${tone}`,
      color: tone,
      fontSize: 10,
      fontWeight: 850,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {pretty(value)}
    </span>
  );
}

function BoolToggle({ value, onChange, disabled = false }) {
  return (
    <div style={{ display: 'inline-flex', gap: 8 }}>
      {[true, false].map((next) => {
        const active = value === next;
        return (
          <button
            key={String(next)}
            type="button"
            disabled={disabled}
            onClick={() => onChange(next)}
            style={{
              minWidth: 82,
              height: 38,
              borderRadius: 8,
              border: `1px solid ${active ? 'var(--zm-accent)' : 'var(--zm-line)'}`,
              background: active ? 'var(--zm-accent-soft)' : 'var(--zm-surface)',
              color: active ? 'var(--zm-accent)' : 'var(--zm-fg-2)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--zm-font-body)',
              fontWeight: 850,
            }}
          >
            {next ? 'Yes' : 'No'}
          </button>
        );
      })}
    </div>
  );
}

function StageCard({ title, eyebrow, done, unlocked, children, footer }) {
  const tone = statusTone(done, unlocked);
  return (
    <section className="zm-glass" style={{
      borderRadius: 12,
      overflow: 'hidden',
      borderColor: tone.border,
      background: done ? tone.bg : 'var(--zm-surface)',
    }}>
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '16px 18px',
        borderBottom: '1px solid var(--zm-line)',
      }}>
        <div>
          <div style={{
            color: 'var(--zm-fg-3)',
            fontSize: 10.5,
            fontWeight: 850,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
          }}>
            {eyebrow}
          </div>
          <h2 style={{
            margin: '4px 0 0',
            color: 'var(--zm-fg)',
            fontSize: 20,
            lineHeight: 1.1,
            fontWeight: 900,
          }}>
            {title}
          </h2>
        </div>
        <StatusChip value={tone.label} tone={tone.color}/>
      </header>
      <div style={{ padding: 18 }}>
        {children}
        {footer && <div style={{ marginTop: 18 }}>{footer}</div>}
      </div>
    </section>
  );
}

function LockedNotice({ children }) {
  return (
    <div style={{
      display: 'flex',
      gap: 10,
      alignItems: 'flex-start',
      padding: 14,
      borderRadius: 10,
      border: '1px solid var(--zm-line)',
      background: 'var(--zm-surface-2)',
      color: 'var(--zm-fg-2)',
      fontSize: 13,
      lineHeight: 1.45,
      fontWeight: 650,
    }}>
      <Icon name="lock" size={16}/>
      <span>{children}</span>
    </div>
  );
}

function TriggerRail({ triggers }) {
  return (
    <div className="zm-glass" style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: 12,
      padding: 14,
      borderRadius: 12,
    }}>
      {triggers.map((trigger, index) => {
        const tone = statusTone(trigger.complete, trigger.unlocked);
        return (
          <div
            key={trigger.key}
            title={trigger.reason || trigger.label}
            style={{
              padding: 14,
              minHeight: 96,
              borderRadius: 10,
              border: `1px solid ${tone.border}`,
              background: tone.bg,
              color: tone.color,
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              fontSize: 10,
              fontWeight: 850,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}>
              <span>Trigger {index + 1}</span>
              <Icon name={trigger.unlocked ? 'check' : 'lock'} size={14}/>
            </div>
            <div style={{ marginTop: 10, color: 'var(--zm-fg)', fontWeight: 900, fontSize: 14 }}>
              {trigger.label}
            </div>
            <div style={{ marginTop: 6, color: 'var(--zm-fg-3)', fontSize: 12, lineHeight: 1.35 }}>
              {trigger.reason || (trigger.unlocked ? 'Unlocked' : 'Waiting on upstream module')}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function NsoReviewPage() {
  const { siteId } = useParams();
  const navigate = useNavigate();
  const { showToast } = usePageContext();
  const [state, setState] = React.useState({ status: 'loading', review: null, error: null });
  const [stageOne, setStageOne] = React.useState({ communicationFloated: null });
  const [stageThree, setStageThree] = React.useState({
    dryStockOrderStatus: 'pending',
    onlineDeliveryStatus: 'pending',
    handoverChecklistSigned: null,
    launchDate: '',
    launchReady: null,
    finalApprovalSignoff1: false,
    finalApprovalSignoff2: false,
  });
  const [busy, setBusy] = React.useState(null);
  const [dirty, setDirty] = React.useState(false);
  const [notice, setNotice] = React.useState(null);

  const hydrate = React.useCallback((review) => {
    setStageOne({
      communicationFloated: review.communicationFloated ?? null,
    });
    setStageThree({
      dryStockOrderStatus: review.dryStockOrderStatus || 'pending',
      onlineDeliveryStatus: review.onlineDeliveryStatus || 'pending',
      handoverChecklistSigned: review.handoverChecklistSigned ?? null,
      launchDate: review.launchDate || '',
      launchReady: review.launchReady ?? null,
      finalApprovalSignoff1: Boolean(review.finalApprovalSignoff1),
      finalApprovalSignoff2: Boolean(review.finalApprovalSignoff2),
    });
    setDirty(false);
  }, []);

  const load = React.useCallback((silent = false) => {
    let cancelled = false;
    if (!silent) setState((prev) => ({ ...prev, status: 'loading', error: null }));
    getNso(siteId)
      .then((review) => {
        if (cancelled) return;
        setState({ status: 'ready', review, error: null });
        hydrate(review);
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: 'error',
          review: null,
          error: err?.detail || err?.message || 'Failed to load NSO review',
        });
      });
    return () => { cancelled = true; };
  }, [hydrate, siteId]);

  React.useEffect(() => load(), [load]);
  useSiteDataRefresh(() => load(true), {
    siteId,
    sources: ['nso', 'project', 'businessAdmin', 'payment', 'legalApi', 'siteTrackerApi', 'launch'],
    skipWhen: () => busy || dirty,
  });

  const review = state.review;
  const triggerMap = Object.fromEntries((review?.triggers || []).map((item) => [item.key, item]));
  const stageOneUnlocked = Boolean(triggerMap.finance_ca?.unlocked);
  const stageTwoUnlocked = Boolean(triggerMap.project_initiation?.unlocked);
  const stageTwoDone = Boolean(review?.legalLicensingSnapshot?.complete || review?.stageTwoCompletedAt);
  const stageThreeUnlocked = Boolean(triggerMap.project_completion?.unlocked);
  const finalUnlocked = Boolean(review?.stageThreeCompletedAt && !review?.finalApprovedAt);

  const saveOne = async () => {
    setBusy('stage-one');
    setNotice(null);
    try {
      const next = await saveNsoStageOne(siteId, stageOne);
      setState({ status: 'ready', review: next, error: null });
      hydrate(next);
      setNotice('Stage 1 saved.');
    } catch (err) {
      setNotice(err?.detail || err?.message || 'Could not save Stage 1.');
    } finally {
      setBusy(null);
    }
  };

  const saveThree = async () => {
    setBusy('stage-three');
    setNotice(null);
    try {
      const next = await saveNsoStageThree(siteId, {
        ...stageThree,
        launchDate: stageThree.launchDate || null,
      });
      setState({ status: 'ready', review: next, error: null });
      hydrate(next);
      setNotice('Stage 3 saved.');
    } catch (err) {
      setNotice(err?.detail || err?.message || 'Could not save Stage 3.');
    } finally {
      setBusy(null);
    }
  };

  const approveFinal = async () => {
    setBusy('final');
    setNotice(null);
    try {
      const next = await finalApproveNso(siteId);
      setState({ status: 'ready', review: next, error: null });
      hydrate(next);
      // Use the app-level toast (not the local notice) since we navigate away —
      // a cross-page toast survives the unmount; an inline notice would not.
      showToast?.('NSO final approval complete.', 'success');
      // End of the NSO chain → back to the queue for the next site.
      navigate(ROUTES.NSO);
    } catch (err) {
      setNotice(err?.detail || err?.message || 'Could not finalize NSO.');
    } finally {
      setBusy(null);
    }
  };

  const saveButton = (label, onClick, disabled, busyKey) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || Boolean(busy)}
      style={{
        height: 36,
        padding: '0 16px',
        border: 'none',
        borderRadius: 8,
        background: disabled ? 'var(--zm-surface-2)' : 'var(--zm-accent)',
        color: disabled ? 'var(--zm-fg-3)' : '#fff',
        fontFamily: 'var(--zm-font-body)',
        fontSize: 12,
        fontWeight: 850,
        cursor: disabled || busy ? 'not-allowed' : 'pointer',
      }}
    >
      {busy === busyKey ? 'Saving...' : label}
    </button>
  );

  if (state.status === 'loading') {
    return <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>Loading NSO site...</div>;
  }

  if (state.status === 'error') {
    return (
      <div className="zm-glass" style={{ padding: 24, color: 'var(--zm-danger)' }}>
        {state.error}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 10"
        eyebrow={`NSO · ${review.siteCode}`}
        title={`${review.siteName} opening`}
        lede={`${review.city} · CA ${review.caCode || 'pending'} · Project ${pretty(review.projectStatus)}`}
        right={<HeaderTag icon="home" label={pretty(review.nsoStatus)}/>}
      />

      <TriggerRail triggers={review.triggers || []}/>

      {review.isLaunched && (
        <div style={{
          padding: '14px 20px', borderRadius: 12,
          background: 'rgba(46,168,106,0.12)', border: '1px solid rgba(46,168,106,0.35)',
          color: 'var(--zm-success)', fontWeight: 750, fontSize: 15,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          🚀 <span>This site has been <strong>LAUNCHED</strong>
          {review.launchedAt ? ` on ${new Date(review.launchedAt).toLocaleDateString('en-IN')}` : ''}.
          All approval steps are complete.</span>
        </div>
      )}

      {notice && (
        <div className="zm-glass" style={{
          padding: 14,
          color: notice.startsWith('Could') ? 'var(--zm-danger)' : 'var(--zm-success)',
          fontWeight: 750,
        }}>
          {notice}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 0.8fr)', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <StageCard
            eyebrow="Stage 1"
            title="Property readiness"
            done={Boolean(review.stageOneCompletedAt)}
            unlocked={stageOneUnlocked}
            footer={saveButton(
              'Save Stage 1',
              saveOne,
              !stageOneUnlocked || stageOne.communicationFloated == null,
              'stage-one',
            )}
          >
            {!stageOneUnlocked ? (
              <LockedNotice>Finance / CA approval with an active CA code is required before NSO can start.</LockedNotice>
            ) : (
              <div style={{ display: 'grid', gap: 16 }}>
                <div>
                  <FieldLabel>CA code</FieldLabel>
                  <input value={review.caCode || ''} readOnly style={inputStyle(true)}/>
                </div>
                <div>
                  <FieldLabel>Property details</FieldLabel>
                  <PropertySnapshotPanel snapshot={review.propertySnapshot} />
                </div>
                <div>
                  <FieldLabel>Communication floated</FieldLabel>
                  <BoolToggle
                    value={stageOne.communicationFloated}
                    onChange={(value) => {
                      setDirty(true);
                      setStageOne((prev) => ({ ...prev, communicationFloated: value }));
                    }}
                  />
                </div>
              </div>
            )}
          </StageCard>

          <StageCard
            eyebrow="Stage 2"
            title="License status"
            done={stageTwoDone}
            unlocked={stageTwoUnlocked}
          >
            {!stageTwoUnlocked ? (
              <LockedNotice>Stage 2 unlocks after Stage 1 is complete and the Project initiation date is approved.</LockedNotice>
            ) : (
              <LegalLicenseSnapshotPanel snapshot={review.legalLicensingSnapshot} />
            )}
          </StageCard>

          <StageCard
            eyebrow="Stage 3"
            title="Launch readiness"
            done={Boolean(review.stageThreeCompletedAt)}
            unlocked={stageThreeUnlocked}
            footer={saveButton('Save Stage 3', saveThree, !stageThreeUnlocked, 'stage-three')}
          >
            {!stageThreeUnlocked ? (
              <LockedNotice>Stage 3 unlocks after Legal Licensing is complete and Project has reached completion.</LockedNotice>
            ) : (
              <div style={{ display: 'grid', gap: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <FieldLabel>Dry stock order</FieldLabel>
                    <select
                      value={stageThree.dryStockOrderStatus}
                      onChange={(e) => {
                        setDirty(true);
                        setStageThree((prev) => ({ ...prev, dryStockOrderStatus: e.target.value }));
                      }}
                      style={inputStyle(false)}
                    >
                      <option value="pending">Pending</option>
                      <option value="ordered">Ordered</option>
                      <option value="received">Received</option>
                    </select>
                  </div>
                  <div>
                    <FieldLabel>Online delivery</FieldLabel>
                    <select
                      value={stageThree.onlineDeliveryStatus}
                      onChange={(e) => {
                        setDirty(true);
                        setStageThree((prev) => ({ ...prev, onlineDeliveryStatus: e.target.value }));
                      }}
                      style={inputStyle(false)}
                    >
                      <option value="pending">Pending</option>
                      <option value="ready">Ready</option>
                      <option value="active">Active</option>
                    </select>
                  </div>
                </div>
                <div>
                  <FieldLabel>Handover checklist signed</FieldLabel>
                  <BoolToggle
                    value={stageThree.handoverChecklistSigned}
                    onChange={(value) => {
                      setDirty(true);
                      setStageThree((prev) => ({ ...prev, handoverChecklistSigned: value }));
                    }}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <FieldLabel>Launch date</FieldLabel>
                    <input
                      type="date"
                      value={stageThree.launchDate}
                      onChange={(e) => {
                        setDirty(true);
                        setStageThree((prev) => ({ ...prev, launchDate: e.target.value }));
                      }}
                      style={inputStyle(false)}
                    />
                  </div>
                  <div>
                    <FieldLabel>Launch ready</FieldLabel>
                    <BoolToggle
                      value={stageThree.launchReady}
                      onChange={(value) => {
                        setDirty(true);
                        setStageThree((prev) => ({ ...prev, launchReady: value }));
                      }}
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800 }}>
                    <input
                      type="checkbox"
                      checked={stageThree.finalApprovalSignoff1}
                      onChange={(e) => {
                        setDirty(true);
                        setStageThree((prev) => ({ ...prev, finalApprovalSignoff1: e.target.checked }));
                      }}
                    />
                    Final approval sign-off 1
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800 }}>
                    <input
                      type="checkbox"
                      checked={stageThree.finalApprovalSignoff2}
                      onChange={(e) => {
                        setDirty(true);
                        setStageThree((prev) => ({ ...prev, finalApprovalSignoff2: e.target.checked }));
                      }}
                    />
                    Final approval sign-off 2
                  </label>
                </div>
              </div>
            )}
          </StageCard>
        </div>

        <aside className="zm-glass" style={{ borderRadius: 12, padding: 18, position: 'sticky', top: 16 }}>
          <div style={{
            color: 'var(--zm-fg-3)',
            fontSize: 10.5,
            fontWeight: 850,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
          }}>
            Readiness summary
          </div>
          <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
            <div><strong>Finance</strong><br/><span style={{ color: 'var(--zm-fg-3)' }}>{pretty(review.financeStatus)} · CA {review.caCode || 'Pending'}</span></div>
            <div><strong>Project</strong><br/><span style={{ color: 'var(--zm-fg-3)' }}>{pretty(review.projectStatus)} · {pretty(review.projectCurrentStage)}</span></div>
            <div><strong>NSO</strong><br/><span style={{ color: 'var(--zm-fg-3)' }}>{pretty(review.nsoStatus)} · {pretty(review.currentStage)}</span></div>
          </div>
          <button
            type="button"
            onClick={approveFinal}
            disabled={!finalUnlocked || Boolean(busy)}
            style={{
              width: '100%',
              height: 40,
              marginTop: 18,
              border: 'none',
              borderRadius: 9,
              background: finalUnlocked ? 'var(--zm-success)' : 'var(--zm-surface-2)',
              color: finalUnlocked ? '#fff' : 'var(--zm-fg-3)',
              cursor: finalUnlocked && !busy ? 'pointer' : 'not-allowed',
              fontFamily: 'var(--zm-font-body)',
              fontWeight: 900,
            }}
          >
            {busy === 'final' ? 'Finalising...' : 'Final approval'}
          </button>
        </aside>
      </div>

      <button
        type="button"
        onClick={() => navigate(ROUTES.NSO)}
        style={{
          alignSelf: 'flex-start',
          height: 36,
          padding: '0 14px',
          borderRadius: 7,
          border: '1px solid var(--zm-line)',
          background: 'var(--zm-surface)',
          color: 'var(--zm-fg)',
          fontFamily: 'var(--zm-font-body)',
          fontWeight: 800,
          cursor: 'pointer',
        }}
      >
        ← Back to NSO queue
      </button>
    </div>
  );
}
