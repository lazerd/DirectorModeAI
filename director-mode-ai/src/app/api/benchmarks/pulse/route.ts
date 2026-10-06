import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import rawData from '@/app/benchmarks/_data/benchmarks.json';
import { summarize, type BenchmarkRow } from '@/lib/benchmarks/aggregate';
import { normalizePulse, pulseResults, type PulseRow } from '@/lib/benchmarks/pulse';

// Director Pulse: give-to-get. Anyone can see how many pros have shared and
// the public 990 baseline; the blinded results come back only to a signed-in
// user who has a row of their own. Rows themselves never leave the server —
// the admin client reads them (RLS would scope a user to their own row) and
// pulseResults() reduces them to suppressed, rounded statistics.

export const dynamic = 'force-dynamic';

const FIELDS =
  'role, club_type, size_band, state, region, years_band, employment, base_salary, bonus, total_income, ' +
  'private_rate, private_share_pct, clinic_price_hr, clinic_pay_model, clinic_pay_value, junior_price_hr, ' +
  'stringing, teaching_hours_wk, health_insurance, retirement_match';

const s990 = summarize(
  (rawData as BenchmarkRow[]).filter((r) => r.recent && r.dept === 'Tennis/Racquets'),
);
const ninetySeed = s990 && { n: s990.n, median: s990.median, p25: s990.p25, p75: s990.p75 };

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from('director_pulse').select(`profile_id, ${FIELDS}`);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const all = (data || []) as unknown as (PulseRow & { profile_id: string })[];
  const mine = user ? all.find((r) => r.profile_id === user.id) ?? null : null;
  const strip = ({ profile_id: _p, ...r }: PulseRow & { profile_id: string }) => r as PulseRow;

  return NextResponse.json({
    signedIn: !!user,
    contributors: all.length,
    ninetySeed,
    mine: mine ? strip(mine) : null,
    results: mine ? pulseResults(all.map(strip), strip(mine)) : null,
  });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in to share your numbers.' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = normalizePulse(body);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { error } = await getSupabaseAdmin()
    .from('director_pulse')
    .upsert({ profile_id: user.id, ...parsed.row }, { onConflict: 'profile_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
