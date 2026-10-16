/**
 * POST /api/season/[token] — save a Season Builder answer from a personal link.
 * No auth: the token is the credential. Scope (campaign, person) is re-derived
 * from the token on every write; nothing in the body can point elsewhere.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { CAMPAIGN_COLS, parseAnswer, personalLink, saveResponse } from '@/lib/seasonBuilder/server';
import { answerSummary } from '@/lib/seasonBuilder/emails';
import { type Campaign, validate } from '@/lib/seasonBuilder/shared';

export async function POST(req: Request, { params }: { params: { token: string } }) {
  if (!/^[a-f0-9]{32}$/.test(params.token)) return NextResponse.json({ error: 'Link not recognized.' }, { status: 404 });
  const db = getSupabaseAdmin();
  const { data: invite } = await db
    .from('sb_invites')
    .select('id, campaign_id, vault_player_id, name, email')
    .eq('token', params.token)
    .maybeSingle();
  if (!invite) return NextResponse.json({ error: 'Link not recognized.' }, { status: 404 });
  const { data: c } = await db.from('sb_campaigns').select(CAMPAIGN_COLS).eq('id', invite.campaign_id).maybeSingle();
  const campaign = c as Campaign | null;
  if (!campaign) return NextResponse.json({ error: 'Link not recognized.' }, { status: 404 });
  if (campaign.status === 'closed') return NextResponse.json({ error: 'Sign-ups are closed.' }, { status: 410 });

  const answer = parseAnswer(await req.json().catch(() => ({})));
  const bad = validate(campaign, answer);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });

  try {
    const { needs_renewal } = await saveResponse(
      db,
      campaign,
      { invite_id: invite.id, vault_player_id: invite.vault_player_id, name: invite.name, email: invite.email, link: personalLink(params.token), source: 'invite' },
      answer,
    );
    return NextResponse.json({ ok: true, needs_renewal, summary: answerSummary(campaign, answer) });
  } catch (e: any) {
    console.error('[season] save failed', e?.message);
    return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 });
  }
}
