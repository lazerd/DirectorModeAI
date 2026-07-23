import { NextResponse } from 'next/server';
import { requireCalendarContext, isAuthError } from '@/lib/calendar/server';

// DELETE /api/calendar/import/[id] — undo an import.
//
// The constraints cascade from calendar_imports, so removing the import record
// removes every row it created. This is why imports are grouped at all: a
// school-calendar PDF that read badly is one click to reverse rather than
// forty rows to hunt down by hand.
export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireCalendarContext({ requirePro: true });
  if (isAuthError(ctx)) return ctx.error;

  const { data: imp } = await ctx.db
    .from('calendar_imports')
    .select('id, item_count, label')
    .eq('id', params.id)
    .eq('club_id', ctx.club.id)
    .maybeSingle();

  if (!imp) return NextResponse.json({ error: 'Import not found.' }, { status: 404 });

  const { error } = await ctx.db
    .from('calendar_imports')
    .delete()
    .eq('id', params.id)
    .eq('club_id', ctx.club.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, removed: (imp as any).item_count ?? 0 });
}
