import React from 'react';

// Render body preserved exactly from Primitives.jsx.
export default function Icon({ name, size = 16, stroke = 1.5, style }) {
  const paths = {
    dashboard: <><rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor" stroke="none"/><rect x="13" y="3" width="8" height="8" rx="1.5" fill="currentColor" stroke="none"/><rect x="3" y="13" width="8" height="8" rx="1.5" fill="currentColor" stroke="none"/><rect x="13" y="13" width="8" height="8" rx="1.5" fill="currentColor" stroke="none"/></>,
    document: <><path d="M7 3h7l5 5v13H7z" fill="currentColor" opacity=".16" stroke="none"/><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h4"/></>,
    bookmark: <><path d="M7 4h10a1 1 0 011 1v16l-6-3.5L6 21V5a1 1 0 011-1z" fill="currentColor" opacity=".16" stroke="none"/><path d="M7 4h10a1 1 0 011 1v16l-6-3.5L6 21V5a1 1 0 011-1z"/></>,
    layers: <><path d="M12 3l9 5-9 5-9-5z" fill="currentColor" opacity=".16" stroke="none"/><path d="M12 3l9 5-9 5-9-5z"/><path d="M4 12l8 4.5 8-4.5"/><path d="M4 16l8 4.5 8-4.5"/></>,
    archiveBox: <><path d="M4 8h16v12H4z" fill="currentColor" opacity=".14" stroke="none"/><path d="M3 5h18v3H3z"/><path d="M4 8h16v12H4z"/><path d="M9 12h6"/></>,
    warning: <><path d="M12 3l10 18H2z" fill="currentColor" opacity=".14" stroke="none"/><path d="M12 3l10 18H2z"/><path d="M12 9v5M12 17h.01"/></>,
    route: <><path d="M6 6h7a4 4 0 010 8H9a3 3 0 000 6h9"/><circle cx="6" cy="6" r="3" fill="currentColor" opacity=".16"/><circle cx="18" cy="20" r="3" fill="currentColor" opacity=".16"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="20" r="3"/></>,
    users: <><path d="M9 11a4 4 0 100-8 4 4 0 000 8zM17 10a3 3 0 100-6 3 3 0 000 6z" fill="currentColor" opacity=".14" stroke="none"/><circle cx="9" cy="7" r="4"/><path d="M2.5 21a6.5 6.5 0 0113 0"/><path d="M15 11a5.5 5.5 0 016.5 5.4V21"/><circle cx="17" cy="7" r="3"/></>,
    legalShield: <><path d="M12 2l9 4v6c0 5-3.5 9.7-9 10-5.5-.3-9-5-9-10V6z" fill="currentColor" opacity=".14" stroke="none"/><path d="M12 2l9 4v6c0 5-3.5 9.7-9 10-5.5-.3-9-5-9-10V6z"/><path d="M8 12l3 3 6-6"/></>,
    paymentCard: <><rect x="3" y="5" width="18" height="14" rx="2" fill="currentColor" opacity=".14" stroke="none"/><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M8 15h3M15 15h2"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    box: <><path d="M2 9l10-6 10 6-10 6z"/><path d="M2 9v6l10 6 10-6V9"/></>,
    list: <><path d="M3 6h18M3 12h18M3 18h12"/></>,
    pin: <><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1118 0z"/><circle cx="12" cy="10" r="3"/></>,
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>,
    file: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></>,
    refresh: <><path d="M20 6v6h-6"/><path d="M4 18v-6h6"/><path d="M19 12a7 7 0 00-12.2-4.7L4 12"/><path d="M5 12a7 7 0 0012.2 4.7L20 12"/></>,
    check: <><path d="M20 6L9 17l-5-5"/></>,
    alert: <><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></>,
    arrow: <><path d="M3 12h18M13 5l7 7-7 7"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    card: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></>,
    message: <><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></>,
    trend: <><path d="M3 3v18h18"/><path d="M7 14l3-3 4 4 5-7"/></>,
    shield: <><path d="M12 2l9 4v6c0 5-3.5 9.7-9 10-5.5-.3-9-5-9-10V6z"/></>,
    chat: <><path d="M21 11.5a8.5 8.5 0 01-15.4 5.1L3 21l4.4-2.6A8.5 8.5 0 1121 11.5z"/></>,
    user: <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    chevron: <><path d="M9 6l6 6-6 6"/></>,
    chevronDown: <><path d="M6 9l6 6 6-6"/></>,
    chevronUp: <><path d="M6 15l6-6 6 6"/></>,
    x: <><path d="M18 6L6 18M6 6l12 12"/></>,
    filter: <><path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3z"/></>,
    upload: <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></>,
    download: <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></>,
    camera: <><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></>,
    rupee: <><path d="M6 3h12M6 8h12M6 13l5 8M13 3a5 5 0 010 10H6"/></>,
    activity: <><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></>,
    folder: <><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></>,
    home: <><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2h-4v-7H9v7H5a2 2 0 01-2-2z"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style}>
      {paths[name] || null}
    </svg>
  );
}
