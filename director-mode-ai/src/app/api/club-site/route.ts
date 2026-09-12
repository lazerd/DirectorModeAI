/**
 * GET / PATCH the club's website content.
 *
 * PATCH is a partial merge, because the editor autosaves one section at a
 * time — a body carrying only `hero_headline` is the normal case, not an
 * error. Everything goes through the Zod schema so the editor and the
 * renderer cannot drift apart on jsonb shapes Postgres will never check.
 */

import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { clubSitePatchSchema } from '@/lib/clubSite/schema';

export const dynamic = 'force-dynamic';

/** The row, created empty on first read so the editor always has something. */
async function ensureRow(db: ReturnType<typeof import('@/lib/supabase/admin').getSupabaseAdmin>, clubId: string) {
  const { data } = await db.from('club_site').select('*').eq('club_id', clubId).maybeSingle();
  if (data) return data as Record<string, unknown>;
  const { data: created } = await db
    .from('club_site')
    .insert({ club_id: clubId })
    .select('*')
    .maybeSingle();
  return (created as Record<string, unknown> | null) ?? { club_id: clubId, status: 'draft' };
}

export async function GET() {
  const ctx = await requireStaffForClub();
  if ('error' in ctx) return ctx.error;
  const site = await ensureRow(ctx.db, ctx.club.id);
  return NextResponse.json({
    site,
    club: {
      id: ctx.club.id,
      slug: ctx.club.slug,
      name: ctx.club.name,
      timezone: ctx.club.timezone,
    },
  });
}

export async function PATCH(req: Request) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const parsed = clubSitePatchSchema.safeParse(body);
  if (!parsed.success) {
    // Name the field. "Invalid input" on an autosaving form is untraceable —
    // the director has no idea which of forty fields it objected to.
    const first = parsed.error.issues[0];
    const where = first?.path?.join('.') || 'that field';
    return NextResponse.json(
      { error: `${where}: ${first?.message || 'not valid'}` },
      { status: 400 },
    );
  }

  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 });
  }

  await ensureRow(ctx.db, ctx.club.id);

  // Zod turns an emptied text field into `undefined`, which a Supabase update
  // would simply omit — so the field could never be CLEARED once set. Send the
  // keys the caller actually mentioned, with undefined written back as null.
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(body as Record<string, unknown>)) {
    if (!(key in parsed.data)) continue;
    const value = (parsed.data as Record<string, unknown>)[key];
    patch[key] = value === undefined ? null : value;
  }

  const { data, error } = await ctx.db
    .from('club_site')
    .update(patch)
    .eq('club_id', ctx.club.id)
    .select('*')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, site: data });
}
