import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { pickPrimaryClub } from '@/lib/clubRoles';
import { TOURNAMENT_FORMATS } from '@/lib/eventCategory';
import {
  CalendarDays, LayoutGrid, GraduationCap, User, ArrowRight, Trophy, Ticket, MapPin,
} from 'lucide-react';

// The member's front door.
//
// Directors get an operating system; members get a clubhouse. This is that
// clubhouse: what's happening at the club this week, one tap to book a court,
// and a way into their lessons and progress. Warm and simple on purpose — a
// member is here to play, not to administer.
//
// Members are redirected here by middleware from any director surface.

export const dynamic = 'force-dynamic';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function publicHref(e: { match_format: string | null; slug: string | null; event_code: string | null }): string {
  if (e.match_format === 'quads' && e.slug) return `/quads/${e.slug}`;
  if (e.match_format && TOURNAMENT_FORMATS.has(e.match_format) && e.slug) return `/tournaments/${e.slug}`;
  return `/event/${e.event_code}`;
}

function dayLabel(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow]} ${MONTHS[m - 1]} ${d}`;
}

export default async function MemberHome() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/member');

  const admin = getSupabaseAdmin();

  // A director who lands here belongs on the director home.
  const { data: owned } = await admin.from('cc_clubs').select('id').eq('owner_id', user.id).limit(1).maybeSingle();
  if (owned) redirect('/');

  /**
   * Deterministic when someone belongs to more than one club: the same person
   * lands on the same club home every time, rather than whichever row the
   * database happened to return first.
   */
  const { data: memberships } = await admin
    .from('cc_club_members')
    .select('role, club_id, created_at')
    .eq('user_id', user.id);
  const primaryClubId = pickPrimaryClub(
    (memberships as { club_id: string; role: string; created_at: string }[]) || [],
    null,
  );
  const membership =
    ((memberships as { club_id: string; role: string }[]) || []).find(
      (m) => m.club_id === primaryClubId,
    ) || null;

  // Not a member of any club — nothing to show them here.
  if (!membership) redirect('/');

  const { data: club } = await admin
    .from('cc_clubs')
    .select('id, name, slug, owner_id, logo_url, city, state')
    .eq('id', membership.club_id)
    .maybeSingle();
  if (!club) redirect('/');

  const { data: profile } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
  const firstName = (profile?.full_name || '').trim().split(/\s+/)[0] || null;

  // What's on — upcoming public events at the club. Scoped by club_id OR the
  // owner's user_id, since older events predate the club_id column.
  const today = new Date();
  const from = new Date(today.getTime() - 2 * 864e5).toISOString().slice(0, 10);
  const { data: events } = await admin
    .from('events')
    .select('id, name, event_date, start_time, event_code, slug, match_format, public_status, entry_fee_cents')
    .or(`club_id.eq.${club.id},user_id.eq.${club.owner_id}`)
    .in('public_status', ['open', 'running', 'completed'])
    .gte('event_date', from)
    .order('event_date', { ascending: true })
    .limit(6);

  // Does the club publish a full-year calendar members can browse?
  const { data: pubPlan } = await admin
    .from('calendar_plans')
    .select('year')
    .eq('club_id', club.id)
    .eq('status', 'published')
    .order('year', { ascending: false })
    .limit(1)
    .maybeSingle();

  const upcoming = (events ?? []) as any[];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* hero */}
      <header className="bg-gradient-to-br from-sky-600 to-cyan-700 text-white">
        <div className="max-w-3xl mx-auto px-5 py-10">
          {club.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={club.logo_url} alt="" className="h-12 mb-4 object-contain" />
          )}
          <p className="text-sm/6 text-sky-100">
            {firstName ? `Welcome back, ${firstName}.` : 'Welcome back.'}
          </p>
          <h1 className="text-3xl font-bold mt-1">{club.name}</h1>
          {(club.city || club.state) && (
            <p className="text-sky-100 text-sm mt-1 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" /> {[club.city, club.state].filter(Boolean).join(', ')}
            </p>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-8 space-y-8">
        {/* quick actions */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Action href={`/courtsheet/${club.slug}`} icon={LayoutGrid} label="Book a court" tone="#0891b2" />
          <Action href="/client/dashboard" icon={GraduationCap} label="My lessons" tone="#7c3aed" />
          <Action href="/find-coach" icon={User} label="Find a coach" tone="#ea580c" />
          <Action href="/client/dashboard" icon={Trophy} label="My progress" tone="#ca8a04" />
        </div>

        {/* what's on */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-cyan-600" /> Happening at the club
            </h2>
            {pubPlan && (
              <Link href={`/calendar/${club.slug}?year=${pubPlan.year}`} className="text-sm text-cyan-700 hover:underline">
                Full {pubPlan.year} calendar →
              </Link>
            )}
          </div>

          {upcoming.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-500">
              <CalendarDays className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Nothing on the schedule right now. Check back soon.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {upcoming.map((e) => (
                <Link key={e.id} href={publicHref(e)}
                      className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 hover:border-cyan-300 hover:shadow-sm transition">
                  <div className="text-center shrink-0 w-14">
                    <div className="text-xs uppercase text-slate-400">{dayLabel(e.event_date).split(' ')[0]}</div>
                    <div className="text-2xl font-bold text-cyan-700">{Number(e.event_date.slice(8, 10))}</div>
                    <div className="text-[11px] text-slate-400">{MONTHS[Number(e.event_date.slice(5, 7)) - 1]}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{e.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-3">
                      {e.start_time && <span>{time12(e.start_time)}</span>}
                      <span>{e.entry_fee_cents ? `$${(e.entry_fee_cents / 100).toFixed(0)}` : 'Free'}</span>
                      {e.public_status === 'running' && <span className="text-emerald-600 font-medium">Live now</span>}
                      {e.public_status === 'completed' && <span className="text-slate-400">Results</span>}
                    </div>
                  </div>
                  <span className="shrink-0 text-cyan-700 flex items-center gap-1 text-sm font-medium">
                    {e.public_status === 'completed' ? 'View' : <><Ticket className="w-4 h-4" /> Sign up</>}
                    <ArrowRight className="w-4 h-4" />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <p className="text-center text-xs text-slate-400 pt-4">
          {club.name} · powered by ClubMode
        </p>
      </main>
    </div>
  );
}

function Action({ href, icon: Icon, label, tone }: {
  href: string; icon: typeof LayoutGrid; label: string; tone: string;
}) {
  return (
    <Link href={href}
          className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col items-center gap-2 text-center hover:shadow-sm hover:border-slate-300 transition">
      <span className="w-10 h-10 rounded-full grid place-items-center" style={{ background: `${tone}15` }}>
        <Icon className="w-5 h-5" style={{ color: tone }} />
      </span>
      <span className="text-sm font-medium text-slate-700">{label}</span>
    </Link>
  );
}

function time12(t: string): string {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  const s = h >= 12 ? 'pm' : 'am';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hr}:${String(m).padStart(2, '0')}${s}` : `${hr}${s}`;
}
