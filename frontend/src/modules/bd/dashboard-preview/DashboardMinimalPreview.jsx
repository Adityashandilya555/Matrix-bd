import React from 'react';
import Icon from '../../shared/primitives/Icon.jsx';

const FLOW_STAGES = [
  { id: 'loi', label: 'BD LOI Signed', icon: 'file' },
  { id: 'legal', label: 'Legal & Compliance', icon: 'shield' },
  { id: 'commercial', label: 'CA / Commercial Code', icon: 'rupee' },
  { id: 'design', label: 'Design / Technical', icon: 'grid' },
  { id: 'project', label: 'Project Execution', icon: 'box' },
  { id: 'final', label: 'Final Approval', icon: 'check' },
];

const STAGE_INDEX = FLOW_STAGES.reduce((acc, stage, index) => {
  acc[stage.id] = index;
  return acc;
}, {});

const SITES = [
  {
    id: 'site-commercial-code',
    code: 'BT-MUM-0140',
    name: 'Andheri - Lokhandwala',
    city: 'Mumbai',
    stage: 'commercial',
    owner: 'Commercial team',
    nextAction: 'CA code is pending',
    blocker: 'Legal is clear. Commercial code must be added before Design can start.',
    unlock: 'Add commercial code and payment handoff details.',
    cta: 'Open CA code',
    priority: 'Needs action',
    payment: 'Locked',
    summary: 'Ready for commercial validation',
    modules: { legal: 'Complete', agreement: 'Registered', licensing: 'Complete', payment: 'Locked' },
  },
  {
    id: 'site-legal-review',
    code: 'BT-BLR-0209',
    name: 'Koramangala 6th Block',
    city: 'Bengaluru',
    stage: 'legal',
    owner: 'Legal supervisor',
    nextAction: 'Complete DDR review',
    blocker: 'Two DDR fields still need a Yes or No decision.',
    unlock: 'Publish a positive DDR or reject the site.',
    cta: 'Open DDR',
    priority: 'In process',
    payment: 'Locked',
    summary: 'Legal review in progress',
    modules: { legal: 'Pending', agreement: 'Queued', licensing: 'Queued', payment: 'Locked' },
  },
  {
    id: 'site-payment-ready',
    code: 'BT-DEL-0091',
    name: 'Saket M-Block - L13',
    city: 'New Delhi',
    stage: 'final',
    complete: true,
    owner: 'Payment supervisor',
    nextAction: 'Open payment module',
    blocker: 'Legal approved this site. Finance can begin payment handoff.',
    unlock: 'Payment module is available.',
    cta: 'Open Payment',
    priority: 'Ready for payment',
    payment: 'Ready',
    summary: 'Ready for finance',
    modules: { legal: 'Complete', agreement: 'Registered', licensing: 'Complete', payment: 'Ready' },
  },
];

const KPI_ITEMS = [
  { label: 'Sites in flow', value: '05', icon: 'activity', tone: 'teal' },
  { label: 'Needs action', value: '03', icon: 'alert', tone: 'amber' },
  { label: 'Ready for payment', value: '01', icon: 'rupee', tone: 'green' },
];

function getStageState(site, stageId) {
  const current = STAGE_INDEX[site.stage] ?? 0;
  const stage = STAGE_INDEX[stageId] ?? 0;
  if (site.complete && stage <= current) return 'done';
  if (stage < current) return 'done';
  if (stage === current) return 'active';
  return 'queued';
}

function stageStatusLabel(state, stageId) {
  if (state === 'done') return 'Done';
  if (state === 'active') return stageId === 'legal' ? 'Open' : 'Pending';
  return 'Queued';
}

function statusTone(value) {
  const normalized = String(value || '').toLowerCase();
  if (['complete', 'registered'].includes(normalized)) return 'done';
  if (normalized === 'ready') return 'ready';
  if (['pending', 'in process', 'partial'].includes(normalized)) return 'active';
  return 'queued';
}

function AvatarMark({ icon, tone = 'teal', size = 34 }) {
  return (
    <span className={`mdp-avatar tone-${tone}`} style={{ width: size, height: size }}>
      <Icon name={icon} size={Math.max(13, Math.floor(size * 0.42))}/>
    </span>
  );
}

function TopAction({ icon, label, tone = 'teal' }) {
  return (
    <button type="button" className={`mdp-action tone-${tone}`}>
      <AvatarMark icon={icon} tone={tone} size={24}/>
      <span>{label}</span>
    </button>
  );
}

function KpiCard({ item }) {
  return (
    <article className="mdp-kpi">
      <AvatarMark icon={item.icon} tone={item.tone} size={36}/>
      <div>
        <strong>{item.value}</strong>
        <span>{item.label}</span>
      </div>
    </article>
  );
}

function Legend() {
  return (
    <div className="mdp-legend" aria-label="Stage state legend">
      <span><i className="done"/>Done</span>
      <span><i className="active"/>In process</span>
      <span><i className="queued"/>Queued</span>
    </div>
  );
}

function ProcessRail({ site }) {
  return (
    <div className="mdp-process" aria-label={`${site.name} process flow`}>
      {FLOW_STAGES.map((stage, index) => {
        const state = getStageState(site, stage.id);
        const title = state === 'queued'
          ? `${stage.label} unlocks after earlier steps are complete`
          : `${stage.label}: ${stageStatusLabel(state, stage.id)}`;
        return (
          <React.Fragment key={stage.id}>
            <button
              type="button"
              className={`mdp-stage ${state}`}
              title={title}
              aria-current={state === 'active' ? 'step' : undefined}
            >
              <Icon name={stage.icon} size={18}/>
              <span className="mdp-stage-label">{stage.label}</span>
              <span className="mdp-stage-status">{stageStatusLabel(state, stage.id)}</span>
            </button>
            {index < FLOW_STAGES.length - 1 && (
              <span className={`mdp-connector ${getStageState(site, FLOW_STAGES[index + 1].id) === 'done' ? 'done' : ''}`}/>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function NextActionPanel({ site }) {
  return (
    <section className="mdp-panel mdp-next">
      <div className="mdp-next-main">
        <span className="mdp-eyebrow">Next action</span>
        <h2>{site.nextAction}</h2>
        <p>{site.blocker}</p>
        <div className="mdp-meta-row">
          <span><Icon name="pin" size={13}/>{site.code} · {site.city}</span>
          <span><Icon name="user" size={13}/>{site.owner}</span>
        </div>
      </div>
      <button type="button" className="mdp-primary-btn">
        {site.cta}
        <Icon name="arrow" size={14}/>
      </button>
    </section>
  );
}

function PaymentReadiness({ onSelectReady }) {
  const readySite = SITES.find((site) => site.payment === 'Ready');
  const lockedCount = SITES.filter((site) => site.payment === 'Locked').length;
  return (
    <section className="mdp-payment-strip" aria-label="Payment readiness">
      <div>
        <span className="mdp-eyebrow">Payment readiness</span>
        <strong>{readySite ? '1 site ready for Payment' : 'Payment locked'}</strong>
        <p>{lockedCount} sites still need licensing or downstream handoff before Payment opens.</p>
      </div>
      <button type="button" className="mdp-secondary-btn" onClick={() => readySite && onSelectReady(readySite)}>
        <AvatarMark icon="rupee" tone="green" size={24}/>
        View ready site
      </button>
    </section>
  );
}

function SiteRow({ site, selected, onSelect }) {
  const state = getStageState(site, site.stage);
  return (
    <button
      type="button"
      className={`mdp-site-row ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(site)}
    >
      <AvatarMark icon={site.payment === 'Ready' ? 'rupee' : 'pin'} tone={site.payment === 'Ready' ? 'green' : state === 'active' ? 'amber' : 'teal'} size={32}/>
      <span className="mdp-site-id">
        <strong>{site.name}</strong>
        <small>{site.code} · {site.city}</small>
      </span>
      <span className={`mdp-chip ${site.payment === 'Ready' ? 'ready' : state}`}>
        {site.priority}
      </span>
      <span className="mdp-site-next">{site.summary}</span>
    </button>
  );
}

function StatusItem({ label, value }) {
  return (
    <div className="mdp-status-item">
      <span className={`mdp-status-dot ${statusTone(value)}`}/>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SelectedSiteSummary({ site }) {
  return (
    <section className="mdp-panel mdp-summary">
      <div className="mdp-summary-head">
        <div>
          <span className="mdp-eyebrow">Selected site</span>
          <h2>{site.name}</h2>
          <p>{site.code} · {site.city} · {site.owner}</p>
        </div>
        <span className={`mdp-chip ${site.payment === 'Ready' ? 'ready' : 'active'}`}>{site.priority}</span>
      </div>
      <div className="mdp-summary-grid">
        <div>
          <span>Blocker</span>
          <strong>{site.blocker}</strong>
        </div>
        <div>
          <span>Unlock condition</span>
          <strong>{site.unlock}</strong>
        </div>
      </div>
      <div className="mdp-status-row">
        <StatusItem label="Legal" value={site.modules.legal}/>
        <StatusItem label="Agreement" value={site.modules.agreement}/>
        <StatusItem label="Licensing" value={site.modules.licensing}/>
        <StatusItem label="Payment" value={site.modules.payment}/>
      </div>
    </section>
  );
}

export default function DashboardMinimalPreview() {
  const [activeSite, setActiveSite] = React.useState(SITES[0]);

  return (
    <div className="minimal-dashboard-preview">
      <PreviewStyles/>

      <section className="mdp-hero">
        <div>
          <span className="mdp-page-label">Supervisor workspace</span>
          <h1>Welcome back, Riya</h1>
          <p>Three sites need movement. Start with the step blocking the next handoff.</p>
        </div>
        <div className="mdp-actions">
          <TopAction icon="plus" label="New pipeline" tone="teal"/>
          <TopAction icon="activity" label="Sites in process flow" tone="amber"/>
          <TopAction icon="rupee" label="Payment ready" tone="green"/>
        </div>
      </section>

      <section className="mdp-kpi-strip" aria-label="Supervisor KPIs">
        {KPI_ITEMS.map((item) => <KpiCard key={item.label} item={item}/>)}
      </section>

      <NextActionPanel site={activeSite}/>

      <section className="mdp-panel mdp-flow-panel">
        <div className="mdp-rail-head">
          <div>
            <span className="mdp-eyebrow">Process flow</span>
            <h2>{activeSite.name}</h2>
          </div>
          <Legend/>
        </div>
        <ProcessRail site={activeSite}/>
      </section>

      <PaymentReadiness onSelectReady={setActiveSite}/>

      <div className="mdp-lower-grid">
        <section className="mdp-panel mdp-sites">
          <div className="mdp-section-head">
            <div>
              <span className="mdp-eyebrow">Priority sites</span>
              <h2>Only what needs attention</h2>
            </div>
            <span className="mdp-chip queued">Preview data</span>
          </div>
          <div className="mdp-site-list">
            {SITES.map((site) => (
              <SiteRow
                key={site.id}
                site={site}
                selected={site.id === activeSite.id}
                onSelect={setActiveSite}
              />
            ))}
          </div>
        </section>
        <SelectedSiteSummary site={activeSite}/>
      </div>
    </div>
  );
}

function PreviewStyles() {
  return (
    <style>{`
      @keyframes mdp-enter {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      body:has(.minimal-dashboard-preview) .zm-brand-word {
        color: transparent !important;
        text-shadow: none !important;
      }

      body:has(.minimal-dashboard-preview) .zm-brand-word::after {
        content: "Scale";
        position: absolute;
        inset: 0 auto auto 0;
        color: #F5F2EC;
        font: inherit;
        text-shadow: 0 1px 0 rgba(0,0,0,0.35), 0 0 24px rgba(122,231,218,0.15);
      }

      .minimal-dashboard-preview {
        --mdp-bg: #F7F5EF;
        --mdp-surface: #FFFDF8;
        --mdp-soft: #FAF8F1;
        --mdp-line: rgba(35, 39, 43, 0.09);
        --mdp-line-strong: rgba(35, 39, 43, 0.16);
        --mdp-text: #20242A;
        --mdp-muted: #65707A;
        --mdp-faint: #969EA6;
        --mdp-teal: #276F68;
        --mdp-teal-soft: #E6F0EE;
        --mdp-green: #48764F;
        --mdp-green-soft: #EDF3EA;
        --mdp-amber: #9A712D;
        --mdp-amber-soft: #FBF2DD;
        color: var(--mdp-text);
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-height: calc(100vh - 128px);
        padding: 0 0 24px;
      }

      .minimal-dashboard-preview::before {
        content: "";
        position: fixed;
        inset: 64px 0 0 var(--zm-sidebar-width, 232px);
        background:
          linear-gradient(rgba(39, 111, 104, 0.035) 1px, transparent 1px),
          linear-gradient(90deg, rgba(39, 111, 104, 0.025) 1px, transparent 1px),
          linear-gradient(180deg, #FAF8F1 0%, #F4F3ED 100%);
        background-size: 48px 48px, 48px 48px, auto;
        pointer-events: none;
        z-index: -1;
      }

      .mdp-hero,
      .mdp-panel,
      .mdp-kpi,
      .mdp-payment-strip {
        animation: mdp-enter 360ms cubic-bezier(0.16, 1, 0.3, 1) both;
      }

      .mdp-hero {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 24px;
        padding: 8px 0 10px;
        border-bottom: 1px solid var(--mdp-line);
      }

      .mdp-page-label,
      .mdp-eyebrow {
        display: block;
        font-family: var(--zm-font-body);
        font-size: 10px;
        font-weight: 850;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--mdp-faint);
      }

      .mdp-hero h1 {
        margin: 7px 0 5px;
        font-family: var(--zm-font-body);
        font-size: clamp(30px, 3.8vw, 46px);
        font-weight: 850;
        line-height: 1.03;
        letter-spacing: -0.04em;
      }

      .mdp-hero p,
      .mdp-next p,
      .mdp-payment-strip p,
      .mdp-summary-head p {
        margin: 0;
        font-family: var(--zm-font-body);
        font-size: 14px;
        line-height: 1.5;
        color: var(--mdp-muted);
      }

      .mdp-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 9px;
      }

      .mdp-action,
      .mdp-primary-btn,
      .mdp-secondary-btn {
        border: 1px solid var(--mdp-line-strong);
        border-radius: 10px;
        background: var(--mdp-surface);
        color: var(--mdp-text);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        height: 40px;
        padding: 0 13px;
        font-family: var(--zm-font-body);
        font-size: 13px;
        font-weight: 800;
        cursor: pointer;
        transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
        white-space: nowrap;
      }

      .mdp-action:hover,
      .mdp-secondary-btn:hover,
      .mdp-site-row:hover,
      .mdp-stage:hover {
        transform: translateY(-1px);
      }

      .mdp-action:active,
      .mdp-primary-btn:active,
      .mdp-secondary-btn:active,
      .mdp-site-row:active,
      .mdp-stage:active {
        transform: scale(0.99);
      }

      .mdp-primary-btn {
        border-color: var(--mdp-teal);
        background: var(--mdp-teal);
        color: #FFFFFF;
      }

      .mdp-secondary-btn {
        background: var(--mdp-soft);
      }

      .mdp-avatar {
        flex: 0 0 auto;
        border-radius: 11px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--mdp-line);
      }

      .tone-teal { background: var(--mdp-teal-soft); color: var(--mdp-teal); border-color: rgba(39, 111, 104, 0.18); }
      .tone-green { background: var(--mdp-green-soft); color: var(--mdp-green); border-color: rgba(72, 118, 79, 0.18); }
      .tone-amber { background: var(--mdp-amber-soft); color: var(--mdp-amber); border-color: rgba(154, 113, 45, 0.18); }

      .mdp-kpi-strip {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }

      .mdp-kpi,
      .mdp-panel,
      .mdp-payment-strip {
        border: 1px solid var(--mdp-line);
        background: color-mix(in srgb, var(--mdp-surface) 97%, transparent);
        box-shadow: 0 10px 32px rgba(31, 36, 43, 0.03);
      }

      .mdp-kpi {
        min-height: 78px;
        border-radius: 12px;
        padding: 13px;
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr);
        gap: 11px;
        align-items: center;
      }

      .mdp-kpi strong {
        display: block;
        font-family: var(--zm-font-mono);
        font-size: 24px;
        line-height: 1;
      }

      .mdp-kpi span {
        display: block;
        margin-top: 4px;
        font-family: var(--zm-font-body);
        font-size: 12px;
        font-weight: 750;
        color: var(--mdp-muted);
      }

      .mdp-panel,
      .mdp-payment-strip {
        border-radius: 14px;
        padding: 16px;
      }

      .mdp-next {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 18px;
      }

      .mdp-next h2,
      .mdp-rail-head h2,
      .mdp-section-head h2,
      .mdp-summary-head h2 {
        margin: 5px 0 5px;
        font-family: var(--zm-font-body);
        color: var(--mdp-text);
        letter-spacing: -0.025em;
      }

      .mdp-next h2 {
        font-size: clamp(24px, 3vw, 34px);
        font-weight: 850;
      }

      .mdp-meta-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }

      .mdp-meta-row span {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 25px;
        padding: 0 10px;
        border-radius: 8px;
        border: 1px solid var(--mdp-line);
        background: var(--mdp-soft);
        color: var(--mdp-muted);
        font-family: var(--zm-font-body);
        font-size: 12px;
        font-weight: 750;
      }

      .mdp-rail-head,
      .mdp-section-head,
      .mdp-summary-head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 14px;
        margin-bottom: 14px;
      }

      .mdp-rail-head h2,
      .mdp-section-head h2,
      .mdp-summary-head h2 {
        font-size: 18px;
        font-weight: 850;
      }

      .mdp-legend {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 10px;
        font-family: var(--zm-font-body);
        font-size: 11px;
        font-weight: 750;
        color: var(--mdp-muted);
      }

      .mdp-legend span {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .mdp-legend i {
        width: 9px;
        height: 9px;
        border-radius: 999px;
        border: 1px solid var(--mdp-line-strong);
      }

      .mdp-legend i.done { background: var(--mdp-green-soft); border-color: rgba(72, 118, 79, 0.3); }
      .mdp-legend i.active { background: var(--mdp-amber-soft); border-color: rgba(154, 113, 45, 0.35); }
      .mdp-legend i.queued { background: #F8F6EF; }

      .mdp-process {
        display: flex;
        align-items: stretch;
        overflow-x: auto;
        padding: 2px 0 4px;
      }

      .mdp-stage,
      .mdp-stage * {
        text-decoration: none !important;
      }

      .mdp-stage {
        position: relative;
        z-index: 1;
        min-width: 164px;
        min-height: 88px;
        border-radius: 12px;
        border: 1px solid var(--mdp-line);
        background: #F8F6EF;
        color: var(--mdp-faint);
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 7px;
        font-family: var(--zm-font-body);
        cursor: help;
        transition: transform 160ms ease, background 160ms ease, border-color 160ms ease;
      }

      .mdp-stage.done {
        background: var(--mdp-green-soft);
        color: var(--mdp-green);
        border-color: rgba(72, 118, 79, 0.3);
      }

      .mdp-stage.active {
        background: var(--mdp-amber-soft);
        color: var(--mdp-amber);
        border-color: rgba(154, 113, 45, 0.38);
      }

      .mdp-stage-label {
        max-width: 132px;
        text-align: center;
        color: var(--mdp-text);
        font-size: 13px;
        font-weight: 850;
        letter-spacing: 0.06em;
        line-height: 1.16;
        text-transform: uppercase;
      }

      .mdp-stage.queued .mdp-stage-label {
        color: var(--mdp-faint);
      }

      .mdp-stage-status {
        color: currentColor;
        font-size: 11px;
        font-weight: 850;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .mdp-connector {
        flex: 0 0 34px;
        align-self: center;
        height: 1px;
        margin: 0 -1px;
        background: rgba(35, 39, 43, 0.11);
      }

      .mdp-connector.done {
        background: rgba(72, 118, 79, 0.34);
      }

      .mdp-payment-strip {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        background: color-mix(in srgb, var(--mdp-green-soft) 42%, var(--mdp-surface));
      }

      .mdp-payment-strip strong {
        display: block;
        margin: 4px 0 2px;
        font-family: var(--zm-font-body);
        font-size: 16px;
        font-weight: 850;
      }

      .mdp-payment-strip .mdp-secondary-btn {
        width: auto;
      }

      .mdp-lower-grid {
        display: grid;
        grid-template-columns: minmax(0, 0.9fr) minmax(360px, 1.1fr);
        gap: 14px;
        align-items: start;
      }

      .mdp-site-list {
        display: grid;
        gap: 8px;
      }

      .mdp-site-row {
        width: 100%;
        display: grid;
        grid-template-columns: 32px minmax(190px, 1fr) auto minmax(160px, 0.6fr);
        gap: 11px;
        align-items: center;
        border: 1px solid var(--mdp-line);
        border-radius: 12px;
        background: var(--mdp-soft);
        padding: 11px;
        text-align: left;
        cursor: pointer;
        transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
      }

      .mdp-site-row.selected {
        background: var(--mdp-teal-soft);
        border-color: rgba(39, 111, 104, 0.34);
      }

      .mdp-site-id strong,
      .mdp-site-id small {
        display: block;
        font-family: var(--zm-font-body);
      }

      .mdp-site-id strong {
        color: var(--mdp-text);
        font-size: 13.5px;
        font-weight: 850;
      }

      .mdp-site-id small {
        margin-top: 2px;
        color: var(--mdp-muted);
        font-size: 11.5px;
      }

      .mdp-site-next {
        overflow: hidden;
        color: var(--mdp-muted);
        font-family: var(--zm-font-body);
        font-size: 12px;
        font-weight: 700;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .mdp-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 24px;
        padding: 0 9px;
        border-radius: 999px;
        border: 1px solid var(--mdp-line);
        font-family: var(--zm-font-body);
        font-size: 10px;
        font-weight: 850;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .mdp-chip.done { background: var(--mdp-green-soft); color: var(--mdp-green); border-color: rgba(72, 118, 79, 0.22); }
      .mdp-chip.active { background: var(--mdp-amber-soft); color: var(--mdp-amber); border-color: rgba(154, 113, 45, 0.22); }
      .mdp-chip.ready { background: var(--mdp-green-soft); color: var(--mdp-green); border-color: rgba(72, 118, 79, 0.22); }
      .mdp-chip.queued { background: #F8F6EF; color: var(--mdp-faint); }

      .mdp-summary-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      .mdp-summary-grid div {
        border: 1px solid var(--mdp-line);
        background: var(--mdp-soft);
        border-radius: 12px;
        padding: 11px 12px;
      }

      .mdp-summary-grid span {
        display: block;
        font-family: var(--zm-font-body);
        font-size: 10px;
        font-weight: 850;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--mdp-faint);
      }

      .mdp-summary-grid strong {
        display: block;
        margin-top: 5px;
        font-family: var(--zm-font-body);
        font-size: 13px;
        line-height: 1.45;
        color: var(--mdp-text);
      }

      .mdp-status-row {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
        margin-top: 10px;
      }

      .mdp-status-item {
        display: grid;
        grid-template-columns: 8px minmax(0, 1fr);
        align-items: center;
        gap: 7px;
        border: 1px solid var(--mdp-line);
        border-radius: 10px;
        background: var(--mdp-surface);
        padding: 10px;
      }

      .mdp-status-dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: var(--mdp-faint);
        grid-row: span 2;
      }

      .mdp-status-dot.done,
      .mdp-status-dot.ready { background: var(--mdp-green); }
      .mdp-status-dot.active { background: var(--mdp-amber); }

      .mdp-status-item span,
      .mdp-status-item strong {
        display: block;
        min-width: 0;
        font-family: var(--zm-font-body);
      }

      .mdp-status-item span {
        color: var(--mdp-muted);
        font-size: 11px;
        font-weight: 750;
      }

      .mdp-status-item strong {
        overflow: hidden;
        color: var(--mdp-text);
        font-size: 12px;
        font-weight: 850;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      @media (max-width: 1220px) {
        .mdp-lower-grid {
          grid-template-columns: 1fr;
        }

        .mdp-site-row {
          grid-template-columns: 32px minmax(0, 1fr) auto;
        }

        .mdp-site-next {
          grid-column: 2 / -1;
        }
      }

      @media (max-width: 860px) {
        body:has(.minimal-dashboard-preview) .zm-sidebar {
          display: none !important;
        }

        body:has(.minimal-dashboard-preview) .zm-brand-plate {
          width: 164px !important;
          flex-basis: 164px !important;
        }

        body:has(.minimal-dashboard-preview) .zm-brand-word,
        body:has(.minimal-dashboard-preview) .zm-brand-word::after {
          font-size: 24px !important;
        }

        body:has(.minimal-dashboard-preview) .zm-tb-search,
        body:has(.minimal-dashboard-preview) .zm-tb-btn span,
        body:has(.minimal-dashboard-preview) .zm-tb-cta span {
          display: none !important;
        }

        body:has(.minimal-dashboard-preview) .zm-app-main {
          padding: 18px 16px 48px !important;
        }

        .minimal-dashboard-preview::before {
          left: 0;
        }

        .mdp-hero,
        .mdp-next,
        .mdp-payment-strip,
        .mdp-rail-head,
        .mdp-section-head,
        .mdp-summary-head {
          align-items: flex-start;
          flex-direction: column;
        }

        .mdp-hero,
        .mdp-payment-strip {
          display: flex;
        }

        .mdp-actions,
        .mdp-legend {
          justify-content: flex-start;
        }

        .mdp-kpi-strip,
        .mdp-summary-grid,
        .mdp-status-row {
          grid-template-columns: 1fr;
        }

        .mdp-process {
          padding-bottom: 8px;
        }

        .mdp-stage {
          min-width: 142px;
        }
      }
    `}</style>
  );
}
