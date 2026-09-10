import type { Metadata } from 'next';
import rawData from './_data/benchmarks.json';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { publicSnapshot, type BenchmarkRow } from '@/lib/benchmarks/aggregate';
import BenchmarksExplorer from './_components/BenchmarksExplorer';
import PublicBenchmarks from './_components/PublicBenchmarks';

// /benchmarks is linked from the public homepage, but the 990 rows name real
// directors next to their pay. So the split happens HERE, on the server:
// signed-in users get the full named table (rows passed as props, so the JSON
// never lands in a static client chunk anyone could fetch); logged-out visitors
// get a server-rendered aggregate view whose HTML carries no names at all.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Club Leadership Comp Benchmarks — ClubMode AI',
  description:
    'Median pay and ranges for Directors of Tennis & Racquets, Directors of Golf and club General Managers — by region, club type and club size — from public IRS Form 990 filings.',
  alternates: { canonical: '/benchmarks' },
};

const DATA = rawData as BenchmarkRow[];

// Owner curation (see /api/benchmarks/removals) applies to the aggregates too,
// so a bogus row the owner hid doesn't skew the public medians.
async function withoutRemovals(rows: BenchmarkRow[]) {
  try {
    const { data, error } = await getSupabaseAdmin().from('benchmark_removals').select('key');
    if (error || !data?.length) return rows;
    const keys = new Set(data.map((x: { key: string }) => x.key));
    return rows.filter((r) => !keys.has(`${r.ein}|*`) && !keys.has(`${r.ein}|${r.name}|${r.year}`));
  } catch {
    return rows;
  }
}

export default async function BenchmarksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) return <BenchmarksExplorer rows={DATA} />;

  return <PublicBenchmarks snapshot={publicSnapshot(await withoutRemovals(DATA))} />;
}
