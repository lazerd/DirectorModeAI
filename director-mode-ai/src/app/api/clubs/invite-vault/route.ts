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

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai';

async function ownerClub(userId: string) {
  const admin = getSupabaseAdmin();
  const { data: club } = await admin.from('cc_clubs').select('id, name, join_code').eq('owner_id', userId).maybeSingle();
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
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto">
        <h2 style="color:#002838">You're invited to ${club.name}</h2>
        <p>Hi ${(p.full_name || '').split(' ')[0] || 'there'}, your club uses <b>ClubMode</b> to book courts, sign up for lessons, and track your development.</p>
        <p><a href="${joinUrl}" style="display:inline-block;background:#D3FB52;color:#002838;font-weight:600;padding:12px 20px;border-radius:10px;text-decoration:none">Join ${club.name}</a></p>
        <p style="color:#667">Or use club code <b>${club.join_code}</b> after signing up.</p>
      </div>`;
    try {
      await sendBilledEmail(user.id, { to: p.email, subject: `Join ${club.name} on ClubMode`, html });
      sent++;
    } catch (e) {
      if (e instanceof CreditLimitError) { capped = true; break; }
    }
  }
  return NextResponse.json({ sent, capped, total: (players || []).length });
}
