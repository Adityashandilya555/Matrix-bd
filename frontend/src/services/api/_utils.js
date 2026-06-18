export const toNumberOrNull = (value) =>
  value === '' || value == null ? null : Number(value);
