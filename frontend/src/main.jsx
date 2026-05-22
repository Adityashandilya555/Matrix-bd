import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';

import { SessionProvider } from './state/SessionContext.jsx';
import { SitesProvider } from './state/SitesContext.jsx';
import AppRouter from './router/AppRouter.jsx';
import { configureSupabase } from './services/api/supabaseAuth.js';

// Bootstrap Supabase BEFORE rendering so the HTTP adapter has a token to
// attach on the very first request. configureSupabase() also subscribes to
// auth state changes and keeps the token in sync across sign-in/out/refresh.
const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
if (!USE_MOCK) {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Fail loudly — silent misconfiguration was the #1 anti-pattern we just removed.
    // eslint-disable-next-line no-console
    console.error('[matrix] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are required when VITE_USE_MOCK=false.');
  } else {
    configureSupabase(createClient(url, anonKey, { auth: { persistSession: true } }));
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <SessionProvider>
        <SitesProvider>
          <AppRouter />
        </SitesProvider>
      </SessionProvider>
    </HashRouter>
  </React.StrictMode>
);
