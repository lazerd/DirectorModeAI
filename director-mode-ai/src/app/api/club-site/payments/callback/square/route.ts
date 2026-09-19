/**
 * GET /api/club-site/payments/callback/square?code&state
 *
 * Where Square sends a club's staff member after they approve ClubMode. Swaps
 * the code for the club's tokens, stores them service-role-only, records the
 * business name and location, and returns them to the payments screen.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { appBase, exchangeCode, merchantProfile, readState } from '@/lib/squareConnect';

export const dynamic = 'force-dynamic';

const back = (q: string) => NextResponse.redirect(`${appBase()}/run/site/payments?${q}`);

export async function GET(req: Request) {
  const url = new URL(req.url);
  // They said no on Square's screen.
  if (url.searchParams.get('error')) return back('square=declined');

  const state = readState(url.searchParams.get('state'));
  const code = url.searchParams.get('code');
  if (!state || !code) return back('square=expired');

  // The same person, on the same club, who started it — so a link from someone
  // else's flow can't attach a Square account to this club.
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return back('square=signin');
  if (ctx.club.id !== state.clubId || ctx.user.id !== state.userId) return back('square=wrongclub');

  try {
    const tok = await exchangeCode(code);
    const profile = await merchantProfile(tok.access_token, tok.merchant_id);
    const db = getSupabaseAdmin();
    await db.from('club_payment_tokens').upsert({
      club_id: state.clubId,
      provider: 'square',
      merchant_id: tok.merchant_id,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token ?? null,
      expires_at: tok.expires_at ?? null,
      updated_at: new Date().toISOString(),
    });
    await db.from('club_payments').upsert(
      {
        club_id: state.clubId,
        provider: 'square',
        provider_status: 'connected',
        provider_account_id: tok.merchant_id,
        provider_location_id: profile.locationId,
        provider_business_name: profile.businessName,
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'club_id' },
    );
    return back('square=connected');
  } catch (e) {
    console.error('[square connect] callback failed', e);
    return back('square=failed');
  }
}
