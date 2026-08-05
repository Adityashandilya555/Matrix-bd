export function normalizeAgreementStatus(input) {
  const status = typeof input === 'string' ? input : input?.agreementStatus;
  const agreement = typeof input === 'object' ? input?.agreement : null;

  if (agreement?.registered || status === 'registered') return 'registered';
  if (agreement?.signed || status === 'signed' || status === 'executed') return 'executed';
  return 'pending';
}

export function agreementAllowsLicensing(status) {
  const value = normalizeAgreementStatus(status);
  return value === 'executed' || value === 'registered';
}

export function agreementStatusLabel(status) {
  const value = normalizeAgreementStatus(status);
  if (value === 'executed') return 'Executed';
  if (value === 'registered') return 'Registered';
  return 'Pending';
}

export function agreementSavePayload(status) {
  const value = normalizeAgreementStatus(status);
  return {
    signed: value === 'executed' || value === 'registered',
    registered: value === 'registered',
  };
}
