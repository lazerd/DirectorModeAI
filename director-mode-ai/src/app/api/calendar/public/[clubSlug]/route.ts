import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { PUBLIC_ITEM_COLUMNS } from '@/lib/calendar/server';
import { buildIcs } from '@/lib/calendar/ics';
import { catalogEntry } from '@/lib/calendar/catalog';

// GET /api/calendar/public/[clubSlug]?year=2027[&format=ics]
//
// The member-facing calendar. No auth: this is the club's published year.
//
// Only a plan with status 'published' is ever served, and only through
// PUBLIC_ITEM_COLUMNS — cost, revenue, staffing and internal notes live on the
// same table and must never leave it. That is why this route names its columns
// explicitly instead of selecting *.
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { clubSlug: string } }) {
  const url = new URL(req.url);
  const year = Number(url.searchParams.get('year')) || new Date().getUTCFullYear();
  const wantsIcs = url.searchParams.get('format') === 'ics';

  const db = getSupabaseAdmin();

  const { data: club } = await db
    .from('cc_clubs')
    .select('id, name, slug, timezone, logo_url, website')
    .eq('slug', params.clubSlug)
    .maybeSingle();

  if (!club) return NextResponse.json({ error: 'Club not found.' }, { status: 404 });

  const { data: plan } = await db
    .from('calendar_plans')
    .select('id, year, name, status')
    .eq('club_id', (club as any).id)
    .eq('year', year)
    .eq('status', 'published')
    .maybeSingle();

  if (!plan) {
    return wantsIcs
      // An empty but valid feed beats a 404: a member who subscribed last year
      // shouldn't see a broken calendar while this year's plan is still draft.
      ? icsResponse(buildIcs([], { calendarName: `${(club as any).name} ${year}` }), (club as any).slug, year)
      : NextResponse.json({ club, plan: null, items: [] });
  }

  const { data: items } = await db
    .from('calendar_items')
    .select(PUBLIC_ITEM_COLUMNS)
    .eq('plan_id', (plan as any).id)
    .not('target_date', 'is', null)
    .in('status', ['scheduled', 'promoted', 'done'])
    .order('target_date', { ascending: true });

  const rows = (items ?? []) as any[];

  if (wantsIcs) {
    const ics = buildIcs(
      rows.map((i) => ({
        uid: `${i.id}@clubmode`,
        summary: i.title,
        description: publicBlurb(i),
        location: (club as any).name,
        start: i.target_date,
        end: i.target_end_date ?? i.target_date,
        startTime: i.start_time ? String(i.start_time).slice(0, 5) : null,
        durationMinutes: i.duration_minutes ?? null,
      })),
      { calendarName: `${(club as any).name} — ${year} Events`, timezone: (club as any).timezone },
    );
    return icsResponse(ics, (club as any).slug, year);
  }

  return NextResponse.json({
    club: {
      name: (club as any).name,
      slug: (club as any).slug,
      logo_url: (club as any).logo_url,
      website: (club as any).website,
      timezone: (club as any).timezone,
    },
    plan: { year: (plan as any).year, name: (plan as any).name },
    items: rows.map((i) => ({ ...i, blurb: publicBlurb(i) })),
  });
}

/** Prefer what the director wrote; fall back to the catalog's description. */
function publicBlurb(i: any): string | null {
  if (i.description) return String(i.description);
  return catalogEntry(i.catalog_key)?.description ?? null;
}

function icsResponse(body: string, slug: string, year: number) {
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${slug}-${year}.ics"`,
      // Calendar clients poll this feed; an hour keeps it fresh without
      // hammering the function on every subscriber's refresh interval.
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
