/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  // Vitest config — dev/test only, does not affect `vite build`.
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    css: false,
    // Pin the real (non-mock) code paths during tests so the suite is
    // deterministic regardless of a developer's local .env.local. With
    // VITE_USE_MOCK=true (an offline-dev setting) guards/session short-circuit,
    // flipping env-dependent tests like guards.test.jsx. CI has no .env.local.
    env: { VITE_USE_MOCK: 'false' },
  },
});
