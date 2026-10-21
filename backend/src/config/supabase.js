/**
 * backend/src/config/supabase.js
 *
 * Supabase client singleton for the Express backend.
 *
 * Uses the SERVICE ROLE key (bypasses Row Level Security) so the backend
 * can read/write any row on behalf of any user — the JWT-based authMiddleware
 * handles authorisation at the Express level, exactly as before with MongoDB.
 *
 * NEVER expose SUPABASE_SERVICE_ROLE_KEY to the frontend. It is only read
 * server-side via process.env.
 */

import { createClient } from '@supabase/supabase-js';

const url  = process.env.SUPABASE_URL;
const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('❌ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in .env');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: {
    // We manage our own JWT tokens; disable Supabase Auth session management.
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

export default supabase;
