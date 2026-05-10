/**
 * Server-side Supabase client using the SERVICE ROLE key.
 *
 * Used ONLY in server routes where we need to bypass RLS — specifically
 * the public league signup flow, which must insert league_entries rows
 * for unauthenticated visitors.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in the environment. Never import
 * this client from a React component — it would leak the service role
 * key into the browser bundle.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// We don't generate Database types for this project, so `createClient<any>`
// keeps the admin client loosely typed instead of inferring `never` for
// tables it can't find in the empty schema. All callers get type-level
// freedom, which is fine here because admin writes are carefully audited.
let adminClient: SupabaseClient<any, 'public', any> | null = null;

export function getSupabaseAdmin(): SupabaseClient<any, 'public', any> {
  if (adminClient) return adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Add it to Vercel env vars ' +
      '(Settings → Environment Variables).'
    );
  }

  adminClient = createClient<any, 'public', any>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      // Next.js App Router caches `fetch()` GETs by default. Supabase-js uses
      // fetch under the hood, so without this every SELECT through the admin
      // client gets cached forever — newly-inserted rows never appear until a
      // redeploy. We never want stale reads on the admin path.
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
    },
  });
  return adminClient;
}
