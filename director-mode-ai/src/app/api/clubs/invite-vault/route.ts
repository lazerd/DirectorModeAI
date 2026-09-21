/**
 * Invite existing PlayerVault players to become club members by email.
 *  GET  -> { club, players: [{id, full_name, email}] } (the owner's vault w/ emails)
 *  POST { ids } -> emails each the club join link. Respects the club email cap.
 * Owner-only.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendBilledEmail } from '@/lib/email';
import { CreditLimitError } from '@/lib/billing';
import { blockIfDemo } from '@/lib/demo/server';

import { APP_URL } from '@/lib/appUrl';
const BASE = APP_URL;

async function ownerClub(userId: string) {
  const admin = getSupabaseAdmin();
  // limit(1) before maybeSingle: without it this THROWS the moment a user owns
  // two clubs, rather than picking one. Every other club lookup already does
  // this; this one and /api/me/onboarding were the two that did not.
  const { data: club } = await admin
    .from('cc_clubs')
    .select('id, name, join_code')
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return club;
}

export async function GET() {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const club = await ownerClub(user.id);
  if (!club) return NextResponse.json({ club: null, players: [] });
  const admin = getSupabaseAdmin();
  const { data: players } = await admin
    .from('cc_vault_players')
    .select('id, full_name, email')
    .eq('director_id', user.id)
    .not('email', 'is', null)
    .order('full_name');
  return NextResponse.json({ club: { name: club.name, join_code: club.join_code }, players: players || [] });
}

export async function POST(req: Request) {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const demo = await blockIfDemo(user.id);
  if (demo) return demo;
  const club = await ownerClub(user.id);
  if (!club) return NextResponse.json({ error: 'No club to invite to' }, { status: 400 });

  const { ids } = await req.json().catch(() => ({}));
  if (!Array.isArray(ids) || ids.length === 0) return NextResponse.json({ error: 'No players selected' }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: players } = await admin
    .from('cc_vault_players')
    .select('id, full_name, email')
    .eq('director_id', user.id)
    .in('id', ids)
    .not('email', 'is', null);

  const joinUrl = `${BASE}/join/${club.join_code}`;
  let sent = 0, capped = false;
  for (const p of players || []) {
    /*
     * Lead with the reason they were invited, not with the software. The old
     * version opened with "your club uses ClubMode to book courts, sign up for
     * lessons and track your development" — true of the product, and no answer
     * at all to "why am I getting this?". What is actually waiting for them is
     * CourtConnect: their own club's members looking for a fourth.
     */
    const first = (p.full_name || '').split(' ')[0] || 'there';
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
        <h2 style="color:#002838;margin:0 0 12px">Come play at ${club.name}</h2>
        <p style="font-size:17px;line-height:1.5">Hi ${first}, members here are using <b>CourtConnect</b> to find players for games &mdash; doubles that needs a fourth, a hit before work, a match at your level.</p>
        <p style="font-size:17px;line-height:1.5">Join and you'll get an email whenever a game fits your level. One tap says yes, one tap says no. You can post your own games that need players too.</p>
        <p style="margin:24px 0"><a href="${joinUrl}" style="display:inline-block;background:#D3FB52;color:#002838;font-weight:700;padding:14px 24px;border-radius:10px;text-decoration:none;font-size:18px">Join ${club.name}</a></p>
        <p style="color:#475569;font-size:15px">It also gets you court booking, class sign-ups and the club calendar. Already have a login? Use club code <b>${club.join_code}</b>.</p>
      </div>`;
    try {
      await sendBilledEmail(user.id, { to: p.email, subject: `${first}, your club is finding you games on CourtConnect`, html });
      sent++;
    } catch (e) {
      if (e instanceof CreditLimitError) { capped = true; break; }
    }
  }
  return NextResponse.json({ sent, capped, total: (players || []).length });
}
