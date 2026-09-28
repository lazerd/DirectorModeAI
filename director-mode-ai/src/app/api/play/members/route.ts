/**
 * GET /api/play/members?club=<id> — the names a poster can pick from when
 * saying who is already playing with them.
 *
 * Signed-in members of that club only, and only names: no email, no phone,
 * no level. The poster is left out.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isCtxError, requireMember } from '@/lib/partnerFinder/actions';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await requireMember(req.nextUrl.searchParams.get('club'));
  if (isCtxError(ctx)) return ctx.error;
  const { data } = await ctx.db
    .from('cc_vault_players')
    .select('id, full_name, membership_status')
    .eq('club_id', ctx.club.id)
    .not('full_name', 'is', null);
  const members = ((data as { id: string; full_name: string; membership_status: string | null }[] | null) ?? [])
    .filter((r) => r.id !== ctx.personId && (r.membership_status ?? 'active') !== 'inactive' && r.full_name.trim())
    .map((r) => ({ id: r.id, name: r.full_name.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ members }, { headers: { 'Cache-Control': 'no-store' } });
}
