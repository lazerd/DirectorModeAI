/** GET -> every answer as CSV, one row per person × league choice. */
import { NextResponse } from 'next/server';
import { staffCampaign, type ResponseRow } from '@/lib/seasonBuilder/staff';
import { SLOT_SHORT, ntrpLabel } from '@/lib/seasonBuilder/shared';

const cell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await staffCampaign(params.id, { requireWrite: false });
  if ('error' in ctx) return ctx.error;
  const { db, campaign } = ctx;
  const { data } = await db.from('sb_responses').select('*').eq('campaign_id', campaign.id).order('name');
  const head = ['Name', 'Email', 'Interested', 'Gender', 'NTRP', 'League', 'Schedule', 'Captain', '40+ confirmed', 'USTA expires', 'Needs USTA renewal', 'Notes', 'Came in via', 'Matched to member', 'Answered'];
  const lines = [head.join(',')];
  for (const r of (data || []) as ResponseRow[]) {
    const base = (league: string, slot: string) => [
      r.name, r.email, r.interested ? 'Yes' : 'No', r.gender === 'female' ? 'Women' : r.gender === 'male' ? 'Men' : '',
      r.interested ? ntrpLabel(r.ntrp) : '', league, slot, r.role === 'captain' ? 'Yes' : r.role === 'play' ? 'No' : '',
      r.age_ok == null ? '' : r.age_ok ? 'Yes' : 'No', r.usta_unknown ? 'Not sure' : r.usta_expires?.slice(0, 7) ?? '',
      r.needs_renewal ? 'Yes' : '', r.notes, r.source === 'public' ? 'Newsletter link' : 'Email', r.vault_player_id ? 'Yes' : 'NO — check',
      r.updated_at?.slice(0, 10),
    ];
    const choices = r.interested ? r.choices || [] : [];
    if (!choices.length) lines.push(base('', '').map(cell).join(','));
    for (const ch of choices) {
      const l = campaign.leagues.find((x) => x.key === ch.league);
      lines.push(base(l?.label ?? ch.league, SLOT_SHORT[ch.slot]).map(cell).join(','));
    }
  }
  const file = `${campaign.title.replace(/[^\w]+/g, '-')}-signups.csv`;
  return new NextResponse(lines.join('\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${file}"` },
  });
}
