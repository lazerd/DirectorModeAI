/**
 * POST /api/season/join/[token] — save a Season Builder answer from the PUBLIC
 * link (newsletter / Constant Contact). The person types name + email; we match
 * them to their PlayerVault row by NAME (email only breaks ties — households
 * share inboxes). A match reuses their invite so the dashboard shows one row
 * per person; no match is kept and flagged for the director.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { CAMPAIGN_COLS, matchVault, parseAnswer, personalLink, publicLink, saveResponse } from '@/lib/seasonBuilder/server';
import { answerSummary } from '@/lib/seasonBuilder/emails';
import { type Campaign, validate } from '@/lib/seasonBuilder/shared';

export async function POST(req: Request, { params }: { params: { token: string } }) {
  if (!/^[a-f0-9]{32}$/.test(params.token)) return NextResponse.json({ error: 'Link not recognized.' }, { status: 404 });
  const db = getSupabaseAdmin();
  const { data: c } = await db.from('sb_campaigns').select(CAMPAIGN_COLS).eq('public_token', params.token).maybeSingle();
  const campaign = c as Campaign | null;
  if (!campaign) return NextResponse.json({ error: 'Link not recognized.' }, { status: 404 });
  if (campaign.status === 'closed') return NextResponse.json({ error: 'Sign-ups are closed.' }, { status: 410 });

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const email = String(body?.email || '').trim().toLowerCase().slice(0, 200);
  if (name.split(' ').length < 2) return NextResponse.json({ error: 'Please enter your first and last name.' }, { status: 400 });
  if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: 'Please enter a valid email.' }, { status: 400 });

  const answer = parseAnswer(body);
  const bad = validate(campaign, answer);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });

  const vault = await matchVault(db, campaign.club_id, name, email);
  type Invite = { id: string; token: string };
  let invite: Invite | null = null;
  if (vault) {
    const { data } = await db.from('sb_invites').select('id, token').eq('campaign_id', campaign.id).eq('vault_player_id', vault.id).maybeSingle();
    invite = (data as Invite | null) ?? null;
  }

  try {
    const { needs_renewal } = await saveResponse(
      db,
      campaign,
      {
        invite_id: invite?.id ?? null,
        vault_player_id: vault?.id ?? null,
        // The name on file wins for a matched person; the typed one otherwise.
        name: vault?.full_name || name,
        email,
        link: invite ? personalLink(invite.token) : publicLink(params.token),
        source: 'public',
      },
      answer,
    );
    return NextResponse.json({ ok: true, needs_renewal, summary: answerSummary(campaign, answer) });
  } catch (e: any) {
    console.error('[season] public save failed', e?.message);
    return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 });
  }
}
