// skipcq: JS-0833
// CommercialTermsForm — the commercial terms the post-NSO launch loop renegotiates
// alongside rent: carpet area, CAM, capex, security deposit, brokerage, and the
// rent start date.
//
// These six were captured once in the LOI "Add Details" form and then rendered as
// read-only text for the whole review loop, so a number agreed after NSO could
// never be corrected. They now stage, diff and commit through exactly the same
// machinery as rent: PATCH /launch-approvals/{id}/rent-fields writes the
// launch_approvals staging row, every change lands in the timeline, and only the
// admin's final confirm writes them to site_details.
//
// UNLIKE the rent forms there is no V1/V2 split here. Nothing on this form varies
// by rent type, so one component serves both FEATURE_RENT_V2 states — it just
// takes the caller's `tokens` (ZM_TOKENS on the BD surface, AC_TOKENS on the
// admin one) so it inherits whichever theme it is dropped into.
//
// readOnly vs rentStartEditable
// -----------------------------
// The two flags are separate because the permission matrices differ. At
// under_exec_review the site creator may set the rent start date and NOTHING else,
// so that surface passes readOnly + rentStartEditable together. The backend gates
// per field regardless (launch_service._assert_may_edit); this only keeps the UI
// from offering an edit that would 422.
//
// COMMENT STYLE: line comments only, no JSDoc blocks — DeepSource's JavaScript
// analyzer parses a new file containing a JSDoc block as a script rather than a
// module and reports JS-0833 at the first import/export, which skipcq cannot
// suppress because it is a PARSE failure. Same shape as launchRentAdapter.js.
import React from 'react';
import { NumBox, Field } from './RentTermsFormV2.jsx';
import { ZM_TOKENS } from './RentTermsForm.jsx';
import './rent-terms.css';

// A date input styled to match NumBox, which has no date mode. Kept local rather
// than pushed into RentTermsFormV2 because rent_start_date is the only date any
// of these forms collects.
function DateBox({ t, value, onChange, readOnly }) {
  return (
    <div className="rt-field" style={{ display: 'flex', alignItems: 'stretch', height: 38, border: `1px solid ${t.line}`, borderRadius: 6, background: readOnly ? t.surface2 : t.bg, overflow: 'hidden', minWidth: 0 }}>
      <input
        type="date"
        value={value || ''}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value || null)}
        style={{ flex: 1, border: 'none', outline: 'none', padding: '0 10px', background: 'transparent', fontFamily: t.fontMono, fontFeatureSettings: "'tnum' 1", fontSize: 13.5, color: readOnly ? t.fgMuted : t.fg, width: '100%', minWidth: 0 }}
      />
    </div>
  );
}

export default function CommercialTermsForm({
  value = {}, onChange, tokens = ZM_TOKENS, readOnly = false, rentStartEditable = false,
}) {
  const t = tokens;
  const v = value || {};
  const set = (key) => (val) => onChange(key, val);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
      <Field t={t} label="Carpet area">
        <NumBox t={t} value={v.carpet_area_sqft} onChange={set('carpet_area_sqft')}
          suffix="sqft" placeholder="e.g. 1200" readOnly={readOnly} />
      </Field>
      <Field t={t} label="CAM">
        <NumBox t={t} value={v.cam_charges} onChange={set('cam_charges')}
          prefix="₹" placeholder="optional" readOnly={readOnly} />
      </Field>
      <Field t={t} label="Capex">
        <NumBox t={t} value={v.capex} onChange={set('capex')}
          prefix="₹" placeholder="optional" readOnly={readOnly} />
      </Field>
      <Field t={t} label="Security deposit">
        <NumBox t={t} value={v.security_deposit} onChange={set('security_deposit')}
          prefix="₹" placeholder="optional" readOnly={readOnly} />
      </Field>
      <Field t={t} label="Brokerage">
        <NumBox t={t} value={v.brokerage} onChange={set('brokerage')}
          prefix="₹" placeholder="optional" readOnly={readOnly} />
      </Field>
      {/* Required before the admin can commit — the backend 422s a final confirm
          without it — but optional at every earlier stage, so it is not marked
          required here. */}
      <Field t={t} label="Rent start date">
        <DateBox t={t} value={v.rent_start_date} onChange={set('rent_start_date')}
          readOnly={readOnly && !rentStartEditable} />
      </Field>
    </div>
  );
}
