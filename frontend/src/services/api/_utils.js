// Shared utility helpers for API modules.

/**
 * Coerce a form-field value to a number, treating empty string and null/undefined
 * as absent (returns null). Used by budget-item serialisers in projectApi,
 * projectExcellenceApi, and financialClosureApi so the helper stays DRY.
 */
export const toNumberOrNull = (value) =>
  value === '' || value == null ? null : Number(value);
