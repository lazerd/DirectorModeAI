import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// GET/POST the caller's total-comp profile. The full package the 990 can't see.
const DEPTS = new Set(['Tennis/Racquets', 'Golf', 'GM']);

const REGION: Record<string, string> = {};
for (const s of 'CT ME MA NH RI VT NJ NY PA'.split(' ')) REGION[s] = 'Northeast';
for (const s of 'IL IN MI OH WI IA KS MN MO NE ND SD'.split(' ')) REGION[s] = 'Midwest';
for (const s of 'DE FL GA MD NC SC VA DC WV AL KY MS TN AR LA OK TX'.split(' ')) REGION[s] = 'South';
for (const s of 'AZ CO ID MT NV NM UT WY AK CA HI OR WA'.split(' ')) REGION[s] = 'West';

const int = (v: any) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data } = await supabase.from('benchmark_profiles').select('*').eq('profile_id', user.id).maybeSingle();
  return NextResponse.json({ profile: data || null });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const b = await req.json().catch(() => ({}));
  const dept = String(b.dept || '');
  if (!DEPTS.has(dept)) return NextResponse.json({ error: 'invalid dept' }, { status: 400 });

  const base = int(b.base_comp);
  const bonus = int(b.bonus), housing = int(b.housing), auto = int(b.auto), dues = int(b.dues);
  const healthcare = int(b.healthcare), retirement = int(b.retirement), other = int(b.other_amount);
  const total = base + bonus + housing + auto + dues + healthcare + retirement + other;
  const state = b.state ? String(b.state).toUpperCase().slice(0, 2) : null;

  const row = {
    profile_id: user.id,
    claimed_ein: b.claimed_ein ? String(b.claimed_ein) : null,
    ninety_base: Number.isFinite(Number(b.ninety_base)) ? Math.round(Number(b.ninety_base)) : null,
    full_name: b.full_name ? String(b.full_name) : (user.user_metadata?.full_name ?? null),
    club_name: b.club_name ? String(b.club_name) : null,
    dept, state, region: state ? (REGION[state] || null) : null,
    base_comp: base, bonus, housing, auto, dues, healthcare, retirement,
    other_amount: other, other_notes: b.other_notes ? String(b.other_notes) : null,
    vacation_weeks: Number.isFinite(Number(b.vacation_weeks)) ? Math.round(Number(b.vacation_weeks)) : null,
    severance_months: Number.isFinite(Number(b.severance_months)) ? Math.round(Number(b.severance_months)) : null,
    total_package: total,
    is_public: b.is_public !== false,
  };

  const svc = await createServiceClient();
  const { data, error } = await svc.from('benchmark_profiles').upsert(row, { onConflict: 'profile_id' }).select('*').single();
  if (error || !data) return NextResponse.json({ error: error?.message || 'save failed' }, { status: 500 });
  return NextResponse.json({ profile: data });
}
