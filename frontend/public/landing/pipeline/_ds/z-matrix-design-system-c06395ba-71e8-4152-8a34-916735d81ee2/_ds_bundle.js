/* @ds-bundle: {"format":3,"namespace":"ZMatrixDesignSystem_c06395","components":[],"sourceHashes":{"ui_kits/bd-redesign/app.jsx":"b822f4819143","ui_kits/bd-redesign/chrome.jsx":"67d40323cdad","ui_kits/bd-redesign/detail.jsx":"c32900467c4c","ui_kits/bd-redesign/kit.jsx":"3904799bb3bd","ui_kits/bd-redesign/kpis.jsx":"e51ca448f9d8","ui_kits/bd-redesign/screens.jsx":"6bce2ffc5eb5","ui_kits/bd-redesign/screens2.jsx":"b93330c1af06","ui_kits/new-store-folder/AddDetailsForm.jsx":"7518c6c08238","ui_kits/new-store-folder/App.jsx":"78c069913951","ui_kits/new-store-folder/Archive.jsx":"b590526e0ae0","ui_kits/new-store-folder/Chrome.jsx":"3b23ef46780e","ui_kits/new-store-folder/Drafts.jsx":"1e47b157d46c","ui_kits/new-store-folder/PageHeader.jsx":"46350775f0c5","ui_kits/new-store-folder/Pipeline.jsx":"7b1e53178ee5","ui_kits/new-store-folder/Primitives.jsx":"81a1a7b318ac","ui_kits/new-store-folder/Shortlist.jsx":"79aeba5aa32e","ui_kits/new-store-folder/SiteDrawer.jsx":"ec1e383949bb","ui_kits/new-store-folder/Staging.jsx":"dedcc14ed308","ui_kits/workspace/Command.jsx":"90c11600a8d0","ui_kits/workspace/Surfaces.jsx":"3ee4a5707698","ui_kits/workspace/WsApp.jsx":"6f7acdd03b6b","ui_kits/workspace/WsChrome.jsx":"8f58ff98d804","ui_kits/workspace/WsPrimitives.jsx":"6e62509321d9"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.ZMatrixDesignSystem_c06395 = window.ZMatrixDesignSystem_c06395 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// ui_kits/bd-redesign/app.jsx
try { (() => {
// ════════════════════════════════════════════════════════════════
// App — state, role/RBAC, navigation, metrics. Row click opens the
// full-page detail (no drawer); Back returns to the list.
// ════════════════════════════════════════════════════════════════

const VIEW_LABELS = {
  overview: 'Sites in motion',
  pipeline: 'Pipeline',
  shortlist: 'Shortlist queue',
  staging: 'Staging',
  archive: 'Archive'
};
const App = () => {
  const [role, setRole] = React.useState('supervisor');
  const [view, setView] = React.useState('overview');
  const [stage, setStage] = React.useState('all');
  const [openSite, setOpenSite] = React.useState(null); // { site, backLabel }
  const [toast, setToast] = React.useState(null);
  const [drafts, setDrafts] = React.useState(DRAFTS);
  const [shortlist, setShortlist] = React.useState(SHORTLIST);
  const [staging, setStaging] = React.useState(STAGING);
  const [archive, setArchive] = React.useState(ARCHIVE_SEED);
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  const showToast = (msg, tone = 'success') => setToast({
    msg,
    tone
  });
  const isExec = role === 'exec';
  const visibleDrafts = isExec ? drafts.filter(d => d.createdBy === ME) : drafts;
  const visibleShortlist = isExec ? shortlist.filter(s => s.createdBy === ME) : shortlist;
  const visibleStaging = isExec ? staging.filter(s => s.createdBy === ME) : staging.filter(s => s.loiUploaded === true || !s.loiUploaded);

  // ─ metrics ─
  const loiOverdue = staging.filter(s => !s.loiUploaded && s.daysSinceApproval > s.expectedLoiDays).length;
  const inReview = visibleShortlist.filter(s => s.inReview).length;
  const staleDrafts = role === 'supervisor' ? visibleDrafts.filter(d => d.days > 7).length : 0;
  const cityCount = new Set([...visibleDrafts.map(d => d.city), ...visibleShortlist.map(s => s.city), ...visibleStaging.map(s => s.city)]).size;
  const distribution = [{
    label: 'Draft',
    value: 38,
    color: 'var(--zm-stage-draft)'
  }, {
    label: 'Shortlist',
    value: 24,
    color: 'var(--zm-stage-shortlist)'
  }, {
    label: 'In process',
    value: 51,
    color: 'var(--zm-stage-loi)'
  }, {
    label: 'Overdue',
    value: 9,
    color: 'var(--zm-danger)'
  }, {
    label: 'Closing',
    value: 20,
    color: 'var(--zm-success)'
  }];
  const metrics = {
    total: 142,
    cities: 23,
    delta: '+12 / wk',
    trend: [88, 92, 96, 101, 99, 108, 114, 119, 124, 129, 136, 142],
    distribution,
    drafts: visibleDrafts.length,
    staleDrafts,
    shortlist: visibleShortlist.length,
    inReview,
    loiOverdue,
    staging: staging.length
  };

  // ─ motion rows ─
  const allMotion = [...visibleDrafts.map(d => ({
    id: d.id,
    code: d.code,
    name: d.name,
    city: d.city,
    stage: 'draft',
    days: d.days,
    owner: d.createdBy,
    when: d.visitDate,
    _row: d,
    _kind: 'draft'
  })), ...visibleShortlist.map(s => ({
    id: s.code,
    code: s.code,
    name: s.name,
    city: s.city,
    stage: s.inReview ? 'inReview' : 'shortlist',
    days: 3,
    owner: s.createdBy,
    when: s.visitDate,
    _row: s,
    _kind: 'shortlist'
  })), ...visibleStaging.map(s => {
    const overdue = s.daysSinceApproval > s.expectedLoiDays && !s.loiUploaded;
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      city: s.city,
      stage: s.pushed ? 'completed' : s.loiUploaded ? 'uploaded' : overdue ? 'overdue' : 'staging',
      days: s.daysSinceApproval,
      owner: s.createdBy,
      when: s.draftDate,
      _row: s,
      _kind: 'staging'
    };
  })];
  // urgency sort: overdue first, then by days desc
  const order = {
    overdue: 0,
    staging: 1,
    inReview: 2,
    shortlist: 3,
    uploaded: 4,
    draft: 5,
    completed: 6
  };
  const sorted = [...allMotion].sort((a, b) => order[a.stage] - order[b.stage] || b.days - a.days);
  const motionRows = stage === 'all' ? sorted : sorted.filter(r => {
    if (stage === 'staging') return ['staging', 'overdue', 'uploaded', 'completed'].includes(r.stage);
    if (stage === 'shortlist') return ['shortlist', 'inReview'].includes(r.stage);
    return r.stage === stage;
  });
  const counts = {
    all: allMotion.length,
    draft: visibleDrafts.length,
    shortlist: visibleShortlist.length,
    staging: visibleStaging.length,
    pipeline: visibleDrafts.length,
    archive: archive.length
  };

  // ─ open a site as full page ─
  const openFrom = (row, kind, viewName) => {
    const stageMap = {
      draft: 'draft',
      shortlist: row.inReview ? 'inReview' : 'shortlist',
      staging: row.daysSinceApproval > row.expectedLoiDays && !row.loiUploaded ? 'overdue' : row.loiUploaded ? 'uploaded' : 'staging',
      archived: 'archived'
    };
    setOpenSite({
      site: buildSite(row, stageMap[kind] || 'draft'),
      backLabel: VIEW_LABELS[viewName] || 'Sites in motion'
    });
  };
  const openMotionRow = r => setOpenSite({
    site: buildSite(r._row, r.stage),
    backLabel: VIEW_LABELS.overview
  });

  // ─ workflow actions ─
  const approveDraft = d => {
    setDrafts(p => p.filter(x => x.id !== d.id));
    setShortlist(p => [{
      code: d.code,
      name: d.name,
      city: d.city,
      visitDate: d.visitDate,
      createdBy: d.createdBy,
      score: '',
      estSales: '',
      carpet: '',
      rent: '',
      rentType: '',
      totalOpCost: 0,
      hue: Math.round(Math.random() * 360),
      inReview: false,
      spocName: d.createdBy
    }, ...p]);
    showToast(`Shortlisted · ${d.name} moved to queue`);
  };
  const archiveDraft = d => {
    setDrafts(p => p.filter(x => x.id !== d.id));
    setArchive(p => [{
      id: d.id,
      code: d.code,
      name: d.name,
      city: d.city,
      createdBy: d.createdBy,
      archivedAt: '2026-05-19',
      reasons: [],
      note: 'Archived for future reference'
    }, ...p]);
    showToast(`Archived · ${d.name}`);
  };
  const rejectDraft = d => {
    setDrafts(p => p.filter(x => x.id !== d.id));
    setArchive(p => [{
      id: d.id,
      code: d.code,
      name: d.name,
      city: d.city,
      createdBy: d.createdBy,
      archivedAt: '2026-05-19',
      reasons: ['High rent'],
      note: ''
    }, ...p]);
    showToast(`Rejected · ${d.name} archived`, 'danger');
  };
  const uploadLOI = s => {
    setStaging(p => p.map(x => x.id === s.id ? {
      ...x,
      loiUploaded: true,
      loiUploadedAt: '2026-05-19',
      daysToLOI: x.daysSinceApproval
    } : x));
    showToast(`LOI uploaded · ${s.name}`);
  };
  const pushSite = s => {
    setStaging(p => p.filter(x => x.id !== s.id));
    showToast(`Pushed · ${s.name} → Payments module`);
  };
  const onNewPipeline = () => showToast('New pipeline · opens the 3-field draft form');
  return /*#__PURE__*/React.createElement("div", {
    "data-theme": "light",
    style: {
      width: '100%',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--zm-bg)',
      color: 'var(--zm-fg)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement(TopBar, {
    user: {
      name: ME
    },
    role: role,
    onNewPipeline: onNewPipeline
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      minHeight: 0,
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement(Sidebar, {
    view: openSite ? null : view,
    onView: v => {
      setOpenSite(null);
      setView(v);
    },
    counts: counts,
    role: role,
    onRole: setRole
  }), openSite ? /*#__PURE__*/React.createElement("main", {
    className: "zm-main",
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--zm-bg)',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement(SiteDetail, {
    site: openSite.site,
    backLabel: openSite.backLabel,
    onBack: () => setOpenSite(null)
  })) : /*#__PURE__*/React.createElement("main", {
    className: "zm-main zm-blueprint",
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '24px 32px 64px',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      zIndex: 1
    }
  }, view === 'overview' && /*#__PURE__*/React.createElement(OverviewScreen, {
    role: role,
    rows: motionRows,
    metrics: metrics,
    stage: stage,
    onStage: setStage,
    counts: counts,
    onOpen: openMotionRow
  }), view === 'pipeline' && /*#__PURE__*/React.createElement(DraftsScreen, {
    role: role,
    drafts: visibleDrafts,
    onOpen: d => openFrom(d, 'draft', 'pipeline'),
    onApprove: approveDraft,
    onReject: rejectDraft,
    onArchive: archiveDraft
  }), view === 'shortlist' && /*#__PURE__*/React.createElement(ShortlistScreen, {
    role: role,
    items: visibleShortlist,
    onOpen: s => openFrom(s, 'shortlist', 'shortlist'),
    onAddDetails: () => showToast('Add details · opens the 17-field form'),
    onApprove: () => showToast('Approve · set LOI timeline, then advance to staging')
  }), view === 'staging' && /*#__PURE__*/React.createElement(StagingScreen, {
    role: role,
    sites: visibleStaging,
    onOpen: s => openFrom(s, 'staging', 'staging'),
    onUpload: uploadLOI,
    onPush: pushSite,
    onViewLOI: s => showToast(`Opening LOI · ${s.name}`)
  }), view === 'archive' && role === 'supervisor' && /*#__PURE__*/React.createElement(ArchiveScreen, {
    archives: archive,
    onOpen: a => openFrom(a, 'archived', 'archive')
  }), view === 'archive' && role !== 'supervisor' && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 60,
      textAlign: 'center',
      color: 'var(--zm-fg-3)',
      fontFamily: 'var(--zm-font-body)'
    }
  }, "Archive is supervisor-only.")))), toast && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      bottom: 22,
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'var(--zm-fg)',
      color: 'var(--zm-fg-inv)',
      padding: '11px 17px',
      borderRadius: 10,
      boxShadow: 'var(--zm-shadow-pop)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 500,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      zIndex: 200,
      animation: 'zm-rise 240ms var(--zm-ease-emp)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 999,
      background: toast.tone === 'danger' ? 'var(--zm-danger)' : 'var(--zm-success)'
    }
  }), toast.msg));
};
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/bd-redesign/app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/bd-redesign/chrome.jsx
try { (() => {
// ════════════════════════════════════════════════════════════════
// Chrome — top bar + sidebar for the BD redesign
// ════════════════════════════════════════════════════════════════

const TopBar = ({
  user,
  role,
  onNewPipeline
}) => /*#__PURE__*/React.createElement("header", {
  style: {
    height: 60,
    display: 'flex',
    alignItems: 'stretch',
    flex: '0 0 auto',
    background: 'var(--zm-surface)',
    borderBottom: '1px solid var(--zm-line)',
    position: 'relative',
    zIndex: 20
  }
}, /*#__PURE__*/React.createElement("div", {
  className: "zm-brand-plate",
  style: {
    width: 230,
    flex: '0 0 230px',
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    padding: '0 16px',
    color: '#F5F2EC',
    borderRight: '1px solid var(--zm-line)'
  }
}, /*#__PURE__*/React.createElement("svg", {
  className: "zm-brand-cube",
  width: "30",
  height: "30",
  viewBox: "0 0 64 64",
  fill: "none",
  style: {
    display: 'block',
    flex: '0 0 auto',
    position: 'relative',
    zIndex: 1
  }
}, /*#__PURE__*/React.createElement("g", {
  stroke: "#7AE7DA",
  strokeWidth: "1.2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  opacity: "0.55"
}, /*#__PURE__*/React.createElement("path", {
  d: "M22 10 L58 10 L58 46 L22 46 Z"
}), /*#__PURE__*/React.createElement("path", {
  d: "M6 22 L22 10"
}), /*#__PURE__*/React.createElement("path", {
  d: "M42 22 L58 10"
}), /*#__PURE__*/React.createElement("path", {
  d: "M6 58 L22 46"
}), /*#__PURE__*/React.createElement("path", {
  d: "M42 58 L58 46"
}), /*#__PURE__*/React.createElement("path", {
  d: "M6 22 L42 22 L42 58 L6 58 Z"
})), /*#__PURE__*/React.createElement("g", {
  stroke: "#E0A659",
  strokeWidth: "3.8",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "M6 22 L58 10"
}), /*#__PURE__*/React.createElement("path", {
  d: "M58 10 L6 58"
}), /*#__PURE__*/React.createElement("path", {
  d: "M6 58 L58 46"
}))), /*#__PURE__*/React.createElement("span", {
  className: "zm-brand-word",
  style: {
    fontFamily: 'var(--zm-font-serif)',
    fontStyle: 'italic',
    fontWeight: 400,
    fontSize: 27,
    color: '#F5F2EC',
    letterSpacing: '-0.012em',
    lineHeight: 1,
    whiteSpace: 'nowrap',
    position: 'relative',
    zIndex: 1,
    textShadow: '0 1px 0 rgba(0,0,0,0.35), 0 0 24px rgba(122,231,218,0.15)'
  }
}, "z\u2011matrix")), /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0 20px',
    minWidth: 0
  }
}, /*#__PURE__*/React.createElement("button", {
  className: "zm-tb-btn",
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    height: 34,
    padding: '0 10px 0 12px',
    borderRadius: 8,
    border: '1px solid var(--zm-line)',
    background: 'var(--zm-surface)',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12.5,
    fontWeight: 600,
    color: 'var(--zm-fg)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flex: '0 0 auto'
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "folder",
  size: 14,
  style: {
    color: 'var(--zm-fg-3)'
  }
}), /*#__PURE__*/React.createElement("span", null, "New store opening"), /*#__PURE__*/React.createElement(Icon, {
  name: "chevronDown",
  size: 12,
  style: {
    color: 'var(--zm-fg-3)',
    marginLeft: 2
  }
})), /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1,
    position: 'relative',
    minWidth: 200,
    maxWidth: 460
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "search",
  size: 14,
  style: {
    position: 'absolute',
    left: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    color: 'var(--zm-fg-3)',
    pointerEvents: 'none'
  }
}), /*#__PURE__*/React.createElement("input", {
  className: "zm-tb-search",
  placeholder: "Search sites or SPOC\u2026",
  style: {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    height: 34,
    padding: '0 56px 0 34px',
    background: 'var(--zm-bg)',
    border: '1px solid var(--zm-line)',
    borderRadius: 8,
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13,
    color: 'var(--zm-fg)',
    outline: 'none',
    textOverflow: 'ellipsis'
  }
}), /*#__PURE__*/React.createElement("kbd", {
  style: {
    position: 'absolute',
    right: 8,
    top: '50%',
    transform: 'translateY(-50%)',
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 10.5,
    fontWeight: 500,
    color: 'var(--zm-fg-3)',
    background: 'var(--zm-surface)',
    border: '1px solid var(--zm-line)',
    padding: '2px 6px',
    borderRadius: 4,
    lineHeight: 1,
    pointerEvents: 'none'
  }
}, "\u2318K")), /*#__PURE__*/React.createElement("span", {
  style: {
    flex: 1
  }
}), /*#__PURE__*/React.createElement("button", {
  onClick: onNewPipeline,
  className: "zm-tb-cta",
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 34,
    padding: '0 14px',
    borderRadius: 8,
    background: 'var(--zm-accent)',
    color: '#fff',
    border: 'none',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: 'var(--zm-shadow-1)',
    whiteSpace: 'nowrap',
    flex: '0 0 auto'
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "plus",
  size: 13
}), /*#__PURE__*/React.createElement("span", null, "New pipeline")), /*#__PURE__*/React.createElement("span", {
  style: {
    width: 1,
    height: 24,
    background: 'var(--zm-line)',
    flex: '0 0 auto'
  }
}), /*#__PURE__*/React.createElement("button", {
  title: "Account",
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    height: 40,
    padding: '0 8px 0 4px',
    borderRadius: 999,
    background: 'transparent',
    border: '1px solid transparent',
    cursor: 'pointer',
    flex: '0 0 auto'
  },
  onMouseEnter: e => {
    e.currentTarget.style.background = 'var(--zm-surface-hover)';
    e.currentTarget.style.borderColor = 'var(--zm-line)';
  },
  onMouseLeave: e => {
    e.currentTarget.style.background = 'transparent';
    e.currentTarget.style.borderColor = 'transparent';
  }
}, /*#__PURE__*/React.createElement(Avatar, {
  name: user.name,
  size: 30
}), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1.15,
    whiteSpace: 'nowrap',
    alignItems: 'flex-start'
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12.5,
    fontWeight: 600,
    color: 'var(--zm-fg)'
  }
}, user.name), /*#__PURE__*/React.createElement("span", {
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontFamily: 'var(--zm-font-body)',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: role === 'supervisor' ? 'var(--zm-accent)' : 'var(--zm-fg-3)',
    marginTop: 2
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    width: 5,
    height: 5,
    borderRadius: 999,
    background: role === 'supervisor' ? 'var(--zm-accent)' : 'var(--zm-fg-3)'
  }
}), role === 'supervisor' ? 'Supervisor' : 'BD Exec')), /*#__PURE__*/React.createElement(Icon, {
  name: "chevronDown",
  size: 12,
  style: {
    color: 'var(--zm-fg-3)'
  }
}))));
const SidebarItem = ({
  icon,
  label,
  count,
  active,
  accent,
  onClick
}) => /*#__PURE__*/React.createElement("button", {
  onClick: onClick,
  className: "zm-sb-item",
  style: {
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    width: '100%',
    textAlign: 'left',
    padding: '8px 11px',
    borderRadius: 8,
    cursor: 'pointer',
    border: 'none',
    background: active ? 'var(--zm-accent-soft)' : 'transparent',
    color: active ? 'var(--zm-fg)' : 'var(--zm-fg-2)',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13,
    fontWeight: active ? 650 : 500,
    position: 'relative'
  }
}, active && /*#__PURE__*/React.createElement("span", {
  style: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 2.5,
    background: 'var(--zm-accent)',
    borderRadius: 2
  }
}), /*#__PURE__*/React.createElement("span", {
  style: {
    color: active ? 'var(--zm-accent)' : 'var(--zm-fg-3)',
    display: 'inline-flex'
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: icon,
  size: 16
})), label, count != null && /*#__PURE__*/React.createElement("span", {
  style: {
    marginLeft: 'auto',
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 11,
    fontWeight: 600,
    minWidth: 20,
    textAlign: 'center',
    padding: '1px 6px',
    borderRadius: 999,
    color: accent ? 'var(--zm-copper)' : active ? 'var(--zm-accent)' : 'var(--zm-fg-3)',
    background: accent ? 'var(--zm-copper-soft)' : active ? 'color-mix(in srgb, var(--zm-accent) 12%, transparent)' : 'var(--zm-surface-2)'
  }
}, count));
const Sidebar = ({
  view,
  onView,
  counts,
  role,
  onRole
}) => /*#__PURE__*/React.createElement("aside", {
  style: {
    width: 230,
    flex: '0 0 230px',
    padding: '14px 12px',
    background: 'var(--zm-surface)',
    borderRight: '1px solid var(--zm-line)',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    overflowY: 'auto',
    position: 'relative',
    zIndex: 10
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 700,
    fontSize: 9.5,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--zm-fg-4)',
    padding: '4px 11px 6px'
  }
}, "Overview"), /*#__PURE__*/React.createElement(SidebarItem, {
  icon: "trend",
  label: "Sites in motion",
  active: view === 'overview',
  onClick: () => onView('overview')
}), /*#__PURE__*/React.createElement("div", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 700,
    fontSize: 9.5,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--zm-fg-4)',
    padding: '14px 11px 6px'
  }
}, "Workflow"), /*#__PURE__*/React.createElement(SidebarItem, {
  icon: "file",
  label: "Pipeline",
  count: counts.pipeline,
  active: view === 'pipeline',
  onClick: () => onView('pipeline')
}), /*#__PURE__*/React.createElement(SidebarItem, {
  icon: "shield",
  label: "Shortlist queue",
  count: counts.shortlist,
  active: view === 'shortlist',
  onClick: () => onView('shortlist')
}), /*#__PURE__*/React.createElement(SidebarItem, {
  icon: "layers",
  label: "Staging",
  count: counts.staging,
  accent: true,
  active: view === 'staging',
  onClick: () => onView('staging')
}), role === 'supervisor' && /*#__PURE__*/React.createElement(SidebarItem, {
  icon: "folder",
  label: "Archive",
  count: counts.archive,
  active: view === 'archive',
  onClick: () => onView('archive')
}), /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1
  }
}), /*#__PURE__*/React.createElement("div", {
  style: {
    padding: 10,
    margin: '0 4px 8px',
    border: '1px solid var(--zm-line)',
    borderRadius: 10,
    background: 'var(--zm-surface-2)',
    display: 'flex',
    flexDirection: 'column',
    gap: 8
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 700,
    fontSize: 9.5,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--zm-fg-3)'
  }
}, "View as"), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    gap: 4,
    background: 'var(--zm-bg-2)',
    borderRadius: 7,
    padding: 3
  }
}, ['supervisor', 'exec'].map(r => /*#__PURE__*/React.createElement("button", {
  key: r,
  onClick: () => onRole(r),
  style: {
    flex: 1,
    height: 26,
    border: 'none',
    borderRadius: 5,
    background: role === r ? 'var(--zm-surface)' : 'transparent',
    color: role === r ? 'var(--zm-fg)' : 'var(--zm-fg-3)',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: role === r ? 'var(--zm-shadow-1)' : 'none'
  }
}, r === 'supervisor' ? 'Supervisor' : 'BD exec')))), /*#__PURE__*/React.createElement("div", {
  style: {
    padding: 12,
    margin: '0 4px',
    border: '1px solid var(--zm-line)',
    borderRadius: 10,
    background: 'linear-gradient(160deg, var(--zm-accent-soft), var(--zm-surface-2))',
    display: 'flex',
    flexDirection: 'column',
    gap: 6
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    color: 'var(--zm-accent)'
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "sparkle",
  size: 14
}), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase'
  }
}, "Ask Matrix")), /*#__PURE__*/React.createElement("p", {
  style: {
    margin: 0,
    fontFamily: 'var(--zm-font-body)',
    fontSize: 11.5,
    color: 'var(--zm-fg-2)',
    lineHeight: 1.45
  }
}, "\"Which staging sites are overdue > 14 days?\"")));
Object.assign(window, {
  TopBar,
  Sidebar,
  SidebarItem
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/bd-redesign/chrome.jsx", error: String((e && e.message) || e) }); }

// ui_kits/bd-redesign/detail.jsx
try { (() => {
// ════════════════════════════════════════════════════════════════
// Full-page Site detail — replaces the half-screen drawer.
// Sticky "← Back" bar + sticky tab strip + scrollable content.
// ════════════════════════════════════════════════════════════════

const Field = ({
  label,
  value,
  mono,
  accent
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 700,
    fontSize: 9.5,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--zm-fg-3)'
  }
}, label), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: mono ? 'var(--zm-font-mono)' : 'var(--zm-font-body)',
    fontFeatureSettings: mono ? "'tnum' 1" : 'normal',
    fontSize: 14.5,
    color: accent ? 'var(--zm-accent)' : 'var(--zm-fg)',
    fontWeight: 600
  }
}, value));
const DetailTab = ({
  active,
  label,
  count,
  onClick
}) => /*#__PURE__*/React.createElement("button", {
  onClick: onClick,
  className: 'zm-tab' + (active ? ' is-active' : ''),
  style: {
    background: 'none',
    border: 'none',
    padding: '14px 2px',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13.5,
    fontWeight: active ? 650 : 500,
    color: active ? 'var(--zm-fg)' : 'var(--zm-fg-3)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    marginRight: 26,
    position: 'relative'
  }
}, label, count != null && /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 11,
    color: 'var(--zm-fg-3)',
    background: 'var(--zm-surface-2)',
    padding: '1px 6px',
    borderRadius: 999
  }
}, count));

// LOI tracker hero band
const LoiTrackerBand = ({
  site
}) => {
  const overdue = site.days > 14;
  const steps = [{
    label: 'Signed',
    done: true
  }, {
    label: 'Uploaded to drive',
    done: true
  }, {
    label: 'Supervisor approval',
    done: false,
    active: true
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      borderRadius: 14,
      padding: 22,
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto',
      gap: 28,
      alignItems: 'center',
      border: '1px solid ' + (overdue ? 'var(--zm-copper-line)' : 'var(--zm-accent-line)'),
      background: overdue ? 'linear-gradient(135deg, var(--zm-copper-soft), var(--zm-surface) 70%)' : 'linear-gradient(135deg, var(--zm-accent-soft), var(--zm-surface) 70%)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 700,
      fontSize: 9.5,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: overdue ? 'var(--zm-copper)' : 'var(--zm-accent)'
    }
  }, "LOI tracker"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-serif)',
      fontStyle: 'italic',
      fontWeight: 400,
      fontSize: 46,
      lineHeight: 0.9,
      color: overdue ? 'var(--zm-copper)' : 'var(--zm-fg)'
    }
  }, pad2(site.days), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18,
      fontStyle: 'normal',
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      marginLeft: 4
    }
  }, "days")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      color: 'var(--zm-fg-3)'
    }
  }, "signed ", site.loiSignedAt, " \xB7 submitted ", site.loiSubmittedAt)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 0
    }
  }, steps.map((s, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: s.label
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 7,
      flex: '0 0 auto'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 30,
      height: 30,
      borderRadius: 999,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: s.done ? 'var(--zm-success)' : s.active ? overdue ? 'var(--zm-copper)' : 'var(--zm-accent)' : 'var(--zm-surface-sunken)',
      color: s.done || s.active ? '#fff' : 'var(--zm-fg-3)',
      border: '2px solid var(--zm-surface)',
      boxShadow: '0 0 0 1px var(--zm-line)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: s.done ? 'check' : s.active ? overdue ? 'alert' : 'clock' : 'clock',
    size: 15
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 11,
      fontWeight: 600,
      color: s.done ? 'var(--zm-success)' : s.active ? 'var(--zm-fg)' : 'var(--zm-fg-3)',
      whiteSpace: 'nowrap'
    }
  }, s.label)), i < steps.length - 1 && /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: 2,
      margin: '0 8px 22px',
      background: s.done ? 'var(--zm-success)' : 'var(--zm-line-strong)',
      borderRadius: 2,
      minWidth: 30
    }
  })))), /*#__PURE__*/React.createElement("button", {
    className: "zm-btn-primary",
    style: {
      height: 38,
      padding: '0 18px',
      border: 'none',
      borderRadius: 9,
      background: overdue ? 'var(--zm-copper)' : 'var(--zm-accent)',
      color: '#fff',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 700,
      cursor: 'pointer',
      boxShadow: 'var(--zm-shadow-1)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 7
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "file",
    size: 15
  }), " View LOI document"));
};
const PhotoTile = ({
  caption,
  hue
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    borderRadius: 11,
    overflow: 'hidden',
    background: `linear-gradient(135deg, hsl(${hue} 30% 80%), hsl(${hue + 30} 28% 62%))`,
    aspectRatio: '4 / 3',
    position: 'relative',
    display: 'flex',
    alignItems: 'flex-end'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    position: 'absolute',
    inset: 0,
    background: 'linear-gradient(to top, rgba(0,0,0,0.42), transparent 55%)'
  }
}), /*#__PURE__*/React.createElement("span", {
  style: {
    position: 'relative',
    padding: 11,
    color: '#fff',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 11.5,
    fontWeight: 600
  }
}, caption));
const SectionCard = ({
  title,
  action,
  children
}) => /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 12
  }
}, /*#__PURE__*/React.createElement("h4", {
  style: {
    margin: 0,
    fontFamily: 'var(--zm-font-display)',
    fontWeight: 650,
    fontSize: 14,
    color: 'var(--zm-fg)',
    letterSpacing: '-0.01em',
    whiteSpace: 'nowrap'
  }
}, title), action), children);
const OverviewTab = ({
  site
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    gap: 26
  }
}, /*#__PURE__*/React.createElement(LoiTrackerBand, {
  site: site
}), /*#__PURE__*/React.createElement(SectionCard, {
  title: "Site fundamentals"
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '20px 24px',
    padding: '22px 24px',
    background: 'var(--zm-surface)',
    border: '1px solid var(--zm-line)',
    borderRadius: 12
  }
}, /*#__PURE__*/React.createElement(Field, {
  label: "Site code",
  value: site.code,
  mono: true
}), /*#__PURE__*/React.createElement(Field, {
  label: "Model",
  value: site.model
}), /*#__PURE__*/React.createElement(Field, {
  label: "City",
  value: site.city
}), /*#__PURE__*/React.createElement(Field, {
  label: "Carpet area",
  value: `${site.carpet} sqft`,
  mono: true
}), /*#__PURE__*/React.createElement(Field, {
  label: "Rent / month",
  value: `₹${site.rent.toLocaleString('en-IN')}`,
  mono: true
}), /*#__PURE__*/React.createElement(Field, {
  label: "CAM",
  value: `₹${site.cam.toLocaleString('en-IN')}`,
  mono: true
}), /*#__PURE__*/React.createElement(Field, {
  label: "Total op cost",
  value: `₹${site.opCost.toLocaleString('en-IN')}`,
  mono: true
}), /*#__PURE__*/React.createElement(Field, {
  label: "Lock-in",
  value: `${site.lockin} months`,
  mono: true
}), /*#__PURE__*/React.createElement(Field, {
  label: "Escalation",
  value: `${site.escalation}% / yr`,
  mono: true
}), /*#__PURE__*/React.createElement(Field, {
  label: "Security deposit",
  value: `₹${site.deposit.toLocaleString('en-IN')}`,
  mono: true
}), /*#__PURE__*/React.createElement(Field, {
  label: "Rent-free days",
  value: `${site.rentFree}`,
  mono: true
}), /*#__PURE__*/React.createElement(Field, {
  label: "Est. monthly sales",
  value: `₹${site.estSalesAbs.toLocaleString('en-IN')}`,
  mono: true,
  accent: true
}))), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 24
  }
}, /*#__PURE__*/React.createElement(SectionCard, {
  title: "SPOC contact",
  action: /*#__PURE__*/React.createElement("button", {
    className: "zm-link-btn",
    style: {
      background: 'none',
      border: 'none',
      color: 'var(--zm-accent)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      fontWeight: 600,
      cursor: 'pointer'
    }
  }, "Call SPOC \u2192")
}, /*#__PURE__*/React.createElement("div", {
  style: {
    padding: 20,
    background: 'var(--zm-surface)',
    border: '1px solid var(--zm-line)',
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    height: '100%',
    boxSizing: 'border-box'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'center',
    gap: 12
  }
}, /*#__PURE__*/React.createElement(Avatar, {
  name: site.spocName,
  size: 42
}), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 14.5,
    fontWeight: 650,
    color: 'var(--zm-fg)'
  }
}, site.spocName), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12,
    color: 'var(--zm-fg-3)'
  }
}, "Site point of contact"))), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16
  }
}, /*#__PURE__*/React.createElement(Field, {
  label: "Phone",
  value: site.spocPhone,
  mono: true
}), /*#__PURE__*/React.createElement(Field, {
  label: "Google pin",
  value: site.pin,
  mono: true
})))), /*#__PURE__*/React.createElement(SectionCard, {
  title: "Location",
  action: /*#__PURE__*/React.createElement("button", {
    className: "zm-link-btn",
    style: {
      background: 'none',
      border: 'none',
      color: 'var(--zm-accent)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      fontWeight: 600,
      cursor: 'pointer'
    }
  }, "Open in Maps \u2192")
}, /*#__PURE__*/React.createElement("div", {
  style: {
    borderRadius: 12,
    position: 'relative',
    overflow: 'hidden',
    border: '1px solid var(--zm-line)',
    minHeight: 150,
    height: '100%',
    backgroundColor: 'var(--zm-surface-2)',
    backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><path d='M32 0 L0 0 0 32' fill='none' stroke='%230F5D5C' stroke-width='0.6' opacity='0.16'/></svg>\")"
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    position: 'absolute',
    top: 12,
    left: 12,
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 10,
    color: 'var(--zm-accent)'
  }
}, "map \xB7 stub"), /*#__PURE__*/React.createElement("span", {
  style: {
    position: 'absolute',
    left: '52%',
    top: '48%',
    width: 16,
    height: 16,
    borderRadius: 999,
    background: 'var(--zm-copper)',
    boxShadow: '0 0 0 7px color-mix(in srgb, var(--zm-copper) 22%, transparent)',
    transform: 'translate(-50%,-50%)'
  }
})))), /*#__PURE__*/React.createElement(SectionCard, {
  title: "Site photos",
  action: /*#__PURE__*/React.createElement("button", {
    className: "zm-btn",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 8,
      padding: '7px 11px',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--zm-fg)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "upload",
    size: 13
  }), " Upload")
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 12
  }
}, /*#__PURE__*/React.createElement(PhotoTile, {
  caption: "Storefront \xB7 day",
  hue: 200
}), /*#__PURE__*/React.createElement(PhotoTile, {
  caption: "Interior shell",
  hue: 30
}), /*#__PURE__*/React.createElement(PhotoTile, {
  caption: "Foot traffic",
  hue: 140
}), /*#__PURE__*/React.createElement(PhotoTile, {
  caption: "Adjacency map",
  hue: 280
}))));
const ActivityTab = () => {
  const entries = [{
    t: '12 min ago',
    who: 'Riya Sharma',
    act: 'uploaded LOI document',
    color: 'var(--zm-info)'
  }, {
    t: '2 hr ago',
    who: 'Aman Verma',
    act: 'set LOI signing date to 2026-05-19',
    color: 'var(--zm-accent)'
  }, {
    t: '1 day ago',
    who: 'Nikhil Iyer',
    act: 'approved site shortlist',
    color: 'var(--zm-success)'
  }, {
    t: '3 days ago',
    who: 'Riya Sharma',
    act: 'completed 17-field site form',
    color: 'var(--zm-accent)'
  }, {
    t: '5 days ago',
    who: 'Riya Sharma',
    act: 'submitted pipeline for shortlist',
    color: 'var(--zm-info)'
  }, {
    t: '6 days ago',
    who: 'Riya Sharma',
    act: 'created pipeline draft',
    color: 'var(--zm-fg-3)'
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 12,
      overflow: 'hidden'
    }
  }, entries.map((e, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'grid',
      gridTemplateColumns: '120px 1fr',
      alignItems: 'center',
      gap: 16,
      padding: '15px 22px',
      borderBottom: i < entries.length - 1 ? '1px solid var(--zm-line-faint)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 11.5,
      color: 'var(--zm-fg-3)'
    }
  }, e.t), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 11
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: 999,
      background: e.color,
      flex: '0 0 7px',
      boxShadow: '0 0 0 3px color-mix(in srgb, ' + e.color + ' 16%, transparent)'
    }
  }), /*#__PURE__*/React.createElement(Avatar, {
    name: e.who,
    size: 24
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg)'
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      fontWeight: 650
    }
  }, e.who), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--zm-fg-2)'
    }
  }, e.act))))));
};
const DocsTab = () => {
  const docs = [{
    name: 'LOI · final signed.pdf',
    size: '482 KB',
    when: '12 min ago',
    who: 'Riya S.'
  }, {
    name: 'Carpet floor plan v3.pdf',
    size: '1.2 MB',
    when: '3 days ago',
    who: 'Riya S.'
  }, {
    name: 'Site photos · 14 images.zip',
    size: '8.4 MB',
    when: '3 days ago',
    who: 'Riya S.'
  }, {
    name: 'Rental agreement draft v2.docx',
    size: '212 KB',
    when: '4 days ago',
    who: 'Aman V.'
  }, {
    name: 'Estimated sales model.xlsx',
    size: '88 KB',
    when: '5 days ago',
    who: 'Riya S.'
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 12,
      overflow: 'hidden'
    }
  }, docs.map((d, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "zm-row",
    style: {
      display: 'grid',
      gridTemplateColumns: '30px 1fr 80px 110px 70px 28px',
      alignItems: 'center',
      gap: 14,
      padding: '13px 18px',
      borderBottom: i < docs.length - 1 ? '1px solid var(--zm-line-faint)' : 'none',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--zm-accent)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "file",
    size: 17
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--zm-fg)'
    }
  }, d.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 11.5,
      color: 'var(--zm-fg-3)'
    }
  }, d.size), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      color: 'var(--zm-fg-3)'
    }
  }, d.when), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      color: 'var(--zm-fg-3)'
    }
  }, d.who), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--zm-fg-3)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "download",
    size: 15
  })))));
};
const SiteDetail = ({
  site,
  backLabel = 'Sites in motion',
  onBack
}) => {
  const [tab, setTab] = React.useState('overview');
  return /*#__PURE__*/React.createElement("div", {
    "data-screen-label": "Site detail",
    style: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: '0 0 auto',
      background: 'var(--zm-surface)',
      borderBottom: '1px solid var(--zm-line)',
      padding: '14px 32px 0',
      position: 'sticky',
      top: 0,
      zIndex: 5
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onBack,
    className: "zm-back-btn",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 7,
      height: 30,
      padding: '0 12px 0 8px',
      borderRadius: 8,
      border: '1px solid var(--zm-line)',
      background: 'var(--zm-bg)',
      color: 'var(--zm-fg-2)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12.5,
      fontWeight: 600,
      cursor: 'pointer',
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "arrowLeft",
    size: 14
  }), " Back to ", backLabel), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 7,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 11.5,
      color: 'var(--zm-fg-3)',
      whiteSpace: 'nowrap'
    }
  }, site.code), /*#__PURE__*/React.createElement(StatusPill, {
    stage: site.stage
  })), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontFamily: 'var(--zm-font-serif)',
      fontStyle: 'italic',
      fontWeight: 400,
      fontSize: 34,
      letterSpacing: '-0.015em',
      color: 'var(--zm-fg)',
      lineHeight: 1
    }
  }, site.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg-3)'
    }
  }, site.city, " \xB7 ", site.model, " \xB7 created by ", site.createdBy, " \xB7 ", site.createdAt)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flex: '0 0 auto'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "zm-btn",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 36,
      padding: '0 14px',
      borderRadius: 8,
      border: '1px solid var(--zm-line)',
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "message",
    size: 14
  }), " Comment"), /*#__PURE__*/React.createElement("button", {
    className: "zm-btn",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 36,
      padding: '0 14px',
      borderRadius: 8,
      border: '1px solid var(--zm-line)',
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg-2)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer'
    }
  }, "Re-assign"), /*#__PURE__*/React.createElement("button", {
    className: "zm-btn-primary",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 7,
      height: 36,
      padding: '0 16px',
      borderRadius: 8,
      border: 'none',
      background: 'var(--zm-accent)',
      color: '#fff',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 700,
      cursor: 'pointer',
      boxShadow: 'var(--zm-shadow-1)'
    }
  }, "Advance to payment ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow",
    size: 14
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 0,
      borderTop: '1px solid var(--zm-line)',
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement(DetailTab, {
    label: "Overview",
    active: tab === 'overview',
    onClick: () => setTab('overview')
  }), /*#__PURE__*/React.createElement(DetailTab, {
    label: "Activity",
    count: 6,
    active: tab === 'activity',
    onClick: () => setTab('activity')
  }), /*#__PURE__*/React.createElement(DetailTab, {
    label: "Documents",
    count: 5,
    active: tab === 'docs',
    onClick: () => setTab('docs')
  }), /*#__PURE__*/React.createElement(DetailTab, {
    label: "Payments",
    count: 1,
    active: tab === 'payments',
    onClick: () => setTab('payments')
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '26px 32px 64px'
    }
  }, tab === 'overview' && /*#__PURE__*/React.createElement(OverviewTab, {
    site: site
  }), tab === 'activity' && /*#__PURE__*/React.createElement(ActivityTab, null), tab === 'docs' && /*#__PURE__*/React.createElement(DocsTab, null), tab === 'payments' && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 56,
      textAlign: 'center',
      background: 'var(--zm-surface)',
      border: '1px dashed var(--zm-line)',
      borderRadius: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      color: 'var(--zm-accent)',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "rupee",
    size: 28
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 14,
      color: 'var(--zm-fg-2)'
    }
  }, "1 draft payment ready for approval \u2014 open the Payments module to action."))));
};
Object.assign(window, {
  SiteDetail
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/bd-redesign/detail.jsx", error: String((e && e.message) || e) }); }

// ui_kits/bd-redesign/kit.jsx
try { (() => {
// ════════════════════════════════════════════════════════════════
// Z-Matrix · BD module redesign — shared kit
// Icons, pills, avatars, micro-charts, count-up, seed data.
// Exported to window for the other Babel scripts.
// ════════════════════════════════════════════════════════════════

const Icon = ({
  name,
  size = 16,
  stroke = 1.6,
  style
}) => {
  const paths = {
    grid: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "3",
      width: "7",
      height: "7",
      rx: "1"
    }), /*#__PURE__*/React.createElement("rect", {
      x: "14",
      y: "3",
      width: "7",
      height: "7",
      rx: "1"
    }), /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "14",
      width: "7",
      height: "7",
      rx: "1"
    }), /*#__PURE__*/React.createElement("rect", {
      x: "14",
      y: "14",
      width: "7",
      height: "7",
      rx: "1"
    })),
    box: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M2 9l10-6 10 6-10 6z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M2 9v6l10 6 10-6V9"
    })),
    pin: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1118 0z"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "10",
      r: "3"
    })),
    calendar: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "4",
      width: "18",
      height: "18",
      rx: "2"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M16 2v4M8 2v4M3 10h18"
    })),
    file: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M14 2v6h6"
    })),
    clock: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "9"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 7v5l3 2"
    })),
    check: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M20 6L9 17l-5-5"
    })),
    alert: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "9"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 8v4M12 16h.01"
    })),
    search: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "11",
      cy: "11",
      r: "7"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M21 21l-4.3-4.3"
    })),
    arrow: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M3 12h18M13 5l7 7-7 7"
    })),
    arrowLeft: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M21 12H3M11 5l-7 7 7 7"
    })),
    plus: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M12 5v14M5 12h14"
    })),
    message: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
    })),
    trend: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M3 3v18h18"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M7 14l3-3 4 4 5-7"
    })),
    shield: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M12 2l9 4v6c0 5-3.5 9.7-9 10-5.5-.3-9-5-9-10V6z"
    })),
    chat: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M21 11.5a8.5 8.5 0 01-15.4 5.1L3 21l4.4-2.6A8.5 8.5 0 1121 11.5z"
    })),
    user: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "7",
      r: "4"
    })),
    chevron: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M9 6l6 6-6 6"
    })),
    chevronDown: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M6 9l6 6 6-6"
    })),
    x: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M18 6L6 18M6 6l12 12"
    })),
    filter: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M22 3H2l8 9.5V19l4 2v-8.5L22 3z"
    })),
    upload: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M17 8l-5-5-5 5"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 3v12"
    })),
    download: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M7 10l5 5 5-5"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 15V3"
    })),
    rupee: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M6 3h12M6 8h12M6 13l5 8M13 3a5 5 0 010 10H6"
    })),
    activity: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M22 12h-4l-3 9L9 3l-3 9H2"
    })),
    folder: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"
    })),
    layers: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M12 2l9 5-9 5-9-5 9-5z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M3 12l9 5 9-5M3 17l9 5 9-5"
    })),
    eye: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "3"
    })),
    flag: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M4 22V4M4 4h13l-2 4 2 4H4"
    })),
    sparkle: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"
    })),
    zap: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M13 2L3 14h7l-1 8 10-12h-7z"
    })),
    target: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "9"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "5"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "1"
    })),
    map: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M9 4v14M15 6v14"
    })),
    phone: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3 19.5 19.5 0 01-6-6 19.8 19.8 0 01-3-8.6A2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.4-1.2a2 2 0 012.1-.5c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z"
    }))
  };
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: style
  }, paths[name] || null);
};

// Stage → semantic tone (mirrors design-system palette)
const TONES = {
  neutral: {
    fg: 'var(--zm-fg-2)',
    bg: 'var(--zm-surface-2)',
    edge: 'var(--zm-line-strong)',
    mark: 'var(--zm-fg-3)'
  },
  accent: {
    fg: 'var(--zm-accent)',
    bg: 'var(--zm-accent-soft)',
    edge: 'var(--zm-accent-line)',
    mark: 'var(--zm-accent)'
  },
  copper: {
    fg: 'var(--zm-copper)',
    bg: 'var(--zm-copper-soft)',
    edge: 'var(--zm-copper-line)',
    mark: 'var(--zm-copper)'
  },
  plum: {
    fg: 'var(--zm-plum)',
    bg: 'var(--zm-plum-soft)',
    edge: 'color-mix(in srgb, var(--zm-plum) 38%, transparent)',
    mark: 'var(--zm-plum)'
  },
  info: {
    fg: 'var(--zm-info)',
    bg: 'var(--zm-info-soft)',
    edge: 'color-mix(in srgb, var(--zm-info) 38%, transparent)',
    mark: 'var(--zm-info)'
  },
  success: {
    fg: 'var(--zm-success)',
    bg: 'var(--zm-success-soft)',
    edge: 'color-mix(in srgb, var(--zm-success) 38%, transparent)',
    mark: 'var(--zm-success)'
  },
  danger: {
    fg: 'var(--zm-danger)',
    bg: 'var(--zm-danger-soft)',
    edge: 'color-mix(in srgb, var(--zm-danger) 38%, transparent)',
    mark: 'var(--zm-danger)'
  }
};
const STAGES = {
  draft: {
    name: 'Draft',
    tone: 'neutral',
    color: 'var(--zm-stage-draft)'
  },
  shortlist: {
    name: 'Shortlist',
    tone: 'info',
    color: 'var(--zm-stage-shortlist)'
  },
  inReview: {
    name: 'In review',
    tone: 'plum',
    color: 'var(--zm-stage-legal)'
  },
  staging: {
    name: 'Staging · LOI',
    tone: 'copper',
    color: 'var(--zm-stage-loi)'
  },
  overdue: {
    name: 'LOI overdue',
    tone: 'danger',
    color: 'var(--zm-danger)'
  },
  uploaded: {
    name: 'LOI uploaded',
    tone: 'accent',
    color: 'var(--zm-accent)'
  },
  completed: {
    name: 'Pushed',
    tone: 'success',
    color: 'var(--zm-success)'
  },
  rejected: {
    name: 'Rejected',
    tone: 'danger',
    color: 'var(--zm-danger)'
  },
  archived: {
    name: 'Archived',
    tone: 'neutral',
    color: 'var(--zm-stage-draft)'
  }
};
const StageDot = ({
  stage,
  size = 9
}) => /*#__PURE__*/React.createElement("span", {
  style: {
    display: 'inline-block',
    width: size,
    height: size,
    borderRadius: 999,
    background: STAGES[stage]?.color || 'var(--zm-fg-3)',
    flex: '0 0 auto',
    boxShadow: '0 0 0 3px color-mix(in srgb, ' + (STAGES[stage]?.color || 'var(--zm-fg-3)') + ' 16%, transparent)'
  }
});
const StatusPill = ({
  stage,
  size = 'md'
}) => {
  const s = STAGES[stage] || STAGES.draft;
  const t = TONES[s.tone] || TONES.neutral;
  const h = size === 'sm' ? 20 : 23;
  return /*#__PURE__*/React.createElement("span", {
    className: "zm-status-pill",
    style: {
      '--pill-mark': t.mark,
      display: 'inline-flex',
      alignItems: 'center',
      height: h,
      borderRadius: 6,
      background: t.bg,
      color: t.fg,
      border: '1px solid ' + t.edge,
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 700,
      fontSize: size === 'sm' ? 9.5 : 10,
      letterSpacing: '0.13em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
      lineHeight: 1,
      position: 'relative',
      overflow: 'hidden',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 3,
      alignSelf: 'stretch',
      background: t.mark,
      flex: '0 0 3px'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      padding: '0 9px 0 8px'
    }
  }, s.name));
};
const Avatar = ({
  name,
  size = 28,
  ring = false
}) => {
  const initials = (name || '').split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  // deterministic hue per name for subtle variety
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      width: size,
      height: size,
      borderRadius: 999,
      background: `color-mix(in srgb, hsl(${h} 45% 55%) 16%, var(--zm-surface))`,
      color: `hsl(${h} 45% 38%)`,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 700,
      fontSize: size * 0.4,
      letterSpacing: 0.3,
      flex: '0 0 auto',
      border: ring ? '2px solid var(--zm-surface)' : 'none',
      boxShadow: ring ? '0 0 0 1px var(--zm-line)' : 'none'
    }
  }, initials || '–');
};

// ─── Micro-charts ──────────────────────────────────────────────────
// Sparkline — smooth area + line
const Sparkline = ({
  data,
  color = 'var(--zm-accent)',
  w = 132,
  h = 40,
  fill = true,
  animate = true
}) => {
  const max = Math.max(...data),
    min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => [i / (data.length - 1) * w, h - (v - min) / range * (h - 6) - 3]);
  const line = pts.map((p, i) => i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  const id = 'sg' + Math.round(w + h + data[0] + data.length * 7);
  return /*#__PURE__*/React.createElement("svg", {
    width: w,
    height: h,
    viewBox: `0 0 ${w} ${h}`,
    style: {
      display: 'block',
      overflow: 'visible'
    }
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
    id: id,
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "1"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: color,
    stopOpacity: "0.20"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: color,
    stopOpacity: "0"
  }))), fill && /*#__PURE__*/React.createElement("path", {
    d: area,
    fill: `url(#${id})`
  }), /*#__PURE__*/React.createElement("path", {
    d: line,
    fill: "none",
    stroke: color,
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: animate ? 'zm-spark' : '',
    pathLength: "1"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: pts[pts.length - 1][0],
    cy: pts[pts.length - 1][1],
    r: "2.6",
    fill: color
  }));
};

// Segmented distribution bar — stages as proportional segments
const SegBar = ({
  segments,
  h = 12,
  gap = 3
}) => {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap,
      width: '100%'
    }
  }, segments.map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    title: `${s.label} · ${s.value}`,
    className: "zm-seg",
    style: {
      flex: s.value,
      height: h,
      borderRadius: 4,
      background: s.color,
      minWidth: s.value ? 6 : 0,
      position: 'relative',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      inset: 0,
      background: 'linear-gradient(180deg, rgba(255,255,255,0.35), transparent 60%)'
    }
  }))));
};

// Mini vertical bars
const MiniBars = ({
  data,
  color = 'var(--zm-fg-3)',
  w = 60,
  h = 26
}) => {
  const max = Math.max(...data) || 1;
  const bw = (w - (data.length - 1) * 3) / data.length;
  return /*#__PURE__*/React.createElement("svg", {
    width: w,
    height: h,
    viewBox: `0 0 ${w} ${h}`,
    style: {
      display: 'block'
    }
  }, data.map((v, i) => {
    const bh = Math.max(2, v / max * h);
    return /*#__PURE__*/React.createElement("rect", {
      key: i,
      x: i * (bw + 3),
      y: h - bh,
      width: bw,
      height: bh,
      rx: "1.5",
      fill: color,
      opacity: i === data.length - 1 ? 1 : 0.45
    });
  }));
};

// Count-up hook — animates a number from 0 on mount, but always renders the
// real target on first paint (capture-safe: never stuck at 0 if rAF stalls).
const useCountUp = (target, dur = 900) => {
  const [val, setVal] = React.useState(target);
  React.useEffect(() => {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVal(target);
      return;
    }
    let raf,
      start,
      done = false;
    const safety = setTimeout(() => {
      if (!done) setVal(target);
    }, 650);
    setVal(0);
    const tick = t => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(eased * target));
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        done = true;
        setVal(target);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(safety);
    };
  }, [target, dur]);
  return val;
};
const pad2 = n => String(n).padStart(2, '0');

// ─── Seed data (from the real BD module) ───────────────────────────
const ME = 'Riya Sharma';
const DRAFTS = [{
  id: 'site_h9d31a40',
  code: 'BT-MUM-0144',
  name: 'BKC One · East Wing',
  city: 'Mumbai',
  visitDate: '2026-05-18',
  days: 1,
  createdBy: 'Riya Sharma'
}, {
  id: 'site_i1e42a51',
  code: 'BT-CHE-0011',
  name: 'Anna Nagar 2nd Ave',
  city: 'Chennai',
  visitDate: '2026-05-16',
  days: 3,
  createdBy: 'Aman Verma'
}, {
  id: 'site_j2f53b62',
  code: 'BT-AHM-0008',
  name: 'CG Road · Navrangpura',
  city: 'Ahmedabad',
  visitDate: '2026-05-14',
  days: 5,
  createdBy: 'Nikhil Iyer'
}, {
  id: 'site_k3g64c73',
  code: 'BT-BLR-0210',
  name: 'HSR Layout 27th Main',
  city: 'Bengaluru',
  visitDate: '2026-05-13',
  days: 7,
  createdBy: 'Aisha Sengupta'
}, {
  id: 'site_l4h75d84',
  code: 'BT-PUN-0024',
  name: 'Baner High Street',
  city: 'Pune',
  visitDate: '2026-05-11',
  days: 9,
  createdBy: 'Riya Sharma'
}, {
  id: 'site_m5i86e95',
  code: 'BT-MUM-0145',
  name: 'Lokhandwala Back Rd',
  city: 'Mumbai',
  visitDate: '2026-05-08',
  days: 12,
  createdBy: 'Aman Verma'
}, {
  id: 'site_n6j97f06',
  code: 'BT-HYD-0036',
  name: 'Jubilee Hills Rd 36',
  city: 'Hyderabad',
  visitDate: '2026-04-29',
  days: 21,
  createdBy: 'Nikhil Iyer'
}, {
  id: 'site_o7k08g17',
  code: 'BT-DEL-0091',
  name: 'Saket M-Block · L13',
  city: 'New Delhi',
  visitDate: '2026-04-26',
  days: 24,
  createdBy: 'Aisha Sengupta'
}, {
  id: 'site_p8l19h28',
  code: 'BT-BLR-0211',
  name: 'Whitefield · Hope Farm',
  city: 'Bengaluru',
  visitDate: '2026-04-22',
  days: 28,
  createdBy: 'Aman Verma'
}];
const SHORTLIST = [{
  code: 'BT-MUM-0143',
  name: 'Bandra Linking Rd',
  city: 'Mumbai',
  visitDate: '2026-05-17',
  createdBy: 'Riya Sharma',
  score: 78,
  estSales: 19.8,
  carpet: 1120,
  rent: 112,
  rentType: 'fixed',
  totalOpCost: 165000,
  hue: 140,
  inReview: true,
  spocName: 'Meera Nair'
}, {
  code: 'BT-MUM-0146',
  name: 'Borivali West · Carter',
  city: 'Mumbai',
  visitDate: '2026-05-15',
  createdBy: 'Riya Sharma',
  score: '',
  estSales: '',
  carpet: '',
  rent: '',
  rentType: '',
  totalOpCost: 0,
  hue: 220,
  inReview: false,
  spocName: 'Karan Shah'
}, {
  code: 'BT-BLR-0209',
  name: 'Koramangala 6th Block',
  city: 'Bengaluru',
  visitDate: '2026-05-15',
  createdBy: 'Aman Verma',
  score: '',
  estSales: '',
  carpet: '',
  rent: '',
  rentType: '',
  totalOpCost: 0,
  hue: 30,
  inReview: false,
  spocName: 'Vivek Rao'
}, {
  code: 'BT-DEL-0090',
  name: 'Connaught Place · F-21',
  city: 'New Delhi',
  visitDate: '2026-05-12',
  createdBy: 'Nikhil Iyer',
  score: 82,
  estSales: 22.0,
  carpet: 1320,
  rent: 142,
  rentType: 'fixed',
  totalOpCost: 198000,
  hue: 200,
  inReview: true,
  spocName: 'Devansh Roy'
}];
const STAGING = [{
  id: 'site_a8f3c129',
  code: 'BT-MUM-0142',
  name: 'Powai · Lake Homes',
  city: 'Mumbai',
  createdBy: 'Riya Sharma',
  spocName: 'Rohan Khanna',
  draftDate: '2026-05-01',
  approvedDate: '2026-05-03',
  approvedBy: 'N. Iyer',
  expectedLoiDays: 14,
  daysSinceApproval: 16,
  loiUploaded: false,
  loiUploadedAt: null,
  daysToLOI: null,
  pushed: false
}, {
  id: 'site_e2c1f8a3',
  code: 'BT-HYD-0034',
  name: 'Banjara Hills Rd 12',
  city: 'Hyderabad',
  createdBy: 'Riya Sharma',
  spocName: 'Pranav Reddy',
  draftDate: '2026-05-08',
  approvedDate: '2026-05-10',
  approvedBy: 'R. Sharma',
  expectedLoiDays: 14,
  daysSinceApproval: 9,
  loiUploaded: false,
  loiUploadedAt: null,
  daysToLOI: null,
  pushed: false
}, {
  id: 'site_q9m20i39',
  code: 'BT-MUM-0140',
  name: 'Andheri · Lokhandwala',
  city: 'Mumbai',
  createdBy: 'Riya Sharma',
  spocName: 'Tanvi Joshi',
  draftDate: '2026-04-06',
  approvedDate: '2026-04-08',
  approvedBy: 'N. Iyer',
  expectedLoiDays: 14,
  daysSinceApproval: 14,
  loiUploaded: true,
  loiUploadedAt: '2026-04-21',
  daysToLOI: 13,
  pushed: false
}, {
  id: 'site_r0n31j40',
  code: 'BT-DEL-0086',
  name: 'GK-1 N-Block · 142',
  city: 'New Delhi',
  createdBy: 'Aman Verma',
  spocName: 'Vikram Anand',
  draftDate: '2026-03-30',
  approvedDate: '2026-04-02',
  approvedBy: 'R. Sharma',
  expectedLoiDays: 21,
  daysSinceApproval: 20,
  loiUploaded: true,
  loiUploadedAt: '2026-04-22',
  daysToLOI: 20,
  pushed: false
}];
const ARCHIVE_SEED = [{
  id: 'site_arch_001',
  code: 'BT-MUM-0091',
  name: 'Khar · Linking Rd 33',
  city: 'Mumbai',
  createdBy: 'Aman Verma',
  archivedAt: '2026-04-12',
  reasons: ['High rent', 'High cannibalisation'],
  note: ''
}, {
  id: 'site_arch_002',
  code: 'BT-DEL-0072',
  name: 'Defence Colony · 12B',
  city: 'New Delhi',
  createdBy: 'Nikhil Iyer',
  archivedAt: '2026-03-30',
  reasons: ['Affluence problem'],
  note: ''
}, {
  id: 'site_arch_003',
  code: 'BT-BLR-0188',
  name: 'Jayanagar 4th Block',
  city: 'Bengaluru',
  createdBy: 'Riya Sharma',
  archivedAt: '2026-03-18',
  reasons: ['No visibility', 'Sales problem'],
  note: 'Revisit post-metro line'
}];

// Build a rich detail record for the full-page site view
const buildSite = (row, stage) => ({
  ...row,
  id: row.id || row.code,
  stage: stage || row.stage || 'draft',
  carpet: row.carpet || 1080,
  opCost: row.totalOpCost || 142000,
  rent: row.rent ? row.rent * 1000 : 86000,
  cam: 18000,
  deposit: 420000,
  lockin: 36,
  escalation: 5,
  rentFree: 30,
  estSalesAbs: (row.estSales || 14) * 100000,
  model: 'Café · 900–1200 sqft',
  spocName: row.spocName || row.createdBy || 'TBD',
  spocPhone: '+91 ••••• •••••',
  pin: '19.07° N, 72.87° E',
  loiSignedAt: row.loiUploadedAt || '—',
  loiSubmittedAt: row.loiUploadedAt || '—',
  days: row.days ?? row.daysSinceApproval ?? 0,
  createdAt: row.createdAt || row.visitDate || row.approvedDate || '—',
  city: row.city
});
Object.assign(window, {
  Icon,
  TONES,
  STAGES,
  StageDot,
  StatusPill,
  Avatar,
  Sparkline,
  SegBar,
  MiniBars,
  useCountUp,
  pad2,
  ME,
  DRAFTS,
  SHORTLIST,
  STAGING,
  ARCHIVE_SEED,
  buildSite
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/bd-redesign/kit.jsx", error: String((e && e.message) || e) }); }

// ui_kits/bd-redesign/kpis.jsx
try { (() => {
// ════════════════════════════════════════════════════════════════
// KPI deck — hero card + supporting cards with micro-charts
// ════════════════════════════════════════════════════════════════

// Corner registration ticks (editorial "field manual" detail)
const CornerTicks = ({
  color = 'var(--zm-fg-3)',
  opacity = 0.3
}) => /*#__PURE__*/React.createElement(React.Fragment, null, [{
  top: 0,
  left: 0
}, {
  top: 0,
  right: 0,
  rot: 90
}, {
  bottom: 0,
  right: 0,
  rot: 180
}, {
  bottom: 0,
  left: 0,
  rot: -90
}].map((p, i) => /*#__PURE__*/React.createElement("span", {
  key: i,
  "aria-hidden": true,
  style: {
    position: 'absolute',
    width: 7,
    height: 7,
    ...p,
    margin: 7,
    borderTop: '1.5px solid ' + color,
    borderLeft: '1.5px solid ' + color,
    opacity,
    transform: `rotate(${p.rot || 0}deg)`,
    pointerEvents: 'none'
  }
})));

// ─── Hero KPI — portfolio pulse ────────────────────────────────────
const HeroKpi = ({
  total,
  distribution,
  trend,
  delta,
  cities
}) => {
  const value = useCountUp(total, 1000);
  return /*#__PURE__*/React.createElement("article", {
    className: "zm-kpi zm-kpi-hero",
    style: {
      position: 'relative',
      overflow: 'hidden',
      borderRadius: 16,
      padding: '20px 24px 18px',
      background: 'linear-gradient(158deg, color-mix(in srgb, var(--zm-accent) 7%, var(--zm-surface)) 0%, var(--zm-surface) 60%)',
      border: '1px solid var(--zm-accent-line)',
      boxShadow: 'var(--zm-glass)',
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(CornerTicks, {
    color: "var(--zm-accent)",
    opacity: 0.4
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 3
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "zm-live-dot",
    style: {
      width: 7,
      height: 7,
      borderRadius: 999,
      background: 'var(--zm-accent)',
      flex: '0 0 auto'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 700,
      fontSize: 9.5,
      letterSpacing: '0.18em',
      textTransform: 'uppercase',
      color: 'var(--zm-accent)',
      whiteSpace: 'nowrap'
    }
  }, "Sites in motion")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 11.5,
      color: 'var(--zm-fg-3)',
      whiteSpace: 'nowrap'
    }
  }, "Portfolio-wide \xB7 synced 2 min ago")), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      height: 24,
      padding: '0 10px',
      borderRadius: 999,
      background: 'var(--zm-success-soft)',
      color: 'var(--zm-success)',
      border: '1px solid color-mix(in srgb, var(--zm-success) 30%, transparent)',
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 11,
      fontWeight: 600,
      whiteSpace: 'nowrap'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "trend",
    size: 12
  }), delta)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-serif)',
      fontStyle: 'italic',
      fontWeight: 400,
      fontSize: 80,
      lineHeight: 0.9,
      letterSpacing: '-0.01em',
      color: 'var(--zm-fg)',
      fontFeatureSettings: "'tnum' 1",
      flex: '0 0 auto'
    }
  }, pad2(value)), /*#__PURE__*/React.createElement("div", {
    style: {
      paddingBottom: 6,
      flex: '0 0 auto'
    }
  }, /*#__PURE__*/React.createElement(Sparkline, {
    data: trend,
    color: "var(--zm-accent)",
    w: 140,
    h: 46
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12.5,
      color: 'var(--zm-fg-3)'
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--zm-fg-2)',
      fontWeight: 600
    }
  }, "across ", cities, " cities"), " \xB7 12-week intake trend")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 9,
      marginTop: 2
    }
  }, /*#__PURE__*/React.createElement(SegBar, {
    segments: distribution,
    h: 13
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px 16px'
    }
  }, distribution.map((s, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 11.5,
      color: 'var(--zm-fg-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 2,
      background: s.color
    }
  }), s.label, /*#__PURE__*/React.createElement("strong", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 11.5,
      color: 'var(--zm-fg)',
      fontWeight: 600
    }
  }, pad2(s.value)))))));
};

// ─── Supporting KPI ────────────────────────────────────────────────
const SupportKpi = ({
  no,
  eyebrow,
  value,
  sub,
  subTone = 'muted',
  tone = 'neutral',
  chart,
  onClick
}) => {
  const v = useCountUp(value, 850);
  const t = TONES[tone] || TONES.neutral;
  const alert = tone === 'copper' || tone === 'danger';
  return /*#__PURE__*/React.createElement("article", {
    onClick: onClick,
    className: "zm-kpi",
    style: {
      position: 'relative',
      overflow: 'hidden',
      borderRadius: 16,
      padding: '18px 18px 16px',
      background: alert ? 'linear-gradient(160deg, var(--zm-copper-soft), var(--zm-surface) 70%)' : 'var(--zm-surface)',
      border: '1px solid ' + (alert ? 'var(--zm-copper-line)' : 'var(--zm-line)'),
      boxShadow: 'var(--zm-shadow-1)',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      cursor: onClick ? 'pointer' : 'default'
    }
  }, /*#__PURE__*/React.createElement(CornerTicks, {
    color: alert ? 'var(--zm-copper)' : 'var(--zm-fg-3)',
    opacity: alert ? 0.45 : 0.28
  }), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": true,
    style: {
      position: 'absolute',
      inset: '0 0 auto 0',
      height: 2,
      background: 'linear-gradient(90deg, ' + t.mark + ', transparent)',
      opacity: alert ? 0.7 : 0.5
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, no && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.12em',
      color: alert ? 'var(--zm-copper)' : 'var(--zm-fg-4)'
    }
  }, no), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 700,
      fontSize: 9.5,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      color: alert ? 'var(--zm-copper)' : 'var(--zm-fg-3)',
      flex: 1,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, eyebrow), alert && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      color: 'var(--zm-copper)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "alert",
    size: 14
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-serif)',
      fontStyle: 'italic',
      fontWeight: 400,
      fontSize: 56,
      lineHeight: 0.85,
      letterSpacing: '-0.02em',
      color: alert ? 'var(--zm-copper)' : 'var(--zm-fg)',
      fontFeatureSettings: "'tnum' 1"
    }
  }, pad2(v)), /*#__PURE__*/React.createElement("div", {
    style: {
      paddingBottom: 6
    }
  }, chart)), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 30,
      height: 1.5,
      background: t.mark,
      opacity: 0.65,
      borderRadius: 2
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      lineHeight: 1.35,
      color: subTone === 'neg' ? 'var(--zm-danger)' : subTone === 'copper' ? 'var(--zm-copper)' : subTone === 'pos' ? 'var(--zm-success)' : 'var(--zm-fg-3)',
      fontWeight: subTone === 'muted' ? 400 : 600
    }
  }, sub));
};

// Small ratio bar used inside the overdue card
const RatioBar = ({
  value,
  total,
  color = 'var(--zm-copper)',
  w = 60
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    alignItems: 'flex-end'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    width: w,
    height: 6,
    borderRadius: 999,
    background: 'var(--zm-surface-sunken)',
    overflow: 'hidden'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    width: `${Math.round(value / total * 100)}%`,
    height: '100%',
    background: color,
    borderRadius: 999
  }
})), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 10.5,
    color: 'var(--zm-fg-3)'
  }
}, value, "/", total, " staging"));
const KpiDeck = ({
  metrics,
  onAlert
}) => /*#__PURE__*/React.createElement("div", {
  className: "zm-stagger",
  style: {
    display: 'grid',
    gridTemplateColumns: '1.85fr 1fr 1fr 1fr',
    gap: 14,
    alignItems: 'stretch'
  }
}, /*#__PURE__*/React.createElement(HeroKpi, {
  total: metrics.total,
  cities: metrics.cities,
  delta: metrics.delta,
  trend: metrics.trend,
  distribution: metrics.distribution
}), /*#__PURE__*/React.createElement(SupportKpi, {
  no: "\u2160",
  eyebrow: "New drafts",
  value: metrics.drafts,
  tone: "neutral",
  sub: metrics.staleDrafts > 0 ? `${metrics.staleDrafts} past 7-day SLA` : 'All within SLA',
  subTone: metrics.staleDrafts > 0 ? 'neg' : 'pos',
  chart: /*#__PURE__*/React.createElement(MiniBars, {
    data: [3, 5, 2, 6, 4, 9],
    color: "var(--zm-fg-3)",
    w: 56,
    h: 26
  })
}), /*#__PURE__*/React.createElement(SupportKpi, {
  no: "\u2161",
  eyebrow: "Awaiting decision",
  value: metrics.shortlist,
  tone: "info",
  sub: `${metrics.inReview} in review · ready to approve`,
  subTone: "muted",
  chart: /*#__PURE__*/React.createElement(MiniBars, {
    data: [1, 2, 1, 3, 2, 4],
    color: "var(--zm-info)",
    w: 56,
    h: 26
  })
}), /*#__PURE__*/React.createElement(SupportKpi, {
  no: "\u2162",
  eyebrow: "LOI overdue",
  value: metrics.loiOverdue,
  tone: "copper",
  onClick: onAlert,
  sub: "past expected timeline",
  subTone: "copper",
  chart: /*#__PURE__*/React.createElement(RatioBar, {
    value: metrics.loiOverdue,
    total: metrics.staging,
    color: "var(--zm-copper)"
  })
}));
Object.assign(window, {
  KpiDeck,
  HeroKpi,
  SupportKpi,
  CornerTicks
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/bd-redesign/kpis.jsx", error: String((e && e.message) || e) }); }

// ui_kits/bd-redesign/screens.jsx
try { (() => {
// ════════════════════════════════════════════════════════════════
// Screens — header, filters, sites table, and the workflow views
// ════════════════════════════════════════════════════════════════

// ─── Editorial page header ─────────────────────────────────────────
const PageHeader = ({
  file,
  eyebrow,
  title,
  lede,
  right
}) => /*#__PURE__*/React.createElement("header", {
  style: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 24,
    marginBottom: 20,
    paddingBottom: 16,
    borderBottom: '1px solid var(--zm-line)',
    position: 'relative'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minWidth: 0,
    flex: 1
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'center',
    gap: 14
  }
}, file && /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.18em',
    color: 'var(--zm-fg-4)',
    whiteSpace: 'nowrap'
  }
}, file), file && /*#__PURE__*/React.createElement("span", {
  style: {
    width: 18,
    height: 1,
    background: 'var(--zm-line-strong)',
    flex: '0 0 auto'
  }
}), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    color: 'var(--zm-fg-3)',
    whiteSpace: 'nowrap'
  }
}, eyebrow)), /*#__PURE__*/React.createElement("h1", {
  style: {
    margin: 0,
    color: 'var(--zm-fg)',
    fontFamily: 'var(--zm-font-serif)',
    fontWeight: 400,
    fontSize: 46,
    lineHeight: 1,
    letterSpacing: '-0.015em',
    fontStyle: 'italic'
  }
}, title), lede && /*#__PURE__*/React.createElement("p", {
  style: {
    margin: '8px 0 0',
    maxWidth: 760,
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13.5,
    lineHeight: 1.55,
    color: 'var(--zm-fg-2)'
  }
}, lede)), right && /*#__PURE__*/React.createElement("div", {
  style: {
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'flex-end',
    gap: 10
  }
}, right));
const HeaderTag = ({
  icon,
  label,
  tone = 'default'
}) => /*#__PURE__*/React.createElement("span", {
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 24,
    padding: '0 11px 0 9px',
    borderRadius: 6,
    border: '1px solid ' + (tone === 'accent' ? 'var(--zm-accent-line)' : tone === 'copper' ? 'var(--zm-copper-line)' : 'var(--zm-line-strong)'),
    background: tone === 'accent' ? 'var(--zm-accent-soft)' : tone === 'copper' ? 'var(--zm-copper-soft)' : 'transparent',
    color: tone === 'accent' ? 'var(--zm-accent)' : tone === 'copper' ? 'var(--zm-copper)' : 'var(--zm-fg-2)',
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 700,
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    lineHeight: 1
  }
}, icon && /*#__PURE__*/React.createElement(Icon, {
  name: icon,
  size: 11
}), label);

// ─── Filter chips ──────────────────────────────────────────────────
const FilterChip = ({
  active,
  label,
  count,
  color,
  onClick
}) => /*#__PURE__*/React.createElement("button", {
  onClick: onClick,
  className: "zm-pill",
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    height: 32,
    padding: '0 13px',
    borderRadius: 999,
    border: '1px solid ' + (active ? 'var(--zm-fg)' : 'var(--zm-line)'),
    background: active ? 'var(--zm-fg)' : 'var(--zm-surface)',
    color: active ? 'var(--zm-fg-inv)' : 'var(--zm-fg-2)',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer'
  }
}, color && /*#__PURE__*/React.createElement("span", {
  style: {
    width: 7,
    height: 7,
    borderRadius: 999,
    background: color
  }
}), label, count != null && /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontWeight: 600,
    fontSize: 11,
    color: active ? 'var(--zm-fg-inv)' : 'var(--zm-fg-3)',
    opacity: active ? 0.7 : 1
  }
}, count));
const FilterRow = ({
  stage,
  onStage,
  counts
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap'
  }
}, /*#__PURE__*/React.createElement(FilterChip, {
  label: "All",
  count: counts.all,
  active: stage === 'all',
  onClick: () => onStage('all')
}), /*#__PURE__*/React.createElement(FilterChip, {
  label: "Draft",
  count: counts.draft,
  active: stage === 'draft',
  onClick: () => onStage('draft'),
  color: STAGES.draft.color
}), /*#__PURE__*/React.createElement(FilterChip, {
  label: "Shortlist",
  count: counts.shortlist,
  active: stage === 'shortlist',
  onClick: () => onStage('shortlist'),
  color: STAGES.shortlist.color
}), /*#__PURE__*/React.createElement(FilterChip, {
  label: "In process",
  count: counts.staging,
  active: stage === 'staging',
  onClick: () => onStage('staging'),
  color: STAGES.staging.color
}), /*#__PURE__*/React.createElement("span", {
  style: {
    flex: 1
  }
}), /*#__PURE__*/React.createElement("button", {
  className: "zm-btn",
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 32,
    padding: '0 13px',
    borderRadius: 999,
    border: '1px solid var(--zm-line)',
    background: 'var(--zm-surface)',
    color: 'var(--zm-fg-2)',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "filter",
  size: 13
}), " More filters"));

// ─── Sites table (motion) — hover reveals "Open" ───────────────────
const COLS = '14px 0.85fr 1.7fr 0.95fr 1fr 0.6fr 1.05fr 96px';
const MotionTable = ({
  rows,
  onOpen
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    background: 'var(--zm-surface)',
    border: '1px solid var(--zm-line)',
    borderRadius: 14,
    overflow: 'hidden',
    boxShadow: 'var(--zm-shadow-1)'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'grid',
    gridTemplateColumns: COLS,
    gap: 12,
    padding: '12px 18px',
    background: 'var(--zm-surface-2)',
    borderBottom: '1px solid var(--zm-line)',
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 700,
    fontSize: 10,
    letterSpacing: '0.13em',
    textTransform: 'uppercase',
    color: 'var(--zm-fg-3)'
  }
}, /*#__PURE__*/React.createElement("span", null), /*#__PURE__*/React.createElement("span", null, "Code"), /*#__PURE__*/React.createElement("span", null, "Site"), /*#__PURE__*/React.createElement("span", null, "City"), /*#__PURE__*/React.createElement("span", null, "Owner"), /*#__PURE__*/React.createElement("span", null, "Days"), /*#__PURE__*/React.createElement("span", null, "Stage"), /*#__PURE__*/React.createElement("span", null)), rows.slice(0, 12).map((r, i) => {
  const overdue = r.stage === 'overdue';
  return /*#__PURE__*/React.createElement("div", {
    key: r.id,
    onClick: () => onOpen(r),
    className: "zm-row",
    style: {
      display: 'grid',
      gridTemplateColumns: COLS,
      gap: 12,
      padding: '13px 18px',
      alignItems: 'center',
      borderBottom: i < rows.slice(0, 12).length - 1 ? '1px solid var(--zm-line-faint)' : 'none',
      background: overdue ? 'color-mix(in srgb, var(--zm-copper) 6%, transparent)' : 'transparent',
      cursor: 'pointer',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(StageDot, {
    stage: r.stage
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 11.5,
      color: 'var(--zm-fg-3)'
    }
  }, r.code), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13.5,
      fontWeight: 600,
      color: 'var(--zm-fg)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, r.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg-2)'
    }
  }, r.city), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: r.owner,
    size: 22
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12.5,
      color: 'var(--zm-fg-2)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, r.owner)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 12.5,
      fontWeight: overdue ? 700 : 500,
      color: overdue ? 'var(--zm-copper)' : 'var(--zm-fg)'
    }
  }, pad2(r.days), "d"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement(StatusPill, {
    stage: r.stage
  })), /*#__PURE__*/React.createElement("span", {
    className: "zm-row-cta",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 5,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      fontWeight: 700,
      color: 'var(--zm-accent)',
      whiteSpace: 'nowrap'
    }
  }, "Open ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow",
    size: 13
  })));
}), rows.length === 0 && /*#__PURE__*/React.createElement("div", {
  style: {
    padding: 48,
    textAlign: 'center',
    color: 'var(--zm-fg-3)',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13
  }
}, "No sites in this stage right now."));

// ═══ OVERVIEW ══════════════════════════════════════════════════════
const OverviewScreen = ({
  role,
  rows,
  metrics,
  stage,
  onStage,
  counts,
  onOpen
}) => /*#__PURE__*/React.createElement("div", {
  "data-screen-label": "Sites in motion"
}, /*#__PURE__*/React.createElement(PageHeader, {
  file: "\u2116 01",
  eyebrow: "Overview",
  title: "Sites in motion",
  lede: role === 'supervisor' ? `All sites in your tenant — ${counts.all} files across draft, shortlist and in-process. Start with what's blocking the next handoff.` : `Your sites, ${ME} — ${counts.all} files across draft, shortlist and in-process.`,
  right: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(HeaderTag, {
    icon: "clock",
    label: "LIVE \xB7 2M LAG"
  }), /*#__PURE__*/React.createElement(HeaderTag, {
    icon: "shield",
    label: role === 'supervisor' ? 'TENANT SCOPE' : 'PERSONAL SCOPE',
    tone: "accent"
  }))
}), /*#__PURE__*/React.createElement("div", {
  style: {
    marginBottom: 18
  }
}, /*#__PURE__*/React.createElement(KpiDeck, {
  metrics: metrics,
  onAlert: () => onStage('staging')
})), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12
  }
}, /*#__PURE__*/React.createElement("h2", {
  style: {
    margin: 0,
    fontFamily: 'var(--zm-font-display)',
    fontWeight: 650,
    fontSize: 15,
    letterSpacing: '-0.01em',
    color: 'var(--zm-fg)'
  }
}, "Priority queue"), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12,
    color: 'var(--zm-fg-3)'
  }
}, "Sorted by urgency \xB7 click any row to open")), /*#__PURE__*/React.createElement("div", {
  style: {
    marginBottom: 14
  }
}, /*#__PURE__*/React.createElement(FilterRow, {
  stage: stage,
  onStage: onStage,
  counts: counts
})), /*#__PURE__*/React.createElement(MotionTable, {
  rows: rows,
  onOpen: onOpen
}));

// ═══ PIPELINE / DRAFTS ═════════════════════════════════════════════
const DCOLS_SUP = '14px 0.85fr 1.5fr 1fr 0.9fr 0.85fr 0.6fr 232px';
const DCOLS_EXEC = '14px 0.85fr 1.5fr 1fr 0.9fr 0.85fr 0.6fr 96px';
const DraftRow = ({
  d,
  role,
  last,
  onOpen,
  onApprove,
  onReject,
  onArchive
}) => {
  const overdue = role === 'supervisor' && d.days > 7;
  const cols = role === 'supervisor' ? DCOLS_SUP : DCOLS_EXEC;
  return /*#__PURE__*/React.createElement("div", {
    className: "zm-row",
    style: {
      display: 'grid',
      gridTemplateColumns: cols,
      gap: 12,
      padding: '12px 18px',
      alignItems: 'center',
      borderBottom: last ? 'none' : '1px solid var(--zm-line-faint)',
      background: overdue ? 'color-mix(in srgb, var(--zm-danger) 5%, transparent)' : 'transparent',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(StageDot, {
    stage: overdue ? 'overdue' : 'draft'
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 11.5,
      color: 'var(--zm-fg-3)'
    }
  }, d.code), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13.5,
      fontWeight: 600,
      color: 'var(--zm-fg)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, d.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 10.5,
      color: 'var(--zm-fg-4)'
    }
  }, d.id)), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: d.createdBy,
    size: 22
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12.5,
      color: 'var(--zm-fg-2)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, d.createdBy)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg-2)'
    }
  }, d.city), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 12,
      color: 'var(--zm-fg-3)'
    }
  }, d.visitDate), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 12.5,
      fontWeight: overdue ? 700 : 500,
      color: overdue ? 'var(--zm-danger)' : 'var(--zm-fg)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5
    }
  }, overdue && /*#__PURE__*/React.createElement(Icon, {
    name: "alert",
    size: 12
  }), pad2(d.days), "d"), role === 'supervisor' ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      justifyContent: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: e => {
      e.stopPropagation();
      onOpen(d);
    },
    title: "View",
    className: "zm-icon-btn",
    style: iconBtn
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "eye",
    size: 15
  })), /*#__PURE__*/React.createElement("button", {
    onClick: e => {
      e.stopPropagation();
      onArchive(d);
    },
    title: "Archive",
    className: "zm-icon-btn",
    style: iconBtn
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "folder",
    size: 14
  })), /*#__PURE__*/React.createElement("button", {
    onClick: e => {
      e.stopPropagation();
      onReject(d);
    },
    className: "zm-btn-danger",
    style: {
      height: 32,
      padding: '0 11px',
      border: '1px solid var(--zm-danger-soft)',
      borderRadius: 8,
      background: 'var(--zm-surface)',
      color: 'var(--zm-danger)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      fontWeight: 700,
      cursor: 'pointer'
    }
  }, "No"), /*#__PURE__*/React.createElement("button", {
    onClick: e => {
      e.stopPropagation();
      onApprove(d);
    },
    className: "zm-btn-primary",
    style: {
      height: 32,
      padding: '0 14px',
      border: 'none',
      borderRadius: 8,
      background: 'var(--zm-accent)',
      color: '#fff',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      fontWeight: 700,
      cursor: 'pointer',
      boxShadow: 'var(--zm-shadow-1)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 12
  }), " Yes")) : /*#__PURE__*/React.createElement("button", {
    onClick: e => {
      e.stopPropagation();
      onOpen(d);
    },
    className: "zm-btn",
    style: {
      height: 32,
      padding: '0 12px',
      border: '1px solid var(--zm-line)',
      borderRadius: 8,
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg-2)',
      justifySelf: 'end',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      fontWeight: 600,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "eye",
    size: 14
  }), " View"));
};
const iconBtn = {
  width: 32,
  height: 32,
  padding: 0,
  border: '1px solid var(--zm-line)',
  borderRadius: 8,
  background: 'var(--zm-surface)',
  color: 'var(--zm-fg-2)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center'
};
const DraftsScreen = ({
  role,
  drafts,
  onOpen,
  onApprove,
  onReject,
  onArchive
}) => {
  const overdueCount = role === 'supervisor' ? drafts.filter(d => d.days > 7).length : 0;
  const cols = role === 'supervisor' ? DCOLS_SUP : DCOLS_EXEC;
  return /*#__PURE__*/React.createElement("div", {
    "data-screen-label": "Pipeline"
  }, /*#__PURE__*/React.createElement(PageHeader, {
    file: "\u2116 02",
    eyebrow: "Workflow \xB7 Pipeline",
    title: role === 'supervisor' ? 'Drafts awaiting shortlist' : 'Your drafts in flight',
    lede: role === 'supervisor' ? `${drafts.length} drafts from all your BD execs. SLA: 7 days. Decide Yes, No, or Archive.` : `${drafts.length} of your own drafts awaiting supervisor decision.`,
    right: overdueCount > 0 ? /*#__PURE__*/React.createElement(HeaderTag, {
      icon: "alert",
      label: `${overdueCount} PAST SLA`,
      tone: "copper"
    }) : /*#__PURE__*/React.createElement(HeaderTag, {
      icon: "check",
      label: "SLA CLEAR",
      tone: "accent"
    })
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 14,
      overflow: 'hidden',
      boxShadow: 'var(--zm-shadow-1)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: cols,
      gap: 12,
      padding: '12px 18px',
      background: 'var(--zm-surface-2)',
      borderBottom: '1px solid var(--zm-line)',
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 700,
      fontSize: 10,
      letterSpacing: '0.13em',
      textTransform: 'uppercase',
      color: 'var(--zm-fg-3)'
    }
  }, /*#__PURE__*/React.createElement("span", null), /*#__PURE__*/React.createElement("span", null, "Code"), /*#__PURE__*/React.createElement("span", null, "Pipeline"), /*#__PURE__*/React.createElement("span", null, "Created by"), /*#__PURE__*/React.createElement("span", null, "City"), /*#__PURE__*/React.createElement("span", null, "Visit"), /*#__PURE__*/React.createElement("span", null, "Days"), /*#__PURE__*/React.createElement("span", {
    style: {
      textAlign: 'right'
    }
  }, role === 'supervisor' ? 'Decision' : 'Action')), drafts.map((d, i) => /*#__PURE__*/React.createElement(DraftRow, {
    key: d.id,
    d: d,
    role: role,
    last: i === drafts.length - 1,
    onOpen: onOpen,
    onApprove: onApprove,
    onReject: onReject,
    onArchive: onArchive
  })), drafts.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 48,
      textAlign: 'center',
      color: 'var(--zm-fg-3)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13
    }
  }, "No drafts right now.")));
};

// ═══ SHORTLIST ═════════════════════════════════════════════════════
const ShortlistCard = ({
  item,
  role,
  onOpen,
  onAddDetails,
  onApprove
}) => {
  const supervisor = role === 'supervisor';
  const reviewable = item.inReview === true;
  const stats = [['Est. sales', item.estSales ? `₹${item.estSales}L` : '—'], ['Carpet', item.carpet ? `${item.carpet} sqft` : '—'], ['Total op', item.totalOpCost ? `₹${Math.round(item.totalOpCost / 1000)}k/mo` : '—'], ['Rent type', item.rentType === 'fixed' ? 'Fixed + esc.' : item.rentType === 'revshare' ? 'Rev share' : '—']];
  return /*#__PURE__*/React.createElement("div", {
    className: "zm-card-hover",
    style: {
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 14,
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      boxShadow: 'var(--zm-shadow-1)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: () => onOpen(item),
    style: {
      width: 60,
      height: 60,
      borderRadius: 12,
      flex: '0 0 60px',
      cursor: 'pointer',
      background: `linear-gradient(135deg, hsl(${item.hue} 32% 78%), hsl(${item.hue + 30} 30% 58%))`,
      position: 'relative',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      inset: 0,
      background: 'linear-gradient(180deg, rgba(255,255,255,0.25), transparent 50%)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 11,
      color: 'var(--zm-fg-3)'
    }
  }, item.code), /*#__PURE__*/React.createElement(StatusPill, {
    stage: reviewable ? 'inReview' : 'shortlist',
    size: "sm"
  })), /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontFamily: 'var(--zm-font-display)',
      fontWeight: 650,
      fontSize: 17,
      color: 'var(--zm-fg)',
      letterSpacing: '-0.01em'
    }
  }, item.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12.5,
      color: 'var(--zm-fg-3)'
    }
  }, item.city, " \xB7 visit ", item.visitDate, " \xB7 ", item.createdBy)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 700,
      fontSize: 9.5,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: 'var(--zm-fg-3)'
    }
  }, "Score"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-serif)',
      fontStyle: 'italic',
      fontWeight: 400,
      fontSize: 32,
      lineHeight: 1,
      color: item.score >= 75 ? 'var(--zm-success)' : 'var(--zm-fg)'
    }
  }, item.score || '—'))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      padding: '12px 0',
      borderTop: '1px solid var(--zm-line-faint)',
      borderBottom: '1px solid var(--zm-line-faint)'
    }
  }, stats.map(([k, v]) => /*#__PURE__*/React.createElement("div", {
    key: k,
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 3
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 10,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: 'var(--zm-fg-3)'
    }
  }, k), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--zm-fg)'
    }
  }, v)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onOpen(item),
    title: "View",
    className: "zm-icon-btn",
    style: {
      ...iconBtn,
      width: 34,
      height: 34
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "eye",
    size: 16
  })), !supervisor && /*#__PURE__*/React.createElement("button", {
    onClick: () => onAddDetails(item),
    className: "zm-btn",
    style: {
      height: 34,
      padding: '0 14px',
      border: '1px solid var(--zm-line)',
      borderRadius: 8,
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 13
  }), " ", reviewable ? 'Edit details' : 'Add details'), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), supervisor ? /*#__PURE__*/React.createElement("button", {
    onClick: () => onApprove(item),
    disabled: !reviewable,
    className: "zm-btn-primary",
    title: !reviewable ? 'Exec must send for review first' : 'Approve & advance',
    style: {
      height: 34,
      padding: '0 14px',
      border: 'none',
      borderRadius: 8,
      background: reviewable ? 'var(--zm-accent)' : 'var(--zm-surface-sunken)',
      color: reviewable ? '#fff' : 'var(--zm-fg-4)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12.5,
      fontWeight: 700,
      cursor: reviewable ? 'pointer' : 'not-allowed',
      boxShadow: reviewable ? 'var(--zm-shadow-1)' : 'none',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 13
  }), " Approve shortlist") : reviewable ? /*#__PURE__*/React.createElement("span", {
    style: {
      padding: '7px 11px',
      borderRadius: 8,
      background: 'var(--zm-accent-soft)',
      border: '1px solid var(--zm-accent-line)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 11.5,
      color: 'var(--zm-accent)',
      fontWeight: 600,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "clock",
    size: 12
  }), " Awaiting approval") : /*#__PURE__*/React.createElement("span", {
    style: {
      padding: '7px 11px',
      borderRadius: 8,
      background: 'var(--zm-surface-2)',
      border: '1px solid var(--zm-line)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 11.5,
      color: 'var(--zm-fg-3)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "alert",
    size: 12
  }), " Add 17 fields, then send")));
};
const ShortlistScreen = ({
  role,
  items,
  onOpen,
  onAddDetails,
  onApprove
}) => /*#__PURE__*/React.createElement("div", {
  "data-screen-label": "Shortlist queue",
  style: {
    maxWidth: 940
  }
}, /*#__PURE__*/React.createElement(PageHeader, {
  file: "\u2116 03",
  eyebrow: "Workflow \xB7 Shortlist",
  title: "Shortlist queue",
  lede: role === 'supervisor' ? `${items.length} sites cleared from pipeline — approve once the exec marks them in review.` : `${items.length} of your shortlisted sites — add the 17 essential fields, then send for review.`,
  right: /*#__PURE__*/React.createElement(HeaderTag, {
    icon: "clock",
    label: "OLDEST FIRST"
  })
}), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14
  }
}, items.map(item => /*#__PURE__*/React.createElement(ShortlistCard, {
  key: item.code,
  item: item,
  role: role,
  onOpen: onOpen,
  onAddDetails: onAddDetails,
  onApprove: onApprove
})), items.length === 0 && /*#__PURE__*/React.createElement("div", {
  style: {
    padding: 48,
    textAlign: 'center',
    background: 'var(--zm-surface)',
    border: '1px dashed var(--zm-line)',
    borderRadius: 14,
    color: 'var(--zm-fg-2)',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 14
  }
}, "Queue empty.")));
Object.assign(window, {
  PageHeader,
  HeaderTag,
  FilterChip,
  FilterRow,
  MotionTable,
  OverviewScreen,
  DraftsScreen,
  ShortlistScreen,
  ShortlistCard,
  iconBtn
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/bd-redesign/screens.jsx", error: String((e && e.message) || e) }); }

// ui_kits/bd-redesign/screens2.jsx
try { (() => {
// ════════════════════════════════════════════════════════════════
// Staging (LOI tracker) + Archive screens
// ════════════════════════════════════════════════════════════════

// Progress meter toward LOI deadline
const LoiMeter = ({
  used,
  total,
  overdue,
  uploaded
}) => {
  const pct = Math.min(100, Math.round(used / total * 100));
  const color = uploaded ? 'var(--zm-success)' : overdue ? 'var(--zm-danger)' : pct > 75 ? 'var(--zm-copper)' : 'var(--zm-accent)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      minWidth: 180
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 12.5,
      fontWeight: 600,
      color,
      whiteSpace: 'nowrap'
    }
  }, uploaded ? 'Uploaded' : `${used} / ${total}d`), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 11,
      color: 'var(--zm-fg-3)',
      whiteSpace: 'nowrap'
    }
  }, uploaded ? 'LOI in' : overdue ? 'overdue' : `${total - used}d left`)), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 7,
      borderRadius: 999,
      background: 'var(--zm-surface-sunken)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: `${uploaded ? 100 : pct}%`,
      height: '100%',
      background: color,
      borderRadius: 999,
      transition: 'width 600ms var(--zm-ease)'
    }
  })));
};
const StagingCard = ({
  site,
  role,
  onOpen,
  onUpload,
  onPush,
  onViewLOI
}) => {
  const overdue = site.daysSinceApproval > site.expectedLoiDays && !site.loiUploaded;
  const stage = site.pushed ? 'completed' : site.loiUploaded ? 'uploaded' : overdue ? 'overdue' : 'staging';
  return /*#__PURE__*/React.createElement("div", {
    className: "zm-card-hover",
    style: {
      background: 'var(--zm-surface)',
      border: '1px solid ' + (overdue ? 'var(--zm-copper-line)' : 'var(--zm-line)'),
      borderRadius: 14,
      padding: 18,
      boxShadow: 'var(--zm-shadow-1)',
      position: 'relative',
      overflow: 'hidden',
      display: 'grid',
      gridTemplateColumns: '1.6fr 1fr auto',
      gap: 20,
      alignItems: 'center'
    }
  }, overdue && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 3,
      background: 'var(--zm-copper)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    onClick: () => onOpen(site),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      cursor: 'pointer',
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 44,
      height: 44,
      borderRadius: 11,
      flex: '0 0 44px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: overdue ? 'var(--zm-copper-soft)' : 'var(--zm-accent-soft)',
      color: overdue ? 'var(--zm-copper)' : 'var(--zm-accent)',
      border: '1px solid ' + (overdue ? 'var(--zm-copper-line)' : 'var(--zm-accent-line)')
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: site.loiUploaded ? 'check' : 'layers',
    size: 20
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 3,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 11,
      color: 'var(--zm-fg-3)'
    }
  }, site.code), /*#__PURE__*/React.createElement(StatusPill, {
    stage: stage,
    size: "sm"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-display)',
      fontWeight: 650,
      fontSize: 15.5,
      color: 'var(--zm-fg)',
      letterSpacing: '-0.01em'
    }
  }, site.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      color: 'var(--zm-fg-3)'
    }
  }, site.city, " \xB7 SPOC ", site.spocName, " \xB7 approved ", site.approvedDate))), /*#__PURE__*/React.createElement(LoiMeter, {
    used: site.daysSinceApproval,
    total: site.expectedLoiDays,
    overdue: overdue,
    uploaded: site.loiUploaded
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      justifyContent: 'flex-end',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onOpen(site),
    title: "View",
    className: "zm-icon-btn",
    style: {
      ...iconBtn,
      width: 34,
      height: 34
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "eye",
    size: 16
  })), site.loiUploaded ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    onClick: () => onViewLOI(site),
    className: "zm-btn",
    style: {
      height: 34,
      padding: '0 13px',
      border: '1px solid var(--zm-line)',
      borderRadius: 8,
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12.5,
      fontWeight: 600,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "file",
    size: 14
  }), " View LOI"), role === 'supervisor' && /*#__PURE__*/React.createElement("button", {
    onClick: () => onPush(site),
    className: "zm-btn-primary",
    style: {
      height: 34,
      padding: '0 14px',
      border: 'none',
      borderRadius: 8,
      background: 'var(--zm-accent)',
      color: '#fff',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12.5,
      fontWeight: 700,
      cursor: 'pointer',
      boxShadow: 'var(--zm-shadow-1)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5
    }
  }, "Push site ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow",
    size: 13
  }))) : /*#__PURE__*/React.createElement("button", {
    onClick: () => onUpload(site),
    className: "zm-btn-primary",
    style: {
      height: 34,
      padding: '0 14px',
      border: 'none',
      borderRadius: 8,
      background: overdue ? 'var(--zm-copper)' : 'var(--zm-accent)',
      color: '#fff',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12.5,
      fontWeight: 700,
      cursor: 'pointer',
      boxShadow: 'var(--zm-shadow-1)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "upload",
    size: 14
  }), " Upload LOI")));
};
const StagingScreen = ({
  role,
  sites,
  onOpen,
  onUpload,
  onPush,
  onViewLOI
}) => {
  const overdueCount = sites.filter(s => s.daysSinceApproval > s.expectedLoiDays && !s.loiUploaded).length;
  const readyCount = sites.filter(s => s.loiUploaded && !s.pushed).length;
  return /*#__PURE__*/React.createElement("div", {
    "data-screen-label": "Staging"
  }, /*#__PURE__*/React.createElement(PageHeader, {
    file: "\u2116 04",
    eyebrow: "Workflow \xB7 Staging",
    title: "Sites in process",
    lede: role === 'supervisor' ? `${sites.length} approved sites tracking toward signed LOI. Upload lands here for your push to Payments.` : `${sites.length} of your approved sites — upload the signed LOI before the timeline closes.`,
    right: /*#__PURE__*/React.createElement(React.Fragment, null, readyCount > 0 && /*#__PURE__*/React.createElement(HeaderTag, {
      icon: "check",
      label: `${readyCount} READY TO PUSH`,
      tone: "accent"
    }), overdueCount > 0 ? /*#__PURE__*/React.createElement(HeaderTag, {
      icon: "alert",
      label: `${overdueCount} OVERDUE`,
      tone: "copper"
    }) : /*#__PURE__*/React.createElement(HeaderTag, {
      icon: "clock",
      label: "ON TRACK"
    }))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, sites.map(s => /*#__PURE__*/React.createElement(StagingCard, {
    key: s.id,
    site: s,
    role: role,
    onOpen: onOpen,
    onUpload: onUpload,
    onPush: onPush,
    onViewLOI: onViewLOI
  })), sites.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 48,
      textAlign: 'center',
      background: 'var(--zm-surface)',
      border: '1px dashed var(--zm-line)',
      borderRadius: 14,
      color: 'var(--zm-fg-2)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 14
    }
  }, "No sites in process.")));
};

// ═══ ARCHIVE ═══════════════════════════════════════════════════════
const ArchiveScreen = ({
  archives,
  onOpen
}) => /*#__PURE__*/React.createElement("div", {
  "data-screen-label": "Archive"
}, /*#__PURE__*/React.createElement(PageHeader, {
  file: "\u2116 05",
  eyebrow: "Workflow \xB7 Archive",
  title: "Archived sites",
  lede: `${archives.length} sites set aside — rejected or shelved for future reference. Re-open any file to revisit the reasoning.`,
  right: /*#__PURE__*/React.createElement(HeaderTag, {
    icon: "folder",
    label: "REFERENCE"
  })
}), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: 14
  }
}, archives.map(a => /*#__PURE__*/React.createElement("div", {
  key: a.id,
  onClick: () => onOpen(a),
  className: "zm-card-hover",
  style: {
    background: 'var(--zm-surface)',
    border: '1px solid var(--zm-line)',
    borderRadius: 14,
    padding: 18,
    boxShadow: 'var(--zm-shadow-1)',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 12
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    flex: 1,
    minWidth: 0
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 11,
    color: 'var(--zm-fg-3)'
  }
}, a.code), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-display)',
    fontWeight: 650,
    fontSize: 15.5,
    color: 'var(--zm-fg)',
    letterSpacing: '-0.01em',
    lineHeight: 1.2
  }
}, a.name), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12,
    color: 'var(--zm-fg-3)'
  }
}, a.city, " \xB7 ", a.createdBy)), /*#__PURE__*/React.createElement(StatusPill, {
  stage: "archived",
  size: "sm"
})), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6
  }
}, a.reasons.map(r => /*#__PURE__*/React.createElement("span", {
  key: r,
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    height: 24,
    padding: '0 9px',
    borderRadius: 999,
    background: 'var(--zm-danger-soft)',
    color: 'var(--zm-danger)',
    border: '1px solid color-mix(in srgb, var(--zm-danger) 22%, transparent)',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: 'nowrap'
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "flag",
  size: 10
}), r))), a.note && /*#__PURE__*/React.createElement("p", {
  style: {
    margin: 0,
    fontFamily: 'var(--zm-font-body)',
    fontStyle: 'italic',
    fontSize: 12.5,
    color: 'var(--zm-fg-2)',
    lineHeight: 1.45
  }
}, "\u201C", a.note, "\u201D"), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTop: '1px solid var(--zm-line-faint)',
    paddingTop: 10
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 11,
    color: 'var(--zm-fg-4)'
  }
}, "Archived ", a.archivedAt), /*#__PURE__*/React.createElement("span", {
  className: "zm-row-cta",
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--zm-accent)'
  }
}, "Open ", /*#__PURE__*/React.createElement(Icon, {
  name: "arrow",
  size: 12
})))))));
Object.assign(window, {
  StagingScreen,
  StagingCard,
  LoiMeter,
  ArchiveScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/bd-redesign/screens2.jsx", error: String((e && e.message) || e) }); }

// ui_kits/new-store-folder/AddDetailsForm.jsx
try { (() => {
// Add details form — the 20-field site detail filled by the BD exec
// after a draft is shortlisted by the supervisor. 17 essential fields plus
// optional lock-in / tenure. Total op cost auto-calculates as (rent + CAM) × 1.18.
//
// Fields 1-3 come from the original draft and are pre-filled (Name editable,
// Visit date read-only, City editable). Fields 4-17 are required.

const MODELS = ['Café · 600–900 sqft', 'Café · 900–1200 sqft', 'Café · 1200+ sqft', 'Kiosk · Express', 'Roastery + café'];
const RENT_TYPES = [{
  id: 'revshare',
  label: 'Revenue share',
  sub: '% of monthly sales'
}, {
  id: 'fixed',
  label: 'Fixed + escalation',
  sub: 'monthly fixed + % per year'
}];
const PhotoPicker = ({
  photos,
  onAdd,
  onRemove
}) => {
  const fileInput = React.useRef(null);
  const onPick = e => {
    const files = Array.from(e.target.files || []);
    files.forEach(f => {
      const url = URL.createObjectURL(f);
      onAdd({
        id: Math.random().toString(36).slice(2, 8),
        name: f.name,
        size: f.size,
        url
      });
    });
    e.target.value = '';
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 10
    }
  }, photos.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    className: "zm-photo-tile",
    style: {
      position: 'relative',
      aspectRatio: '4 / 3',
      borderRadius: 10,
      overflow: 'hidden',
      border: '1px solid var(--zm-line)',
      background: `url(${p.url}) center/cover`
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onRemove(p.id),
    title: "Remove",
    className: "zm-photo-del",
    style: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 22,
      height: 22,
      padding: 0,
      border: 'none',
      borderRadius: 999,
      background: 'rgba(11,12,16,0.7)',
      color: '#fff',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "x",
    size: 12
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 6,
      bottom: 6,
      padding: '2px 6px',
      borderRadius: 4,
      background: 'rgba(11,12,16,0.6)',
      color: '#fff',
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 10
    }
  }, Math.round(p.size / 1024), " KB"))), /*#__PURE__*/React.createElement("button", {
    onClick: () => fileInput.current?.click(),
    className: "zm-upload-tile",
    style: {
      aspectRatio: '4 / 3',
      borderRadius: 10,
      border: '1px dashed var(--zm-line-strong)',
      background: 'var(--zm-surface-2)',
      color: 'var(--zm-fg-3)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      fontWeight: 600,
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "camera",
    size: 20
  }), " Add photos", /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 10,
      color: 'var(--zm-fg-4)'
    }
  }, "OneDrive sync"))), /*#__PURE__*/React.createElement("input", {
    ref: fileInput,
    type: "file",
    accept: "image/*",
    multiple: true,
    onChange: onPick,
    style: {
      display: 'none'
    }
  }), photos.length === 0 && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '8px 0 0',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 11.5,
      color: 'var(--zm-fg-3)'
    }
  }, "Add at least one storefront photo. All photos sync to OneDrive on save."));
};
const formatINR = n => {
  if (!Number.isFinite(n)) return '—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
};
const TextField = ({
  label,
  value,
  onChange,
  placeholder,
  readOnly,
  mono,
  required,
  span = 1,
  prefix,
  suffix,
  type = 'text',
  min,
  hint,
  error
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    gridColumn: `span ${span}`
  }
}, /*#__PURE__*/React.createElement("label", {
  style: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 600,
    fontSize: 12,
    color: 'var(--zm-fg)'
  }
}, label, required && /*#__PURE__*/React.createElement("span", {
  style: {
    color: '#B91C1C',
    fontWeight: 700
  }
}, "*"), readOnly && /*#__PURE__*/React.createElement("span", {
  style: {
    color: 'var(--zm-fg-4)',
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 10,
    marginLeft: 'auto'
  }
}, "read-only")), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'stretch',
    height: 38,
    border: '1px solid ' + (error ? '#B91C1C' : 'var(--zm-line)'),
    borderRadius: 6,
    background: readOnly ? 'var(--zm-surface-sunken)' : 'var(--zm-bg)',
    overflow: 'hidden'
  }
}, prefix && /*#__PURE__*/React.createElement("span", {
  style: {
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    color: 'var(--zm-fg-3)',
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 12,
    background: 'var(--zm-surface-2)',
    borderRight: '1px solid var(--zm-line)'
  }
}, prefix), /*#__PURE__*/React.createElement("input", {
  type: type,
  value: value ?? '',
  onChange: e => onChange?.(e.target.value),
  placeholder: placeholder,
  readOnly: readOnly,
  min: min,
  style: {
    flex: 1,
    border: 'none',
    outline: 'none',
    padding: '0 10px',
    background: 'transparent',
    fontFamily: mono ? 'var(--zm-font-mono)' : 'var(--zm-font-body)',
    fontFeatureSettings: mono ? "'tnum' 1" : 'normal',
    fontSize: 13.5,
    color: readOnly ? 'var(--zm-fg-2)' : 'var(--zm-fg)'
  }
}), suffix && /*#__PURE__*/React.createElement("span", {
  style: {
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    color: 'var(--zm-fg-3)',
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 12,
    background: 'var(--zm-surface-2)',
    borderLeft: '1px solid var(--zm-line)'
  }
}, suffix)), hint && !error && /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 11,
    color: 'var(--zm-fg-3)'
  }
}, hint), error && /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 11,
    color: '#B91C1C'
  }
}, error));
const SelectField = ({
  label,
  value,
  onChange,
  options,
  required,
  span = 1
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    gridColumn: `span ${span}`
  }
}, /*#__PURE__*/React.createElement("label", {
  style: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 600,
    fontSize: 12,
    color: 'var(--zm-fg)'
  }
}, label, required && /*#__PURE__*/React.createElement("span", {
  style: {
    color: '#B91C1C',
    fontWeight: 700
  }
}, "*")), /*#__PURE__*/React.createElement("select", {
  value: value || '',
  onChange: e => onChange(e.target.value),
  style: {
    height: 38,
    padding: '0 10px',
    border: '1px solid var(--zm-line)',
    borderRadius: 6,
    background: 'var(--zm-bg)',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13.5,
    color: 'var(--zm-fg)',
    outline: 'none'
  }
}, /*#__PURE__*/React.createElement("option", {
  value: ""
}, "Select\u2026"), options.map(o => /*#__PURE__*/React.createElement("option", {
  key: o,
  value: o
}, o))));
const FormSection = ({
  title,
  n,
  children
}) => /*#__PURE__*/React.createElement("section", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
    marginTop: 6
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    borderRadius: 999,
    background: 'var(--zm-accent-soft)',
    color: 'var(--zm-accent)',
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 10.5,
    fontWeight: 700
  }
}, n), /*#__PURE__*/React.createElement("h4", {
  style: {
    margin: 0,
    fontFamily: 'var(--zm-font-display)',
    fontWeight: 600,
    fontSize: 14,
    color: 'var(--zm-fg)'
  }
}, title)), children);
const AddDetailsForm = ({
  item,
  onClose,
  onSubmit
}) => {
  // Pre-fill from the draft (fields 1-3)
  const init = item.details || {
    name: item.name,
    visitDate: item.visitDate,
    city: item.city,
    model: '',
    spocName: '',
    googlePin: '',
    photos: [],
    score: '',
    estSales: '',
    nearestStarbucks: '',
    nearestTWC: '',
    carpet: '',
    cam: '',
    rentType: '',
    rent: '',
    escalation: '',
    rentFreeDays: '',
    cadex: '',
    deposit: '',
    brokerage: '',
    lockin: '',
    tenure: ''
  };
  const [f, setF] = React.useState(init);
  const upd = k => v => setF(prev => ({
    ...prev,
    [k]: v
  }));

  // Auto-calculated total op cost = (rent + CAM) × 1.18
  const rentNum = parseFloat(f.rent) || 0;
  const camNum = parseFloat(f.cam) || 0;
  const totalOpCost = (rentNum + camNum) * 1.18;

  // Required fields (17). Optional: lock-in, tenure.
  const errors = {};
  ['model', 'spocName', 'googlePin', 'score', 'estSales', 'nearestStarbucks', 'nearestTWC', 'carpet', 'cam', 'rentType', 'rent', 'cadex', 'deposit', 'brokerage'].forEach(k => {
    if (!f[k] && f[k] !== 0) errors[k] = 'Required';
  });
  if (f.photos.length === 0) errors.photos = 'Add at least one photo';
  if (f.rentType === 'fixed' && !f.escalation) errors.escalation = 'Set escalation %';
  if (f.rentType === 'revshare' && !f.revshare) errors.revshare = 'Set revenue share %';
  const filled = Object.keys(errors).length === 0;
  const handleSubmit = () => {
    if (!filled) return;
    onSubmit({
      ...f,
      totalOpCost
    });
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(11,12,16,0.50)',
      backdropFilter: 'blur(6px)',
      zIndex: 110,
      display: 'flex',
      alignItems: 'stretch',
      justifyContent: 'flex-end',
      animation: 'zm-fade 200ms var(--zm-ease)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--zm-bg)',
      borderLeft: '1px solid var(--zm-line)',
      width: 880,
      maxWidth: '96%',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: 'var(--zm-shadow-pop)',
      animation: 'zm-slide 280ms var(--zm-ease-emp)'
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      padding: '20px 28px',
      background: 'var(--zm-surface)',
      borderBottom: '1px solid var(--zm-line)',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 11.5,
      color: 'var(--zm-fg-3)'
    }
  }, item.code), /*#__PURE__*/React.createElement(StatusPill, {
    stage: "shortlist"
  })), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontFamily: 'var(--zm-font-display)',
      fontWeight: 700,
      fontSize: 22,
      letterSpacing: '-0.02em',
      color: 'var(--zm-fg)'
    }
  }, "Add site details \xB7 ", f.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12.5,
      color: 'var(--zm-fg-3)'
    }
  }, "17 essential fields. Total op cost is auto-calculated. Hit ", /*#__PURE__*/React.createElement("strong", null, "Send for review"), " when ready.")), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "zm-icon-btn",
    style: {
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 8,
      width: 30,
      height: 30,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--zm-fg-2)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "x",
    size: 14
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '20px 28px 28px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 24
    }
  }, /*#__PURE__*/React.createElement(FormSection, {
    n: "1\xB73",
    title: "Identity"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(TextField, {
    label: "Name",
    value: f.name,
    onChange: upd('name'),
    required: true,
    hint: "Editable from draft"
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "Visit date",
    value: f.visitDate,
    mono: true,
    readOnly: true,
    hint: "Locked from pipeline"
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "City",
    value: f.city,
    onChange: upd('city'),
    required: true
  }))), /*#__PURE__*/React.createElement(FormSection, {
    n: "4\xB76",
    title: "Model \xB7 SPOC \xB7 Google pin"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(SelectField, {
    label: "Model",
    value: f.model,
    onChange: upd('model'),
    required: true,
    options: MODELS
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "SPOC name",
    value: f.spocName,
    onChange: upd('spocName'),
    required: true,
    placeholder: "Landlord / agent"
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "Google pin",
    value: f.googlePin,
    onChange: upd('googlePin'),
    required: true,
    mono: true,
    placeholder: "19.1183, 72.9089"
  }))), /*#__PURE__*/React.createElement(FormSection, {
    n: "7",
    title: "Storefront photos"
  }, /*#__PURE__*/React.createElement(PhotoPicker, {
    photos: f.photos,
    onAdd: p => setF(prev => ({
      ...prev,
      photos: [...prev.photos, p]
    })),
    onRemove: id => setF(prev => ({
      ...prev,
      photos: prev.photos.filter(x => x.id !== id)
    }))
  }), errors.photos && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 11.5,
      color: '#B91C1C',
      marginTop: 6
    }
  }, errors.photos)), /*#__PURE__*/React.createElement(FormSection, {
    n: "8\xB711",
    title: "Score + adjacency sales"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(TextField, {
    label: "Score",
    value: f.score,
    onChange: upd('score'),
    required: true,
    type: "number",
    min: "0",
    hint: "0\u2013100 footfall + visibility"
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "Estimated sales",
    value: f.estSales,
    onChange: upd('estSales'),
    required: true,
    mono: true,
    prefix: "\u20B9",
    suffix: "/mo"
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "Nearest Starbucks sales",
    value: f.nearestStarbucks,
    onChange: upd('nearestStarbucks'),
    required: true,
    mono: true,
    prefix: "\u20B9",
    suffix: "/mo"
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "Nearest TWC sales",
    value: f.nearestTWC,
    onChange: upd('nearestTWC'),
    required: true,
    mono: true,
    prefix: "\u20B9",
    suffix: "/mo",
    hint: "Third-Wave Coffee"
  }))), /*#__PURE__*/React.createElement(FormSection, {
    n: "12\xB714",
    title: "Carpet \xB7 CAM \xB7 rent"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(TextField, {
    label: "Carpet / covered area",
    value: f.carpet,
    onChange: upd('carpet'),
    required: true,
    mono: true,
    suffix: "sqft"
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "CAM",
    value: f.cam,
    onChange: upd('cam'),
    required: true,
    mono: true,
    prefix: "\u20B9",
    suffix: "/mo"
  }), /*#__PURE__*/React.createElement("div", null)), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 10,
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'block',
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: 12,
      color: 'var(--zm-fg)',
      marginBottom: 8
    }
  }, "Rent type ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#B91C1C',
      fontWeight: 700
    }
  }, "*")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 8
    }
  }, RENT_TYPES.map(rt => /*#__PURE__*/React.createElement("button", {
    key: rt.id,
    onClick: () => upd('rentType')(rt.id),
    className: "zm-btn",
    style: {
      textAlign: 'left',
      padding: 12,
      borderRadius: 8,
      border: '1px solid ' + (f.rentType === rt.id ? 'var(--zm-accent)' : 'var(--zm-line)'),
      background: f.rentType === rt.id ? 'var(--zm-accent-soft)' : 'var(--zm-surface)',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      fontFamily: 'inherit'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 16,
      height: 16,
      borderRadius: 999,
      marginTop: 1,
      border: '1.5px solid ' + (f.rentType === rt.id ? 'var(--zm-accent)' : 'var(--zm-line-strong)'),
      background: f.rentType === rt.id ? 'var(--zm-accent)' : 'transparent',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: '0 0 16px'
    }
  }, f.rentType === rt.id && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 999,
      background: '#fff'
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: 13,
      color: 'var(--zm-fg)'
    }
  }, rt.label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 11.5,
      color: 'var(--zm-fg-3)'
    }
  }, rt.sub)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 14
    }
  }, f.rentType === 'fixed' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(TextField, {
    label: "Rent (monthly)",
    value: f.rent,
    onChange: upd('rent'),
    required: true,
    mono: true,
    prefix: "\u20B9",
    suffix: "/mo"
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "Escalation",
    value: f.escalation,
    onChange: upd('escalation'),
    required: true,
    mono: true,
    suffix: "% / yr"
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "Rent-free days",
    value: f.rentFreeDays,
    onChange: upd('rentFreeDays'),
    mono: true,
    suffix: "days",
    hint: "Optional fit-out grace"
  })), f.rentType === 'revshare' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(TextField, {
    label: "Revenue share",
    value: f.revshare,
    onChange: upd('revshare'),
    required: true,
    mono: true,
    suffix: "% of sales",
    error: errors.revshare
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "Min guarantee",
    value: f.rent,
    onChange: upd('rent'),
    mono: true,
    prefix: "\u20B9",
    suffix: "/mo",
    hint: "If applicable",
    required: true
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "Rent-free days",
    value: f.rentFreeDays,
    onChange: upd('rentFreeDays'),
    mono: true,
    suffix: "days",
    hint: "Optional"
  })), !f.rentType && /*#__PURE__*/React.createElement("div", {
    style: {
      gridColumn: 'span 3',
      padding: 16,
      background: 'var(--zm-surface-2)',
      borderRadius: 8,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12.5,
      color: 'var(--zm-fg-3)',
      textAlign: 'center'
    }
  }, "Pick a rent type above to reveal the rent fields."))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--zm-accent-soft)',
      border: '1px solid var(--zm-accent-line)',
      borderRadius: 10,
      padding: '14px 18px',
      display: 'flex',
      alignItems: 'center',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 700,
      fontSize: 10.5,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: 'var(--zm-accent)'
    }
  }, "Auto \xB7 total op cost"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 11,
      color: 'var(--zm-fg-3)'
    }
  }, "= (rent + CAM) \xD7 1.18"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontFeatureSettings: "'tnum' 1",
      fontSize: 22,
      fontWeight: 600,
      color: 'var(--zm-fg)'
    }
  }, formatINR(totalOpCost), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--zm-fg-3)',
      marginLeft: 4
    }
  }, "/mo")))), /*#__PURE__*/React.createElement(FormSection, {
    n: "15\xB717",
    title: "Capex \xB7 deposit \xB7 brokerage"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(TextField, {
    label: "Cadex (capex)",
    value: f.cadex,
    onChange: upd('cadex'),
    required: true,
    mono: true,
    prefix: "\u20B9",
    hint: "Fit-out budget"
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "Security deposit",
    value: f.deposit,
    onChange: upd('deposit'),
    required: true,
    mono: true,
    prefix: "\u20B9"
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "Brokerage",
    value: f.brokerage,
    onChange: upd('brokerage'),
    required: true,
    mono: true,
    prefix: "\u20B9"
  }))), /*#__PURE__*/React.createElement(FormSection, {
    n: "opt",
    title: "Lock-in + tenure \xB7 optional"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(TextField, {
    label: "Lock-in period",
    value: f.lockin,
    onChange: upd('lockin'),
    mono: true,
    suffix: "months",
    hint: "Optional"
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "Tenure",
    value: f.tenure,
    onChange: upd('tenure'),
    mono: true,
    suffix: "months",
    hint: "Optional"
  }), /*#__PURE__*/React.createElement("div", null))))), /*#__PURE__*/React.createElement("footer", {
    style: {
      padding: '14px 28px',
      borderTop: '1px solid var(--zm-line)',
      background: 'var(--zm-surface)',
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, !filled ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12.5,
      color: 'var(--zm-fg-3)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "alert",
    size: 14,
    style: {
      color: '#B45309'
    }
  }), Object.keys(errors).length, " of 17 essential fields incomplete") : /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12.5,
      color: '#047857',
      fontWeight: 600
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 14
  }), " All essentials filled \xB7 ready for review"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "zm-btn",
    style: {
      height: 36,
      padding: '0 14px',
      borderRadius: 8,
      border: '1px solid var(--zm-line)',
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer'
    }
  }, "Save draft"), /*#__PURE__*/React.createElement("button", {
    onClick: handleSubmit,
    disabled: !filled,
    className: "zm-btn-primary",
    style: {
      height: 36,
      padding: '0 16px',
      borderRadius: 8,
      border: 'none',
      background: filled ? 'var(--zm-accent)' : 'var(--zm-surface-sunken)',
      color: filled ? '#fff' : 'var(--zm-fg-4)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 700,
      cursor: filled ? 'pointer' : 'not-allowed',
      boxShadow: filled ? 'var(--zm-shadow-1)' : 'none',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, "Send for review ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow",
    size: 14
  })))));
};
Object.assign(window, {
  AddDetailsForm
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/new-store-folder/AddDetailsForm.jsx", error: String((e && e.message) || e) }); }

// ui_kits/new-store-folder/App.jsx
try { (() => {
// Z-Matrix · new-store-folder app
//
// Workflow (per-role views):
//   Pipeline (drafts) → Shortlist queue → Staging (LOI) → exit to Payments module
//
// RBAC: BD exec sees ONLY sites they originated. Supervisor sees all.
// Pipeline SLA: supervisor should action a draft within 7 days; overdue rows are red.
// Staging is two-step: exec uploads LOI; once uploaded the site enters the
// supervisor's staging view where they View LOI + Push site (and see a timer
// of draft date → LOI upload date against the expected timeline).

const ME = 'Riya Sharma';
const DRAFTS = [{
  id: 'site_h9d31a40',
  code: 'BT-MUM-0144',
  name: 'BKC One · East Wing',
  city: 'Mumbai',
  visitDate: '2026-05-18',
  days: 1,
  createdBy: 'Riya Sharma',
  stage: 'draft'
}, {
  id: 'site_i1e42a51',
  code: 'BT-CHE-0011',
  name: 'Anna Nagar 2nd Ave',
  city: 'Chennai',
  visitDate: '2026-05-16',
  days: 3,
  createdBy: 'Aman Verma',
  stage: 'draft'
}, {
  id: 'site_j2f53b62',
  code: 'BT-AHM-0008',
  name: 'CG Road · Navrangpura',
  city: 'Ahmedabad',
  visitDate: '2026-05-14',
  days: 5,
  createdBy: 'Nikhil Iyer',
  stage: 'draft'
}, {
  id: 'site_k3g64c73',
  code: 'BT-BLR-0210',
  name: 'HSR Layout 27th Main',
  city: 'Bengaluru',
  visitDate: '2026-05-13',
  days: 7,
  createdBy: 'Aisha Sengupta',
  stage: 'draft'
}, {
  id: 'site_l4h75d84',
  code: 'BT-PUN-0024',
  name: 'Baner High Street',
  city: 'Pune',
  visitDate: '2026-05-11',
  days: 9,
  createdBy: 'Riya Sharma',
  stage: 'draft'
}, {
  id: 'site_m5i86e95',
  code: 'BT-MUM-0145',
  name: 'Lokhandwala Back Rd',
  city: 'Mumbai',
  visitDate: '2026-05-08',
  days: 12,
  createdBy: 'Aman Verma',
  stage: 'draft'
}, {
  id: 'site_n6j97f06',
  code: 'BT-HYD-0036',
  name: 'Jubilee Hills Rd 36',
  city: 'Hyderabad',
  visitDate: '2026-04-29',
  days: 21,
  createdBy: 'Nikhil Iyer',
  stage: 'draft'
}, {
  id: 'site_o7k08g17',
  code: 'BT-DEL-0091',
  name: 'Saket M-Block · L13',
  city: 'New Delhi',
  visitDate: '2026-04-26',
  days: 24,
  createdBy: 'Aisha Sengupta',
  stage: 'draft'
}, {
  id: 'site_p8l19h28',
  code: 'BT-BLR-0211',
  name: 'Whitefield · Hope Farm',
  city: 'Bengaluru',
  visitDate: '2026-04-22',
  days: 28,
  createdBy: 'Aman Verma',
  stage: 'draft'
}];
const SHORTLIST = [
// Riya's: one in review (essentials done), one still needing details
{
  code: 'BT-MUM-0143',
  name: 'Bandra Linking Rd',
  city: 'Mumbai',
  visitDate: '2026-05-17',
  createdBy: 'Riya Sharma',
  score: 78,
  estSales: 19.8,
  carpet: 1120,
  rent: 112,
  rentType: 'fixed',
  totalOpCost: 165000,
  hue: 140,
  inReview: true,
  stage: 'shortlist'
}, {
  code: 'BT-MUM-0146',
  name: 'Borivali West · Carter',
  city: 'Mumbai',
  visitDate: '2026-05-15',
  createdBy: 'Riya Sharma',
  score: '',
  estSales: '',
  carpet: '',
  rent: '',
  rentType: '',
  totalOpCost: 0,
  hue: 220,
  inReview: false,
  stage: 'shortlist'
},
// Others' shortlists (supervisor will see these too)
{
  code: 'BT-BLR-0209',
  name: 'Koramangala 6th Block',
  city: 'Bengaluru',
  visitDate: '2026-05-15',
  createdBy: 'Aman Verma',
  score: '',
  estSales: '',
  carpet: '',
  rent: '',
  rentType: '',
  totalOpCost: 0,
  hue: 30,
  inReview: false,
  stage: 'shortlist'
}, {
  code: 'BT-DEL-0090',
  name: 'Connaught Place · F-21',
  city: 'New Delhi',
  visitDate: '2026-05-12',
  createdBy: 'Nikhil Iyer',
  score: 82,
  estSales: 22.0,
  carpet: 1320,
  rent: 142,
  rentType: 'fixed',
  totalOpCost: 198000,
  hue: 200,
  inReview: true,
  stage: 'shortlist'
}];
const STAGING = [
// Riya's approved sites: one overdue + needs LOI, one uploaded recently (supervisor view), one early upload
{
  id: 'site_a8f3c129',
  code: 'BT-MUM-0142',
  name: 'Powai · Lake Homes',
  city: 'Mumbai',
  createdBy: 'Riya Sharma',
  spocName: 'Rohan Khanna',
  draftDate: '2026-05-01',
  approvedDate: '2026-05-03',
  approvedBy: 'N. Iyer',
  expectedLoiDays: 14,
  daysSinceApproval: 16,
  loiUploaded: false,
  loiUploadedAt: null,
  daysToLOI: null,
  pushed: false,
  stage: 'staging'
}, {
  id: 'site_e2c1f8a3',
  code: 'BT-HYD-0034',
  name: 'Banjara Hills Rd 12',
  city: 'Hyderabad',
  createdBy: 'Riya Sharma',
  spocName: 'Pranav Reddy',
  draftDate: '2026-05-08',
  approvedDate: '2026-05-10',
  approvedBy: 'R. Sharma',
  expectedLoiDays: 14,
  daysSinceApproval: 9,
  loiUploaded: false,
  loiUploadedAt: null,
  daysToLOI: null,
  pushed: false,
  stage: 'staging'
},
// Already uploaded by Riya — appears in supervisor's staging
{
  id: 'site_q9m20i39',
  code: 'BT-MUM-0140',
  name: 'Andheri · Lokhandwala',
  city: 'Mumbai',
  createdBy: 'Riya Sharma',
  spocName: 'Tanvi Joshi',
  draftDate: '2026-04-06',
  approvedDate: '2026-04-08',
  approvedBy: 'N. Iyer',
  expectedLoiDays: 14,
  daysSinceApproval: 14,
  loiUploaded: true,
  loiUploadedAt: '2026-04-21',
  daysToLOI: 13,
  pushed: false,
  stage: 'staging'
},
// Others' sites
{
  id: 'site_c4d09f02',
  code: 'BT-DEL-0089',
  name: 'Khan Market · Shop 27',
  city: 'New Delhi',
  createdBy: 'Nikhil Iyer',
  spocName: 'Devansh Roy',
  draftDate: '2026-04-20',
  approvedDate: '2026-04-22',
  approvedBy: 'N. Iyer',
  expectedLoiDays: 21,
  daysSinceApproval: 27,
  loiUploaded: false,
  loiUploadedAt: null,
  daysToLOI: null,
  pushed: false,
  stage: 'staging'
}, {
  id: 'site_g8c20d12',
  code: 'BT-PUN-0021',
  name: 'Koregaon Park Lane 5',
  city: 'Pune',
  createdBy: 'Nikhil Iyer',
  spocName: 'Yash Bhide',
  draftDate: '2026-04-13',
  approvedDate: '2026-04-15',
  approvedBy: 'N. Iyer',
  expectedLoiDays: 21,
  daysSinceApproval: 34,
  loiUploaded: false,
  loiUploadedAt: null,
  daysToLOI: null,
  pushed: false,
  stage: 'staging'
}, {
  id: 'site_r0n31j40',
  code: 'BT-DEL-0086',
  name: 'GK-1 N-Block · 142',
  city: 'New Delhi',
  createdBy: 'Aman Verma',
  spocName: 'Vikram Anand',
  draftDate: '2026-03-30',
  approvedDate: '2026-04-02',
  approvedBy: 'R. Sharma',
  expectedLoiDays: 21,
  daysSinceApproval: 20,
  loiUploaded: true,
  loiUploadedAt: '2026-04-22',
  daysToLOI: 20,
  pushed: false,
  stage: 'staging'
}, {
  id: 'site_b7e2118a',
  code: 'BT-BLR-0207',
  name: 'Indiranagar 12th Main',
  city: 'Bengaluru',
  createdBy: 'Aman Verma',
  spocName: 'Aisha Mehta',
  draftDate: '2026-05-10',
  approvedDate: '2026-05-12',
  approvedBy: 'R. Sharma',
  expectedLoiDays: 14,
  daysSinceApproval: 6,
  loiUploaded: false,
  loiUploadedAt: null,
  daysToLOI: null,
  pushed: false,
  stage: 'staging'
}];
const ARCHIVE_SEED = [{
  id: 'site_arch_001',
  code: 'BT-MUM-0091',
  name: 'Khar · Linking Rd 33',
  city: 'Mumbai',
  createdBy: 'Aman Verma',
  archivedAt: '2026-04-12',
  reasons: ['High rent', 'High cannibalisation'],
  note: ''
}, {
  id: 'site_arch_002',
  code: 'BT-DEL-0072',
  name: 'Defence Colony · 12B',
  city: 'New Delhi',
  createdBy: 'Nikhil Iyer',
  archivedAt: '2026-03-30',
  reasons: ['Affluence problem'],
  note: ''
}];
const buildDrawerSite = row => ({
  ...row,
  id: row.id || row.code,
  code: row.code,
  name: row.name,
  city: row.city,
  stage: row.stage || 'shortlist',
  carpet: row.carpet || 1000,
  opCost: row.totalOpCost || 100000,
  rent: row.rent || 80000,
  cam: row.cam || 18000,
  deposit: row.deposit || 400000,
  lockin: row.lockin || 36,
  escalation: row.escalation || 5,
  rentFree: row.rentFreeDays || 30,
  estSales: (row.estSales || 12) * 100000,
  model: row.model || 'Café · 900–1200 sqft',
  spocName: row.spocName || row.createdBy || row.by || 'TBD',
  spocPhone: '+91 ••••• •••••',
  pin: row.googlePin || row.pin || '—',
  loiSignedAt: row.loiUploadedAt || '—',
  loiSubmittedAt: row.loiUploadedAt || '—',
  days: row.days ?? row.daysSinceApproval ?? 0,
  createdAt: row.createdAt || row.visitDate || '—'
});
const App = () => {
  const [role, setRole] = React.useState('supervisor');
  const [dark, setDark] = React.useState(false);
  const [view, setView] = React.useState('overview');
  const [stage, setStage] = React.useState('all');
  const [advanced, setAdvanced] = React.useState({
    month: '',
    preset: '',
    from: '',
    to: ''
  });
  const [openSite, setOpenSite] = React.useState(null);
  const [showNew, setShowNew] = React.useState(false);
  const [approving, setApproving] = React.useState(null); // shortlist item being approved
  const [rejecting, setRejecting] = React.useState(null); // draft being rejected
  const [detailing, setDetailing] = React.useState(null); // shortlist item being detailed
  const [toast, setToast] = React.useState(null);
  const [drafts, setDrafts] = React.useState(DRAFTS);
  const [shortlist, setShortlist] = React.useState(SHORTLIST);
  const [staging, setStaging] = React.useState(STAGING);
  const [archive, setArchive] = React.useState(ARCHIVE_SEED);
  React.useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.body.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3400);
    return () => clearTimeout(t);
  }, [toast]);
  const showToast = (msg, tone = 'success') => setToast({
    msg,
    tone
  });

  // ============ RBAC ============
  // BD exec only sees sites they originated. Supervisor sees all.
  // Staging additionally splits by upload state:
  //   - supervisor staging view shows ONLY sites with loiUploaded === true
  //   - exec staging view shows their own approved sites regardless of upload state
  const isExec = role === 'exec';
  const visibleDrafts = isExec ? drafts.filter(d => d.createdBy === ME) : drafts;
  const visibleShortlist = isExec ? shortlist.filter(s => s.createdBy === ME) : shortlist;
  const visibleStaging = isExec ? staging.filter(s => s.createdBy === ME) : staging.filter(s => s.loiUploaded === true);

  // ============ Pipeline → Shortlist ============
  const onDraftApprove = d => {
    setDrafts(prev => prev.filter(x => x.id !== d.id));
    setShortlist(prev => [{
      code: d.code,
      name: d.name,
      city: d.city,
      visitDate: d.visitDate,
      createdBy: d.createdBy,
      score: '',
      estSales: '',
      carpet: '',
      rent: '',
      rentType: '',
      totalOpCost: 0,
      hue: Math.round(Math.random() * 360),
      inReview: false,
      stage: 'shortlist'
    }, ...prev]);
    showToast(`Shortlisted · ${d.name} moved to shortlist queue`);
  };
  const onDraftReject = d => setRejecting(d);
  const onDraftRejectConfirm = (d, reasons, comment) => {
    setRejecting(null);
    setDrafts(prev => prev.filter(x => x.id !== d.id));
    setArchive(prev => [{
      id: d.id,
      code: d.code,
      name: d.name,
      city: d.city,
      createdBy: d.createdBy,
      archivedAt: new Date().toISOString().slice(0, 10),
      reasons,
      note: comment,
      source: 'rejected'
    }, ...prev]);
    showToast(`Rejected · ${d.name} · archived with ${reasons.length} reason${reasons.length === 1 ? '' : 's'}`, 'danger');
  };
  const onDraftArchive = d => {
    setDrafts(prev => prev.filter(x => x.id !== d.id));
    setArchive(prev => [{
      id: d.id,
      code: d.code,
      name: d.name,
      city: d.city,
      createdBy: d.createdBy,
      archivedAt: new Date().toISOString().slice(0, 10),
      reasons: [],
      note: 'Archived for future reference',
      source: 'archived'
    }, ...prev]);
    showToast(`Archived · ${d.name}. Available in Archive view.`);
  };

  // ============ Shortlist actions ============
  // BD exec opens the 17-field form. On submit, item is marked inReview.
  const onAddDetails = item => setDetailing(item);
  const onDetailsSubmit = (item, formData) => {
    setDetailing(null);
    setShortlist(prev => prev.map(x => x.code === item.code ? {
      ...x,
      details: formData,
      name: formData.name,
      city: formData.city,
      score: Number(formData.score) || x.score,
      estSales: Number(formData.estSales) / 100000 || x.estSales,
      // store in lakhs
      carpet: Number(formData.carpet) || x.carpet,
      rent: Math.round(Number(formData.rent) / 1000) || x.rent,
      // store in thousands
      rentType: formData.rentType,
      totalOpCost: formData.totalOpCost,
      inReview: true
    } : x));
    showToast(`Sent for review · ${formData.name}. Supervisor notified.`);
  };

  // Supervisor approve shortlist → LOI timeline modal
  const onApproveShortlist = item => setApproving(item);
  const onTimelineSubmit = (item, days) => {
    setApproving(null);
    setShortlist(prev => prev.filter(x => x.code !== item.code));
    setStaging(prev => [{
      id: 'site_' + Math.random().toString(36).slice(2, 10),
      code: item.code,
      name: item.name,
      city: item.city,
      createdBy: item.createdBy,
      spocName: item.details?.spocName || item.createdBy,
      draftDate: item.visitDate || new Date().toISOString().slice(0, 10),
      approvedDate: new Date().toISOString().slice(0, 10),
      approvedBy: 'R. Sharma',
      expectedLoiDays: days,
      daysSinceApproval: 0,
      loiUploaded: false,
      loiUploadedAt: null,
      daysToLOI: null,
      pushed: false,
      stage: 'staging'
    }, ...prev]);
    showToast(`Approved · ${item.name}. LOI expected in ${days}d. Moved to staging.`);
  };

  // ============ Staging actions ============
  // Exec uploads LOI → site now visible in supervisor staging
  const onUploadLOI = site => {
    setStaging(prev => prev.map(x => x.id === site.id ? {
      ...x,
      loiUploaded: true,
      loiUploadedAt: new Date().toISOString().slice(0, 10),
      daysToLOI: x.daysSinceApproval
    } : x));
    showToast(`LOI uploaded · ${site.name}. Supervisor will review and push.`);
  };

  // Supervisor pushes the site → leaves staging (out to Payments module)
  const onPushSite = site => {
    setStaging(prev => prev.map(x => x.id === site.id ? {
      ...x,
      pushed: true
    } : x));
    showToast(`Pushed · ${site.name} sent to Payments module.`);
  };
  const onViewLOI = site => {
    showToast(`Opening LOI · ${site.name} (mock).`);
  };
  const counts = {
    pipeline: visibleDrafts.length,
    shortlist: visibleShortlist.length,
    staging: visibleStaging.length,
    archive: archive.length
  };

  // Sites-in-motion overview combines stages — RBAC-filtered.
  const allMotion = [...visibleDrafts.map(d => ({
    id: d.id,
    code: d.code,
    name: d.name,
    city: d.city,
    stage: 'draft',
    days: d.days,
    owner: d.createdBy,
    when: d.visitDate,
    meta: 'visit ' + d.visitDate
  })), ...visibleShortlist.map(s => ({
    id: s.code,
    code: s.code,
    name: s.name,
    city: s.city,
    stage: s.inReview ? 'inReview' : 'shortlist',
    days: 3,
    owner: s.createdBy,
    when: s.visitDate,
    meta: s.inReview ? 'in review' : 'awaiting details'
  })), ...visibleStaging.map(s => {
    const overdue = s.daysSinceApproval > s.expectedLoiDays && !s.loiUploaded;
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      city: s.city,
      stage: s.pushed ? 'completed' : s.loiUploaded ? 'uploaded' : overdue ? 'overdue' : 'staging',
      days: s.daysSinceApproval,
      owner: s.createdBy,
      when: s.draftDate || s.approvedDate,
      meta: `LOI ${s.daysSinceApproval}/${s.expectedLoiDays}d`
    };
  })];
  // Apply stage filter chip
  const stageFiltered = stage === 'all' ? allMotion : allMotion.filter(r => {
    if (stage === 'staging') return ['staging', 'overdue', 'uploaded', 'completed'].includes(r.stage);
    if (stage === 'shortlist') return ['shortlist', 'inReview'].includes(r.stage);
    return r.stage === stage;
  });
  // Apply advanced (month / preset / range) filter
  const filteredMotion = stageFiltered.filter(r => {
    if (!r.when) return true;
    if (advanced.month) {
      return r.when.slice(0, 7) === advanced.month;
    }
    if (advanced.from || advanced.to) {
      if (advanced.from && r.when < advanced.from) return false;
      if (advanced.to && r.when > advanced.to) return false;
    }
    return true;
  });
  return /*#__PURE__*/React.createElement("div", {
    "data-screen-label": "01 Sites in motion",
    "data-theme": dark ? 'dark' : 'light',
    style: {
      width: '100%',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--zm-bg)',
      color: 'var(--zm-fg)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement(TopBar, {
    user: {
      name: 'Riya Sharma'
    },
    role: role,
    dark: dark,
    onToggleDark: () => setDark(d => !d),
    onNewPipeline: () => setShowNew(true)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      minHeight: 0,
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement(Sidebar, {
    view: view,
    onView: setView,
    counts: counts,
    role: role,
    onRole: setRole
  }), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '24px 32px 64px',
      background: 'var(--zm-bg)',
      backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'><path d='M40 0 L0 0 0 40' fill='none' stroke='" + (dark ? '%23E2E8F0' : '%23111827') + "' stroke-width='0.5' opacity='0.04'/></svg>\")",
      backgroundSize: '40px 40px'
    }
  }, view === 'overview' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(PageHeader, {
    file: "\u2116 01",
    eyebrow: "Overview",
    title: "Sites in motion",
    lede: role === 'supervisor' ? `Synced 2 min ago — all sites in your tenant. ${visibleDrafts.length + visibleShortlist.length + visibleStaging.length} files across draft, shortlist and staging.` : `Synced 2 min ago — your sites, ${ME}. ${visibleDrafts.length + visibleShortlist.length + visibleStaging.length} files across draft, shortlist and staging.`,
    right: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(HeaderTag, {
      icon: "clock",
      label: "LIVE \xB7 2M LAG"
    }), /*#__PURE__*/React.createElement(HeaderTag, {
      icon: "shield",
      label: role === 'supervisor' ? 'TENANT SCOPE' : 'PERSONAL SCOPE',
      tone: "accent"
    }))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(MetricStrip, null)), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(PipelineFilter, {
    stage: stage,
    onStage: setStage,
    counts: {
      all: allMotion.length,
      draft: counts.pipeline,
      shortlist: counts.shortlist,
      staging: counts.staging
    },
    advanced: advanced,
    onAdvanced: setAdvanced
  })), /*#__PURE__*/React.createElement(MotionTable, {
    rows: filteredMotion,
    onOpen: r => {
      if (r.stage === 'draft') setView('pipeline');else if (['shortlist', 'inReview'].includes(r.stage)) setView('shortlist');else setView('staging');
    }
  })), view === 'pipeline' && /*#__PURE__*/React.createElement(DraftsView, {
    drafts: visibleDrafts,
    role: role,
    onApprove: onDraftApprove,
    onReject: onDraftReject,
    onArchive: onDraftArchive,
    onOpen: d => setOpenSite(buildDrawerSite({
      ...d,
      stage: 'draft'
    }))
  }), view === 'shortlist' && /*#__PURE__*/React.createElement(ShortlistQueue, {
    items: visibleShortlist,
    role: role,
    onView: item => setOpenSite(buildDrawerSite(item)),
    onAddDetails: onAddDetails,
    onApprove: onApproveShortlist
  }), view === 'staging' && /*#__PURE__*/React.createElement(StagingView, {
    sites: visibleStaging,
    role: role,
    onUpload: onUploadLOI,
    onOpen: site => setOpenSite(buildDrawerSite(site)),
    onPush: onPushSite,
    onViewLOI: onViewLOI
  }), view === 'archive' && role === 'supervisor' && /*#__PURE__*/React.createElement(ArchiveView, {
    archives: archive,
    onOpen: a => setOpenSite(buildDrawerSite({
      ...a,
      stage: 'archived'
    }))
  })), openSite && /*#__PURE__*/React.createElement(SiteDrawer, {
    site: openSite,
    onClose: () => setOpenSite(null)
  })), showNew && /*#__PURE__*/React.createElement(NewPipelineModal, {
    onClose: () => setShowNew(false),
    onSubmit: form => {
      setShowNew(false);
      const id = 'site_' + Math.random().toString(36).slice(2, 10);
      setDrafts(prev => [{
        id,
        code: 'BT-' + form.city.slice(0, 3).toUpperCase() + '-' + Math.floor(Math.random() * 900 + 100),
        name: form.name,
        city: form.city,
        visitDate: form.visitDate,
        days: 0,
        createdBy: ME,
        stage: 'draft'
      }, ...prev]);
      showToast(`Pipeline submitted · ${form.name}. Supervisor notified.`);
    }
  }), approving && /*#__PURE__*/React.createElement(LOITimelineModal, {
    site: approving,
    onCancel: () => setApproving(null),
    onSubmit: onTimelineSubmit
  }), rejecting && /*#__PURE__*/React.createElement(RejectReasonDialog, {
    draft: rejecting,
    onCancel: () => setRejecting(null),
    onSubmit: onDraftRejectConfirm
  }), detailing && /*#__PURE__*/React.createElement(AddDetailsForm, {
    item: detailing,
    onClose: () => setDetailing(null),
    onSubmit: formData => onDetailsSubmit(detailing, formData)
  }), toast && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      bottom: 22,
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'var(--zm-fg)',
      color: '#fff',
      padding: '10px 16px',
      borderRadius: 10,
      boxShadow: 'var(--zm-shadow-pop)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 500,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      zIndex: 200,
      animation: 'zm-rise 240ms var(--zm-ease-emp)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 999,
      background: toast.tone === 'danger' ? '#F87171' : '#34D399'
    }
  }), toast.msg));
};
const MotionTable = ({
  rows,
  onOpen
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    background: 'var(--zm-surface)',
    border: '1px solid var(--zm-line)',
    borderRadius: 12,
    overflow: 'hidden',
    boxShadow: 'var(--zm-shadow-1)'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'grid',
    gridTemplateColumns: '0.9fr 1.7fr 1fr 1fr 0.7fr 1.1fr 1.2fr',
    gap: 10,
    padding: '11px 16px',
    background: 'var(--zm-surface-2)',
    borderBottom: '1px solid var(--zm-line)',
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 600,
    fontSize: 10.5,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--zm-fg-3)'
  }
}, /*#__PURE__*/React.createElement("span", null, "Code"), /*#__PURE__*/React.createElement("span", null, "Site"), /*#__PURE__*/React.createElement("span", null, "City"), /*#__PURE__*/React.createElement("span", null, "Owner"), /*#__PURE__*/React.createElement("span", null, "Days"), /*#__PURE__*/React.createElement("span", null, "Stage"), /*#__PURE__*/React.createElement("span", null, "Detail")), rows.slice(0, 12).map(r => /*#__PURE__*/React.createElement("div", {
  key: r.id,
  onClick: () => onOpen(r),
  className: "zm-row",
  style: {
    display: 'grid',
    gridTemplateColumns: '0.9fr 1.7fr 1fr 1fr 0.7fr 1.1fr 1.2fr',
    gap: 10,
    padding: '12px 16px',
    borderBottom: '1px solid var(--zm-line-faint)',
    background: r.stage === 'overdue' ? 'rgba(217,119,6,0.06)' : 'transparent',
    cursor: 'pointer',
    position: 'relative'
  }
}, r.stage === 'overdue' && /*#__PURE__*/React.createElement("span", {
  style: {
    position: 'absolute',
    left: 0,
    top: 12,
    bottom: 12,
    width: 2,
    background: '#D97706',
    borderRadius: 2
  }
}), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 11.5,
    color: 'var(--zm-fg-3)'
  }
}, r.code), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--zm-fg)'
  }
}, r.name), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13,
    color: 'var(--zm-fg)'
  }
}, r.city), /*#__PURE__*/React.createElement("span", {
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8
  }
}, /*#__PURE__*/React.createElement(Avatar, {
  name: r.owner,
  size: 20
}), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12.5,
    color: 'var(--zm-fg-2)'
  }
}, r.owner)), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 12.5,
    color: r.stage === 'overdue' ? '#B45309' : 'var(--zm-fg)'
  }
}, String(r.days).padStart(2, '0'), "d"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement(StatusPill, {
  stage: r.stage
})), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12.5,
    color: 'var(--zm-fg-3)'
  }
}, r.meta))), rows.length === 0 && /*#__PURE__*/React.createElement("div", {
  style: {
    padding: 48,
    textAlign: 'center',
    color: 'var(--zm-fg-3)',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13
  }
}, "No sites in this stage right now."));
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/new-store-folder/App.jsx", error: String((e && e.message) || e) }); }

// ui_kits/new-store-folder/Archive.jsx
try { (() => {
// Archive view — supervisor only. Stores rejected/archived sites for future reference.

const ArchiveView = ({
  archives,
  onOpen
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    gap: 18
  }
}, /*#__PURE__*/React.createElement(PageHeader, {
  file: "\u2116 05",
  eyebrow: "Reference \xB7 Archive",
  title: /*#__PURE__*/React.createElement(React.Fragment, null, "Archived ", /*#__PURE__*/React.createElement("em", null, "sites")),
  lede: `${archives.length} site${archives.length === 1 ? '' : 's'} archived for future reference — rejected drafts and paused inquiries, with their reasons preserved.`,
  right: /*#__PURE__*/React.createElement(HeaderTag, {
    icon: "folder",
    label: "READ ONLY"
  })
}), /*#__PURE__*/React.createElement("div", {
  style: {
    background: 'var(--zm-surface)',
    border: '1px solid var(--zm-line)',
    borderRadius: 12,
    overflow: 'hidden',
    boxShadow: 'var(--zm-shadow-1)'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'grid',
    gridTemplateColumns: '0.9fr 1.6fr 1fr 1fr 1fr 1.4fr 90px',
    gap: 10,
    padding: '11px 16px',
    background: 'var(--zm-surface-2)',
    borderBottom: '1px solid var(--zm-line)',
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 600,
    fontSize: 10.5,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--zm-fg-3)'
  }
}, /*#__PURE__*/React.createElement("span", null, "Code"), /*#__PURE__*/React.createElement("span", null, "Site"), /*#__PURE__*/React.createElement("span", null, "City"), /*#__PURE__*/React.createElement("span", null, "Created by"), /*#__PURE__*/React.createElement("span", null, "Archived on"), /*#__PURE__*/React.createElement("span", null, "Reason"), /*#__PURE__*/React.createElement("span", null)), archives.map(a => /*#__PURE__*/React.createElement("div", {
  key: a.id,
  className: "zm-row",
  style: {
    display: 'grid',
    gridTemplateColumns: '0.9fr 1.6fr 1fr 1fr 1fr 1.4fr 90px',
    gap: 10,
    padding: '12px 16px',
    borderBottom: '1px solid var(--zm-line-faint)'
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 11.5,
    color: 'var(--zm-fg-3)'
  }
}, a.code), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--zm-fg)'
  }
}, a.name), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 10.5,
    color: 'var(--zm-fg-3)'
  }
}, a.id)), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13,
    color: 'var(--zm-fg)'
  }
}, a.city), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'center',
    gap: 6
  }
}, /*#__PURE__*/React.createElement(Avatar, {
  name: a.createdBy,
  size: 20
}), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12.5,
    color: 'var(--zm-fg-2)'
  }
}, a.createdBy)), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 12,
    color: 'var(--zm-fg)'
  }
}, a.archivedAt), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    alignItems: 'flex-start'
  }
}, (a.reasons || []).map(r => /*#__PURE__*/React.createElement("span", {
  key: r,
  style: {
    padding: '2px 8px',
    borderRadius: 999,
    background: '#F1F3F6',
    color: '#374151',
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 600,
    fontSize: 10.5,
    whiteSpace: 'nowrap'
  }
}, r)), (!a.reasons || a.reasons.length === 0) && /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12,
    color: 'var(--zm-fg-3)'
  }
}, "\u2014")), /*#__PURE__*/React.createElement("button", {
  onClick: () => onOpen(a),
  className: "zm-btn zm-row-cta",
  style: {
    height: 28,
    padding: '0 10px',
    border: '1px solid var(--zm-line)',
    borderRadius: 7,
    background: 'var(--zm-surface)',
    color: 'var(--zm-fg-2)',
    justifySelf: 'end',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 11.5,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4
  }
}, /*#__PURE__*/React.createElement(EyeIcon, {
  size: 12
}), " View"))), archives.length === 0 && /*#__PURE__*/React.createElement("div", {
  style: {
    padding: 48,
    textAlign: 'center',
    color: 'var(--zm-fg-3)',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13
  }
}, "Archive is empty. Rejected and archived drafts will appear here for future reference.")));
Object.assign(window, {
  ArchiveView
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/new-store-folder/Archive.jsx", error: String((e && e.message) || e) }); }

// ui_kits/new-store-folder/Chrome.jsx
try { (() => {
// Top bar + Sidebar for the new-store-folder web SPA.

const TopBar = ({
  user,
  role,
  dark,
  onToggleDark,
  onNewPipeline,
  onSearch
}) => /*#__PURE__*/React.createElement("header", {
  style: {
    height: 64,
    padding: 0,
    display: 'flex',
    alignItems: 'stretch',
    background: 'var(--zm-surface)',
    borderBottom: '1px solid var(--zm-line)',
    flex: '0 0 auto'
  }
}, /*#__PURE__*/React.createElement("div", {
  className: "zm-brand-plate",
  style: {
    width: 232,
    flex: '0 0 232px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 12px',
    color: '#F5F2EC',
    borderRight: '1px solid var(--zm-line)'
  }
}, /*#__PURE__*/React.createElement("svg", {
  className: "zm-brand-cube",
  width: "34",
  height: "34",
  viewBox: "0 0 64 64",
  fill: "none",
  style: {
    display: 'block',
    flex: '0 0 auto',
    position: 'relative',
    zIndex: 1
  }
}, /*#__PURE__*/React.createElement("g", {
  stroke: "#7AE7DA",
  strokeWidth: "1.2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  opacity: "0.55"
}, /*#__PURE__*/React.createElement("path", {
  d: "M22 10 L58 10 L58 46 L22 46 Z"
}), /*#__PURE__*/React.createElement("path", {
  d: "M6 22 L22 10"
}), /*#__PURE__*/React.createElement("path", {
  d: "M42 22 L58 10"
}), /*#__PURE__*/React.createElement("path", {
  d: "M6 58 L22 46"
}), /*#__PURE__*/React.createElement("path", {
  d: "M42 58 L58 46"
}), /*#__PURE__*/React.createElement("path", {
  d: "M6 22 L42 22 L42 58 L6 58 Z"
})), /*#__PURE__*/React.createElement("g", {
  stroke: "#E0A659",
  strokeWidth: "3.8",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "M6 22 L58 10"
}), /*#__PURE__*/React.createElement("path", {
  d: "M58 10 L6 58"
}), /*#__PURE__*/React.createElement("path", {
  d: "M6 58 L58 46"
}))), /*#__PURE__*/React.createElement("span", {
  className: "zm-brand-word",
  style: {
    fontFamily: 'var(--zm-font-serif)',
    fontStyle: 'italic',
    fontWeight: 400,
    fontSize: 30,
    color: '#F5F2EC',
    letterSpacing: '-0.012em',
    lineHeight: 1,
    whiteSpace: 'nowrap',
    position: 'relative',
    zIndex: 1,
    textShadow: '0 1px 0 rgba(0,0,0,0.35), 0 0 24px rgba(122,231,218,0.15)'
  }
}, "z\u2011matrix"), /*#__PURE__*/React.createElement("span", {
  style: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 5,
    height: 5,
    borderRadius: 999,
    background: '#E0A659',
    boxShadow: '0 0 8px rgba(224,166,89,0.7)',
    zIndex: 1
  }
})), /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0 20px',
    minWidth: 0
  }
}, /*#__PURE__*/React.createElement("button", {
  className: "zm-tb-btn",
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    height: 34,
    padding: '0 10px 0 12px',
    borderRadius: 8,
    border: '1px solid var(--zm-line)',
    background: 'var(--zm-surface)',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12.5,
    fontWeight: 600,
    color: 'var(--zm-fg)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    lineHeight: 1,
    flex: '0 0 auto'
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "folder",
  size: 14,
  style: {
    color: 'var(--zm-fg-3)'
  }
}), /*#__PURE__*/React.createElement("span", null, "New store opening"), /*#__PURE__*/React.createElement(Icon, {
  name: "chevronDown",
  size: 12,
  style: {
    color: 'var(--zm-fg-3)',
    marginLeft: 2
  }
})), /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1,
    position: 'relative',
    minWidth: 200,
    maxWidth: 480
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "search",
  size: 14,
  style: {
    position: 'absolute',
    left: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    color: 'var(--zm-fg-3)',
    pointerEvents: 'none'
  }
}), /*#__PURE__*/React.createElement("input", {
  className: "zm-tb-search",
  placeholder: "Search sites or SPOC\u2026",
  onChange: e => onSearch?.(e.target.value),
  style: {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    height: 34,
    padding: '0 56px 0 34px',
    background: 'var(--zm-bg)',
    border: '1px solid var(--zm-line)',
    borderRadius: 8,
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13,
    color: 'var(--zm-fg)',
    outline: 'none',
    textOverflow: 'ellipsis'
  }
}), /*#__PURE__*/React.createElement("kbd", {
  style: {
    position: 'absolute',
    right: 8,
    top: '50%',
    transform: 'translateY(-50%)',
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 10.5,
    fontWeight: 500,
    color: 'var(--zm-fg-3)',
    background: 'var(--zm-surface)',
    border: '1px solid var(--zm-line)',
    padding: '2px 6px',
    borderRadius: 4,
    lineHeight: 1,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    whiteSpace: 'nowrap',
    pointerEvents: 'none'
  }
}, "\u2318K")), /*#__PURE__*/React.createElement("span", {
  style: {
    flex: 1
  }
}), /*#__PURE__*/React.createElement("button", {
  onClick: onToggleDark,
  title: dark ? 'Switch to light' : 'Switch to dark',
  className: "zm-tb-btn",
  style: {
    width: 34,
    height: 34,
    padding: 0,
    borderRadius: 8,
    border: '1px solid var(--zm-line)',
    background: 'var(--zm-surface)',
    color: 'var(--zm-fg-2)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto'
  }
}, dark ? /*#__PURE__*/React.createElement("svg", {
  width: "15",
  height: "15",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.6",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "12",
  r: "4"
}), /*#__PURE__*/React.createElement("path", {
  d: "M12 3v1M12 20v1M3 12h1M20 12h1M5.6 5.6l.7.7M17.7 17.7l.7.7M5.6 18.4l.7-.7M17.7 6.3l.7-.7"
})) : /*#__PURE__*/React.createElement("svg", {
  width: "15",
  height: "15",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.6",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"
}))), /*#__PURE__*/React.createElement("button", {
  onClick: onNewPipeline,
  className: "zm-tb-cta",
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 34,
    padding: '0 14px',
    borderRadius: 8,
    background: 'var(--zm-accent)',
    color: '#fff',
    border: 'none',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: 'var(--zm-shadow-1)',
    whiteSpace: 'nowrap',
    lineHeight: 1,
    flex: '0 0 auto'
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "plus",
  size: 13
}), /*#__PURE__*/React.createElement("span", null, "New pipeline")), /*#__PURE__*/React.createElement("span", {
  style: {
    width: 1,
    height: 24,
    background: 'var(--zm-line)',
    marginLeft: 2,
    flex: '0 0 auto'
  }
}), /*#__PURE__*/React.createElement("button", {
  title: "Account",
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    height: 40,
    padding: '0 10px 0 4px',
    borderRadius: 999,
    background: 'transparent',
    border: '1px solid transparent',
    cursor: 'pointer',
    flex: '0 0 auto'
  },
  onMouseEnter: e => {
    e.currentTarget.style.background = 'var(--zm-surface-hover)';
    e.currentTarget.style.borderColor = 'var(--zm-line)';
  },
  onMouseLeave: e => {
    e.currentTarget.style.background = 'transparent';
    e.currentTarget.style.borderColor = 'transparent';
  }
}, /*#__PURE__*/React.createElement(Avatar, {
  name: user.name,
  size: 30
}), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1.15,
    whiteSpace: 'nowrap',
    alignItems: 'flex-start'
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12.5,
    fontWeight: 600,
    color: 'var(--zm-fg)'
  }
}, user.name), /*#__PURE__*/React.createElement("span", {
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontFamily: 'var(--zm-font-body)',
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: role === 'supervisor' ? 'var(--zm-accent)' : 'var(--zm-fg-3)',
    marginTop: 2
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    width: 5,
    height: 5,
    borderRadius: 999,
    background: role === 'supervisor' ? 'var(--zm-accent)' : 'var(--zm-fg-3)'
  }
}), role === 'supervisor' ? 'Supervisor' : 'BD Exec')), /*#__PURE__*/React.createElement(Icon, {
  name: "chevronDown",
  size: 12,
  style: {
    color: 'var(--zm-fg-3)'
  }
}))));
const SidebarItem = ({
  icon,
  label,
  count,
  active,
  onClick
}) => /*#__PURE__*/React.createElement("div", {
  onClick: onClick,
  className: "zm-sb-item",
  style: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '7px 10px',
    borderRadius: 7,
    cursor: 'pointer',
    background: active ? 'var(--zm-accent-soft)' : 'transparent',
    color: active ? 'var(--zm-fg)' : 'var(--zm-fg-2)',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    position: 'relative'
  },
  onMouseEnter: e => {
    if (!active) e.currentTarget.style.background = 'var(--zm-surface-hover)';
  },
  onMouseLeave: e => {
    if (!active) e.currentTarget.style.background = 'transparent';
  }
}, active && /*#__PURE__*/React.createElement("span", {
  style: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 2,
    background: 'var(--zm-accent)',
    borderRadius: 2
  }
}), /*#__PURE__*/React.createElement("span", {
  style: {
    color: active ? 'var(--zm-accent)' : 'var(--zm-fg-3)',
    display: 'inline-flex'
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: icon,
  size: 16
})), label, count != null && /*#__PURE__*/React.createElement("span", {
  style: {
    marginLeft: 'auto',
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 11,
    color: active ? 'var(--zm-accent)' : 'var(--zm-fg-3)',
    fontWeight: 500
  }
}, count));
const Sidebar = ({
  view,
  onView,
  counts,
  role,
  onRole
}) => /*#__PURE__*/React.createElement("aside", {
  style: {
    width: 232,
    flex: '0 0 232px',
    padding: '14px 12px',
    background: 'var(--zm-surface)',
    borderRight: '1px solid var(--zm-line)',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    overflowY: 'auto'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 600,
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--zm-fg-4)',
    padding: '4px 10px 6px'
  }
}, "Overview"), /*#__PURE__*/React.createElement(SidebarItem, {
  icon: "trend",
  label: "Sites in motion",
  active: view === 'overview',
  onClick: () => onView('overview')
}), /*#__PURE__*/React.createElement("div", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 600,
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--zm-fg-4)',
    padding: '14px 10px 6px'
  }
}, "Workflow"), /*#__PURE__*/React.createElement(SidebarItem, {
  icon: "file",
  label: "Pipeline",
  count: counts.pipeline,
  active: view === 'pipeline',
  onClick: () => onView('pipeline')
}), /*#__PURE__*/React.createElement(SidebarItem, {
  icon: "shield",
  label: "Shortlist queue",
  count: counts.shortlist,
  active: view === 'shortlist',
  onClick: () => onView('shortlist')
}), /*#__PURE__*/React.createElement(SidebarItem, {
  icon: "box",
  label: "Staging",
  count: counts.staging,
  active: view === 'staging',
  onClick: () => onView('staging')
}), role === 'supervisor' && /*#__PURE__*/React.createElement(SidebarItem, {
  icon: "folder",
  label: "Archive",
  count: counts.archive,
  active: view === 'archive',
  onClick: () => onView('archive')
}), /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1
  }
}), /*#__PURE__*/React.createElement("div", {
  style: {
    padding: 10,
    margin: '0 4px 8px',
    border: '1px solid var(--zm-line)',
    borderRadius: 10,
    background: 'var(--zm-surface-2)',
    display: 'flex',
    flexDirection: 'column',
    gap: 8
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 700,
    fontSize: 9.5,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--zm-fg-3)'
  }
}, "View as"), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    gap: 4,
    background: 'var(--zm-bg-2)',
    borderRadius: 7,
    padding: 3
  }
}, ['supervisor', 'exec'].map(r => /*#__PURE__*/React.createElement("button", {
  key: r,
  onClick: () => onRole(r),
  className: "zm-tb-btn",
  style: {
    flex: 1,
    height: 24,
    border: 'none',
    borderRadius: 5,
    background: role === r ? 'var(--zm-surface)' : 'transparent',
    color: role === r ? 'var(--zm-fg)' : 'var(--zm-fg-3)',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: role === r ? 'var(--zm-shadow-1)' : 'none',
    textTransform: 'capitalize'
  }
}, r === 'supervisor' ? 'Supervisor' : 'BD exec')))), /*#__PURE__*/React.createElement("div", {
  style: {
    padding: 12,
    margin: '0 4px',
    border: '1px solid var(--zm-line)',
    borderRadius: 10,
    background: 'var(--zm-surface-2)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    color: 'var(--zm-accent)'
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "chat",
  size: 14
}), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase'
  }
}, "Ask Matrix")), /*#__PURE__*/React.createElement("p", {
  style: {
    margin: 0,
    fontFamily: 'var(--zm-font-body)',
    fontSize: 11.5,
    color: 'var(--zm-fg-2)',
    lineHeight: 1.45
  }
}, "\"Staging sites overdue > 14 days\" \u2014 answer in the desktop workspace.")));
Object.assign(window, {
  TopBar,
  Sidebar,
  SidebarItem
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/new-store-folder/Chrome.jsx", error: String((e && e.message) || e) }); }

// ui_kits/new-store-folder/Drafts.jsx
try { (() => {
// Pipeline view = DRAFTS ONLY.
// - Supervisor: sees every BD exec's draft; Yes / No / View / Archive.
//               Drafts ≥ 7 days unactioned are highlighted in red.
// - BD exec: sees only their own drafts; View only.
// Filters: name/creator · city · visit month · days.
// "No" opens a reject-reason dialog with 7 reason chips + Other comment.

const MONTHS = ['All', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const REJECT_REASONS = ['High rent', 'High cannibalisation', 'Affluence problem', 'High traffic problem', 'No visibility', 'Sales problem', 'Other'];
const RejectReasonDialog = ({
  draft,
  onCancel,
  onSubmit
}) => {
  const [picked, setPicked] = React.useState([]);
  const [comment, setComment] = React.useState('');
  const toggle = r => setPicked(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
  const otherSelected = picked.includes('Other');
  const ready = picked.length > 0 && (!otherSelected || comment.trim().length > 0);
  if (!draft) return null;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(11,12,16,0.46)',
      backdropFilter: 'blur(6px)',
      zIndex: 110,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      animation: 'zm-fade 200ms var(--zm-ease)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 14,
      width: 540,
      padding: 26,
      boxShadow: 'var(--zm-shadow-pop)',
      display: 'flex',
      flexDirection: 'column',
      gap: 18,
      animation: 'zm-rise 240ms var(--zm-ease-emp)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: 10.5,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: '#B91C1C'
    }
  }, "Rejecting \xB7 ", draft.code), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '4px 0 6px',
      fontFamily: 'var(--zm-font-display)',
      fontWeight: 700,
      fontSize: 20,
      letterSpacing: '-0.02em',
      color: 'var(--zm-fg)'
    }
  }, "Why is this draft a No?"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg-3)'
    }
  }, "Pick all that apply. The BD exec sees the reason; the draft is archived for future reference.")), /*#__PURE__*/React.createElement("button", {
    onClick: onCancel,
    className: "zm-icon-btn",
    style: {
      background: 'var(--zm-surface-2)',
      border: '1px solid var(--zm-line)',
      borderRadius: 8,
      width: 30,
      height: 30,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--zm-fg-2)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "x",
    size: 14
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8
    }
  }, REJECT_REASONS.map(r => {
    const on = picked.includes(r);
    return /*#__PURE__*/React.createElement("button", {
      key: r,
      onClick: () => toggle(r),
      className: "zm-pill",
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 32,
        padding: '0 12px',
        borderRadius: 999,
        border: '1px solid ' + (on ? '#B91C1C' : 'var(--zm-line)'),
        background: on ? '#FBE0E0' : 'var(--zm-surface)',
        color: on ? '#B91C1C' : 'var(--zm-fg-2)',
        fontFamily: 'var(--zm-font-body)',
        fontSize: 12.5,
        fontWeight: 600,
        cursor: 'pointer'
      }
    }, on && /*#__PURE__*/React.createElement(Icon, {
      name: "check",
      size: 12
    }), r);
  })), otherSelected && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: 12,
      color: 'var(--zm-fg)'
    }
  }, "Other reason \xB7 comment ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#B91C1C',
      fontWeight: 700
    }
  }, "*")), /*#__PURE__*/React.createElement("textarea", {
    value: comment,
    onChange: e => setComment(e.target.value),
    placeholder: "Tell the BD exec what to look out for next time\u2026",
    style: {
      width: '100%',
      minHeight: 80,
      padding: 10,
      resize: 'vertical',
      border: '1px solid var(--zm-line)',
      borderRadius: 8,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg)',
      outline: 'none',
      background: 'var(--zm-bg)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      justifyContent: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onCancel,
    className: "zm-btn",
    style: {
      height: 36,
      padding: '0 14px',
      borderRadius: 8,
      border: '1px solid var(--zm-line)',
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer'
    }
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    disabled: !ready,
    onClick: () => onSubmit(draft, picked, comment),
    className: "zm-btn-primary",
    style: {
      height: 36,
      padding: '0 16px',
      borderRadius: 8,
      border: '1px solid #F2B6B6',
      background: ready ? '#fff' : 'var(--zm-surface)',
      color: ready ? '#B91C1C' : 'var(--zm-fg-4)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 700,
      cursor: ready ? 'pointer' : 'not-allowed',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, "Confirm reject"))));
};
const DraftsFilterBar = ({
  filters,
  onFilters,
  drafts
}) => {
  const cities = ['All', ...Array.from(new Set(drafts.map(d => d.city)))];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
      gap: 10,
      padding: 14,
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 12,
      boxShadow: 'var(--zm-shadow-1)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 13,
    style: {
      position: 'absolute',
      left: 10,
      top: '50%',
      transform: 'translateY(-50%)',
      color: 'var(--zm-fg-3)',
      pointerEvents: 'none'
    }
  }), /*#__PURE__*/React.createElement("input", {
    placeholder: "Search name or creator\u2026",
    value: filters.q,
    onChange: e => onFilters({
      ...filters,
      q: e.target.value
    }),
    style: {
      width: '100%',
      minWidth: 0,
      boxSizing: 'border-box',
      height: 36,
      padding: '0 10px 0 32px',
      background: 'var(--zm-bg)',
      border: '1px solid var(--zm-line)',
      borderRadius: 6,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg)',
      outline: 'none'
    }
  })), /*#__PURE__*/React.createElement("select", {
    value: filters.city,
    onChange: e => onFilters({
      ...filters,
      city: e.target.value
    }),
    style: {
      height: 36,
      padding: '0 10px',
      background: 'var(--zm-bg)',
      border: '1px solid var(--zm-line)',
      borderRadius: 6,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg)',
      outline: 'none'
    }
  }, cities.map(c => /*#__PURE__*/React.createElement("option", {
    key: c,
    value: c
  }, "City \xB7 ", c))), /*#__PURE__*/React.createElement("select", {
    value: filters.month,
    onChange: e => onFilters({
      ...filters,
      month: e.target.value
    }),
    style: {
      height: 36,
      padding: '0 10px',
      background: 'var(--zm-bg)',
      border: '1px solid var(--zm-line)',
      borderRadius: 6,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg)',
      outline: 'none'
    }
  }, MONTHS.map(m => /*#__PURE__*/React.createElement("option", {
    key: m,
    value: m
  }, "Visit \xB7 ", m))), /*#__PURE__*/React.createElement("select", {
    value: filters.days,
    onChange: e => onFilters({
      ...filters,
      days: e.target.value
    }),
    style: {
      height: 36,
      padding: '0 10px',
      background: 'var(--zm-bg)',
      border: '1px solid var(--zm-line)',
      borderRadius: 6,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg)',
      outline: 'none'
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: "all"
  }, "Days \xB7 all"), /*#__PURE__*/React.createElement("option", {
    value: "0-3"
  }, "Days \xB7 0\u20133"), /*#__PURE__*/React.createElement("option", {
    value: "4-7"
  }, "Days \xB7 4\u20137"), /*#__PURE__*/React.createElement("option", {
    value: "7+"
  }, "Days \xB7 > 7 (overdue)"), /*#__PURE__*/React.createElement("option", {
    value: "14+"
  }, "Days \xB7 14+")));
};
const applyDraftFilters = (drafts, f) => drafts.filter(d => {
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!d.name.toLowerCase().includes(q) && !d.createdBy.toLowerCase().includes(q)) return false;
  }
  if (f.city !== 'All' && d.city !== f.city) return false;
  if (f.month !== 'All') {
    const m = new Date(d.visitDate).toLocaleString('en', {
      month: 'short'
    });
    if (m !== f.month) return false;
  }
  if (f.days !== 'all') {
    const bands = {
      '0-3': [0, 3],
      '4-7': [4, 7],
      '7+': [8, 9999],
      '14+': [14, 9999]
    };
    const [lo, hi] = bands[f.days];
    if (d.days < lo || d.days > hi) return false;
  }
  return true;
});
const EyeIcon = ({
  size = 14
}) => /*#__PURE__*/React.createElement("svg", {
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.6",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"
}), /*#__PURE__*/React.createElement("circle", {
  cx: "12",
  cy: "12",
  r: "3"
}));
const DraftRow = ({
  draft,
  role,
  onApprove,
  onReject,
  onArchive,
  onOpen
}) => {
  const overdue = role === 'supervisor' && draft.days > 7;
  return /*#__PURE__*/React.createElement("div", {
    className: "zm-row",
    style: {
      display: 'grid',
      gridTemplateColumns: '0.9fr 1.6fr 1fr 1fr 0.8fr 0.7fr ' + (role === 'supervisor' ? '230px' : '90px'),
      alignItems: 'center',
      gap: 10,
      padding: '12px 16px',
      borderBottom: '1px solid var(--zm-line-faint)',
      background: overdue ? 'rgba(185,28,28,0.05)' : 'transparent',
      position: 'relative'
    }
  }, overdue && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 0,
      top: 12,
      bottom: 12,
      width: 2,
      background: '#B91C1C',
      borderRadius: 2
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 11.5,
      color: 'var(--zm-fg-3)'
    }
  }, draft.code), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13.5,
      fontWeight: 600,
      color: 'var(--zm-fg)'
    }
  }, draft.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 10.5,
      color: 'var(--zm-fg-3)'
    }
  }, draft.id)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: draft.createdBy,
    size: 22
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12.5,
      color: 'var(--zm-fg-2)'
    }
  }, draft.createdBy)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg)'
    }
  }, draft.city), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 12.5,
      color: 'var(--zm-fg-2)'
    }
  }, draft.visitDate), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 13,
      fontWeight: 600,
      color: overdue ? '#B91C1C' : 'var(--zm-fg)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, overdue && /*#__PURE__*/React.createElement(Icon, {
    name: "alert",
    size: 12
  }), String(draft.days).padStart(2, '0'), "d"), role === 'supervisor' ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      justifyContent: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onOpen(draft),
    title: "View",
    className: "zm-icon-btn",
    style: {
      width: 32,
      height: 32,
      padding: 0,
      border: '1px solid var(--zm-line)',
      borderRadius: 7,
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg-2)',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(EyeIcon, null)), /*#__PURE__*/React.createElement("button", {
    onClick: () => onArchive(draft),
    title: "Archive",
    className: "zm-icon-btn",
    style: {
      width: 32,
      height: 32,
      padding: 0,
      border: '1px solid var(--zm-line)',
      borderRadius: 7,
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg-2)',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "folder",
    size: 14
  })), /*#__PURE__*/React.createElement("button", {
    onClick: () => onReject(draft),
    className: "zm-btn-danger",
    style: {
      height: 32,
      padding: '0 10px',
      border: '1px solid #F2B6B6',
      borderRadius: 7,
      background: '#fff',
      color: '#B91C1C',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      fontWeight: 600,
      cursor: 'pointer'
    }
  }, "No"), /*#__PURE__*/React.createElement("button", {
    onClick: () => onApprove(draft),
    className: "zm-btn-primary",
    style: {
      height: 32,
      padding: '0 14px',
      border: 'none',
      borderRadius: 7,
      background: 'var(--zm-accent)',
      color: '#fff',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      fontWeight: 700,
      cursor: 'pointer',
      boxShadow: 'var(--zm-shadow-1)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 12
  }), " Yes")) : /*#__PURE__*/React.createElement("button", {
    onClick: () => onOpen(draft),
    className: "zm-btn",
    style: {
      height: 32,
      padding: '0 12px',
      border: '1px solid var(--zm-line)',
      borderRadius: 7,
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg-2)',
      justifySelf: 'end',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      fontWeight: 600,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(EyeIcon, null), " View"));
};
const DraftsView = ({
  drafts,
  role,
  onApprove,
  onReject,
  onArchive,
  onOpen
}) => {
  const [filters, setFilters] = React.useState({
    q: '',
    city: 'All',
    month: 'All',
    days: 'all'
  });
  const filtered = applyDraftFilters(drafts, filters);
  const overdueCount = role === 'supervisor' ? drafts.filter(d => d.days > 7).length : 0;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 18
    }
  }, /*#__PURE__*/React.createElement(PageHeader, {
    file: "\u2116 02",
    eyebrow: "Workflow \xB7 Pipeline",
    title: role === 'supervisor' ? /*#__PURE__*/React.createElement(React.Fragment, null, "Drafts ", /*#__PURE__*/React.createElement("em", null, "awaiting"), " shortlist") : /*#__PURE__*/React.createElement(React.Fragment, null, "Your drafts ", /*#__PURE__*/React.createElement("em", null, "in flight")),
    lede: role === 'supervisor' ? `${drafts.length} draft${drafts.length === 1 ? '' : 's'} from all your BD execs. Supervisor SLA: 7 days. Tap Yes, No, or Archive.` : `${drafts.length} of your own draft${drafts.length === 1 ? '' : 's'} awaiting supervisor decision — you only see what you created.`,
    right: overdueCount > 0 ? /*#__PURE__*/React.createElement(HeaderTag, {
      icon: "alert",
      label: `${overdueCount} PAST SLA`,
      tone: "accent"
    }) : /*#__PURE__*/React.createElement(HeaderTag, {
      icon: "check",
      label: "SLA CLEAR"
    })
  }), /*#__PURE__*/React.createElement(DraftsFilterBar, {
    filters: filters,
    onFilters: setFilters,
    drafts: drafts
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 12,
      overflow: 'hidden',
      boxShadow: 'var(--zm-shadow-1)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '0.9fr 1.6fr 1fr 1fr 0.8fr 0.7fr ' + (role === 'supervisor' ? '230px' : '90px'),
      gap: 10,
      padding: '11px 16px',
      background: 'var(--zm-surface-2)',
      borderBottom: '1px solid var(--zm-line)',
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: 10.5,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: 'var(--zm-fg-3)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Code"), /*#__PURE__*/React.createElement("span", null, "Pipeline name"), /*#__PURE__*/React.createElement("span", null, "Created by"), /*#__PURE__*/React.createElement("span", null, "City"), /*#__PURE__*/React.createElement("span", null, "Visit date"), /*#__PURE__*/React.createElement("span", null, "Days"), /*#__PURE__*/React.createElement("span", {
    style: {
      textAlign: 'right'
    }
  }, role === 'supervisor' ? 'Decision' : 'Action')), filtered.map(d => /*#__PURE__*/React.createElement(DraftRow, {
    key: d.id,
    draft: d,
    role: role,
    onApprove: onApprove,
    onReject: onReject,
    onArchive: onArchive,
    onOpen: onOpen
  })), filtered.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 48,
      textAlign: 'center',
      color: 'var(--zm-fg-3)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13
    }
  }, "No drafts match these filters.")));
};
Object.assign(window, {
  DraftsView,
  RejectReasonDialog,
  applyDraftFilters,
  EyeIcon
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/new-store-folder/Drafts.jsx", error: String((e && e.message) || e) }); }

// ui_kits/new-store-folder/PageHeader.jsx
try { (() => {
// Editorial page-header used across every view.
// Builds an "editorial field manual" feel: case-file number, eyebrow with
// rule, large serif title (italic), and a body lede.

const PageHeader = ({
  file,
  eyebrow,
  title,
  lede,
  right,
  italic = true
}) => /*#__PURE__*/React.createElement("header", {
  style: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 24,
    marginBottom: 22,
    paddingBottom: 18,
    borderBottom: '1px solid var(--zm-line)',
    position: 'relative'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minWidth: 0,
    flex: 1
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'center',
    gap: 14
  }
}, file && /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.18em',
    color: 'var(--zm-fg-4)',
    whiteSpace: 'nowrap',
    flex: '0 0 auto'
  }
}, file), file && /*#__PURE__*/React.createElement("span", {
  style: {
    width: 18,
    height: 1,
    background: 'var(--zm-line-strong)',
    flex: '0 0 auto'
  }
}), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    color: 'var(--zm-fg-3)',
    whiteSpace: 'nowrap'
  }
}, eyebrow)), /*#__PURE__*/React.createElement("h1", {
  style: {
    margin: 0,
    color: 'var(--zm-fg)',
    fontFamily: 'var(--zm-font-serif)',
    fontWeight: 400,
    fontSize: 48,
    lineHeight: 1,
    letterSpacing: '-0.015em',
    fontStyle: italic ? 'italic' : 'normal'
  }
}, title), lede && /*#__PURE__*/React.createElement("p", {
  style: {
    margin: '8px 0 0',
    maxWidth: 720,
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13.5,
    lineHeight: 1.55,
    color: 'var(--zm-fg-2)'
  }
}, lede)), right && /*#__PURE__*/React.createElement("div", {
  style: {
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'flex-end',
    gap: 10
  }
}, right));

// Inline pill used at the top of headers for tenant / role context.
const HeaderTag = ({
  icon,
  label,
  tone = 'default'
}) => /*#__PURE__*/React.createElement("span", {
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 22,
    padding: '0 10px 0 9px',
    borderRadius: 4,
    border: '1px solid ' + (tone === 'accent' ? 'var(--zm-accent)' : 'var(--zm-line-strong)'),
    background: 'transparent',
    color: tone === 'accent' ? 'var(--zm-accent)' : 'var(--zm-fg-2)',
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 700,
    fontSize: 10,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    lineHeight: 1
  }
}, icon && /*#__PURE__*/React.createElement(Icon, {
  name: icon,
  size: 11
}), label);
Object.assign(window, {
  PageHeader,
  HeaderTag
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/new-store-folder/PageHeader.jsx", error: String((e && e.message) || e) }); }

// ui_kits/new-store-folder/Pipeline.jsx
try { (() => {
// Pipeline overview: metric strip + filter bar + sites table.

const MetricCard = ({
  eyebrow,
  value,
  rule = 'var(--zm-copper)',
  delta,
  deltaTone = 'pos',
  sub,
  no
}) => /*#__PURE__*/React.createElement("div", {
  className: "zm-glass",
  style: {
    borderRadius: 16,
    padding: '24px 26px 26px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    position: 'relative',
    overflow: 'hidden',
    transition: 'transform 200ms cubic-bezier(0.22,1,0.36,1), box-shadow 200ms cubic-bezier(0.22,1,0.36,1)'
  },
  onMouseEnter: e => {
    e.currentTarget.style.transform = 'translateY(-2px)';
    e.currentTarget.style.boxShadow = 'var(--zm-shadow-3)';
  },
  onMouseLeave: e => {
    e.currentTarget.style.transform = 'translateY(0)';
    e.currentTarget.style.boxShadow = 'var(--zm-glass)';
  }
}, /*#__PURE__*/React.createElement("span", {
  "aria-hidden": "true",
  style: {
    position: 'absolute',
    inset: '0 0 auto 0',
    height: 1,
    background: 'linear-gradient(90deg, transparent, ' + rule + ', transparent)',
    opacity: 0.6
  }
}), /*#__PURE__*/React.createElement(CornerTicks, null), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0
  }
}, no && /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.16em',
    color: 'var(--zm-fg-4)',
    flex: '0 0 auto'
  }
}, no), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 700,
    fontSize: 9.5,
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    color: 'var(--zm-fg-3)',
    lineHeight: 1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    flex: 1
  }
}, eyebrow)), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-serif)',
    fontWeight: 400,
    fontStyle: 'italic',
    fontSize: 68,
    letterSpacing: '-0.025em',
    color: 'var(--zm-fg)',
    lineHeight: 0.95,
    fontFeatureSettings: "'tnum' 1"
  }
}, value), /*#__PURE__*/React.createElement("span", {
  style: {
    width: 36,
    height: 1,
    background: rule,
    opacity: 0.7
  }
}), delta && /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 11.5,
    letterSpacing: 0,
    color: deltaTone === 'pos' ? 'var(--zm-success)' : deltaTone === 'neg' ? 'var(--zm-danger)' : 'var(--zm-fg-3)'
  }
}, delta), sub && /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-serif)',
    fontStyle: 'italic',
    fontSize: 13,
    color: 'var(--zm-fg-3)'
  }
}, sub));
const CornerTicks = () => /*#__PURE__*/React.createElement(React.Fragment, null, [{
  top: 0,
  left: 0,
  rot: 0
}, {
  top: 0,
  right: 0,
  rot: 90
}, {
  bottom: 0,
  right: 0,
  rot: 180
}, {
  bottom: 0,
  left: 0,
  rot: -90
}].map((p, i) => /*#__PURE__*/React.createElement("span", {
  key: i,
  style: {
    position: 'absolute',
    width: 8,
    height: 8,
    ...p,
    borderTop: '1px solid var(--zm-fg-3)',
    borderLeft: '1px solid var(--zm-fg-3)',
    opacity: 0.35,
    transform: `rotate(${p.rot}deg)`,
    margin: 6
  }
})));
const MetricStrip = () => /*#__PURE__*/React.createElement("div", {
  className: "zm-stagger",
  style: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 14
  }
}, /*#__PURE__*/React.createElement(MetricCard, {
  no: "\u2160",
  eyebrow: "Sites in motion",
  value: "142",
  rule: "var(--zm-accent)",
  delta: "\u25B2 12 this week",
  sub: "across 23 cities"
}), /*#__PURE__*/React.createElement(MetricCard, {
  no: "\u2161",
  eyebrow: "New drafts",
  value: "9",
  rule: "var(--zm-fg-3)",
  delta: "\u25B2 2 vs last week",
  sub: "awaiting review"
}), /*#__PURE__*/React.createElement(MetricCard, {
  no: "\u2162",
  eyebrow: "Shortlist queue",
  value: "3",
  rule: "var(--zm-info)",
  delta: "oldest \xB7 3 days",
  sub: "supervisor decision"
}), /*#__PURE__*/React.createElement(MetricCard, {
  no: "\u2163",
  eyebrow: "LOI overdue",
  value: "4",
  rule: "var(--zm-copper)",
  delta: "\u25B2 1 vs last week",
  deltaTone: "neg",
  sub: "past timeline"
}));
const FilterChip = ({
  active,
  label,
  count,
  color,
  onClick
}) => /*#__PURE__*/React.createElement("button", {
  onClick: onClick,
  className: "zm-pill",
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    height: 30,
    padding: '0 12px',
    borderRadius: 999,
    border: '1px solid ' + (active ? 'var(--zm-fg)' : 'var(--zm-line)'),
    background: active ? 'var(--zm-fg)' : 'var(--zm-surface)',
    color: active ? '#fff' : 'var(--zm-fg-2)',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 120ms var(--zm-ease)'
  }
}, color && /*#__PURE__*/React.createElement("span", {
  style: {
    width: 6,
    height: 6,
    borderRadius: 999,
    background: color
  }
}), label, count != null && /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontWeight: 500,
    fontSize: 11,
    color: active ? 'rgba(255,255,255,0.7)' : 'var(--zm-fg-3)'
  }
}, count));

// =================================================================
// More-filters popover: month chips, quick presets, calendar range.
// =================================================================

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PRESETS = [{
  id: 'today',
  label: 'Today',
  days: 0
}, {
  id: 'week',
  label: 'Last 7 days',
  days: 7
}, {
  id: 'month',
  label: 'Last 30 days',
  days: 30
}, {
  id: 'thisMo',
  label: 'This month',
  kind: 'thisMonth'
}, {
  id: 'lastMo',
  label: 'Last month',
  kind: 'lastMonth'
}, {
  id: 'q',
  label: 'This quarter',
  kind: 'thisQuarter'
}, {
  id: 'ytd',
  label: 'YTD',
  kind: 'ytd'
}];
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const fmtISO = d => {
  // Local-date ISO — avoids the UTC off-by-one when the user is east of GMT.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const fmtNice = iso => iso ? new Date(iso + 'T00:00').toLocaleDateString('en', {
  day: '2-digit',
  month: 'short',
  year: 'numeric'
}) : '—';
const presetRange = p => {
  const now = new Date();
  if (p.days != null) {
    const end = now;
    const start = p.days === 0 ? now : addDays(now, -p.days);
    return {
      from: fmtISO(start),
      to: fmtISO(end)
    };
  }
  if (p.kind === 'thisMonth') {
    return {
      from: fmtISO(new Date(now.getFullYear(), now.getMonth(), 1)),
      to: fmtISO(new Date(now.getFullYear(), now.getMonth() + 1, 0))
    };
  }
  if (p.kind === 'lastMonth') {
    return {
      from: fmtISO(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: fmtISO(new Date(now.getFullYear(), now.getMonth(), 0))
    };
  }
  if (p.kind === 'thisQuarter') {
    const q = Math.floor(now.getMonth() / 3);
    return {
      from: fmtISO(new Date(now.getFullYear(), q * 3, 1)),
      to: fmtISO(new Date(now.getFullYear(), q * 3 + 3, 0))
    };
  }
  if (p.kind === 'ytd') {
    return {
      from: fmtISO(new Date(now.getFullYear(), 0, 1)),
      to: fmtISO(now)
    };
  }
  return {
    from: '',
    to: ''
  };
};

// Tiny month-grid calendar with click-to-pick range.
const RangeCalendar = ({
  from,
  to,
  onChange
}) => {
  const [view, setView] = React.useState(() => {
    const seed = from ? new Date(from + 'T00:00') : new Date();
    return {
      y: seed.getFullYear(),
      m: seed.getMonth()
    };
  });

  // Keep the visible month in sync when `from` is set externally (e.g. via a preset).
  React.useEffect(() => {
    if (!from) return;
    const d = new Date(from + 'T00:00');
    setView(v => v.y === d.getFullYear() && v.m === d.getMonth() ? v : {
      y: d.getFullYear(),
      m: d.getMonth()
    });
  }, [from]);
  const monthStart = new Date(view.y, view.m, 1);
  const monthEnd = new Date(view.y, view.m + 1, 0);
  const startDow = monthStart.getDay(); // 0..6 (Sun)
  const daysInMonth = monthEnd.getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(view.y, view.m, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const fromD = from ? new Date(from + 'T00:00') : null;
  const toD = to ? new Date(to + 'T00:00') : null;
  const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const inRange = d => fromD && toD && d > fromD && d < toD;
  const isEnd = (d, t) => sameDay(d, t);
  const pick = d => {
    if (!d) return;
    const iso = fmtISO(d);
    // No range yet, OR a full range already exists → start over with a new "from".
    if (!from || from && to) return onChange({
      from: iso,
      to: ''
    });
    // "From" picked, choosing the second endpoint.
    if (iso === from) return onChange({
      from: iso,
      to: iso
    }); // single-day range
    if (iso < from) return onChange({
      from: iso,
      to: from
    }); // swap if user picked earlier
    return onChange({
      from,
      to: iso
    });
  };
  const shift = delta => setView(v => {
    let y = v.y,
      m = v.m + delta;
    while (m < 0) {
      m += 12;
      y--;
    }
    while (m > 11) {
      m -= 12;
      y++;
    }
    return {
      y,
      m
    };
  });
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 10,
      padding: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      minWidth: 248
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => shift(-1),
    className: "zm-icon-btn",
    style: {
      width: 24,
      height: 24,
      padding: 0,
      border: '1px solid var(--zm-line)',
      borderRadius: 6,
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg-2)',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M15 18l-6-6 6-6"
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: 12.5,
      color: 'var(--zm-fg)'
    }
  }, MONTH_NAMES[view.m], " ", view.y), /*#__PURE__*/React.createElement("button", {
    onClick: () => shift(1),
    className: "zm-icon-btn",
    style: {
      width: 24,
      height: 24,
      padding: 0,
      border: '1px solid var(--zm-line)',
      borderRadius: 6,
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg-2)',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M9 18l6-6-6-6"
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(7, 1fr)',
      gap: 2
    }
  }, ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: 9.5,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: 'var(--zm-fg-4)',
      textAlign: 'center',
      padding: '4px 0'
    }
  }, d)), cells.map((d, i) => {
    if (!d) return /*#__PURE__*/React.createElement("span", {
      key: i,
      style: {
        height: 28
      }
    });
    const startSel = isEnd(d, fromD);
    const endSel = isEnd(d, toD);
    const within = inRange(d) && !startSel && !endSel;
    return /*#__PURE__*/React.createElement("button", {
      key: i,
      onClick: () => pick(d),
      className: "zm-cal-day",
      "data-state": startSel ? 'start' : endSel ? 'end' : within ? 'within' : 'idle',
      style: {
        height: 28,
        padding: 0,
        border: 'none',
        borderRadius: startSel ? '999px 0 0 999px' : endSel ? '0 999px 999px 0' : within ? 0 : 6,
        background: startSel || endSel ? 'var(--zm-accent)' : within ? 'var(--zm-accent-soft)' : 'transparent',
        color: startSel || endSel ? '#fff' : within ? 'var(--zm-accent)' : 'var(--zm-fg)',
        fontFamily: 'var(--zm-font-mono)',
        fontFeatureSettings: "'tnum' 1",
        fontSize: 12,
        fontWeight: startSel || endSel ? 700 : 500,
        cursor: 'pointer'
      }
    }, d.getDate());
  })));
};
const MoreFilters = ({
  value,
  onChange,
  onClose
}) => {
  // Build last 12 months as pickable chips (advanced.month is a YYYY-MM string).
  const months = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: `${MONTH_NAMES[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`
    });
  }
  const setMonth = k => {
    if (value.month === k) return onChange({
      ...value,
      month: ''
    });
    onChange({
      ...value,
      month: k,
      from: '',
      to: '',
      preset: ''
    });
  };
  const setPreset = p => {
    const r = presetRange(p);
    onChange({
      ...value,
      preset: p.id,
      month: '',
      ...r
    });
  };
  const setRange = r => onChange({
    ...value,
    ...r,
    preset: '',
    month: ''
  });
  const clear = () => onChange({
    month: '',
    preset: '',
    from: '',
    to: ''
  });
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 'calc(100% + 8px)',
      right: 0,
      zIndex: 30,
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 12,
      boxShadow: 'var(--zm-shadow-pop)',
      width: 560,
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      animation: 'zm-rise 200ms var(--zm-ease-emp)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h4", {
    style: {
      margin: 0,
      fontFamily: 'var(--zm-font-display)',
      fontWeight: 600,
      fontSize: 14,
      color: 'var(--zm-fg)'
    }
  }, "More filters"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 11.5,
      color: 'var(--zm-fg-3)'
    }
  }, "Narrow by visit-date month, preset window, or custom range.")), /*#__PURE__*/React.createElement("button", {
    onClick: clear,
    className: "zm-link-btn",
    style: {
      background: 'transparent',
      border: 'none',
      color: 'var(--zm-fg-3)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 11.5,
      fontWeight: 600,
      cursor: 'pointer',
      textDecoration: 'underline',
      textUnderlineOffset: 2
    }
  }, "Clear all")), /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 700,
      fontSize: 9.5,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: 'var(--zm-fg-3)',
      marginBottom: 8
    }
  }, "By month \xB7 visit date"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(6, 1fr)',
      gap: 6
    }
  }, months.map(m => {
    const on = value.month === m.key;
    return /*#__PURE__*/React.createElement("button", {
      key: m.key,
      onClick: () => setMonth(m.key),
      className: "zm-pill",
      style: {
        height: 30,
        padding: '0 8px',
        borderRadius: 7,
        border: '1px solid ' + (on ? 'var(--zm-accent)' : 'var(--zm-line)'),
        background: on ? 'var(--zm-accent-soft)' : 'var(--zm-surface)',
        color: on ? 'var(--zm-accent)' : 'var(--zm-fg-2)',
        fontFamily: 'var(--zm-font-mono)',
        fontSize: 11,
        fontWeight: on ? 700 : 600,
        cursor: 'pointer'
      }
    }, m.label);
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '180px 1fr',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 700,
      fontSize: 9.5,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: 'var(--zm-fg-3)',
      marginBottom: 8
    }
  }, "Preset window"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, PRESETS.map(p => {
    const on = value.preset === p.id;
    return /*#__PURE__*/React.createElement("button", {
      key: p.id,
      onClick: () => setPreset(p),
      style: {
        textAlign: 'left',
        height: 30,
        padding: '0 10px',
        borderRadius: 7,
        border: '1px solid ' + (on ? 'var(--zm-accent)' : 'transparent'),
        background: on ? 'var(--zm-accent-soft)' : 'transparent',
        color: on ? 'var(--zm-accent)' : 'var(--zm-fg-2)',
        fontFamily: 'var(--zm-font-body)',
        fontSize: 12.5,
        fontWeight: on ? 600 : 500,
        cursor: 'pointer'
      }
    }, p.label);
  }))), /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 700,
      fontSize: 9.5,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: 'var(--zm-fg-3)',
      marginBottom: 8
    }
  }, "Custom range"), /*#__PURE__*/React.createElement(RangeCalendar, {
    from: value.from,
    to: value.to,
    onChange: setRange
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 12px',
      borderRadius: 8,
      background: 'var(--zm-bg-2)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "calendar",
    size: 13,
    style: {
      color: 'var(--zm-fg-3)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 11.5,
      color: 'var(--zm-fg-2)'
    }
  }, value.month ? /*#__PURE__*/React.createElement(React.Fragment, null, "Month: ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--zm-fg)'
    }
  }, months.find(m => m.key === value.month)?.label)) : value.from || value.to ? /*#__PURE__*/React.createElement(React.Fragment, null, "Range: ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--zm-fg)'
    }
  }, fmtNice(value.from)), " \u2192 ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--zm-fg)'
    }
  }, fmtNice(value.to))) : /*#__PURE__*/React.createElement(React.Fragment, null, "No date filter applied \xB7 showing all sites")), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    style: {
      height: 30,
      padding: '0 14px',
      borderRadius: 7,
      border: 'none',
      background: 'var(--zm-accent)',
      color: '#fff',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12.5,
      fontWeight: 700,
      cursor: 'pointer'
    }
  }, "Apply")));
};
const PipelineFilter = ({
  stage,
  onStage,
  counts,
  advanced,
  onAdvanced
}) => {
  const [open, setOpen] = React.useState(false);
  const adv = advanced || {
    month: '',
    preset: '',
    from: '',
    to: ''
  };
  const active = !!(adv.month || adv.preset || adv.from || adv.to);
  const popRef = React.useRef(null);

  // Close on outside click + Escape
  React.useEffect(() => {
    if (!open) return;
    const onDoc = e => {
      if (popRef.current && !popRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = e => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Defer attaching to the next tick so the opening click doesn't immediately re-close.
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onDoc, true);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const summary = adv.month ? `Month · ${adv.month.slice(5)}/${adv.month.slice(2, 4)}` : adv.preset ? PRESETS.find(p => p.id === adv.preset)?.label : adv.from && adv.to ? `${adv.from} → ${adv.to}` : adv.from ? `from ${adv.from}` : '';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement(FilterChip, {
    label: "All",
    count: counts.all,
    active: stage === 'all',
    onClick: () => onStage('all')
  }), /*#__PURE__*/React.createElement(FilterChip, {
    label: "Draft",
    count: counts.draft,
    active: stage === 'draft',
    onClick: () => onStage('draft'),
    color: STAGES.draft.color
  }), /*#__PURE__*/React.createElement(FilterChip, {
    label: "Shortlist",
    count: counts.shortlist,
    active: stage === 'shortlist',
    onClick: () => onStage('shortlist'),
    color: STAGES.shortlist.color
  }), /*#__PURE__*/React.createElement(FilterChip, {
    label: "Staging",
    count: counts.staging,
    active: stage === 'staging',
    onClick: () => onStage('staging'),
    color: STAGES.staging.color
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), active && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 30,
      padding: '0 10px',
      borderRadius: 999,
      background: 'var(--zm-accent-soft)',
      color: 'var(--zm-accent)',
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 11,
      fontWeight: 600
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "calendar",
    size: 11
  }), " ", summary, /*#__PURE__*/React.createElement("button", {
    onClick: () => onAdvanced({
      month: '',
      preset: '',
      from: '',
      to: ''
    }),
    style: {
      background: 'transparent',
      border: 'none',
      color: 'inherit',
      padding: 0,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      marginLeft: 4,
      opacity: 0.7
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "x",
    size: 11
  }))), /*#__PURE__*/React.createElement("div", {
    ref: popRef,
    style: {
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setOpen(o => !o),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 30,
      padding: '0 12px',
      borderRadius: 999,
      border: '1px solid ' + (active || open ? 'var(--zm-accent)' : 'var(--zm-line)'),
      background: active || open ? 'var(--zm-accent-soft)' : 'var(--zm-surface)',
      color: active || open ? 'var(--zm-accent)' : 'var(--zm-fg-2)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      fontWeight: 600,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      lineHeight: 1
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "filter",
    size: 13
  }), " More filters", active && /*#__PURE__*/React.createElement("span", {
    style: {
      background: 'var(--zm-accent)',
      color: '#fff',
      width: 16,
      height: 16,
      borderRadius: 999,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 9.5,
      fontWeight: 700,
      marginLeft: 2
    }
  }, "\u2022")), open && /*#__PURE__*/React.createElement(MoreFilters, {
    value: adv,
    onChange: v => onAdvanced(v),
    onClose: () => setOpen(false)
  })));
};
const SiteRow = ({
  site,
  onClick,
  hovered,
  onHover
}) => {
  const cell = {
    padding: '12px 8px',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13,
    color: 'var(--zm-fg)'
  };
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => onHover?.(site.id),
    onMouseLeave: () => onHover?.(null),
    className: "zm-row",
    style: {
      display: 'grid',
      gridTemplateColumns: '32px 1.5fr 0.9fr 0.95fr 0.7fr 0.6fr 1.1fr 24px',
      alignItems: 'center',
      gap: 8,
      padding: '0 16px',
      borderBottom: '1px solid var(--zm-line-faint)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      ...cell,
      fontFamily: 'var(--zm-font-mono)',
      color: 'var(--zm-fg-3)',
      fontSize: 11
    }
  }, site.code), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '10px 8px',
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: 13,
      color: 'var(--zm-fg)'
    }
  }, site.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 10.5,
      color: 'var(--zm-fg-3)'
    }
  }, site.id)), /*#__PURE__*/React.createElement("span", {
    style: cell
  }, site.city), /*#__PURE__*/React.createElement("span", {
    style: {
      ...cell,
      fontFamily: 'var(--zm-font-mono)',
      fontFeatureSettings: "'tnum' 1",
      textAlign: 'right'
    }
  }, "\u20B9", site.opCost.toLocaleString('en-IN')), /*#__PURE__*/React.createElement("span", {
    style: {
      ...cell,
      fontFamily: 'var(--zm-font-mono)',
      fontFeatureSettings: "'tnum' 1",
      textAlign: 'right'
    }
  }, site.carpet), /*#__PURE__*/React.createElement("span", {
    style: {
      ...cell,
      fontFamily: 'var(--zm-font-mono)',
      fontFeatureSettings: "'tnum' 1",
      textAlign: 'right',
      color: site.days > 14 ? '#B45309' : 'var(--zm-fg)'
    }
  }, String(site.days).padStart(2, '0'), "d"), /*#__PURE__*/React.createElement("span", {
    style: cell
  }, /*#__PURE__*/React.createElement(StatusPill, {
    stage: site.stage
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      ...cell,
      color: 'var(--zm-fg-4)'
    },
    className: "zm-row-cta"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron",
    size: 14
  })));
};
const SitesTable = ({
  sites,
  onOpen
}) => {
  const [hovered, setHovered] = React.useState(null);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 12,
      overflow: 'hidden',
      boxShadow: 'var(--zm-shadow-1)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '32px 1.5fr 0.9fr 0.95fr 0.7fr 0.6fr 1.1fr 24px',
      gap: 8,
      padding: '11px 16px',
      background: 'var(--zm-surface-2)',
      borderBottom: '1px solid var(--zm-line)',
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: 10.5,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: 'var(--zm-fg-3)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "#"), /*#__PURE__*/React.createElement("span", null, "Site"), /*#__PURE__*/React.createElement("span", null, "City"), /*#__PURE__*/React.createElement("span", {
    style: {
      textAlign: 'right'
    }
  }, "Op cost"), /*#__PURE__*/React.createElement("span", {
    style: {
      textAlign: 'right'
    }
  }, "Carpet"), /*#__PURE__*/React.createElement("span", {
    style: {
      textAlign: 'right'
    }
  }, "Days"), /*#__PURE__*/React.createElement("span", null, "Stage"), /*#__PURE__*/React.createElement("span", null)), sites.map(site => /*#__PURE__*/React.createElement(SiteRow, {
    key: site.id,
    site: site,
    onClick: () => onOpen(site),
    hovered: hovered === site.id,
    onHover: setHovered
  })), sites.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 48,
      textAlign: 'center',
      color: 'var(--zm-fg-3)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13
    }
  }, "No sites match this filter. Adjust above or submit a new pipeline."));
};
Object.assign(window, {
  MetricCard,
  MetricStrip,
  FilterChip,
  PipelineFilter,
  SiteRow,
  SitesTable,
  CornerTicks
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/new-store-folder/Pipeline.jsx", error: String((e && e.message) || e) }); }

// ui_kits/new-store-folder/Primitives.jsx
try { (() => {
// Small primitives shared across the new-store-folder kit.
// Exported to window so other Babel scripts can use them.

const Icon = ({
  name,
  size = 16,
  stroke = 1.5,
  style
}) => {
  const paths = {
    grid: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "3",
      width: "7",
      height: "7",
      rx: "1"
    }), /*#__PURE__*/React.createElement("rect", {
      x: "14",
      y: "3",
      width: "7",
      height: "7",
      rx: "1"
    }), /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "14",
      width: "7",
      height: "7",
      rx: "1"
    }), /*#__PURE__*/React.createElement("rect", {
      x: "14",
      y: "14",
      width: "7",
      height: "7",
      rx: "1"
    })),
    box: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M2 9l10-6 10 6-10 6z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M2 9v6l10 6 10-6V9"
    })),
    list: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M3 6h18M3 12h18M3 18h12"
    })),
    pin: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1118 0z"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "10",
      r: "3"
    })),
    calendar: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "4",
      width: "18",
      height: "18",
      rx: "2"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M16 2v4M8 2v4M3 10h18"
    })),
    file: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M14 2v6h6"
    })),
    clock: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "9"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 7v5l3 2"
    })),
    check: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M20 6L9 17l-5-5"
    })),
    alert: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "9"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 8v4M12 16h.01"
    })),
    search: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "11",
      cy: "11",
      r: "7"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M21 21l-4.3-4.3"
    })),
    arrow: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M3 12h18M13 5l7 7-7 7"
    })),
    plus: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M12 5v14M5 12h14"
    })),
    card: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "5",
      width: "18",
      height: "14",
      rx: "2"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M3 10h18"
    })),
    message: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
    })),
    settings: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "3"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"
    })),
    trend: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M3 3v18h18"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M7 14l3-3 4 4 5-7"
    })),
    shield: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M12 2l9 4v6c0 5-3.5 9.7-9 10-5.5-.3-9-5-9-10V6z"
    })),
    chat: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M21 11.5a8.5 8.5 0 01-15.4 5.1L3 21l4.4-2.6A8.5 8.5 0 1121 11.5z"
    })),
    user: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "7",
      r: "4"
    })),
    chevron: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M9 6l6 6-6 6"
    })),
    chevronDown: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M6 9l6 6 6-6"
    })),
    chevronUp: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M6 15l6-6 6 6"
    })),
    x: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M18 6L6 18M6 6l12 12"
    })),
    filter: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M22 3H2l8 9.5V19l4 2v-8.5L22 3z"
    })),
    upload: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M17 8l-5-5-5 5"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 3v12"
    })),
    download: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M7 10l5 5 5-5"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 15V3"
    })),
    camera: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "13",
      r: "4"
    })),
    rupee: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M6 3h12M6 8h12M6 13l5 8M13 3a5 5 0 010 10H6"
    })),
    activity: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M22 12h-4l-3 9L9 3l-3 9H2"
    })),
    folder: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"
    })),
    home: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M3 9l9-7 9 7v11a2 2 0 01-2 2h-4v-7H9v7H5a2 2 0 01-2-2z"
    }))
  };
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: style
  }, paths[name] || null);
};

// Z-Matrix new-store-folder is a three-stage module:
//   draft (pipeline) → shortlist (queue) → staging (LOI upload) → exits to Payments (separate module)
// Tones map to the design-system semantic palette — no raw saturated hex per stage.
const TONES = {
  neutral: {
    fg: 'var(--zm-fg-2)',
    bg: 'var(--zm-surface-2)',
    edge: 'var(--zm-line-strong)',
    mark: 'var(--zm-fg-3)'
  },
  accent: {
    fg: 'var(--zm-accent)',
    bg: 'var(--zm-accent-soft)',
    edge: 'var(--zm-accent-line)',
    mark: 'var(--zm-accent)'
  },
  copper: {
    fg: 'var(--zm-copper)',
    bg: 'var(--zm-copper-soft)',
    edge: 'var(--zm-copper-line)',
    mark: 'var(--zm-copper)'
  },
  plum: {
    fg: 'var(--zm-plum)',
    bg: 'var(--zm-plum-soft)',
    edge: 'color-mix(in srgb, var(--zm-plum) 38%, transparent)',
    mark: 'var(--zm-plum)'
  },
  info: {
    fg: 'var(--zm-info)',
    bg: 'var(--zm-info-soft)',
    edge: 'color-mix(in srgb, var(--zm-info) 38%, transparent)',
    mark: 'var(--zm-info)'
  },
  success: {
    fg: 'var(--zm-success)',
    bg: 'var(--zm-success-soft)',
    edge: 'color-mix(in srgb, var(--zm-success) 38%, transparent)',
    mark: 'var(--zm-success)'
  },
  danger: {
    fg: 'var(--zm-danger)',
    bg: 'var(--zm-danger-soft)',
    edge: 'color-mix(in srgb, var(--zm-danger) 38%, transparent)',
    mark: 'var(--zm-danger)'
  }
};
const STAGES = {
  draft: {
    name: 'Draft',
    tone: 'neutral',
    color: '#6E6E78'
  },
  overdueDraft: {
    name: 'Draft · overdue',
    tone: 'danger',
    color: '#9B2A2A'
  },
  shortlist: {
    name: 'Shortlist',
    tone: 'info',
    color: '#2A4FA0'
  },
  inReview: {
    name: 'In review',
    tone: 'plum',
    color: '#6B4789'
  },
  staging: {
    name: 'Staging · LOI',
    tone: 'copper',
    color: '#B0712E'
  },
  overdue: {
    name: 'LOI overdue',
    tone: 'danger',
    color: '#9B2A2A'
  },
  uploaded: {
    name: 'LOI uploaded',
    tone: 'accent',
    color: '#0F5D5C'
  },
  completed: {
    name: 'Pushed',
    tone: 'success',
    color: '#2F7A4A'
  },
  rejected: {
    name: 'Rejected',
    tone: 'danger',
    color: '#9B2A2A'
  },
  archived: {
    name: 'Archived',
    tone: 'neutral',
    color: '#6E6E78'
  }
};
const StageDot = ({
  stage,
  size = 8
}) => /*#__PURE__*/React.createElement("span", {
  style: {
    display: 'inline-block',
    width: size,
    height: size,
    borderRadius: 999,
    background: STAGES[stage]?.color || '#888',
    flex: '0 0 auto'
  }
});
const StatusPill = ({
  stage
}) => {
  const s = STAGES[stage] || STAGES.draft;
  const t = TONES[s.tone] || TONES.neutral;
  return /*#__PURE__*/React.createElement("span", {
    className: "zm-status-pill",
    style: {
      '--pill-fg': t.fg,
      '--pill-bg': t.bg,
      '--pill-edge': t.edge,
      '--pill-mark': t.mark,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 0,
      height: 22,
      padding: 0,
      borderRadius: 5,
      background: t.bg,
      color: t.fg,
      border: '1px solid ' + t.edge,
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 700,
      fontSize: 10,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
      lineHeight: 1,
      position: 'relative',
      overflow: 'hidden',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 3,
      alignSelf: 'stretch',
      background: t.mark,
      flex: '0 0 3px'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      padding: '0 10px 0 9px',
      fontFeatureSettings: "'ss01' 1"
    }
  }, s.name));
};
const Avatar = ({
  name,
  size = 28
}) => {
  const initials = (name || '').split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return /*#__PURE__*/React.createElement("span", {
    style: {
      width: size,
      height: size,
      borderRadius: 999,
      background: 'var(--zm-accent-soft)',
      color: 'var(--zm-accent)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: size * 0.4,
      letterSpacing: 0.5,
      flex: '0 0 auto'
    }
  }, initials || '–');
};
Object.assign(window, {
  Icon,
  STAGES,
  StageDot,
  StatusPill,
  Avatar
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/new-store-folder/Primitives.jsx", error: String((e && e.message) || e) }); }

// ui_kits/new-store-folder/Shortlist.jsx
try { (() => {
// Shortlist queue.
// - BD exec: sees their own shortlisted sites; can View / Add details / Edit details. Cannot Approve.
// - Supervisor: sees all shortlisted sites. Approve only available once exec has marked "In review"
//               (i.e. completed the 17-field form and hit Send for review).
// Approve opens the LOI-timeline modal, then advances the site to Staging.

const ShortlistCard = ({
  item,
  role,
  onView,
  onAddDetails,
  onApprove
}) => {
  const supervisor = role === 'supervisor';
  const reviewable = item.inReview === true;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 12,
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      boxShadow: 'var(--zm-shadow-1)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 64,
      height: 64,
      borderRadius: 10,
      flex: '0 0 64px',
      background: `linear-gradient(135deg, hsl(${item.hue} 30% 80%), hsl(${item.hue + 30} 30% 60%))`
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 11,
      color: 'var(--zm-fg-3)'
    }
  }, item.code), reviewable ? /*#__PURE__*/React.createElement(StatusPill, {
    stage: "inReview"
  }) : /*#__PURE__*/React.createElement(StatusPill, {
    stage: "shortlist"
  })), /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontFamily: 'var(--zm-font-display)',
      fontWeight: 600,
      fontSize: 17,
      color: 'var(--zm-fg)'
    }
  }, item.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg-3)'
    }
  }, item.city, " \xB7 visit ", item.visitDate, " \xB7 created by ", item.createdBy)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: 10,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: 'var(--zm-fg-3)'
    }
  }, "Score"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontWeight: 600,
      fontSize: 22,
      color: item.score >= 75 ? '#047857' : 'var(--zm-fg)'
    }
  }, item.score || '—'))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 0,
      padding: '10px 0',
      borderTop: '1px solid var(--zm-line-faint)',
      borderBottom: '1px solid var(--zm-line-faint)'
    }
  }, [['Est. sales', item.estSales ? `₹${item.estSales}L` : '—'], ['Carpet', item.carpet ? `${item.carpet} sqft` : '—'], ['Total op', item.totalOpCost ? `₹${Math.round(item.totalOpCost / 1000)}k/mo` : '—'], ['Rent type', item.rentType === 'fixed' ? 'Fixed + esc.' : item.rentType === 'revshare' ? 'Rev share' : '—']].map(([k, v]) => /*#__PURE__*/React.createElement("div", {
    key: k,
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 10.5,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: 'var(--zm-fg-3)'
    }
  }, k), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontFeatureSettings: "'tnum' 1",
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--zm-fg)'
    }
  }, v)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onView(item),
    title: "View",
    className: "zm-icon-btn",
    style: {
      width: 34,
      height: 34,
      border: '1px solid var(--zm-line)',
      borderRadius: 7,
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg-2)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(EyeIcon, {
    size: 16
  })), !supervisor && /*#__PURE__*/React.createElement("button", {
    onClick: () => onAddDetails(item),
    className: "zm-btn",
    style: {
      height: 34,
      padding: '0 14px',
      border: '1px solid var(--zm-line)',
      borderRadius: 7,
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 13
  }), reviewable ? 'Edit details' : 'Add details'), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), supervisor ? /*#__PURE__*/React.createElement("button", {
    onClick: () => onApprove(item),
    disabled: !reviewable,
    className: "zm-btn-primary",
    title: !reviewable ? 'BD exec must Send for review before approving' : 'Approve and advance to staging',
    style: {
      height: 34,
      padding: '0 14px',
      border: 'none',
      borderRadius: 7,
      background: reviewable ? 'var(--zm-accent)' : 'var(--zm-surface-sunken)',
      color: reviewable ? '#fff' : 'var(--zm-fg-4)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12.5,
      fontWeight: 700,
      cursor: reviewable ? 'pointer' : 'not-allowed',
      boxShadow: reviewable ? 'var(--zm-shadow-1)' : 'none',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      whiteSpace: 'nowrap',
      lineHeight: 1
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 13
  }), " Approve shortlist") : reviewable ? /*#__PURE__*/React.createElement("span", {
    style: {
      padding: '6px 10px',
      borderRadius: 7,
      background: 'var(--zm-accent-soft)',
      border: '1px solid var(--zm-accent-line)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 11.5,
      color: 'var(--zm-accent)',
      fontWeight: 600,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "clock",
    size: 12
  }), " Awaiting supervisor approval") : /*#__PURE__*/React.createElement("span", {
    style: {
      padding: '6px 10px',
      borderRadius: 7,
      background: 'var(--zm-surface-2)',
      border: '1px solid var(--zm-line)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 11.5,
      color: 'var(--zm-fg-3)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "alert",
    size: 12
  }), " Add 17 fields then Send for review")));
};
const ShortlistQueue = ({
  items,
  role,
  onView,
  onAddDetails,
  onApprove
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    maxWidth: 920
  }
}, /*#__PURE__*/React.createElement(PageHeader, {
  file: "\u2116 03",
  eyebrow: "Workflow \xB7 Shortlist",
  title: /*#__PURE__*/React.createElement(React.Fragment, null, "Shortlist ", /*#__PURE__*/React.createElement("em", null, "queue")),
  lede: role === 'supervisor' ? `${items.length} site${items.length === 1 ? '' : 's'} cleared from pipeline — approve once the exec marks them as in review.` : `${items.length} of your own shortlisted site${items.length === 1 ? '' : 's'} — add the 17 essential fields, then send for review.`,
  right: /*#__PURE__*/React.createElement(HeaderTag, {
    icon: "clock",
    label: "OLDEST FIRST"
  })
}), items.map(item => /*#__PURE__*/React.createElement(ShortlistCard, {
  key: item.code,
  item: item,
  role: role,
  onView: onView,
  onAddDetails: onAddDetails,
  onApprove: onApprove
})), items.length === 0 && /*#__PURE__*/React.createElement("div", {
  style: {
    padding: 48,
    textAlign: 'center',
    background: 'var(--zm-surface)',
    border: '1px dashed var(--zm-line)',
    borderRadius: 12
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    display: 'inline-flex',
    color: 'var(--zm-fg-3)',
    marginBottom: 12
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "check",
  size: 32
})), /*#__PURE__*/React.createElement("p", {
  style: {
    margin: 0,
    fontFamily: 'var(--zm-font-body)',
    fontSize: 14,
    color: 'var(--zm-fg-2)'
  }
}, "Queue empty.")));

// Modal that pops after Approve shortlist — supervisor sets expected LOI timeline.
const LOITimelineModal = ({
  site,
  onCancel,
  onSubmit
}) => {
  const [days, setDays] = React.useState(14);
  if (!site) return null;
  const presets = [7, 14, 21, 30];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(11,12,16,0.46)',
      backdropFilter: 'blur(6px)',
      zIndex: 110,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      animation: 'zm-fade 200ms var(--zm-ease)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 14,
      width: 480,
      padding: 28,
      boxShadow: 'var(--zm-shadow-pop)',
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      animation: 'zm-rise 240ms var(--zm-ease-emp)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: 10.5,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: 'var(--zm-accent)'
    }
  }, "Approving \xB7 ", site.code), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '4px 0 6px',
      fontFamily: 'var(--zm-font-display)',
      fontWeight: 700,
      fontSize: 20,
      letterSpacing: '-0.02em',
      color: 'var(--zm-fg)'
    }
  }, "Expected LOI timeline"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg-3)'
    }
  }, "By when should the BD exec have the signed LOI uploaded? Sites that miss this date highlight in staging.")), /*#__PURE__*/React.createElement("button", {
    onClick: onCancel,
    className: "zm-icon-btn",
    style: {
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 8,
      width: 30,
      height: 30,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--zm-fg-2)',
      cursor: 'pointer',
      flex: '0 0 30px'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "x",
    size: 14
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: 12,
      color: 'var(--zm-fg)'
    }
  }, "Days from today"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "number",
    min: "1",
    max: "120",
    value: days,
    onChange: e => setDays(Math.max(1, Math.min(120, Number(e.target.value) || 0))),
    style: {
      width: 110,
      height: 56,
      padding: '0 14px',
      background: 'var(--zm-bg)',
      border: '1px solid var(--zm-line)',
      borderRadius: 8,
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 28,
      fontWeight: 600,
      color: 'var(--zm-fg)',
      outline: 'none',
      textAlign: 'center'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg-2)'
    }
  }, "days \xB7 target date", ' ', /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--zm-fg)',
      fontFamily: 'var(--zm-font-mono)'
    }
  }, new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      marginTop: 4
    }
  }, presets.map(p => /*#__PURE__*/React.createElement("button", {
    key: p,
    onClick: () => setDays(p),
    className: "zm-pill",
    style: {
      height: 28,
      padding: '0 12px',
      borderRadius: 999,
      border: '1px solid ' + (days === p ? 'var(--zm-accent)' : 'var(--zm-line)'),
      background: days === p ? 'var(--zm-accent-soft)' : 'var(--zm-surface)',
      color: days === p ? 'var(--zm-accent)' : 'var(--zm-fg-2)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      fontWeight: 600,
      cursor: 'pointer'
    }
  }, p, "d")))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 12,
      background: 'var(--zm-accent-soft)',
      borderRadius: 8,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      color: 'var(--zm-fg-2)',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--zm-accent)',
      display: 'inline-flex',
      marginTop: 1
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "alert",
    size: 14
  })), "On approval, this site moves to Staging. The BD exec is notified and the timer starts."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      justifyContent: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onCancel,
    className: "zm-btn",
    style: {
      height: 36,
      padding: '0 16px',
      borderRadius: 8,
      border: '1px solid var(--zm-line)',
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer'
    }
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    onClick: () => onSubmit(site, days),
    className: "zm-btn-primary",
    style: {
      height: 36,
      padding: '0 16px',
      borderRadius: 8,
      border: 'none',
      background: 'var(--zm-accent)',
      color: '#fff',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 700,
      cursor: 'pointer',
      boxShadow: 'var(--zm-shadow-1)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 13
  }), " Approve & set timeline"))));
};
const NewPipelineModal = ({
  onClose,
  onSubmit
}) => {
  const [form, setForm] = React.useState({
    name: '',
    visitDate: '',
    city: ''
  });
  const set = k => e => setForm({
    ...form,
    [k]: e.target.value
  });
  const ready = form.name && form.visitDate && form.city;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(11,12,16,0.46)',
      backdropFilter: 'blur(6px)',
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      animation: 'zm-fade 200ms var(--zm-ease)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 14,
      width: 480,
      padding: 28,
      boxShadow: 'var(--zm-shadow-pop)',
      display: 'flex',
      flexDirection: 'column',
      gap: 18,
      animation: 'zm-rise 240ms var(--zm-ease-emp)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: 10.5,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: 'var(--zm-accent)'
    }
  }, "Pipeline \xB7 step 1 of 1"), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '4px 0 6px',
      fontFamily: 'var(--zm-font-display)',
      fontWeight: 700,
      fontSize: 22,
      letterSpacing: '-0.02em',
      color: 'var(--zm-fg)'
    }
  }, "New pipeline draft"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg-3)'
    }
  }, "Three fields to start. Add the 17-field site detail after supervisor shortlist.")), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "zm-icon-btn",
    style: {
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 8,
      width: 30,
      height: 30,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--zm-fg-2)',
      cursor: 'pointer',
      flex: '0 0 30px'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "x",
    size: 14
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: 12,
      color: 'var(--zm-fg)'
    }
  }, "Site / pipeline name"), /*#__PURE__*/React.createElement("input", {
    value: form.name,
    onChange: set('name'),
    placeholder: "e.g. Powai \xB7 Lake Homes",
    style: {
      height: 40,
      padding: '0 12px',
      border: '1px solid var(--zm-line)',
      borderRadius: 6,
      background: 'var(--zm-bg)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 14,
      color: 'var(--zm-fg)',
      outline: 'none'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: 12,
      color: 'var(--zm-fg)'
    }
  }, "Visit date"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    value: form.visitDate,
    onChange: set('visitDate'),
    style: {
      height: 40,
      padding: '0 12px',
      border: '1px solid var(--zm-line)',
      borderRadius: 6,
      background: 'var(--zm-bg)',
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 13,
      color: 'var(--zm-fg)',
      outline: 'none'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: 12,
      color: 'var(--zm-fg)'
    }
  }, "City"), /*#__PURE__*/React.createElement("select", {
    value: form.city,
    onChange: set('city'),
    style: {
      height: 40,
      padding: '0 12px',
      border: '1px solid var(--zm-line)',
      borderRadius: 6,
      background: 'var(--zm-bg)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 14,
      color: 'var(--zm-fg)',
      outline: 'none'
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "Select city\u2026"), /*#__PURE__*/React.createElement("option", null, "Mumbai"), /*#__PURE__*/React.createElement("option", null, "Bengaluru"), /*#__PURE__*/React.createElement("option", null, "New Delhi"), /*#__PURE__*/React.createElement("option", null, "Hyderabad"), /*#__PURE__*/React.createElement("option", null, "Pune"), /*#__PURE__*/React.createElement("option", null, "Chennai"), /*#__PURE__*/React.createElement("option", null, "Ahmedabad"))))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 12,
      background: 'var(--zm-accent-soft)',
      borderRadius: 8,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      color: 'var(--zm-fg-2)',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--zm-accent)',
      display: 'inline-flex',
      marginTop: 1
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "alert",
    size: 14
  })), "Once submitted, your supervisor reviews the shortlist (Yes / No). You can edit the draft until then."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      justifyContent: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "zm-btn",
    style: {
      height: 36,
      padding: '0 16px',
      borderRadius: 8,
      border: '1px solid var(--zm-line)',
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer'
    }
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    disabled: !ready,
    onClick: () => onSubmit(form),
    className: "zm-btn-primary",
    style: {
      height: 36,
      padding: '0 16px',
      borderRadius: 8,
      border: 'none',
      background: ready ? 'var(--zm-accent)' : 'var(--zm-surface-sunken)',
      color: ready ? '#fff' : 'var(--zm-fg-4)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 600,
      cursor: ready ? 'pointer' : 'not-allowed',
      boxShadow: ready ? 'var(--zm-shadow-1)' : 'none',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, "Submit for shortlist ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow",
    size: 14
  })))));
};
Object.assign(window, {
  ShortlistCard,
  ShortlistQueue,
  LOITimelineModal,
  NewPipelineModal
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/new-store-folder/Shortlist.jsx", error: String((e && e.message) || e) }); }

// ui_kits/new-store-folder/SiteDrawer.jsx
try { (() => {
// Site detail drawer: slide-over right pane with tabs.

const Field = ({
  label,
  value,
  mono,
  span = 1
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    gridColumn: `span ${span}`
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 600,
    fontSize: 10.5,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--zm-fg-3)'
  }
}, label), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: mono ? 'var(--zm-font-mono)' : 'var(--zm-font-body)',
    fontFeatureSettings: mono ? "'tnum' 1" : 'normal',
    fontSize: 14,
    color: 'var(--zm-fg)',
    fontWeight: mono ? 500 : 500
  }
}, value));
const Tab = ({
  active,
  label,
  count,
  onClick
}) => /*#__PURE__*/React.createElement("button", {
  onClick: onClick,
  className: "zm-tab" + (active ? " is-active" : ""),
  style: {
    background: 'none',
    border: 'none',
    padding: '12px 4px',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    color: active ? 'var(--zm-fg)' : 'var(--zm-fg-3)',
    borderBottom: '2px solid ' + (active ? 'var(--zm-accent)' : 'transparent'),
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    marginRight: 22
  }
}, label, count != null && /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 11,
    color: 'var(--zm-fg-3)'
  }
}, count));
const LOITracker = ({
  site
}) => {
  const overdue = site.days > 14;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      border: '1px solid ' + (overdue ? 'rgba(217,119,6,0.4)' : 'var(--zm-line)'),
      background: overdue ? 'var(--zm-copper-soft)' : 'var(--zm-surface-2)',
      borderRadius: 10,
      padding: 16,
      display: 'flex',
      alignItems: 'center',
      gap: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: 10.5,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: 'var(--zm-fg-3)'
    }
  }, "LOI tracker"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontFeatureSettings: "'tnum' 1",
      fontSize: 28,
      fontWeight: 600,
      color: overdue ? '#B45309' : 'var(--zm-fg)',
      letterSpacing: '-0.02em'
    }
  }, String(site.days).padStart(2, '0'), " days"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      color: 'var(--zm-fg-3)'
    }
  }, "signed ", site.loiSignedAt, " \xB7 submitted ", site.loiSubmittedAt)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      color: '#047857'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 13
  }), " Signed"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      color: '#047857'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 13
  }), " Uploaded to drive"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      color: overdue ? '#B45309' : 'var(--zm-fg-3)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: overdue ? "alert" : "clock",
    size: 13
  }), " Awaiting supervisor approval")));
};
const PhotoTile = ({
  caption,
  hue = 200
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    border: '1px solid var(--zm-line)',
    borderRadius: 10,
    overflow: 'hidden',
    background: `linear-gradient(135deg, hsl(${hue} 30% 80%), hsl(${hue + 30} 28% 65%))`,
    aspectRatio: '4 / 3',
    position: 'relative',
    display: 'flex',
    alignItems: 'flex-end'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    position: 'absolute',
    inset: 0,
    background: 'linear-gradient(to top, rgba(0,0,0,0.4), transparent 50%)'
  }
}), /*#__PURE__*/React.createElement("span", {
  style: {
    position: 'relative',
    padding: 10,
    color: '#fff',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 11,
    fontWeight: 600
  }
}, caption));
const SiteOverviewTab = ({
  site
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    gap: 24
  }
}, /*#__PURE__*/React.createElement(LOITracker, {
  site: site
}), /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement("h4", {
  style: {
    margin: '0 0 14px',
    fontFamily: 'var(--zm-font-display)',
    fontWeight: 600,
    fontSize: 14,
    color: 'var(--zm-fg)'
  }
}, "Site fundamentals"), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '18px 24px',
    padding: '20px 22px',
    background: 'var(--zm-surface)',
    border: '1px solid var(--zm-line)',
    borderRadius: 10
  }
}, /*#__PURE__*/React.createElement(Field, {
  label: "Site code",
  value: site.code,
  mono: true
}), /*#__PURE__*/React.createElement(Field, {
  label: "Model",
  value: site.model
}), /*#__PURE__*/React.createElement(Field, {
  label: "City",
  value: site.city
}), /*#__PURE__*/React.createElement(Field, {
  label: "Carpet area",
  value: `${site.carpet} sqft`,
  mono: true
}), /*#__PURE__*/React.createElement(Field, {
  label: "Rent / month",
  value: `₹${site.rent.toLocaleString('en-IN')}`,
  mono: true
}), /*#__PURE__*/React.createElement(Field, {
  label: "CAM",
  value: `₹${site.cam.toLocaleString('en-IN')}`,
  mono: true
}), /*#__PURE__*/React.createElement(Field, {
  label: "Total op cost",
  value: `₹${site.opCost.toLocaleString('en-IN')}`,
  mono: true
}), /*#__PURE__*/React.createElement(Field, {
  label: "Lock-in",
  value: `${site.lockin} months`,
  mono: true
}), /*#__PURE__*/React.createElement(Field, {
  label: "Escalation",
  value: `${site.escalation}% / yr`,
  mono: true
}), /*#__PURE__*/React.createElement(Field, {
  label: "Security deposit",
  value: `₹${site.deposit.toLocaleString('en-IN')}`,
  mono: true
}), /*#__PURE__*/React.createElement(Field, {
  label: "Rent-free days",
  value: `${site.rentFree}`,
  mono: true
}), /*#__PURE__*/React.createElement(Field, {
  label: "Est. monthly sales",
  value: `₹${site.estSales.toLocaleString('en-IN')}`,
  mono: true
}))), /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 14
  }
}, /*#__PURE__*/React.createElement("h4", {
  style: {
    margin: 0,
    fontFamily: 'var(--zm-font-display)',
    fontWeight: 600,
    fontSize: 14,
    color: 'var(--zm-fg)'
  }
}, "SPOC + Google pin"), /*#__PURE__*/React.createElement("button", {
  className: "zm-link-btn",
  style: {
    background: 'none',
    border: 'none',
    color: 'var(--zm-accent)',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  }
}, "Open in Maps \u2192")), /*#__PURE__*/React.createElement("div", {
  style: {
    padding: 20,
    background: 'var(--zm-surface)',
    border: '1px solid var(--zm-line)',
    borderRadius: 10,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 20
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12
  }
}, /*#__PURE__*/React.createElement(Field, {
  label: "SPOC name",
  value: site.spocName
}), /*#__PURE__*/React.createElement(Field, {
  label: "SPOC phone",
  value: site.spocPhone,
  mono: true
}), /*#__PURE__*/React.createElement(Field, {
  label: "Google pin",
  value: site.pin,
  mono: true
})), /*#__PURE__*/React.createElement("div", {
  style: {
    background: 'linear-gradient(135deg,#EEF1F5,#E1E5EB)',
    borderRadius: 8,
    position: 'relative',
    overflow: 'hidden',
    backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><path d='M32 0 L0 0 0 32' fill='none' stroke='%23005F60' stroke-width='0.6' opacity='0.18'/></svg>\")",
    backgroundColor: '#EEF1F5',
    minHeight: 130
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    position: 'absolute',
    top: 12,
    left: 12,
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 10,
    color: '#005F60'
  }
}, "map \xB7 stub"), /*#__PURE__*/React.createElement("span", {
  style: {
    position: 'absolute',
    left: '52%',
    top: '46%',
    width: 14,
    height: 14,
    borderRadius: 999,
    background: '#D97706',
    boxShadow: '0 0 0 6px rgba(217,119,6,0.22)',
    transform: 'translate(-50%,-50%)'
  }
})))), /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 14
  }
}, /*#__PURE__*/React.createElement("h4", {
  style: {
    margin: 0,
    fontFamily: 'var(--zm-font-display)',
    fontWeight: 600,
    fontSize: 14,
    color: 'var(--zm-fg)'
  }
}, "Site photos"), /*#__PURE__*/React.createElement("button", {
  className: "zm-btn",
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'var(--zm-surface)',
    border: '1px solid var(--zm-line)',
    borderRadius: 8,
    padding: '6px 10px',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--zm-fg)',
    cursor: 'pointer'
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "upload",
  size: 13
}), " Upload")), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 10
  }
}, /*#__PURE__*/React.createElement(PhotoTile, {
  caption: "Storefront \xB7 day",
  hue: 200
}), /*#__PURE__*/React.createElement(PhotoTile, {
  caption: "Interior shell",
  hue: 30
}), /*#__PURE__*/React.createElement(PhotoTile, {
  caption: "Foot traffic",
  hue: 140
}), /*#__PURE__*/React.createElement(PhotoTile, {
  caption: "Adjacency map",
  hue: 280
}))));
const SiteActivityTab = ({
  site
}) => {
  const entries = [{
    t: '12 min ago',
    who: 'Riya Sharma',
    act: 'uploaded LOI document',
    tag: 'doc',
    color: '#1E40AF'
  }, {
    t: '2 hr ago',
    who: 'Aman Verma',
    act: 'set LOI signing date to 2026-05-19',
    tag: 'edit',
    color: '#005F60'
  }, {
    t: '1 day ago',
    who: 'Nikhil Iyer',
    act: 'approved site shortlist',
    tag: 'approve',
    color: '#047857'
  }, {
    t: '3 days ago',
    who: 'Riya Sharma',
    act: 'completed 20-field site form',
    tag: 'edit',
    color: '#005F60'
  }, {
    t: '5 days ago',
    who: 'Riya Sharma',
    act: 'submitted pipeline for shortlist',
    tag: 'submit',
    color: '#1E40AF'
  }, {
    t: '6 days ago',
    who: 'Riya Sharma',
    act: 'created pipeline draft',
    tag: 'create',
    color: '#6B7280'
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 10,
      overflow: 'hidden'
    }
  }, entries.map((e, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'grid',
      gridTemplateColumns: '110px 1fr',
      alignItems: 'center',
      gap: 16,
      padding: '14px 20px',
      borderBottom: i < entries.length - 1 ? '1px solid var(--zm-line-faint)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 11.5,
      color: 'var(--zm-fg-3)'
    }
  }, e.t), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 999,
      background: e.color,
      flex: '0 0 6px'
    }
  }), /*#__PURE__*/React.createElement(Avatar, {
    name: e.who,
    size: 24
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg)'
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      fontWeight: 600
    }
  }, e.who), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--zm-fg-2)'
    }
  }, e.act))))));
};
const SiteDocsTab = () => {
  const docs = [{
    name: 'LOI · final signed.pdf',
    size: '482 KB',
    when: '12 min ago',
    who: 'Riya S.'
  }, {
    name: 'Carpet floor plan v3.pdf',
    size: '1.2 MB',
    when: '3 days ago',
    who: 'Riya S.'
  }, {
    name: 'Site photos · 14 images.zip',
    size: '8.4 MB',
    when: '3 days ago',
    who: 'Riya S.'
  }, {
    name: 'Rental agreement draft v2.docx',
    size: '212 KB',
    when: '4 days ago',
    who: 'Aman V.'
  }, {
    name: 'Estimated sales model.xlsx',
    size: '88 KB',
    when: '5 days ago',
    who: 'Riya S.'
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 10,
      overflow: 'hidden'
    }
  }, docs.map((d, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'grid',
      gridTemplateColumns: '28px 1fr 80px 110px 80px 24px',
      alignItems: 'center',
      gap: 14,
      padding: '12px 16px',
      borderBottom: i < docs.length - 1 ? '1px solid var(--zm-line-faint)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--zm-fg-3)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "file",
    size: 16
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 500,
      color: 'var(--zm-fg)'
    }
  }, d.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 11.5,
      color: 'var(--zm-fg-3)'
    }
  }, d.size), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      color: 'var(--zm-fg-3)'
    }
  }, d.when), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      color: 'var(--zm-fg-3)'
    }
  }, d.who), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--zm-fg-3)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "download",
    size: 14
  })))));
};
const SiteDrawer = ({
  site,
  onClose
}) => {
  const [tab, setTab] = React.useState('overview');
  if (!site) return null;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: 'absolute',
      inset: 0,
      background: 'rgba(17,24,39,0.32)',
      animation: 'zm-fade 200ms var(--zm-ease)'
    }
  }), /*#__PURE__*/React.createElement("aside", {
    style: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      width: 760,
      maxWidth: '92%',
      background: 'var(--zm-bg)',
      borderLeft: '1px solid var(--zm-line)',
      boxShadow: 'var(--zm-shadow-pop)',
      display: 'flex',
      flexDirection: 'column',
      animation: 'zm-slide 260ms var(--zm-ease-emp)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '20px 28px 0',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 16,
      background: 'var(--zm-surface)',
      borderBottom: '1px solid var(--zm-line)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 11,
      color: 'var(--zm-fg-3)'
    }
  }, site.code), /*#__PURE__*/React.createElement(StatusPill, {
    stage: site.stage
  })), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontFamily: 'var(--zm-font-display)',
      fontWeight: 700,
      fontSize: 24,
      letterSpacing: '-0.02em',
      color: 'var(--zm-fg)'
    }
  }, site.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg-3)'
    }
  }, site.city, " \xB7 ", site.model, " \xB7 created by ", site.createdBy, " \xB7 ", site.createdAt), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      display: 'flex',
      gap: 0,
      borderTop: '1px solid var(--zm-line)',
      marginTop: 18
    }
  }, /*#__PURE__*/React.createElement(Tab, {
    label: "Overview",
    active: tab === 'overview',
    onClick: () => setTab('overview')
  }), /*#__PURE__*/React.createElement(Tab, {
    label: "Activity",
    count: 6,
    active: tab === 'activity',
    onClick: () => setTab('activity')
  }), /*#__PURE__*/React.createElement(Tab, {
    label: "Documents",
    count: 5,
    active: tab === 'docs',
    onClick: () => setTab('docs')
  }), /*#__PURE__*/React.createElement(Tab, {
    label: "Payments",
    count: 1,
    active: tab === 'payments',
    onClick: () => setTab('payments')
  }))), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    className: "zm-icon-btn",
    style: {
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 8,
      width: 30,
      height: 30,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--zm-fg-2)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "x",
    size: 14
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '24px 28px'
    }
  }, tab === 'overview' && /*#__PURE__*/React.createElement(SiteOverviewTab, {
    site: site
  }), tab === 'activity' && /*#__PURE__*/React.createElement(SiteActivityTab, {
    site: site
  }), tab === 'docs' && /*#__PURE__*/React.createElement(SiteDocsTab, null), tab === 'payments' && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 32,
      textAlign: 'center',
      color: 'var(--zm-fg-3)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13
    }
  }, "1 draft payment ready for approval \u2014 open the Payments module to action.")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '14px 28px',
      borderTop: '1px solid var(--zm-line)',
      background: 'var(--zm-surface)',
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "zm-btn",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 34,
      padding: '0 14px',
      borderRadius: 8,
      border: '1px solid var(--zm-line)',
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "message",
    size: 14
  }), " Comment"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("button", {
    className: "zm-btn",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 34,
      padding: '0 14px',
      borderRadius: 8,
      border: '1px solid var(--zm-line)',
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg-2)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer'
    }
  }, "Re-assign"), /*#__PURE__*/React.createElement("button", {
    className: "zm-btn-primary",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 34,
      padding: '0 16px',
      borderRadius: 8,
      border: 'none',
      background: 'var(--zm-accent)',
      color: '#fff',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer',
      boxShadow: 'var(--zm-shadow-1)'
    }
  }, "Advance to payment ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow",
    size: 14
  })))));
};
Object.assign(window, {
  SiteDrawer
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/new-store-folder/SiteDrawer.jsx", error: String((e && e.message) || e) }); }

// ui_kits/new-store-folder/Staging.jsx
try { (() => {
// Staging view — two-step flow:
//   BD exec  : sees their own approved sites (any state). Has Upload LOI.
//   Supervisor: ONLY sees sites where the exec has already uploaded the LOI.
//               In place of Upload LOI: View LOI + Push site.
//               Each row has a draft→LOI timeline tracker with day-count, draft date, LOI date.
//
// Overdue (current days > expected timeline) is highlighted in copper for BD exec view.

const StagingFilterBar = ({
  filters,
  onFilters,
  sites,
  role
}) => {
  const cities = ['All', ...Array.from(new Set(sites.map(s => s.city)))];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
      gap: 10,
      padding: 14,
      background: 'var(--zm-surface)',
      border: '1px solid var(--zm-line)',
      borderRadius: 12,
      boxShadow: 'var(--zm-shadow-1)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 13,
    style: {
      position: 'absolute',
      left: 10,
      top: '50%',
      transform: 'translateY(-50%)',
      color: 'var(--zm-fg-3)',
      pointerEvents: 'none'
    }
  }), /*#__PURE__*/React.createElement("input", {
    placeholder: "Search site or SPOC\u2026",
    value: filters.q,
    onChange: e => onFilters({
      ...filters,
      q: e.target.value
    }),
    style: {
      width: '100%',
      minWidth: 0,
      boxSizing: 'border-box',
      height: 36,
      padding: '0 10px 0 32px',
      background: 'var(--zm-bg)',
      border: '1px solid var(--zm-line)',
      borderRadius: 6,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg)',
      outline: 'none'
    }
  })), /*#__PURE__*/React.createElement("select", {
    value: filters.city,
    onChange: e => onFilters({
      ...filters,
      city: e.target.value
    }),
    style: {
      height: 36,
      padding: '0 10px',
      background: 'var(--zm-bg)',
      border: '1px solid var(--zm-line)',
      borderRadius: 6,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg)',
      outline: 'none'
    }
  }, cities.map(c => /*#__PURE__*/React.createElement("option", {
    key: c,
    value: c
  }, "City \xB7 ", c))), /*#__PURE__*/React.createElement("select", {
    value: filters.status,
    onChange: e => onFilters({
      ...filters,
      status: e.target.value
    }),
    style: {
      height: 36,
      padding: '0 10px',
      background: 'var(--zm-bg)',
      border: '1px solid var(--zm-line)',
      borderRadius: 6,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg)',
      outline: 'none'
    }
  }, role === 'supervisor' ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("option", {
    value: "all"
  }, "Status \xB7 all uploaded"), /*#__PURE__*/React.createElement("option", {
    value: "overdue"
  }, "Status \xB7 uploaded late"), /*#__PURE__*/React.createElement("option", {
    value: "ontime"
  }, "Status \xB7 uploaded on time")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("option", {
    value: "all"
  }, "Status \xB7 all"), /*#__PURE__*/React.createElement("option", {
    value: "ontime"
  }, "Status \xB7 on time"), /*#__PURE__*/React.createElement("option", {
    value: "overdue"
  }, "Status \xB7 overdue"), /*#__PURE__*/React.createElement("option", {
    value: "uploaded"
  }, "Status \xB7 uploaded"))), /*#__PURE__*/React.createElement("select", {
    value: filters.month,
    onChange: e => onFilters({
      ...filters,
      month: e.target.value
    }),
    style: {
      height: 36,
      padding: '0 10px',
      background: 'var(--zm-bg)',
      border: '1px solid var(--zm-line)',
      borderRadius: 6,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg)',
      outline: 'none'
    }
  }, ['All', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(m => /*#__PURE__*/React.createElement("option", {
    key: m,
    value: m
  }, "Approved \xB7 ", m))));
};

// Compact draft→LOI timeline visualization for supervisor view.
const TimelineTracker = ({
  site
}) => {
  const target = site.expectedLoiDays;
  const actual = site.daysToLOI ?? site.daysSinceApproval; // days from approval to LOI upload
  const late = actual > target;
  const pct = Math.max(0, Math.min(100, actual / Math.max(target, actual) * 100));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 4,
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 10.5,
      whiteSpace: 'nowrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--zm-fg-3)'
    }
  }, site.draftDate || site.approvedDate), /*#__PURE__*/React.createElement("span", {
    style: {
      color: late ? '#B91C1C' : '#005F60',
      fontWeight: 600
    }
  }, actual, "d / ", target, "d"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--zm-fg-3)'
    }
  }, site.loiUploadedAt || '—')), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 6,
      borderRadius: 999,
      background: 'var(--zm-surface-sunken)',
      position: 'relative',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: `${pct}%`,
      background: late ? '#B91C1C' : '#005F60',
      borderRadius: 999,
      transition: 'width 360ms var(--zm-ease-emp)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: `${Math.min(100, target / Math.max(target, actual) * 100)}%`,
      top: -3,
      bottom: -3,
      width: 2,
      background: 'var(--zm-fg-3)',
      opacity: 0.4
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 10.5,
      fontWeight: 600,
      color: late ? '#B91C1C' : '#047857',
      whiteSpace: 'nowrap'
    }
  }, late ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon, {
    name: "alert",
    size: 10
  }), " Uploaded ", actual - target, "d late") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 10
  }), " Uploaded ", target - actual, "d early")));
};
const ExecRow = ({
  site,
  onUpload,
  onOpen
}) => {
  const remaining = site.expectedLoiDays - site.daysSinceApproval;
  const overdue = remaining < 0;
  const uploaded = site.loiUploaded;
  return /*#__PURE__*/React.createElement("div", {
    className: "zm-row",
    style: {
      display: 'grid',
      gridTemplateColumns: '0.9fr 1.6fr 1fr 1fr 1fr 1.4fr 170px',
      alignItems: 'center',
      gap: 10,
      padding: '14px 16px',
      borderBottom: '1px solid var(--zm-line-faint)',
      background: overdue && !uploaded ? 'rgba(217,119,6,0.06)' : 'transparent',
      position: 'relative'
    }
  }, overdue && !uploaded && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 0,
      top: 12,
      bottom: 12,
      width: 2,
      background: '#D97706',
      borderRadius: 2
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 11.5,
      color: 'var(--zm-fg-3)'
    }
  }, site.code), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13.5,
      fontWeight: 600,
      color: 'var(--zm-fg)'
    }
  }, site.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 10.5,
      color: 'var(--zm-fg-3)'
    }
  }, "SPOC \xB7 ", site.spocName)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg)'
    }
  }, site.city), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 12.5,
      color: 'var(--zm-fg)'
    }
  }, site.approvedDate), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 11,
      color: 'var(--zm-fg-3)'
    }
  }, "by ", site.approvedBy)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--zm-fg)'
    }
  }, String(site.daysSinceApproval).padStart(2, '0'), " / ", site.expectedLoiDays, " d"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 11,
      fontWeight: 500,
      color: uploaded ? '#005F60' : overdue ? '#B45309' : 'var(--zm-fg-3)'
    }
  }, uploaded ? 'LOI uploaded' : overdue ? `${Math.abs(remaining)}d overdue` : `${remaining}d remaining`)), /*#__PURE__*/React.createElement("div", null, uploaded ? /*#__PURE__*/React.createElement(StatusPill, {
    stage: "uploaded"
  }) : overdue ? /*#__PURE__*/React.createElement(StatusPill, {
    stage: "overdue"
  }) : /*#__PURE__*/React.createElement(StatusPill, {
    stage: "staging"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      justifyContent: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onOpen(site),
    title: "View",
    className: "zm-icon-btn",
    style: {
      width: 32,
      height: 32,
      padding: 0,
      border: '1px solid var(--zm-line)',
      borderRadius: 7,
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg-2)',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(EyeIcon, null)), uploaded ? /*#__PURE__*/React.createElement("button", {
    disabled: true,
    style: {
      height: 32,
      padding: '0 12px',
      border: '1px solid var(--zm-line)',
      borderRadius: 7,
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg-3)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      fontWeight: 600,
      cursor: 'not-allowed',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 12
  }), " Uploaded") : /*#__PURE__*/React.createElement("button", {
    onClick: () => onUpload(site),
    className: "zm-btn-primary",
    style: {
      height: 32,
      padding: '0 12px',
      border: 'none',
      borderRadius: 7,
      background: overdue ? '#D97706' : 'var(--zm-accent)',
      color: '#fff',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      fontWeight: 700,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      boxShadow: 'var(--zm-shadow-1)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "upload",
    size: 12
  }), " Upload LOI")));
};
const SupervisorRow = ({
  site,
  onPush,
  onViewLOI,
  onOpen
}) => {
  const pushed = site.pushed;
  return /*#__PURE__*/React.createElement("div", {
    className: "zm-row",
    style: {
      display: 'grid',
      gridTemplateColumns: '70px minmax(130px, 0.9fr) 70px 124px minmax(170px, 1.3fr) 170px',
      alignItems: 'center',
      gap: 10,
      padding: '14px 12px',
      borderBottom: '1px solid var(--zm-line-faint)',
      background: pushed ? 'rgba(4,120,87,0.04)' : 'transparent',
      opacity: pushed ? 0.85 : 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 11.5,
      color: 'var(--zm-fg-3)'
    }
  }, site.code), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13.5,
      fontWeight: 600,
      color: 'var(--zm-fg)'
    }
  }, site.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 10.5,
      color: 'var(--zm-fg-3)'
    }
  }, "by ", site.createdBy)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: 'var(--zm-fg)'
    }
  }, site.city), /*#__PURE__*/React.createElement("div", null, pushed ? /*#__PURE__*/React.createElement(StatusPill, {
    stage: "completed"
  }) : /*#__PURE__*/React.createElement(StatusPill, {
    stage: "uploaded"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement(TimelineTracker, {
    site: site
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      justifyContent: 'flex-end',
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onOpen(site),
    title: "View site",
    className: "zm-icon-btn",
    style: {
      width: 32,
      height: 32,
      padding: 0,
      border: '1px solid var(--zm-line)',
      borderRadius: 7,
      background: 'transparent',
      color: 'var(--zm-fg)',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: '0 0 32px'
    }
  }, /*#__PURE__*/React.createElement(EyeIcon, {
    size: 14
  })), /*#__PURE__*/React.createElement("button", {
    onClick: () => onViewLOI(site),
    title: "View LOI",
    className: "zm-icon-btn",
    style: {
      width: 32,
      height: 32,
      padding: 0,
      border: '1px solid var(--zm-line)',
      borderRadius: 7,
      background: 'transparent',
      color: 'var(--zm-fg)',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: '0 0 32px'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "file",
    size: 14
  })), pushed ? /*#__PURE__*/React.createElement("button", {
    disabled: true,
    style: {
      height: 32,
      padding: '0 12px',
      border: '1px solid var(--zm-line)',
      borderRadius: 7,
      background: 'var(--zm-surface)',
      color: 'var(--zm-fg-3)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12,
      fontWeight: 600,
      cursor: 'not-allowed',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      whiteSpace: 'nowrap',
      lineHeight: 1,
      flex: '0 0 auto'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 12
  }), " Pushed") : /*#__PURE__*/React.createElement("button", {
    onClick: () => onPush(site),
    className: "zm-btn-primary",
    style: {
      flex: '1 1 auto',
      minWidth: 100,
      height: 32,
      padding: '0 12px',
      border: 'none',
      borderRadius: 7,
      background: 'var(--zm-accent)',
      color: '#fff',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12.5,
      fontWeight: 700,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      whiteSpace: 'nowrap',
      lineHeight: 1,
      boxShadow: 'var(--zm-shadow-1)'
    }
  }, "Push site ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrow",
    size: 12
  }))));
};
const applyStagingFilters = (sites, f) => sites.filter(s => {
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!s.name.toLowerCase().includes(q) && !(s.spocName || '').toLowerCase().includes(q)) return false;
  }
  if (f.city !== 'All' && s.city !== f.city) return false;
  if (f.month !== 'All') {
    const m = new Date(s.approvedDate).toLocaleString('en', {
      month: 'short'
    });
    if (m !== f.month) return false;
  }
  const overdue = s.daysSinceApproval > s.expectedLoiDays && !s.loiUploaded;
  if (f.status === 'overdue' && !overdue) return false;
  if (f.status === 'ontime' && (overdue || s.loiUploaded)) return false;
  if (f.status === 'uploaded' && !s.loiUploaded) return false;
  return true;
});
const StagingView = ({
  sites,
  role,
  onUpload,
  onOpen,
  onPush,
  onViewLOI
}) => {
  const [filters, setFilters] = React.useState({
    q: '',
    city: 'All',
    month: 'All',
    status: 'all'
  });
  const filtered = applyStagingFilters(sites, filters);
  const overdueCount = sites.filter(s => s.daysSinceApproval > s.expectedLoiDays && !s.loiUploaded).length;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 18
    }
  }, /*#__PURE__*/React.createElement(PageHeader, {
    file: "\u2116 04",
    eyebrow: "Workflow \xB7 Staging",
    title: role === 'supervisor' ? /*#__PURE__*/React.createElement(React.Fragment, null, "LOIs ", /*#__PURE__*/React.createElement("em", null, "awaiting"), " push") : /*#__PURE__*/React.createElement(React.Fragment, null, "Sites ", /*#__PURE__*/React.createElement("em", null, "awaiting"), " LOI"),
    lede: role === 'supervisor' ? `${sites.length} site${sites.length === 1 ? '' : 's'} with uploaded LOI — review the draft → LOI timeline and push to the next module.` : `${sites.length} of your own approved site${sites.length === 1 ? '' : 's'} — ${overdueCount} overdue against expected timeline.`,
    right: role !== 'supervisor' && overdueCount > 0 ? /*#__PURE__*/React.createElement(HeaderTag, {
      icon: "alert",
      label: `${overdueCount} OVERDUE`,
      tone: "accent"
    }) : /*#__PURE__*/React.createElement(HeaderTag, {
      icon: "check",
      label: "ON TRACK"
    })
  }), /*#__PURE__*/React.createElement(StagingFilterBar, {
    filters: filters,
    onFilters: setFilters,
    sites: sites,
    role: role
  }), /*#__PURE__*/React.createElement("div", {
    className: "zm-glass",
    style: {
      borderRadius: 16,
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: 'auto'
    }
  }, role === 'supervisor' ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '70px minmax(130px, 0.9fr) 70px 124px minmax(170px, 1.3fr) 170px',
      gap: 10,
      padding: '11px 12px',
      background: 'var(--zm-surface-2)',
      borderBottom: '1px solid var(--zm-line)',
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: 10.5,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: 'var(--zm-fg-3)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Code"), /*#__PURE__*/React.createElement("span", null, "Site"), /*#__PURE__*/React.createElement("span", null, "City"), /*#__PURE__*/React.createElement("span", null, "Status"), /*#__PURE__*/React.createElement("span", null, "Draft \u2192 LOI timeline"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      justifyContent: 'flex-end',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      width: 32,
      flex: '0 0 32px'
    }
  }), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      width: 32,
      flex: '0 0 32px'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: '1 1 auto',
      minWidth: 100,
      textAlign: 'center'
    }
  }, "Action"))), filtered.map(s => /*#__PURE__*/React.createElement(SupervisorRow, {
    key: s.id,
    site: s,
    onPush: onPush,
    onViewLOI: onViewLOI,
    onOpen: onOpen
  }))) : /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 1080
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '0.9fr 1.6fr 1fr 1fr 1fr 1.4fr 170px',
      gap: 10,
      padding: '11px 16px',
      background: 'var(--zm-surface-2)',
      borderBottom: '1px solid var(--zm-line)',
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: 10.5,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: 'var(--zm-fg-3)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Code"), /*#__PURE__*/React.createElement("span", null, "Site"), /*#__PURE__*/React.createElement("span", null, "City"), /*#__PURE__*/React.createElement("span", null, "Approved"), /*#__PURE__*/React.createElement("span", null, "LOI timeline"), /*#__PURE__*/React.createElement("span", null, "Status"), /*#__PURE__*/React.createElement("span", {
    style: {
      textAlign: 'right'
    }
  }, "Action")), filtered.map(s => /*#__PURE__*/React.createElement(ExecRow, {
    key: s.id,
    site: s,
    onUpload: onUpload,
    onOpen: onOpen
  }))), filtered.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 48,
      textAlign: 'center',
      color: 'var(--zm-fg-3)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13
    }
  }, role === 'supervisor' ? 'No LOIs uploaded yet.' : 'No sites match these filters.'))));
};
Object.assign(window, {
  StagingView
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/new-store-folder/Staging.jsx", error: String((e && e.message) || e) }); }

// ui_kits/workspace/Command.jsx
try { (() => {
// Command bar (NL query) + Ask Matrix reply tile.

const SUGGESTIONS = ['Staging sites overdue > 14 days in Mumbai', 'Drafts older than 21 days by creator', 'Generate shortlist digest PPTX for last week', 'Compare pipeline velocity by city this quarter'];
const CommandBar = ({
  value,
  onChange,
  onSubmit,
  busy
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    background: '#171923',
    border: '1px solid #262A38',
    borderRadius: 14,
    padding: 4,
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    boxShadow: 'var(--zm-shadow-3)'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 14px'
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    color: busy ? '#F59E0B' : '#00B4D8',
    display: 'inline-flex'
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "sparkle",
  size: 18,
  stroke: 1.6
})), /*#__PURE__*/React.createElement("input", {
  value: value,
  onChange: e => onChange(e.target.value),
  onKeyDown: e => {
    if (e.key === 'Enter' && value.trim()) onSubmit(value);
  },
  placeholder: "Ask the workspace\u2026  e.g. sites stuck at LOI > 14 days in Mumbai",
  style: {
    flex: 1,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 15,
    color: '#E2E8F0',
    letterSpacing: '-0.005em'
  }
}), /*#__PURE__*/React.createElement("kbd", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 10,
    color: '#7C8499',
    border: '1px solid #262A38',
    padding: '2px 6px',
    borderRadius: 4
  }
}, "\u2318 \u21B5"), /*#__PURE__*/React.createElement("button", {
  disabled: !value.trim() || busy,
  onClick: () => onSubmit(value),
  style: {
    height: 30,
    padding: '0 12px',
    borderRadius: 8,
    border: 'none',
    background: value.trim() && !busy ? '#00B4D8' : '#262A38',
    color: value.trim() && !busy ? '#0B0C10' : '#525A6F',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12.5,
    fontWeight: 700,
    cursor: value.trim() && !busy ? 'pointer' : 'not-allowed',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6
  }
}, busy ? 'Thinking…' : /*#__PURE__*/React.createElement(React.Fragment, null, "Run ", /*#__PURE__*/React.createElement(Icon, {
  name: "arrow",
  size: 12
})))), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    gap: 6,
    padding: '10px 14px',
    borderTop: '1px solid #1B1E2A',
    overflowX: 'auto'
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: '#525A6F',
    alignSelf: 'center',
    marginRight: 6,
    whiteSpace: 'nowrap'
  }
}, "Try"), SUGGESTIONS.map((s, i) => /*#__PURE__*/React.createElement("button", {
  key: i,
  onClick: () => onSubmit(s),
  style: {
    height: 26,
    padding: '0 10px',
    borderRadius: 999,
    border: '1px solid #262A38',
    background: '#1D2030',
    color: '#B4BBC9',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 11.5,
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  }
}, s))));
const REPLY_TABLE = [{
  code: 'BT-MUM-0142',
  name: 'Powai · Lake Homes',
  days: 16,
  value: '₹1.42L',
  who: 'Riya S.'
}, {
  code: 'BT-MUM-0118',
  name: 'Andheri W · Veera Desai',
  days: 19,
  value: '₹1.28L',
  who: 'Aman V.'
}, {
  code: 'BT-MUM-0110',
  name: 'Lower Parel · One BKC',
  days: 22,
  value: '₹2.04L',
  who: 'Riya S.'
}, {
  code: 'BT-MUM-0098',
  name: 'Juhu Tara Rd',
  days: 28,
  value: '₹1.18L',
  who: 'Nikhil I.'
}, {
  code: 'BT-MUM-0091',
  name: 'Khar Linking · 33',
  days: 31,
  value: '₹1.56L',
  who: 'Aman V.'
}, {
  code: 'BT-MUM-0084',
  name: 'Worli Sea Face Lobby',
  days: 38,
  value: '₹2.42L',
  who: 'Riya S.'
}];
const AskMatrixReply = ({
  query
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    background: '#171923',
    border: '1px solid #262A38',
    borderRadius: 14,
    overflow: 'hidden',
    boxShadow: 'var(--zm-shadow-2)'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    padding: '14px 18px 12px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    borderBottom: '1px solid #1B1E2A'
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    width: 28,
    height: 28,
    borderRadius: 8,
    flex: '0 0 28px',
    background: 'rgba(0,180,216,0.16)',
    color: '#00B4D8',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center'
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "sparkle",
  size: 15
})), /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 700,
    fontSize: 12,
    color: '#E2E8F0'
  }
}, "Ask Matrix"), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 11,
    color: '#7C8499',
    marginLeft: 8
  }
}, "\xB7 claude-haiku-4-5 \xB7 1.8s"), /*#__PURE__*/React.createElement("p", {
  style: {
    margin: '4px 0 0',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 14,
    color: '#B4BBC9',
    lineHeight: 1.55
  }
}, "6 staging sites in Mumbai have been past their expected LOI date by > 14 days. Combined expected", ' ', /*#__PURE__*/React.createElement("strong", {
  style: {
    color: '#F59E0B',
    fontFamily: 'var(--zm-font-mono)',
    fontWeight: 600
  }
}, "monthly op cost \u20B99.90L"), ". Oldest is Worli Sea Face Lobby at 38 days overdue.")), /*#__PURE__*/React.createElement("button", {
  style: {
    background: 'transparent',
    border: '1px solid #262A38',
    borderRadius: 7,
    padding: '4px 10px',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 11.5,
    fontWeight: 600,
    color: '#B4BBC9',
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  }
}, "Export PPTX")), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'grid',
    gridTemplateColumns: '90px 1fr 80px 80px 90px',
    alignItems: 'center',
    gap: 8,
    padding: '8px 18px',
    background: '#1B1E2A',
    borderBottom: '1px solid #1B1E2A',
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 600,
    fontSize: 10,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: '#7C8499'
  }
}, /*#__PURE__*/React.createElement("span", null, "Code"), /*#__PURE__*/React.createElement("span", null, "Site"), /*#__PURE__*/React.createElement("span", {
  style: {
    textAlign: 'right'
  }
}, "Overdue"), /*#__PURE__*/React.createElement("span", {
  style: {
    textAlign: 'right'
  }
}, "Op cost"), /*#__PURE__*/React.createElement("span", null, "Owner")), REPLY_TABLE.map((r, i) => /*#__PURE__*/React.createElement("div", {
  key: r.code,
  style: {
    display: 'grid',
    gridTemplateColumns: '90px 1fr 80px 80px 90px',
    alignItems: 'center',
    gap: 8,
    padding: '10px 18px',
    borderBottom: i < REPLY_TABLE.length - 1 ? '1px solid #1B1E2A' : 'none',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13,
    color: '#E2E8F0'
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 11.5,
    color: '#7C8499'
  }
}, r.code), /*#__PURE__*/React.createElement("span", {
  style: {
    fontWeight: 500
  }
}, r.name), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontFeatureSettings: "'tnum' 1",
    textAlign: 'right',
    color: r.days > 21 ? '#F87171' : '#F59E0B',
    fontWeight: 600
  }
}, r.days, "d"), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontFeatureSettings: "'tnum' 1",
    textAlign: 'right'
  }
}, r.value), /*#__PURE__*/React.createElement("span", {
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    color: '#B4BBC9'
  }
}, /*#__PURE__*/React.createElement(Avatar, {
  name: r.who,
  size: 20
}), /*#__PURE__*/React.createElement("span", {
  style: {
    fontSize: 12
  }
}, r.who)))), /*#__PURE__*/React.createElement("div", {
  style: {
    padding: '12px 18px',
    background: '#0F111A',
    borderTop: '1px solid #1B1E2A',
    display: 'flex',
    alignItems: 'center',
    gap: 10
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 10.5,
    color: '#7C8499'
  }
}, "via bd-mcp \xB7 staging_overdue(city=\"Mumbai\", days_over=14)"), /*#__PURE__*/React.createElement("span", {
  style: {
    flex: 1
  }
}), /*#__PURE__*/React.createElement("button", {
  style: {
    background: 'transparent',
    border: 'none',
    color: '#00B4D8',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4
  }
}, "Open in sites view ", /*#__PURE__*/React.createElement(Icon, {
  name: "arrow",
  size: 12
}))));
Object.assign(window, {
  CommandBar,
  AskMatrixReply,
  SUGGESTIONS
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/workspace/Command.jsx", error: String((e && e.message) || e) }); }

// ui_kits/workspace/Surfaces.jsx
try { (() => {
// Hero tiles: 4-up metric grid with sparklines + Approvals queue + Trace panel.

const HeroTile = ({
  eyebrow,
  value,
  accent = '#00B4D8',
  delta,
  deltaTone = 'pos',
  spark,
  sparkColor
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    background: '#171923',
    border: '1px solid #262A38',
    borderRadius: 12,
    padding: '18px 18px 4px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    position: 'relative',
    overflow: 'hidden'
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 600,
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: '#7C8499'
  }
}, eyebrow), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontFeatureSettings: "'tnum' 1",
    fontWeight: 600,
    fontSize: 34,
    letterSpacing: '-0.02em',
    color: '#E2E8F0',
    lineHeight: 1
  }
}, value), /*#__PURE__*/React.createElement("span", {
  style: {
    width: 32,
    height: 2,
    background: accent,
    boxShadow: `0 0 6px ${accent}55`
  }
}), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 11.5,
    color: deltaTone === 'pos' ? '#34D399' : deltaTone === 'neg' ? '#F87171' : '#7C8499'
  }
}, delta), /*#__PURE__*/React.createElement("div", {
  style: {
    width: '55%',
    opacity: 0.92
  }
}, spark && /*#__PURE__*/React.createElement(Spark, {
  data: spark,
  color: sparkColor || accent,
  height: 30
}))));
const HeroTiles = () => /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 12
  }
}, /*#__PURE__*/React.createElement(HeroTile, {
  eyebrow: "Sites in motion",
  value: "142",
  accent: "#00B4D8",
  delta: "\u25B2 12 \xB7 7d",
  spark: [110, 118, 121, 124, 128, 132, 136, 138, 142]
}), /*#__PURE__*/React.createElement(HeroTile, {
  eyebrow: "Drafts \xB7 pending",
  value: "9",
  accent: "#A78BFA",
  delta: "\u25B2 2 \xB7 7d",
  spark: [5, 6, 7, 8, 7, 8, 9, 8, 9],
  sparkColor: "#A78BFA"
}), /*#__PURE__*/React.createElement(HeroTile, {
  eyebrow: "LOI overdue",
  value: "4",
  accent: "#F59E0B",
  delta: "\u25B2 1 \xB7 7d",
  deltaTone: "neg",
  spark: [2, 2, 3, 3, 3, 4, 4, 3, 4],
  sparkColor: "#F59E0B"
}), /*#__PURE__*/React.createElement(HeroTile, {
  eyebrow: "Cycle \xB7 median d",
  value: "61",
  accent: "#34D399",
  delta: "\u25BC 5 \xB7 vs Q1",
  spark: [71, 69, 68, 66, 64, 63, 62, 61, 61],
  sparkColor: "#34D399"
}));
const APPROVALS = [{
  id: 'sl_88f1',
  site: 'Bandra Linking Rd',
  city: 'Mumbai',
  code: 'BT-MUM-0143',
  by: 'Riya Sharma',
  ago: '14 min',
  detailed: true,
  score: 78
}, {
  id: 'sl_88e3',
  site: 'Connaught Place · F-21',
  city: 'New Delhi',
  code: 'BT-DEL-0090',
  by: 'Nikhil Iyer',
  ago: '2 hr',
  detailed: true,
  score: 82
}, {
  id: 'sl_88d2',
  site: 'BKC One · East Wing',
  city: 'Mumbai',
  code: 'BT-MUM-0144',
  by: 'Riya Sharma',
  ago: '5 hr',
  detailed: false,
  score: 74
}, {
  id: 'sl_88c1',
  site: 'Koramangala 6th Block',
  city: 'Bengaluru',
  code: 'BT-BLR-0209',
  by: 'Aman Verma',
  ago: '1 day',
  detailed: false,
  score: 71
}];
const ApprovalCard = ({
  row,
  onApprove,
  onReject
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    padding: '14px 16px',
    borderBottom: '1px solid #1B1E2A',
    display: 'grid',
    gridTemplateColumns: '1.6fr 1fr 0.7fr 1.1fr auto',
    alignItems: 'center',
    gap: 14
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13,
    fontWeight: 600,
    color: '#E2E8F0'
  }
}, row.site), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 10.5,
    color: '#7C8499'
  }
}, row.code, " \xB7 ", row.city)), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12.5,
    color: '#E2E8F0'
  }
}, "by ", row.by), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 11,
    color: '#7C8499'
  }
}, row.ago, " ago")), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontFeatureSettings: "'tnum' 1",
    fontSize: 18,
    fontWeight: 600,
    color: row.score >= 75 ? '#34D399' : '#E2E8F0',
    textAlign: 'right'
  }
}, row.score), /*#__PURE__*/React.createElement("div", null, row.detailed ? /*#__PURE__*/React.createElement("span", {
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 10px',
    borderRadius: 999,
    background: 'rgba(52,211,153,0.14)',
    color: '#34D399',
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 600,
    fontSize: 10.5,
    letterSpacing: '0.12em',
    textTransform: 'uppercase'
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "check",
  size: 11
}), " Details added") : /*#__PURE__*/React.createElement("span", {
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 10px',
    borderRadius: 999,
    background: 'rgba(245,158,11,0.14)',
    color: '#F59E0B',
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 600,
    fontSize: 10.5,
    letterSpacing: '0.12em',
    textTransform: 'uppercase'
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "alert",
  size: 11
}), " Awaiting detail")), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    gap: 6
  }
}, /*#__PURE__*/React.createElement("button", {
  onClick: () => onReject(row),
  style: {
    background: 'transparent',
    border: '1px solid rgba(248,113,113,0.4)',
    borderRadius: 7,
    padding: '6px 10px',
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 600,
    fontSize: 12,
    color: '#F87171',
    cursor: 'pointer'
  }
}, "Reject"), /*#__PURE__*/React.createElement("button", {
  disabled: !row.detailed,
  onClick: () => onApprove(row),
  style: {
    background: row.detailed ? '#00B4D8' : '#262A38',
    color: row.detailed ? '#0B0C10' : '#525A6F',
    border: 'none',
    borderRadius: 7,
    padding: '6px 12px',
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 700,
    fontSize: 12,
    cursor: row.detailed ? 'pointer' : 'not-allowed',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "check",
  size: 12
}), " Approve")));
const Approvals = ({
  onAction
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    background: '#171923',
    border: '1px solid #262A38',
    borderRadius: 12,
    overflow: 'hidden'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    padding: '14px 16px',
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    borderBottom: '1px solid #1B1E2A'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10
  }
}, /*#__PURE__*/React.createElement("h3", {
  style: {
    margin: 0,
    fontFamily: 'var(--zm-font-display)',
    fontWeight: 600,
    fontSize: 16,
    color: '#E2E8F0'
  }
}, "Shortlist approvals"), /*#__PURE__*/React.createElement("span", {
  style: {
    padding: '2px 8px',
    borderRadius: 999,
    background: 'rgba(245,158,11,0.14)',
    color: '#F59E0B',
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: '0.08em',
    textTransform: 'uppercase'
  }
}, APPROVALS.length, " pending")), /*#__PURE__*/React.createElement("div", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 11,
    color: '#7C8499'
  }
}, "via bd-mcp \xB7 4s lag")), APPROVALS.map(r => /*#__PURE__*/React.createElement(ApprovalCard, {
  key: r.id,
  row: r,
  onApprove: () => onAction('approved', r),
  onReject: () => onAction('rejected', r)
})));
const TRACE = [{
  kind: 'user',
  t: '14:32:08',
  text: 'staging sites overdue > 14 days in mumbai'
}, {
  kind: 'think',
  t: '14:32:08',
  text: 'Resolving "Mumbai" → tenant.cities[name=Mumbai]. Building filter: stage == staging AND city == Mumbai AND (days_since_approval − expected_loi_days) > 14.'
}, {
  kind: 'tool',
  t: '14:32:09',
  text: 'bd-mcp · staging_overdue',
  meta: 'city=Mumbai · days_over=14'
}, {
  kind: 'result',
  t: '14:32:10',
  text: '6 rows · cache hit · 142ms'
}, {
  kind: 'think',
  t: '14:32:10',
  text: 'Computing expected op cost = sum(total_op_cost) = ₹9,90,000. Sorting by overdue days desc.'
}, {
  kind: 'tool',
  t: '14:32:11',
  text: 'render · table_card',
  meta: 'cols=5 · sort=overdue desc'
}, {
  kind: 'msg',
  t: '14:32:11',
  text: '6 sites returned. Want me to draft the supervisor digest as PPTX?'
}];
const TracePanel = () => /*#__PURE__*/React.createElement("aside", {
  style: {
    width: 320,
    flex: '0 0 320px',
    background: '#0F111A',
    borderLeft: '1px solid #1B1E2A',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    padding: '14px 16px',
    borderBottom: '1px solid #1B1E2A',
    display: 'flex',
    alignItems: 'center',
    gap: 8
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "activity",
  size: 14,
  style: {
    color: '#00B4D8'
  }
}), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 600,
    fontSize: 11,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: '#B4BBC9'
  }
}, "Trace"), /*#__PURE__*/React.createElement("span", {
  style: {
    marginLeft: 'auto',
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 10.5,
    color: '#525A6F'
  }
}, "last run \xB7 14:32:11")), /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 0'
  }
}, TRACE.map((e, i) => {
  const colors = {
    user: {
      c: '#E2E8F0',
      l: 'You',
      bg: 'rgba(0,180,216,0.12)'
    },
    think: {
      c: '#A78BFA',
      l: 'Think',
      bg: 'rgba(167,139,250,0.10)'
    },
    tool: {
      c: '#00B4D8',
      l: 'Tool',
      bg: 'rgba(0,180,216,0.10)'
    },
    result: {
      c: '#34D399',
      l: 'Result',
      bg: 'rgba(52,211,153,0.10)'
    },
    msg: {
      c: '#F59E0B',
      l: 'Reply',
      bg: 'rgba(245,158,11,0.10)'
    }
  }[e.kind];
  return /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      padding: '8px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      padding: '1px 7px',
      borderRadius: 4,
      background: colors.bg,
      color: colors.c,
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 9.5,
      fontWeight: 700,
      letterSpacing: '0.1em',
      textTransform: 'uppercase'
    }
  }, colors.l), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 10,
      color: '#525A6F'
    }
  }, e.t)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: e.kind === 'tool' ? 'var(--zm-font-mono)' : 'var(--zm-font-body)',
      fontSize: e.kind === 'tool' ? 12 : 12.5,
      color: e.kind === 'tool' ? '#B4BBC9' : '#D1D6E2',
      lineHeight: 1.5
    }
  }, e.text), e.meta && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-mono)',
      fontSize: 10.5,
      color: '#7C8499',
      paddingLeft: 8,
      borderLeft: '1px solid #262A38'
    }
  }, e.meta));
})), /*#__PURE__*/React.createElement("div", {
  style: {
    padding: '10px 14px',
    borderTop: '1px solid #1B1E2A',
    display: 'flex',
    alignItems: 'center',
    gap: 10
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 10.5,
    color: '#525A6F'
  }
}, "2 MCP servers \xB7 5 skills"), /*#__PURE__*/React.createElement("span", {
  style: {
    flex: 1
  }
}), /*#__PURE__*/React.createElement("button", {
  style: {
    background: 'transparent',
    border: 'none',
    color: '#7C8499',
    cursor: 'pointer',
    display: 'inline-flex'
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: "refresh",
  size: 13
}))));
Object.assign(window, {
  HeroTile,
  HeroTiles,
  ApprovalCard,
  Approvals,
  TracePanel,
  APPROVALS
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/workspace/Surfaces.jsx", error: String((e && e.message) || e) }); }

// ui_kits/workspace/WsApp.jsx
try { (() => {
// Main workspace app.

const App = () => {
  const [view, setView] = React.useState('dashboard');
  const [query, setQuery] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [reply, setReply] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  const runQuery = q => {
    setQuery(q);
    setBusy(true);
    setReply(null);
    setTimeout(() => {
      setBusy(false);
      setReply(q);
    }, 1200);
  };
  return /*#__PURE__*/React.createElement("div", {
    "data-screen-label": "01 Workspace",
    style: {
      width: '100%',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: '#0B0C10',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement(Titlebar, {
    tenant: "Blue Tokai \xB7 Mumbai tenant",
    model: "claude-haiku-4-5"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(Sidebar, {
    view: view,
    onView: setView
  }), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '24px 28px 56px',
      background: '#0B0C10',
      backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'><path d='M40 0 L0 0 0 40' fill='none' stroke='%23E2E8F0' stroke-width='0.5' opacity='0.04'/></svg>\")",
      backgroundSize: '40px 40px'
    }
  }, (view === 'dashboard' || view === 'ask') && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 18,
      maxWidth: 1140,
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: 10.5,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: '#7C8499'
    }
  }, "Z-Matrix workspace \xB7 dashboard"), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: '4px 0 4px',
      fontFamily: 'var(--zm-font-display)',
      fontWeight: 700,
      fontSize: 30,
      letterSpacing: '-0.02em',
      color: '#E2E8F0'
    }
  }, "Good evening, Riya"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      color: '#7C8499'
    }
  }, "9 shortlists awaiting approval \xB7 4 LOI overdue \xB7 synced 4s ago")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: {
      height: 32,
      padding: '0 12px',
      borderRadius: 8,
      border: '1px solid #262A38',
      background: '#171923',
      color: '#B4BBC9',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12.5,
      fontWeight: 600,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "book",
    size: 13
  }), " Skills"), /*#__PURE__*/React.createElement("button", {
    style: {
      height: 32,
      padding: '0 12px',
      borderRadius: 8,
      border: '1px solid rgba(0,180,216,0.32)',
      background: 'rgba(0,180,216,0.12)',
      color: '#00B4D8',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 12.5,
      fontWeight: 700,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 13
  }), " New report"))), /*#__PURE__*/React.createElement(CommandBar, {
    value: query,
    onChange: setQuery,
    onSubmit: runQuery,
    busy: busy
  }), reply && /*#__PURE__*/React.createElement(AskMatrixReply, {
    query: reply
  }), /*#__PURE__*/React.createElement(HeroTiles, null), /*#__PURE__*/React.createElement(Approvals, {
    onAction: (verb, row) => setToast(`${verb === 'approved' ? 'Approved' : 'Rejected'} · ${row.site}`)
  })), view === 'sites' && /*#__PURE__*/React.createElement(PlaceholderView, {
    title: "Sites browser",
    body: "Same data the new-store folder shows, scoped to your tenant via bd-mcp. Includes outbox: edits queue locally if the gateway is unreachable."
  }), view === 'approvals' && /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1080,
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: '0 0 18px',
      fontFamily: 'var(--zm-font-display)',
      fontWeight: 700,
      fontSize: 28,
      letterSpacing: '-0.02em',
      color: '#E2E8F0'
    }
  }, "Shortlist approvals"), /*#__PURE__*/React.createElement(Approvals, {
    onAction: (verb, row) => setToast(`${verb === 'approved' ? 'Approved' : 'Rejected'} · ${row.site}`)
  })), view === 'activity' && /*#__PURE__*/React.createElement(PlaceholderView, {
    title: "Live activity",
    body: "Cross-module event stream from Notification service. WebSocket push lands here even when modules are idle."
  })), /*#__PURE__*/React.createElement(TracePanel, null)), toast && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      bottom: 22,
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#171923',
      border: '1px solid #262A38',
      color: '#E2E8F0',
      padding: '10px 16px',
      borderRadius: 10,
      boxShadow: 'var(--zm-shadow-pop)',
      fontFamily: 'var(--zm-font-body)',
      fontSize: 13,
      fontWeight: 500,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      animation: 'zm-rise 240ms var(--zm-ease-emp)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 999,
      background: '#34D399',
      boxShadow: '0 0 8px rgba(52,211,153,0.7)'
    }
  }), toast));
};
const PlaceholderView = ({
  title,
  body
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    maxWidth: 720,
    margin: '0 auto'
  }
}, /*#__PURE__*/React.createElement("h1", {
  style: {
    margin: 0,
    fontFamily: 'var(--zm-font-display)',
    fontWeight: 700,
    fontSize: 28,
    letterSpacing: '-0.02em',
    color: '#E2E8F0'
  }
}, title), /*#__PURE__*/React.createElement("p", {
  style: {
    margin: '8px 0 18px',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 14,
    color: '#B4BBC9',
    lineHeight: 1.55
  }
}, body), /*#__PURE__*/React.createElement("div", {
  style: {
    padding: 32,
    border: '1px dashed #262A38',
    borderRadius: 12,
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13,
    color: '#7C8499',
    background: '#171923'
  }
}, "Surface mocked at kit level only."));
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/workspace/WsApp.jsx", error: String((e && e.message) || e) }); }

// ui_kits/workspace/WsChrome.jsx
try { (() => {
// Titlebar (Electron-style) + dark sidebar + workspace switcher.

const Titlebar = ({
  tenant,
  model
}) => /*#__PURE__*/React.createElement("header", {
  style: {
    height: 38,
    padding: '0 12px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: '#0B0C10',
    borderBottom: '1px solid #171923',
    fontFamily: 'var(--zm-font-body)',
    WebkitAppRegion: 'drag',
    flex: '0 0 auto'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    gap: 7,
    WebkitAppRegion: 'no-drag'
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    width: 11,
    height: 11,
    borderRadius: 999,
    background: '#FF5F57'
  }
}), /*#__PURE__*/React.createElement("span", {
  style: {
    width: 11,
    height: 11,
    borderRadius: 999,
    background: '#FEBC2E'
  }
}), /*#__PURE__*/React.createElement("span", {
  style: {
    width: 11,
    height: 11,
    borderRadius: 999,
    background: '#28C840'
  }
})), /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontSize: 11.5,
    color: '#7C8499',
    letterSpacing: '0.04em'
  }
}, tenant, " \xB7 ", model), /*#__PURE__*/React.createElement("span", {
  style: {
    width: 6,
    height: 6,
    borderRadius: 999,
    background: '#34D399',
    boxShadow: '0 0 8px rgba(52,211,153,0.6)'
  }
})), /*#__PURE__*/React.createElement("div", {
  style: {
    width: 60
  }
}));
const SidebarItem = ({
  icon,
  label,
  count,
  active,
  badge,
  onClick
}) => /*#__PURE__*/React.createElement("div", {
  onClick: onClick,
  style: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 10px',
    borderRadius: 7,
    cursor: 'pointer',
    background: active ? 'rgba(0,180,216,0.12)' : 'transparent',
    color: active ? '#E2E8F0' : '#B4BBC9',
    fontFamily: 'var(--zm-font-body)',
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    position: 'relative',
    transition: 'background 120ms var(--zm-ease)'
  },
  onMouseEnter: e => {
    if (!active) e.currentTarget.style.background = '#20243A';
  },
  onMouseLeave: e => {
    if (!active) e.currentTarget.style.background = 'transparent';
  }
}, active && /*#__PURE__*/React.createElement("span", {
  style: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 2,
    background: '#00B4D8',
    borderRadius: 2,
    boxShadow: '0 0 8px rgba(0,180,216,0.6)'
  }
}), /*#__PURE__*/React.createElement("span", {
  style: {
    color: active ? '#00B4D8' : '#7C8499',
    display: 'inline-flex'
  }
}, /*#__PURE__*/React.createElement(Icon, {
  name: icon,
  size: 16
})), label, count != null && /*#__PURE__*/React.createElement("span", {
  style: {
    marginLeft: 'auto',
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 11,
    color: active ? '#00B4D8' : '#7C8499',
    fontWeight: 500
  }
}, count), badge && /*#__PURE__*/React.createElement("span", {
  style: {
    marginLeft: 'auto',
    padding: '1px 6px',
    borderRadius: 999,
    background: 'rgba(245,158,11,0.16)',
    color: '#F59E0B',
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 10,
    fontWeight: 600
  }
}, badge));
const Sidebar = ({
  view,
  onView
}) => /*#__PURE__*/React.createElement("aside", {
  style: {
    width: 238,
    flex: '0 0 238px',
    padding: '12px 10px',
    background: '#0F111A',
    borderRight: '1px solid #1B1E2A',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    overflowY: 'auto'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 8px 14px',
    borderBottom: '1px solid #1B1E2A',
    marginBottom: 8
  }
}, /*#__PURE__*/React.createElement("svg", {
  width: "24",
  height: "24",
  viewBox: "0 0 64 64",
  fill: "none"
}, /*#__PURE__*/React.createElement("g", {
  stroke: "#00B4D8",
  strokeWidth: "3",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "M14 14 L48 14"
}), /*#__PURE__*/React.createElement("path", {
  d: "M48 14.6 L19 47.4"
}), /*#__PURE__*/React.createElement("path", {
  d: "M16 50 L50 50"
}), /*#__PURE__*/React.createElement("path", {
  d: "M14 14 L22 6 L56 6",
  opacity: "0.7"
}), /*#__PURE__*/React.createElement("path", {
  d: "M56 6.4 L56 42",
  opacity: "0.7"
}), /*#__PURE__*/React.createElement("path", {
  d: "M56 42.2 L50 50",
  opacity: "0.7"
}))), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-display)',
    fontWeight: 800,
    fontSize: 14,
    color: '#E2E8F0',
    letterSpacing: '0.04em'
  }
}, "Z", /*#__PURE__*/React.createElement("span", {
  style: {
    fontWeight: 400,
    letterSpacing: '0.34em',
    fontSize: 11,
    marginLeft: 2,
    color: '#B4BBC9'
  }
}, "MATRIX")), /*#__PURE__*/React.createElement("span", {
  style: {
    marginLeft: 'auto',
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 9.5,
    color: '#525A6F',
    letterSpacing: '0.08em'
  }
}, "v3.3")), /*#__PURE__*/React.createElement(SidebarItem, {
  icon: "grid",
  label: "Dashboard",
  active: view === 'dashboard',
  onClick: () => onView('dashboard')
}), /*#__PURE__*/React.createElement(SidebarItem, {
  icon: "box",
  label: "Sites",
  count: 142,
  active: view === 'sites',
  onClick: () => onView('sites')
}), /*#__PURE__*/React.createElement(SidebarItem, {
  icon: "shield",
  label: "Approvals",
  badge: "9",
  active: view === 'approvals',
  onClick: () => onView('approvals')
}), /*#__PURE__*/React.createElement(SidebarItem, {
  icon: "activity",
  label: "Live activity",
  active: view === 'activity',
  onClick: () => onView('activity')
}), /*#__PURE__*/React.createElement("div", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 600,
    fontSize: 9.5,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: '#525A6F',
    padding: '14px 10px 4px'
  }
}, "Agent"), /*#__PURE__*/React.createElement(SidebarItem, {
  icon: "chat",
  label: "Ask Matrix",
  active: view === 'ask',
  onClick: () => onView('ask')
}), /*#__PURE__*/React.createElement(SidebarItem, {
  icon: "terminal",
  label: "MCP servers",
  count: 2
}), /*#__PURE__*/React.createElement(SidebarItem, {
  icon: "wand",
  label: "Skills",
  count: 5
}), /*#__PURE__*/React.createElement("div", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontWeight: 600,
    fontSize: 9.5,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: '#525A6F',
    padding: '14px 10px 4px'
  }
}, "Modules"), /*#__PURE__*/React.createElement(SidebarItem, {
  icon: "shield",
  label: "Legal \xB7 DD"
}), /*#__PURE__*/React.createElement(SidebarItem, {
  icon: "pin",
  label: "Recce + design"
}), /*#__PURE__*/React.createElement(SidebarItem, {
  icon: "folder",
  label: "Project ex"
}), /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1
  }
}), /*#__PURE__*/React.createElement("div", {
  style: {
    margin: '8px 4px',
    padding: 10,
    borderRadius: 10,
    background: '#171923',
    border: '1px solid #262A38',
    display: 'flex',
    alignItems: 'center',
    gap: 10
  }
}, /*#__PURE__*/React.createElement(Avatar, {
  name: "Riya Sharma",
  size: 28
}), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column'
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-body)',
    fontSize: 12,
    fontWeight: 600,
    color: '#E2E8F0'
  }
}, "Riya Sharma"), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: 'var(--zm-font-mono)',
    fontSize: 10,
    color: '#7C8499'
  }
}, "BD supervisor \xB7 MUM")), /*#__PURE__*/React.createElement(Icon, {
  name: "settings",
  size: 14,
  style: {
    marginLeft: 'auto',
    color: '#7C8499'
  }
})));
Object.assign(window, {
  Titlebar,
  Sidebar
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/workspace/WsChrome.jsx", error: String((e && e.message) || e) }); }

// ui_kits/workspace/WsPrimitives.jsx
try { (() => {
// Shared primitives for workspace kit (dark-default).

const Icon = ({
  name,
  size = 16,
  stroke = 1.5,
  style
}) => {
  const paths = {
    grid: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "3",
      width: "7",
      height: "7",
      rx: "1"
    }), /*#__PURE__*/React.createElement("rect", {
      x: "14",
      y: "3",
      width: "7",
      height: "7",
      rx: "1"
    }), /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "14",
      width: "7",
      height: "7",
      rx: "1"
    }), /*#__PURE__*/React.createElement("rect", {
      x: "14",
      y: "14",
      width: "7",
      height: "7",
      rx: "1"
    })),
    box: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M2 9l10-6 10 6-10 6z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M2 9v6l10 6 10-6V9"
    })),
    list: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M3 6h18M3 12h18M3 18h12"
    })),
    pin: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1118 0z"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "10",
      r: "3"
    })),
    calendar: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "4",
      width: "18",
      height: "18",
      rx: "2"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M16 2v4M8 2v4M3 10h18"
    })),
    file: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M14 2v6h6"
    })),
    clock: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "9"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 7v5l3 2"
    })),
    check: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M20 6L9 17l-5-5"
    })),
    alert: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "12",
      r: "9"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M12 8v4M12 16h.01"
    })),
    search: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
      cx: "11",
      cy: "11",
      r: "7"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M21 21l-4.3-4.3"
    })),
    arrow: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M3 12h18M13 5l7 7-7 7"
    })),
    plus: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M12 5v14M5 12h14"
    })),
    card: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "5",
      width: "18",
      height: "14",
      rx: "2"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M3 10h18"
    })),
    message: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
    })),
    sparkle: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7z"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z"
    })),
    trend: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M3 3v18h18"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M7 14l3-3 4 4 5-7"
    })),
    shield: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M12 2l9 4v6c0 5-3.5 9.7-9 10-5.5-.3-9-5-9-10V6z"
    })),
    chat: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M21 11.5a8.5 8.5 0 01-15.4 5.1L3 21l4.4-2.6A8.5 8.5 0 1121 11.5z"
    })),
    user: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "12",
      cy: "7",
      r: "4"
    })),
    chevron: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M9 6l6 6-6 6"
    })),
    chevronDown: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M6 9l6 6 6-6"
    })),
    chevronUp: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M6 15l6-6 6 6"
    })),
    x: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M18 6L6 18M6 6l12 12"
    })),
    activity: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M22 12h-4l-3 9L9 3l-3 9H2"
    })),
    folder: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"
    })),
    home: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M3 9l9-7 9 7v11a2 2 0 01-2 2h-4v-7H9v7H5a2 2 0 01-2-2z"
    })),
    terminal: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polyline", {
      points: "4 17 10 11 4 5"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "12",
      y1: "19",
      x2: "20",
      y2: "19"
    })),
    wand: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M15 4l5 5"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M3 21l13-13"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M14 5l5 5"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M9 2l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"
    })),
    book: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
      d: "M4 19.5A2.5 2.5 0 016.5 17H20"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"
    })),
    refresh: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polyline", {
      points: "23 4 23 10 17 10"
    }), /*#__PURE__*/React.createElement("polyline", {
      points: "1 20 1 14 7 14"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M3.5 9a9 9 0 0114.85-3.36L23 10M1 14l4.65 4.36A9 9 0 0020.5 15"
    }))
  };
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: style
  }, paths[name] || null);
};
const Avatar = ({
  name,
  size = 28
}) => {
  const initials = (name || '').split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return /*#__PURE__*/React.createElement("span", {
    style: {
      width: size,
      height: size,
      borderRadius: 999,
      background: 'rgba(0,180,216,0.16)',
      color: '#00B4D8',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--zm-font-body)',
      fontWeight: 600,
      fontSize: size * 0.4,
      letterSpacing: 0.5,
      flex: '0 0 auto'
    }
  }, initials || '–');
};
const Spark = ({
  data,
  color = '#00B4D8',
  height = 36
}) => {
  const w = 140,
    h = height;
  const max = Math.max(...data),
    min = Math.min(...data);
  const norm = v => h - 4 - (v - min) / (max - min || 1) * (h - 8);
  const points = data.map((v, i) => [i / (data.length - 1) * w, norm(v)]);
  const path = points.map((p, i) => i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`).join(' ');
  const area = `${path} L${w},${h} L0,${h} Z`;
  return /*#__PURE__*/React.createElement("svg", {
    viewBox: `0 0 ${w} ${h}`,
    width: "100%",
    height: h,
    preserveAspectRatio: "none",
    style: {
      display: 'block'
    }
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
    id: `spark-${color.replace('#', '')}`,
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "1"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0",
    stopColor: color,
    stopOpacity: "0.32"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "1",
    stopColor: color,
    stopOpacity: "0"
  }))), /*#__PURE__*/React.createElement("path", {
    d: area,
    fill: `url(#spark-${color.replace('#', '')})`
  }), /*#__PURE__*/React.createElement("path", {
    d: path,
    fill: "none",
    stroke: color,
    strokeWidth: "1.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }), points.slice(-1).map((p, i) => /*#__PURE__*/React.createElement("circle", {
    key: i,
    cx: p[0],
    cy: p[1],
    r: "2.5",
    fill: color
  })));
};
Object.assign(window, {
  Icon,
  Avatar,
  Spark
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/workspace/WsPrimitives.jsx", error: String((e && e.message) || e) }); }

})();
