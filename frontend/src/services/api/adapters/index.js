// Picks the adapter based on VITE_USE_MOCK env var.
// All service modules import from here, never from mockAdapter or httpAdapter directly.

import * as mock from './mockAdapter.js';
import * as http from './httpAdapter.js';

// Force mock mode off in production builds — a stray VITE_USE_MOCK must never
// leak the mock session / auth bypass into a deploy. (Mock removal planned.)
const USE_MOCK = (import.meta.env.VITE_USE_MOCK === 'true' || import.meta.env.VITE_USE_MOCK === true) && !import.meta.env.PROD;

if (typeof window !== 'undefined') {
  // Log once at startup so developers know which adapter is active.
  console.info(`[adapter] Using ${USE_MOCK ? 'MOCK' : 'HTTP'} adapter. Set VITE_USE_MOCK to switch.`);
}

export const adapter = USE_MOCK ? mock : http;
