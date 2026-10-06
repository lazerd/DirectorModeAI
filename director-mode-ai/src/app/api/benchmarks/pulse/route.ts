import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { Resend } from 'resend';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { safeResendSend } from '@/lib/emailUnsubscribe';
import rawData from '@/app/benchmarks/_data/benchmarks.json';
import { summarize, type BenchmarkRow } from '@/lib/benchmarks/aggregate';
import { normalizePulse, pulseResults, type PulseRow } from '@/lib/benchmarks/pulse';

// Director Pulse: give-to-get, no sign-in needed. A contributor is recognised
// by their ClubMode login if they have one, otherwise by a private access
// token: set as a cookie on submit and emailed to them as a "your results"
// link, so they can come back on any device as the data fills in.
//
// Rows never leave the server. The admin client reads them (RLS would scope a
// signed-in user to their own row) and pulseResults() reduces them to rounded
// statistics. Email and token are never part of any response but the owner's.

export const dynamic = 'force-dynamic';

const COOKIE = 'pulse_t';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FIELDS =
  'role, club_type, size_band, state, region, years_band, employment, base_salary, bonus, total_income, ' +
  'private_rate, private_share_pct, clinic_price_hr, clinic_pay_model, clinic_pay_value, junior_price_hr, ' +
  'stringing, teaching_hours_wk, health_insurance, retirement_match';

type Stored = PulseRow & { profile_id: string | null; access_token: string; email: string | null };

const s990 = summarize(
  (rawData as BenchmarkRow[]).filter((r) => r.recent && r.dept === 'Tennis/Racquets'),
);
const ninetySeed = s990 && { n: s990.n, median: s990.median, p25: s990.p25, p75: s990.p75 };

const strip = ({ profile_id: _p, access_token: _t, email: _e, ...r }: Stored) => r as PulseRow;

async function caller() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

function setTokenCookie(res: NextResponse, token: string) {
  res.cookies.set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 400 });
}

function resultsLink(req: Request, token: string) {
  return `${new URL(req.url).origin}/benchmarks/pulse?t=${token}`;
}

async function emailLink(to: string, link: string) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  return safeResendSend(resend, {
    from: process.env.RESEND_FROM_EMAIL || 'ClubMode <noreply@mail.clubmode.ai>',
    to,
    subject: 'Your Director Pulse results',
    operational: true,
    html: `<div style="font-family: system-ui, sans-serif; max-width: 520px; color: #0f172a;">
      <p>Thanks for sharing your numbers on Director Pulse.</p>
      <p>This is your private link. Open it any time to see how other pros are paid and how they price lessons and clinics. The numbers update as more pros share.</p>
      <p><a href="${link}" style="color: #0f766e; font-weight: 600;">See the results &rarr;</a></p>
      <p style="color: #64748b; font-size: 13px;">Keep this link to yourself: it's how we know it's you. Your answers are never shown to anyone, only rounded medians and ranges.</p>
    </div>`,
  });
}

export async function GET(req: Request) {
  const user = await caller();
  const jar = await cookies();
  const qToken = new URL(req.url).searchParams.get('t');
  const token = qToken && UUID.test(qToken) ? qToken : jar.get(COOKIE)?.value;

  const { data, error } = await getSupabaseAdmin()
    .from('director_pulse').select(`profile_id, access_token, email, ${FIELDS}`);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const all = (data || []) as unknown as Stored[];
  const mine =
    (user && all.find((r) => r.profile_id === user.id)) ||
    (token && UUID.test(token) && all.find((r) => r.access_token === token)) ||
    null;

  const res = NextResponse.json({
    signedIn: !!user,
    contributors: all.length,
    ninetySeed,
    mine: mine ? strip(mine) : null,
    myEmail: mine?.email ?? user?.email ?? null,
    myLink: mine ? resultsLink(req, mine.access_token) : null,
    results: mine ? pulseResults(all.map(strip), strip(mine)) : null,
  });
  // Opening the emailed link on a new device remembers them there too.
  if (mine && qToken === mine.access_token) setTokenCookie(res, mine.access_token);
  return res;
}

export async function POST(req: Request) {
  const user = await caller();
  const jar = await cookies();
  const body = await req.json().catch(() => ({}));
  const parsed = normalizePulse(body);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const email = (user?.email || String(body.email || '')).trim().toLowerCase();
  if (!EMAIL.test(email)) return NextResponse.json({ error: 'Add your email so we can send your private results link.' }, { status: 400 });

  const admin = getSupabaseAdmin();
  const cookieToken = jar.get(COOKIE)?.value;

  // Find this contributor's existing row: by login, then by their token.
  let existing: { id: string; access_token: string; email: string | null } | null = null;
  if (user) {
    existing = (await admin.from('director_pulse').select('id, access_token, email').eq('profile_id', user.id).maybeSingle()).data;
  }
  if (!existing && cookieToken && UUID.test(cookieToken)) {
    existing = (await admin.from('director_pulse').select('id, access_token, email').eq('access_token', cookieToken).maybeSingle()).data;
  }

  if (!existing) {
    // Someone already shared with this email from another device. Don't let a
    // stranger overwrite them by typing their address — send the owner's link.
    const { data: byEmail } = await admin.from('director_pulse').select('access_token').ilike('email', email).maybeSingle();
    if (byEmail) {
      await emailLink(email, resultsLink(req, byEmail.access_token));
      return NextResponse.json({ error: 'That email has already shared. We just sent its private results link there.' }, { status: 409 });
    }
  }

  const row = { ...parsed.row, email, ...(user ? { profile_id: user.id } : {}) };
  const { data, error } = existing
    ? await admin.from('director_pulse').update(row).eq('id', existing.id).select('access_token').single()
    : await admin.from('director_pulse').insert(row).select('access_token').single();
  if (error || !data) return NextResponse.json({ error: error?.message || 'Save failed.' }, { status: 500 });

  if (!existing) await emailLink(email, resultsLink(req, data.access_token));

  const res = NextResponse.json({ ok: true });
  setTokenCookie(res, data.access_token);
  return res;
}
