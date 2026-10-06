import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { MIN_GROUP_SIZE } from '@/lib/benchmarks/aggregate';

// GET — anonymous aggregate of the total-comp dataset (the moat's proof point):
// how much the real package runs above the public 990 base, by department.
// PII-stripped; service-role read of medians/counts only.
const median = (a: number[]) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);

export async function GET() {
  // Admin client, not createServiceClient(): that one forwards a signed-in
  // user's cookie, so RLS would limit the medians to their own row.
  const svc = getSupabaseAdmin();
  const { data } = await svc
    .from('benchmark_profiles')
    .select('dept, total_package, ninety_base')
    .eq('is_public', true);

  const rows = (data || []).filter((r) => r.total_package && r.total_package > 0);
  const byDept: Record<string, { n: number; medianTotal: number | null; medianPremiumPct: number | null }> = {};
  for (const dept of ['Tennis/Racquets', 'Golf', 'GM']) {
    const d = rows.filter((r) => r.dept === dept);
    const totals = d.map((r) => r.total_package as number);
    const premiums = d
      .filter((r) => r.ninety_base && r.ninety_base > 0)
      .map((r) => ((r.total_package as number) - (r.ninety_base as number)) / (r.ninety_base as number));
    byDept[dept] = {
      n: d.length,
      // A median of one or two people is just their package, so hold it back.
      medianTotal: totals.length >= MIN_GROUP_SIZE ? median(totals) : null,
      medianPremiumPct: premiums.length >= MIN_GROUP_SIZE ? median(premiums) : null,
    };
  }

  return NextResponse.json({ total: rows.length, byDept });
}
