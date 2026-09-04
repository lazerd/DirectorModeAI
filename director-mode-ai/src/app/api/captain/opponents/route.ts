/**
 * DELETE /api/captain/opponents — remove an opponent from the team's list.
 *
 * The contact-list paste covers a whole section, and a section is far bigger
 * than a flight: Darrin pasted the East Bay sheet for his 12U team and got
 * eight clubs he never plays, with no way to remove any of them. An import that
 * can only ever add is an import a captain stops trusting.
 *
 * The captains hanging off the row go with it (ON DELETE CASCADE). Nothing else
 * references an opponent — captain_matches carries the opponent NAME, so a
 * fixture against a deleted contact is untouched and re-importing restores it.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';

export const dynamic = 'force-dynamic';

export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { team_id?: string; id?: string };

  const ctx = await requireTeam(body.team_id || '');
  if (isError(ctx)) return ctx.error;
  if (!body.id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });

  // Scoped to the team as well as the id: an id alone would let one team delete
  // another team's contact.
  const { error } = await ctx.db
    .from('captain_opponents')
    .delete()
    .eq('id', body.id)
    .eq('team_id', ctx.teamId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
