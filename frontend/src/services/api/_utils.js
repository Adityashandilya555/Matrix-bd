// skipcq: JS-0833
export const toNumberOrNull = (value) =>
  value === '' || value == null ? null : Number(value);
