import React from 'react';
import PageHeader, { HeaderTag } from '../page-header/PageHeader.jsx';
import Icon from '../primitives/Icon.jsx';
import { usePageContext } from '../../../App.jsx';
import { useSession } from '../../../state/SessionContext.jsx';

function yesNoTone(value, active) {
  if (!active) {
    return {
      border: 'var(--zm-line)',
      bg: 'var(--zm-surface)',
      color: 'var(--zm-fg-2)',
      mark: 'var(--zm-line-strong)',
    };
  }
  if (value === 'yes') {
    return {
      border: 'var(--zm-success)',
      bg: 'var(--zm-success-soft)',
      color: 'var(--zm-success)',
      mark: 'var(--zm-success)',
    };
  }
  return {
    border: 'var(--zm-danger)',
    bg: 'var(--zm-danger-soft)',
    color: 'var(--zm-danger)',
    mark: 'var(--zm-danger)',
  };
}

function roleLabel(role) {
  if (role === 'supervisor') return 'Supervisor';
  if (role === 'business_admin') return 'Business admin';
  return 'Executive';
}

// Stage chip for the staged-checklist workflow (migration 202605272).
// Three colour-coded states: draft (neutral) · pending review (warm) ·
// published (success). Missing/unknown values render as published.
function StageBadge({ stage }) {
  const value = stage || 'published';
  const tone = (() => {
    if (value === 'draft') return {
      bg: 'var(--zm-surface-2)',
      color: 'var(--zm-fg-2)',
      border: 'var(--zm-line-strong)',
      label: 'Draft',
    };
    if (value === 'pending_review') return {
      bg: 'var(--zm-warning-soft)',
      color: 'var(--zm-copper)',
      border: 'var(--zm-copper-line)',
      label: 'Pending review',
    };
    return {
      bg: 'var(--zm-success-soft)',
      color: 'var(--zm-success)',
      border: 'var(--zm-success)',
      label: 'Published',
    };
  })();
  return (
    <span
      title={`Workflow stage · ${tone.label}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 26,
        padding: '0 10px',
        borderRadius: 999,
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        color: tone.color,
        fontFamily: 'var(--zm-font-body)',
        fontSize: 10.5,
        fontWeight: 800,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {tone.label}
    </span>
  );
}

function StatusCheckbox({ value, checked, onChange }) {
  const tone = yesNoTone(value, checked);
  const label = value === 'yes' ? 'Yes' : 'No';
  return (
    <label
      className="zm-pill"
      style={{
        minWidth: 82,
        height: 34,
        padding: '0 12px',
        border: `1px solid ${tone.border}`,
        borderRadius: 8,
        background: tone.bg,
        color: tone.color,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        fontFamily: 'var(--zm-font-body)',
        fontSize: 12.5,
        fontWeight: 700,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        style={{
          appearance: 'none',
          width: 13,
          height: 13,
          borderRadius: 3,
          border: `1.5px solid ${tone.mark}`,
          background: checked ? tone.mark : 'transparent',
          boxShadow: checked ? 'inset 0 0 0 2px var(--zm-surface)' : 'none',
          flex: '0 0 auto',
        }}
      />
      {label}
    </label>
  );
}

function ChecklistRow({ no, label, status, onStatus, children }) {
  return (
    <div
      className="zm-row checklist-row"
      style={{
        display: 'grid',
        gridTemplateColumns: '48px minmax(180px, 1fr) 184px',
        alignItems: 'center',
        gap: 14,
        padding: '14px 16px',
        borderBottom: '1px solid var(--zm-line-faint)',
        background: status === 'no' ? 'color-mix(in srgb, var(--zm-danger-soft) 34%, transparent)' : 'transparent',
      }}
    >
      <span
        style={{
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
        }}
      >
        {String(no).padStart(2, '0')}
      </span>

      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {children || (
          <span
            style={{
              fontFamily: 'var(--zm-font-body)',
              fontSize: 14,
              fontWeight: 650,
              color: 'var(--zm-fg)',
              overflowWrap: 'anywhere',
            }}
          >
            {label}
          </span>
        )}
        <span
          style={{
            fontFamily: 'var(--zm-font-mono)',
            fontSize: 10.5,
            color: status ? (status === 'yes' ? 'var(--zm-success)' : 'var(--zm-danger)') : 'var(--zm-fg-4)',
            textTransform: 'uppercase',
          }}
        >
          {status ? `Marked ${status}` : 'Awaiting yes / no'}
        </span>
      </div>

      <div className="checklist-status" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        <StatusCheckbox
          value="yes"
          checked={status === 'yes'}
          onChange={() => onStatus(status === 'yes' ? null : 'yes')}
        />
        <StatusCheckbox
          value="no"
          checked={status === 'no'}
          onChange={() => onStatus(status === 'no' ? null : 'no')}
        />
      </div>
    </div>
  );
}

function SummaryStat({ label, value, tone = 'default' }) {
  const color =
    tone === 'good' ? 'var(--zm-success)' :
    tone === 'bad' ? 'var(--zm-danger)' :
    tone === 'accent' ? 'var(--zm-accent)' :
    'var(--zm-fg)';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 5,
      padding: '12px 14px', borderRadius: 8,
      background: 'var(--zm-surface-2)', border: '1px solid var(--zm-line)',
    }}>
      <span style={{
        fontFamily: 'var(--zm-font-body)', fontSize: 9.5, fontWeight: 800,
        letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: 'var(--zm-font-mono)', fontSize: 24, lineHeight: 1,
        fontWeight: 700, color,
      }}>
        {value}
      </span>
    </div>
  );
}

function ContextPanel({
  site, trail, complete, issueCount, totalChecks, moduleShort,
  canSubmit, submitBlockedText, onSave, onSubmit, saving, submitting,
  stage, canSubmitForReview, onSubmitForReview, submittingForReview,
}) {
  const ready = canSubmit && complete === totalChecks && totalChecks > 0 && !submitting;

  return (
    <aside
      className="zm-glass checklist-summary"
      style={{
        borderRadius: 12,
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        minWidth: 260,
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: site.iconBg || 'var(--zm-plum-soft)',
          color: site.iconColor || 'var(--zm-plum)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flex: '0 0 auto',
        }}>
          <Icon name={site.icon || 'shield'} size={20}/>
        </div>
        <div style={{ minWidth: 0 }}>
          <h2 style={{
            margin: 0, fontFamily: 'var(--zm-font-display)',
            fontSize: 16, lineHeight: 1.2, color: 'var(--zm-fg)',
          }}>
            {site.name}
          </h2>
          <p style={{
            margin: '4px 0 0', fontFamily: 'var(--zm-font-mono)',
            fontSize: 11, color: 'var(--zm-fg-3)',
          }}>
            {site.code} / {site.city}
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <SummaryStat label="Marked" value={`${complete}/${totalChecks}`} tone="accent"/>
        <SummaryStat label="No flags" value={issueCount} tone={issueCount ? 'bad' : 'good'}/>
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 10,
        padding: 12, borderRadius: 8, border: '1px solid var(--zm-line)',
        background: 'var(--zm-surface)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{
            fontFamily: 'var(--zm-font-body)', fontSize: 10, fontWeight: 800,
            letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--zm-fg-3)',
          }}>
            Review trail
          </span>
          <StageBadge stage={stage}/>
        </div>
        {trail.map(([label, value], index) => (
          <div key={label} style={{ display: 'grid', gridTemplateColumns: '20px 1fr', gap: 9, alignItems: 'start' }}>
            <span style={{
              width: 9, height: 9, marginTop: 4, borderRadius: 999,
              background: index === 0 ? 'var(--zm-success)' : index === 1 ? (site.iconColor || 'var(--zm-plum)') : 'var(--zm-line-strong)',
              boxShadow: index === 1 ? `0 0 0 4px ${site.iconBg || 'var(--zm-plum-soft)'}` : 'none',
            }}/>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 12.5, fontWeight: 700, color: 'var(--zm-fg)' }}>{label}</span>
              <span style={{ fontFamily: 'var(--zm-font-mono)', fontSize: 10.5, color: 'var(--zm-fg-3)' }}>{value}</span>
            </div>
          </div>
        ))}
      </div>

      {!canSubmit && (
        <div style={{
          padding: 10, borderRadius: 8,
          background: 'var(--zm-warning-soft)',
          border: '1px solid var(--zm-copper-line)',
          fontFamily: 'var(--zm-font-body)', fontSize: 12,
          lineHeight: 1.45, color: 'var(--zm-fg-2)',
        }}>
          {submitBlockedText}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          className="zm-btn"
          onClick={onSave}
          disabled={saving}
          style={{
            height: 38, borderRadius: 8, border: '1px solid var(--zm-line)',
            background: 'var(--zm-surface)', color: 'var(--zm-fg)',
            fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 700,
            cursor: saving ? 'wait' : 'pointer',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Saving…' : `Save ${moduleShort} draft`}
        </button>
        {canSubmitForReview && (
          <button
            type="button"
            onClick={onSubmitForReview}
            disabled={submittingForReview}
            style={{
              height: 40, borderRadius: 8, border: 'none',
              background: submittingForReview ? 'var(--zm-surface-sunken)' : 'var(--zm-accent)',
              color: submittingForReview ? 'var(--zm-fg-4)' : '#fff',
              fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 800,
              cursor: submittingForReview ? 'wait' : 'pointer',
              boxShadow: submittingForReview ? 'none' : 'var(--zm-shadow-1)',
            }}
          >
            {submittingForReview
              ? `Submitting ${moduleShort} for review…`
              : `Submit ${moduleShort} for review`}
          </button>
        )}
        {canSubmit && (
          <button
            className="zm-btn-primary"
            disabled={!ready}
            onClick={onSubmit}
            style={{
              height: 40, borderRadius: 8, border: 'none',
              background: ready ? 'var(--zm-accent)' : 'var(--zm-surface-sunken)',
              color: ready ? '#fff' : 'var(--zm-fg-4)',
              fontFamily: 'var(--zm-font-body)', fontSize: 13, fontWeight: 800,
              cursor: ready ? 'pointer' : 'not-allowed',
              boxShadow: ready ? 'var(--zm-shadow-1)' : 'none',
            }}
          >
            {submitting ? `Submitting ${moduleShort}…` : `Submit ${moduleShort}`}
          </button>
        )}
      </div>
    </aside>
  );
}

export default function ModuleChecklistPage({
  checks,
  site,
  meta,
  trail,
  header,
  tableLabel,
  moduleShort,
  moduleName,
  handoffText,
  otherPlaceholder,
  otherTitle,
  otherDescription,
  // Controlled state (optional). When provided, parent owns the values; useful
  // for pages that hydrate from a server response (e.g. DdrPage / LicensingPage).
  initialCoreStatuses,
  initialOtherRows,
  // Real action handlers — receive ({ coreStatuses, otherRows, issueCount,
  // complete, totalChecks }). When omitted we fall back to a local toast so the
  // checklist remains usable in mock previews.
  onSave,
  onSubmit,
  saving = false,
  submitting = false,
  // Max number of free-form "Other" rows. Defaults to 2 to match the DB
  // (legal_dd_checklist exposes only other_1 + other_2).
  maxOtherRows = 2,
  // Staging workflow (migration 202605272). Missing values mean the slice
  // isn't wired yet for this caller — fall back to 'published' so existing
  // checklists render unchanged.
  stage = 'published',
  onSubmitForReview,
  submittingForReview = false,
}) {
  const { showToast } = usePageContext();
  const { role, session } = useSession();
  const canSubmit = role === 'supervisor';
  // Executives may only request review while their draft is live, and only
  // if the parent has wired the handler (legacy pages get no button).
  const canSubmitForReview = !!onSubmitForReview && role === 'executive' && stage === 'draft';
  const [coreStatuses, setCoreStatuses] = React.useState(() =>
    checks.reduce((acc, item) => ({ ...acc, [item.id]: initialCoreStatuses?.[item.id] ?? null }), {})
  );
  const [otherRows, setOtherRows] = React.useState(() => initialOtherRows || []);

  // Re-sync when the parent swaps in server-loaded data.
  React.useEffect(() => {
    if (!initialCoreStatuses) return;
    setCoreStatuses(checks.reduce((acc, item) => ({ ...acc, [item.id]: initialCoreStatuses[item.id] ?? null }), {}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCoreStatuses]);

  React.useEffect(() => {
    if (initialOtherRows) setOtherRows(initialOtherRows);
  }, [initialOtherRows]);

  const setCoreStatus = (id, value) => {
    setCoreStatuses((prev) => ({ ...prev, [id]: value }));
  };

  const addOtherRow = () => {
    setOtherRows((rows) => {
      if (rows.length >= maxOtherRows) return rows;
      return [
        ...rows,
        { id: `other-${Date.now()}-${rows.length}`, label: '', status: null },
      ];
    });
  };

  const updateOtherRow = (id, patch) => {
    setOtherRows((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  };

  const removeOtherRow = (id) => {
    setOtherRows((rows) => rows.filter((row) => row.id !== id));
  };

  const activeOtherRows = otherRows.filter((row) => row.label.trim().length > 0);
  const totalChecks = checks.length + activeOtherRows.length;
  const completeCore = checks.filter((item) => coreStatuses[item.id]).length;
  const completeOther = activeOtherRows.filter((row) => row.status).length;
  const complete = completeCore + completeOther;
  const issueCount =
    Object.values(coreStatuses).filter((value) => value === 'no').length +
    activeOtherRows.filter((row) => row.status === 'no').length;

  const snapshot = () => ({
    coreStatuses,
    otherRows: activeOtherRows,
    complete,
    totalChecks,
    issueCount,
  });

  const saveDraft = () => {
    if (onSave) {
      onSave(snapshot());
      return;
    }
    showToast?.(`${moduleShort} draft saved locally for ${site.code}.`);
  };

  const submitReview = () => {
    if (onSubmit) {
      onSubmit(snapshot());
      return;
    }
    const message = issueCount
      ? `${moduleShort} submitted with ${issueCount} no flag${issueCount === 1 ? '' : 's'}.`
      : `${moduleShort} submitted with all checks marked yes.`;
    showToast?.(message, issueCount ? 'danger' : 'success');
  };

  const submitForReview = () => {
    if (!onSubmitForReview) return;
    onSubmitForReview(snapshot());
  };

  const currentModule = session?.module || moduleName;
  const otherRowsExhausted = otherRows.length >= maxOtherRows;

  return (
    <div className="checklist-page" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <style>{`
        @media (max-width: 860px) {
          .zm-sidebar {
            display: none !important;
          }
          .zm-app-main {
            padding: 18px 16px 48px !important;
          }
          .checklist-page header {
            align-items: flex-start !important;
            flex-direction: column !important;
            gap: 14px !important;
          }
          .checklist-page header h1 {
            font-size: 34px !important;
            line-height: 0.98 !important;
          }
        }

        @media (max-width: 1180px) {
          .checklist-shell {
            display: flex !important;
            flex-wrap: wrap !important;
          }
          .checklist-main {
            flex: 1 1 620px !important;
          }
          .checklist-summary {
            position: static !important;
            flex: 1 1 280px !important;
            align-self: stretch !important;
          }
        }

        @media (max-width: 760px) {
          .checklist-meta {
            grid-template-columns: 1fr !important;
          }
          .checklist-table-head,
          .checklist-row {
            grid-template-columns: 40px minmax(0, 1fr) !important;
          }
          .checklist-table-head .checklist-status-head {
            display: none !important;
          }
          .checklist-status {
            grid-column: 2 !important;
            justify-content: flex-start !important;
          }
        }
      `}</style>
      <PageHeader
        file={header.file}
        eyebrow={header.eyebrow}
        title={header.title}
        lede={header.lede}
        right={(
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <StageBadge stage={stage}/>
            <HeaderTag icon={header.tagIcon || site.icon || 'shield'} label={site.stage}/>
          </div>
        )}
      />

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto', gap: 12,
        padding: '10px 12px', borderRadius: 10,
        border: '1px solid var(--zm-line)', background: 'var(--zm-surface)',
      }}>
        <span style={{
          fontFamily: 'var(--zm-font-body)', fontSize: 12.5, lineHeight: 1.45,
          color: 'var(--zm-fg-2)',
        }}>
          {roleLabel(role)} access in the {currentModule} module. {handoffText}
        </span>
        <HeaderTag icon="user" label={roleLabel(role)}/>
      </div>

      <div
        className="checklist-shell"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 300px',
          gap: 18,
          alignItems: 'start',
        }}
      >
        <section className="checklist-main" style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div
            className="checklist-meta"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 10,
            }}
          >
            {meta.map(([label, value]) => (
              <div
                key={label}
                style={{
                  minWidth: 0,
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: '1px solid var(--zm-line)',
                  background: 'var(--zm-surface)',
                  boxShadow: 'var(--zm-shadow-1)',
                }}
              >
                <span style={{
                  display: 'block', marginBottom: 5,
                  fontFamily: 'var(--zm-font-body)', fontSize: 9.5, fontWeight: 800,
                  letterSpacing: '0.14em', textTransform: 'uppercase',
                  color: 'var(--zm-fg-3)',
                }}>
                  {label}
                </span>
                <span style={{
                  display: 'block',
                  fontFamily: label.toLowerCase().includes('date') ? 'var(--zm-font-mono)' : 'var(--zm-font-body)',
                  fontSize: 13, fontWeight: 700, color: 'var(--zm-fg)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {value}
                </span>
              </div>
            ))}
          </div>

          <div className="zm-glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
            <div
              className="checklist-table-head"
              style={{
                display: 'grid',
                gridTemplateColumns: '48px minmax(180px, 1fr) 184px',
                alignItems: 'center',
                gap: 14,
                padding: '12px 16px',
                background: 'var(--zm-surface-2)',
                borderBottom: '1px solid var(--zm-line)',
                fontFamily: 'var(--zm-font-body)',
                fontWeight: 800,
                fontSize: 10.5,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--zm-fg-3)',
              }}
            >
              <span>No.</span>
              <span>{tableLabel}</span>
              <span className="checklist-status-head" style={{ textAlign: 'right' }}>Status</span>
            </div>

            <div className="zm-stagger">
              {checks.map((item, index) => (
                <ChecklistRow
                  key={item.id}
                  no={index + 1}
                  label={item.label}
                  status={coreStatuses[item.id]}
                  onStatus={(value) => setCoreStatus(item.id, value)}
                />
              ))}

              {otherRows.map((row, index) => (
                <ChecklistRow
                  key={row.id}
                  no={checks.length + index + 1}
                  status={row.status}
                  onStatus={(value) => updateOtherRow(row.id, { status: value })}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <input
                      value={row.label}
                      onChange={(event) => updateOtherRow(row.id, { label: event.target.value })}
                      placeholder={otherPlaceholder}
                      aria-label={otherPlaceholder}
                      style={{
                        flex: 1,
                        minWidth: 140,
                        height: 34,
                        padding: '0 10px',
                        border: '1px solid var(--zm-line)',
                        borderRadius: 7,
                        background: 'var(--zm-bg)',
                        color: 'var(--zm-fg)',
                        fontFamily: 'var(--zm-font-body)',
                        fontSize: 13.5,
                        fontWeight: 650,
                      }}
                    />
                    <button
                      type="button"
                      className="zm-icon-btn"
                      onClick={() => removeOtherRow(row.id)}
                      title="Remove other field"
                      style={{
                        width: 32,
                        height: 32,
                        border: '1px solid var(--zm-line)',
                        borderRadius: 7,
                        background: 'transparent',
                        color: 'var(--zm-fg-3)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        flex: '0 0 auto',
                      }}
                    >
                      <Icon name="x" size={13}/>
                    </button>
                  </div>
                </ChecklistRow>
              ))}
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '14px 16px',
              background: 'var(--zm-surface)',
            }}>
              <div style={{ minWidth: 0 }}>
                <span style={{
                  display: 'block',
                  fontFamily: 'var(--zm-font-body)',
                  fontSize: 12.5,
                  fontWeight: 750,
                  color: 'var(--zm-fg)',
                }}>
                  {otherTitle}
                </span>
                <span style={{
                  display: 'block',
                  marginTop: 2,
                  fontFamily: 'var(--zm-font-body)',
                  fontSize: 11.5,
                  color: 'var(--zm-fg-3)',
                }}>
                  {otherDescription}
                </span>
              </div>
              <button
                className="zm-btn-primary"
                type="button"
                onClick={addOtherRow}
                disabled={otherRowsExhausted}
                title={otherRowsExhausted ? `Up to ${maxOtherRows} other rows allowed` : undefined}
                style={{
                  height: 36,
                  padding: '0 14px',
                  border: 'none',
                  borderRadius: 8,
                  background: otherRowsExhausted ? 'var(--zm-surface-sunken)' : 'var(--zm-accent)',
                  color: otherRowsExhausted ? 'var(--zm-fg-4)' : '#fff',
                  fontFamily: 'var(--zm-font-body)',
                  fontSize: 12.5,
                  fontWeight: 800,
                  cursor: otherRowsExhausted ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  whiteSpace: 'nowrap',
                  boxShadow: otherRowsExhausted ? 'none' : 'var(--zm-shadow-1)',
                }}
              >
                <Icon name="plus" size={14}/>
                Add other
              </button>
            </div>
          </div>
        </section>

        <ContextPanel
          site={site}
          trail={trail}
          complete={complete}
          issueCount={issueCount}
          totalChecks={totalChecks}
          moduleShort={moduleShort}
          canSubmit={canSubmit}
          submitBlockedText={`${roleLabel(role)}s can save checklist items. Final submission stays with the module supervisor.`}
          onSave={saveDraft}
          onSubmit={submitReview}
          saving={saving}
          submitting={submitting}
          stage={stage}
          canSubmitForReview={canSubmitForReview}
          onSubmitForReview={submitForReview}
          submittingForReview={submittingForReview}
        />
      </div>
    </div>
  );
}
