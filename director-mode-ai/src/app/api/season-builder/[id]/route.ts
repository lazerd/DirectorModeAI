/**
 * One Season Builder campaign.
 *   GET   -> campaign + dashboard (counts, groups, every response) + links
 *   PATCH -> edit title / intro / sign-off / dates / leagues / status
 */
import { NextResponse } from 'next/server';
import { buildGroups, staffCampaign, type ResponseRow } from '@/lib/seasonBuilder/staff';
import { CAMPAIGN_COLS, publicLink, recipients } from '@/lib/seasonBuilder/server';
import { newsletterCopy } from '@/lib/seasonBuilder/emails';
import type { League } from '@/lib/seasonBuilder/shared';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await staffCampaign(params.id, { requireWrite: false });
  if ('error' in ctx) return ctx.error;
  const { db, campaign } = ctx;
  const [{ data: rows }, { count: invited }, { count: sent }, recips] = await Promise.all([
    db.from('sb_responses').select('*').eq('campaign_id', campaign.id).order('updated_at', { ascending: false }),
    db.from('sb_invites').select('id', { count: 'exact', head: true }).eq('campaign_id', campaign.id),
    db.from('sb_invites').select('id', { count: 'exact', head: true }).eq('campaign_id', campaign.id).not('sent_at', 'is', null),
    recipients(db, campaign.club_id),
  ]);
  const responses = (rows || []) as ResponseRow[];
  const yes = responses.filter((r) => r.interested);
  const link = publicLink(campaign.public_token);
  return NextResponse.json({
    campaign,
    links: { public: link, newsletter: newsletterCopy(campaign, link) },
    counts: {
      recipients: recips.length,
      invited: invited ?? 0,
      sent: sent ?? 0,
      answered: responses.length,
      interested: yes.length,
      not_interested: responses.length - yes.length,
      captains: yes.filter((r) => r.role === 'captain').length,
      needs_renewal: yes.filter((r) => r.needs_renewal).length,
      unmatched: responses.filter((r) => !r.vault_player_id).length,
    },
    groups: buildGroups(campaign, responses),
    responses,
  });
}

const isoOrNull = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await staffCampaign(params.id);
  if ('error' in ctx) return ctx.error;
  const b = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof b.title === 'string' && b.title.trim()) patch.title = b.title.trim().slice(0, 120);
  if ('intro' in b) patch.intro = typeof b.intro === 'string' && b.intro.trim() ? b.intro.trim().slice(0, 1000) : null;
  if ('sign_off' in b) patch.sign_off = typeof b.sign_off === 'string' && b.sign_off.trim() ? b.sign_off.trim().slice(0, 120) : null;
  for (const k of ['registration_opens', 'reply_by', 'season_start', 'season_end']) if (k in b) patch[k] = isoOrNull(b[k]);
  if (b.status === 'draft' || b.status === 'sent' || b.status === 'closed') patch.status = b.status;
  if (Array.isArray(b.leagues)) {
    const ok = (b.leagues as League[]).every(
      (l) => l && typeof l.key === 'string' && typeof l.label === 'string' && ['female', 'male', 'mixed'].includes(l.gender)
        && Array.isArray(l.slots) && l.slots.length > 0 && l.slots.every((s) => s === 'day' || s === 'nights_weekends')
        && typeof l.min_age === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(l.valid_through),
    );
    if (!ok) return NextResponse.json({ error: 'Leagues are incomplete.' }, { status: 400 });
    patch.leagues = b.leagues;
  }
  const { data, error } = await ctx.db.from('sb_campaigns').update(patch).eq('id', ctx.campaign.id).select(CAMPAIGN_COLS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
}
