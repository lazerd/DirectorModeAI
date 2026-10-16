/**
 * Season Builder campaigns for the director's active club.
 *   GET  -> { campaigns: [...] }
 *   POST -> create one, prefilled with a winter USTA default the director edits.
 */
import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { CAMPAIGN_COLS } from '@/lib/seasonBuilder/server';
import { defaultLeagues } from '@/lib/seasonBuilder/shared';

export async function GET() {
  const ctx = await requireStaffForClub({ requireWrite: false });
  if ('error' in ctx) return ctx.error;
  const { data } = await ctx.db
    .from('sb_campaigns')
    .select(CAMPAIGN_COLS)
    .eq('club_id', ctx.club.id)
    .order('created_at', { ascending: false });
  return NextResponse.json({ campaigns: data || [] });
}

const isoOrNull = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export async function POST(req: Request) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;
  const body = await req.json().catch(() => ({}));
  const seasonEnd = isoOrNull(body.season_end);
  const { data: me } = await ctx.db.from('profiles').select('full_name').eq('id', ctx.user.id).maybeSingle();
  const { data, error } = await ctx.db
    .from('sb_campaigns')
    .insert({
      club_id: ctx.club.id,
      title: String(body.title || 'USTA Winter Teams').slice(0, 120),
      intro: typeof body.intro === 'string' && body.intro.trim() ? body.intro.trim().slice(0, 1000) : null,
      sign_off: typeof body.sign_off === 'string' && body.sign_off.trim() ? body.sign_off.trim().slice(0, 120) : (me as any)?.full_name || null,
      registration_opens: isoOrNull(body.registration_opens),
      reply_by: isoOrNull(body.reply_by),
      season_start: isoOrNull(body.season_start),
      season_end: seasonEnd,
      leagues: Array.isArray(body.leagues) && body.leagues.length ? body.leagues : defaultLeagues(seasonEnd || ''),
      created_by: ctx.user.id,
    })
    .select(CAMPAIGN_COLS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
}
