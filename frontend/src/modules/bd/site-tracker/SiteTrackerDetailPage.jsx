import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageHeader, { HeaderTag } from '../../shared/page-header/PageHeader.jsx';
import Icon from '../../shared/primitives/Icon.jsx';
import { getSiteTrackerView } from '../../../services/api/siteTrackerApi.js';
import { ROUTES } from '../../../router/routes.js';

// Static 7-node hand-over graph. The list is intentionally hard-coded — only
// the Legal node is interactive in v1; the other five are placeholders that
// will light up as the downstream modules ship.
const NODES = [
  { id: 'bd',          label: 'BD',            icon: 'shield',  interactive: false },
  { id: 'legal',       label: 'Legal',         icon: 'shield',  interactive: true  },
  { id: 'payment',     label: 'Payment',       icon: 'card',    interactive: false },
  { id: 'design',      label: 'Design',        icon: 'grid',    interactive: false },
  { id: 'project_ex',  label: 'Project Ex',    icon: 'box',     interactive: false },
  { id: 'nso',         label: 'NSO Handover',  icon: 'upload',  interactive: false },
  { id: 'cam',         label: 'CAM',           icon: 'activity', interactive: false },
];

const DD_LABELS = [
  ['title_doc',       'Title / ownership'],
  ['sanctioned_plan', 'Sanctioned plan'],
  ['oc_cc',           'OC / CC'],
  ['commercial_use',  'Commercial usage'],
  ['property_tax',    'Property tax'],
  ['electricity',     'Electricity connection'],
  ['fire_noc',        'Fire NOC'],
];

const LIC_LABELS = [
  ['fssai',           'FSSAI license'],
  ['health_trade',    'Health / trade license'],
  ['shops_estab_reg', 'Shops & establishment'],
  ['fire_noc',        'Fire NOC'],
  ['storage_license', 'Storage license'],
];

function valueTone(value) {
  if (value === 'yes')  return { color: 'var(--zm-success, #2D7A48)', label: 'Yes' };
  if (value === 'no')   return { color: 'var(--zm-danger,  #B91C1C)', label: 'No'  };
  if (!value || value === 'pending') return { color: 'var(--zm-fg-3)', label: 'Pending' };
  return { color: 'var(--zm-fg-2)', label: String(value) };
}

function verdictTone(verdict) {
  if (verdict === 'positive') return { color: 'var(--zm-success, #2D7A48)', label: 'POSITIVE' };
  if (verdict === 'negative') return { color: 'var(--zm-danger,  #B91C1C)', label: 'NEGATIVE' };
  return { color: 'var(--zm-fg-3)', label: 'PENDING' };
}

function NodeCard({ node, selected, onClick }) {
  const greyed = !node.interactive;
  return (
    <button
      type="button"
      onClick={node.interactive ? onClick : undefined}
      disabled={!node.interactive}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        padding: '14px 10px', minWidth: 120,
        borderRadius: 12,
        border: '1px solid ' + (selected ? 'var(--zm-accent)' : 'var(--zm-line)'),
        background: selected
          ? 'var(--zm-accent-soft, var(--zm-surface-2))'
          : greyed ? 'var(--zm-surface-2)' : 'var(--zm-surface)',
        color: greyed ? 'var(--zm-fg-3)' : 'var(--zm-fg)',
        cursor: node.interactive ? 'pointer' : 'not-allowed',
        opacity: greyed ? 0.7 : 1,
        boxShadow: selected ? 'var(--zm-shadow-1)' : 'none',
      }}
    >
      <span style={{ color: selected ? 'var(--zm-accent)' : (greyed ? 'var(--zm-fg-3)' : 'var(--zm-fg-2)') }}>
        <Icon name={node.icon} size={20}/>
      </span>
      <span style={{
        fontFamily: 'var(--zm-font-body)', fontSize: 12, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.08em',
      }}>{node.label}</span>
      <span style={{
        fontFamily: 'var(--zm-font-body)', fontSize: 10, fontWeight: 600,
        color: greyed ? 'var(--zm-fg-3)' : 'var(--zm-accent)',
      }}>
        {node.interactive ? 'OPEN' : 'COMING SOON'}
      </span>
    </button>
  );
}

function NodeDiagram({ selected, onSelect }) {
  // Static, hard-coded SVG-on-grid layout. Six edges, all going left → right
  // in a single row. The arrow heads are inline so we don't need defs.
  return (
    <div style={{
      position: 'relative',
      background: 'var(--zm-surface)', border: '1px solid var(--zm-line)',
      borderRadius: 12, padding: '24px 16px',
      overflowX: 'auto',
    }}>
      {/* Arrow row sits behind the cards. SVG width chosen to comfortably
          contain 7 cards × ~140px each. */}
      <svg
        viewBox="0 0 980 60"
        preserveAspectRatio="none"
        style={{
          position: 'absolute', left: 16, right: 16, top: '50%',
          width: 'calc(100% - 32px)', height: 60,
          transform: 'translateY(-50%)', pointerEvents: 'none',
        }}
      >
        {[0,1,2,3,4,5].map((i) => {
          const x1 = 80 + i * 140;
          const x2 = x1 + 80;
          return (
            <g key={i} stroke="var(--zm-line)" strokeWidth="1.5" fill="none">
              <line x1={x1} y1="30" x2={x2 - 6} y2="30"/>
              <polyline points={`${x2 - 10},25 ${x2 - 4},30 ${x2 - 10},35`}/>
            </g>
          );
        })}
      </svg>

      <div style={{
        position: 'relative', display: 'grid',
        gridTemplateColumns: 'repeat(7, minmax(120px, 1fr))',
        gap: 20, alignItems: 'center',
      }}>
        {NODES.map((n) => (
          <NodeCard
            key={n.id}
            node={n}
            selected={selected === n.id}
            onClick={() => onSelect(n.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ChecklistList({ rows, source }) {
  if (!source) {
    return (
      <div style={{ padding: 14, color: 'var(--zm-fg-3)', fontStyle: 'italic', fontSize: 13 }}>
        Awaiting publish.
      </div>
    );
  }
  return (
    <div>
      {rows.map(([key, label]) => {
        const t = valueTone(source[key]);
        return (
          <div key={key} style={{
            display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 90px',
            gap: 12, padding: '10px 14px', alignItems: 'center',
            borderBottom: '1px solid var(--zm-line-faint)',
          }}>
            <span style={{ fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg)' }}>
              {label}
            </span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              height: 22, padding: '0 8px', borderRadius: 4,
              border: `1px solid ${t.color}`, color: t.color,
              fontFamily: 'var(--zm-font-body)', fontWeight: 700, fontSize: 10.5,
              letterSpacing: '0.12em', textTransform: 'uppercase',
              justifySelf: 'end',
            }}>{t.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function LegalPanel({ data, onClose }) {
  const dd = data.dd;
  const ag = data.agreement;
  const lic = data.licensing;
  const verdict = verdictTone(dd?.final_verdict);

  return (
    <aside style={{
      width: 380, flex: '0 0 380px',
      background: 'var(--zm-surface)', border: '1px solid var(--zm-line)',
      borderRadius: 12, boxShadow: 'var(--zm-shadow-1)',
      display: 'flex', flexDirection: 'column', maxHeight: '78vh', overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '1px solid var(--zm-line)',
        background: 'var(--zm-surface-2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="shield" size={14}/>
          <span style={{
            fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11.5,
            letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            Legal · summary
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close legal panel"
          style={{
            width: 28, height: 28, padding: 0, border: '1px solid var(--zm-line)',
            borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg-2)',
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Icon name="x" size={12}/>
        </button>
      </div>

      <div style={{ overflowY: 'auto' }}>
        <section>
          <div style={{
            padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid var(--zm-line)',
          }}>
            <span style={{
              fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11,
              letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-2)',
            }}>1 · Due diligence</span>
            <span style={{
              fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 10.5,
              letterSpacing: '0.12em', color: verdict.color,
            }}>{verdict.label}</span>
          </div>
          <ChecklistList rows={DD_LABELS} source={dd}/>
          {dd?.rejection_reason && (
            <div style={{
              padding: '10px 14px', color: 'var(--zm-danger, #B91C1C)', fontSize: 12.5,
              borderBottom: '1px solid var(--zm-line-faint)',
            }}>
              Reason: {dd.rejection_reason}
            </div>
          )}
        </section>

        <section>
          <div style={{
            padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid var(--zm-line)', background: 'var(--zm-surface-2)',
          }}>
            <span style={{
              fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11,
              letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-2)',
            }}>2 · Agreement</span>
            <span style={{
              fontFamily: 'var(--zm-font-body)', fontSize: 11,
              color: 'var(--zm-fg-2)',
            }}>{data.agreementStatus || 'pending'}</span>
          </div>
          {!ag ? (
            <div style={{ padding: 14, color: 'var(--zm-fg-3)', fontStyle: 'italic', fontSize: 13 }}>
              Awaiting publish.
            </div>
          ) : (
            <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
              <div>Signed: <strong>{ag.signed ? 'yes' : 'no'}</strong>
                {ag.signed_at ? ` · ${new Date(ag.signed_at).toLocaleDateString()}` : ''}
              </div>
              <div>Registered: <strong>{ag.registered ? 'yes' : 'no'}</strong>
                {ag.registered_at ? ` · ${new Date(ag.registered_at).toLocaleDateString()}` : ''}
              </div>
              {ag.document_url && (
                <a href={ag.document_url} target="_blank" rel="noopener noreferrer"
                  style={{ color: 'var(--zm-accent)', fontWeight: 700 }}>Open document ↗</a>
              )}
            </div>
          )}
        </section>

        <section>
          <div style={{
            padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid var(--zm-line)',
          }}>
            <span style={{
              fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11,
              letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-2)',
            }}>3 · Licensing</span>
            <span style={{
              fontFamily: 'var(--zm-font-body)', fontSize: 11,
              color: 'var(--zm-fg-2)',
            }}>{data.licensingStatus || 'pending'}</span>
          </div>
          <ChecklistList rows={LIC_LABELS} source={lic}/>
        </section>
      </div>
    </aside>
  );
}

function ComingSoonPanel({ node, onClose }) {
  return (
    <aside style={{
      width: 380, flex: '0 0 380px',
      background: 'var(--zm-surface)', border: '1px solid var(--zm-line)',
      borderRadius: 12, boxShadow: 'var(--zm-shadow-1)',
      padding: 18, display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11.5,
          letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-2)',
        }}>{node.label}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          style={{
            width: 28, height: 28, padding: 0, border: '1px solid var(--zm-line)',
            borderRadius: 7, background: 'var(--zm-surface)', color: 'var(--zm-fg-2)',
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Icon name="x" size={12}/>
        </button>
      </div>
      <p style={{ margin: 0, fontFamily: 'var(--zm-font-body)', fontSize: 13, color: 'var(--zm-fg-3)' }}>
        Coming soon — this node will become interactive once the {node.label} module ships.
      </p>
    </aside>
  );
}

export default function SiteTrackerDetailPage() {
  const { siteId } = useParams();
  const navigate = useNavigate();
  const [state, setState] = React.useState({ status: 'loading', data: null, error: null });
  const [selectedNode, setSelectedNode] = React.useState('legal');

  React.useEffect(() => {
    if (!siteId) return undefined;
    let cancelled = false;
    setState({ status: 'loading', data: null, error: null });
    getSiteTrackerView(siteId)
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'ready', data, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: 'error', data: null,
          error: err?.detail || err?.message || 'Failed to load site tracker',
        });
      });
    return () => { cancelled = true; };
  }, [siteId]);

  if (state.status === 'loading') {
    return <div className="zm-glass" style={{ padding: 24, textAlign: 'center', color: 'var(--zm-fg-3)' }}>Loading…</div>;
  }
  if (state.status === 'error') {
    return <div className="zm-glass" style={{ padding: 18, color: 'var(--zm-danger, #B91C1C)' }}>{state.error}</div>;
  }

  const data = state.data;
  const verdict = verdictTone(data.dd?.final_verdict);
  const activeNode = NODES.find((n) => n.id === selectedNode);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PageHeader
        file="No. 08"
        eyebrow={`Site · ${data.siteCode || data.siteId}`}
        title={<>{data.siteName} <em>tracker</em></>}
        lede={`${data.city}${data.submittedByName ? ' · drafted by ' + data.submittedByName : ''}`}
        right={<HeaderTag icon="shield" label={`DD ${verdict.label}`}/>}
      />

      <NodeDiagram selected={selectedNode} onSelect={setSelectedNode}/>

      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 360px', minWidth: 0 }}>
          <div className="zm-glass" style={{
            padding: 16, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 8,
            border: '1px solid var(--zm-line)', background: 'var(--zm-surface)',
          }}>
            <div style={{
              fontFamily: 'var(--zm-font-body)', fontWeight: 800, fontSize: 11,
              letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--zm-fg-2)',
            }}>
              Mirror columns (read-only)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              <div>
                <div style={{ fontSize: 10.5, color: 'var(--zm-fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Legal DD</div>
                <div style={{ fontWeight: 700 }}>{data.legalDdStatus || 'pending'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: 'var(--zm-fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Agreement</div>
                <div style={{ fontWeight: 700 }}>{data.agreementStatus || 'pending'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, color: 'var(--zm-fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Licensing</div>
                <div style={{ fontWeight: 700 }}>{data.licensingStatus || 'pending'}</div>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--zm-fg-3)' }}>
              Click the <strong>Legal</strong> node above to see the published due-diligence, agreement,
              and licensing summary. Other nodes light up once their modules ship.
            </p>
          </div>
        </div>

        {activeNode && activeNode.interactive && (
          <LegalPanel data={data} onClose={() => setSelectedNode(null)}/>
        )}
        {activeNode && !activeNode.interactive && (
          <ComingSoonPanel node={activeNode} onClose={() => setSelectedNode(null)}/>
        )}
      </div>

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
          ← Back to tracker
        </button>
      </div>
    </div>
  );
}
