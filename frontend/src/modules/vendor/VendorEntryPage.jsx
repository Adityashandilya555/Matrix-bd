// skipcq: JS-0833
// #/vendor/:code — hand-off from the shared workspace-code box to the vendor
// platform page. It lives outside RequireAuth and the App shell, like
// /login/:code: a vendor has no Matrix account, and this route never reads or
// writes the Matrix token, session or site state.
import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PRODUCT_NAME } from '../../router/routes.js';
import { openVendorPage, vendorPageUrl, vendorWorkspaceFor } from '../../lib/vendorAccess.js';
import '../landing/branded-auth.css';

export default function VendorEntryPage() {
  const { code: rawCode } = useParams();
  const code = (rawCode || '').toUpperCase();
  const navigate = useNavigate();
  const vendor = vendorWorkspaceFor(code);
  const vendorCode = vendor?.code;

  // Keyed on the code string: vendorWorkspaceFor returns a fresh object on
  // every render, so depending on the object would redirect on every render.
  React.useEffect(() => {
    if (vendorCode) openVendorPage();
  }, [vendorCode]);

  if (!vendor) {
    return (
      <div className="bl-shell">
        <div className="bl-card bl-card--narrow">
          <h2 className="bl-title">Vendor workspace not found</h2>
          <p className="bl-sub">
            We couldn&#39;t find a vendor workspace for <strong>{code}</strong>. Double-check the code
            with the team that gave it to you.
          </p>
          <button type="button" className="bl-btn" onClick={() => navigate('/welcome')}>Back to home</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bl-shell">
      <div className="bl-card bl-card--narrow" role="status">
        <h2 className="bl-title">Opening {vendor.name}</h2>
        <p className="bl-sub">Taking you to the vendor fit-out workspace.</p>
        {/* Fallback if the automatic redirect is blocked or slow. */}
        <a className="bl-btn" href={vendorPageUrl()} style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }}>
          Open the vendor workspace
        </a>
      </div>
      <p className="bl-foot">Powered by {PRODUCT_NAME} &middot; {vendor.code}</p>
    </div>
  );
}
