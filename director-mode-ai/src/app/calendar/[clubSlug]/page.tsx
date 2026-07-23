import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { PUBLIC_ITEM_COLUMNS } from '@/lib/calendar/server';
import { catalogEntry } from '@/lib/calendar/catalog';
import PublicCalendarView from './PublicCalendarView';

// The member-facing published calendar.
//
// Server-rendered and public — members should be able to open this from a
// newsletter link without an account, and search engines should be able to see
// a club's event year.
//
// Only a plan with status 'published' is ever shown, and only through
// PUBLIC_ITEM_COLUMNS: cost, revenue, staffing and internal notes live on the
// same rows and must not leak into a page anyone can load.
export const dynamic = 'force-dynamic';

async function getData(clubSlug: string, year: number) {
  const db = getSupabaseAdmin();

  const { data: club } = await db
    .from('cc_clubs')
    .select('id, name, slug, logo_url, website, timezone')
    .eq('slug', clubSlug)
    .maybeSingle();
  if (!club) return null;

  const { data: plan } = await db
    .from('calendar_plans')
    .select('id, year, name')
    .eq('club_id', (club as any).id)
    .eq('year', year)
    .eq('status', 'published')
    .maybeSingle();

  if (!plan) return { club, plan: null, items: [] as any[] };

  const { data: items } = await db
    .from('calendar_items')
    .select(PUBLIC_ITEM_COLUMNS)
    .eq('plan_id', (plan as any).id)
    .not('target_date', 'is', null)
    .in('status', ['scheduled', 'promoted', 'done'])
    .order('target_date', { ascending: true });

  return { club, plan, items: (items ?? []) as any[] };
}

export async function generateMetadata(
  { params, searchParams }: { params: { clubSlug: string }; searchParams: { year?: string } },
): Promise<Metadata> {
  const year = Number(searchParams.year) || new Date().getFullYear();
  const data = await getData(params.clubSlug, year);
  if (!data) return { title: 'Calendar not found' };
  const name = (data.club as any).name;
  return {
    title: `${name} — ${year} Events`,
    description: `The ${year} event calendar for ${name}.`,
  };
}

export default async function PublicCalendarPage(
  { params, searchParams }: { params: { clubSlug: string }; searchParams: { year?: string } },
) {
  const year = Number(searchParams.year) || new Date().getFullYear();
  const data = await getData(params.clubSlug, year);
  if (!data) notFound();

  const items = data.items.map((i) => ({
    ...i,
    blurb: i.description ?? catalogEntry(i.catalog_key)?.description ?? null,
  }));

  return (
    <PublicCalendarView
      club={data.club as any}
      year={year}
      published={!!data.plan}
      items={items}
    />
  );
}
