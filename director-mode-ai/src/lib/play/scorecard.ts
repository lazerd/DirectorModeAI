import 'server-only';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

/**
 * The /play 30-day scorecard (Kevin Carey, 11/19/26): did organizers create, play and come back?
 * His targets are his own guesses for the experiment, not industry benchmarks.
 * North star = repeat organizers running COMPLETED mixers. Visitors, creates and AI calls don't count.
 */
export const TARGETS = { createRate: 0.8, medianSec: 60, completed: 25, repeatRate: 0.4 } as const;

// Our own test runs: never count them.
const TEST_HOST = /\b(test|demo|qa|e2e)\b/i;
// Link-open tracking started 11/20/26; joins before that have no matching opens.
const OPENS_TRACKED_FROM = '2026-11-20T00:00:00Z';

type Ev = { id: string; host_id: string | null; host_name: string | null; status: string; created_at: string; state: { mixer?: { rounds?: { matches: { scoreA: number | null; scoreB: number | null }[] }[] } } | null };

const scored = (e: Ev) => (e.state?.mixer?.rounds ?? []).some((r) => r.matches.some((m) => m.scoreA != null && m.scoreB != null));

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export async function playScorecard(days = 30) {
  const db = getSupabaseAdmin();
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const [{ data: evs }, { data: rsvps }, { data: an }] = await Promise.all([
    db.from('play_events').select('id, host_id, host_name, status, created_at, state').gte('created_at', since).limit(5000),
    db.from('play_rsvps').select('event_id, is_host, status, created_at').gte('created_at', since).limit(20000),
    db.from('analytics_events').select('event_name, session_id, metadata').in('event_name', ['play_draft', 'play_created', 'play_link_open']).gte('created_at', since).limit(20000),
  ]);

  const events = ((evs ?? []) as Ev[]).filter((e) => !TEST_HOST.test(e.host_name ?? ''));
  const ids = new Set(events.map((e) => e.id));
  const counts = new Map<string, number>();
  for (const r of rsvps ?? []) if (ids.has(r.event_id) && r.status !== 'out') counts.set(r.event_id, (counts.get(r.event_id) ?? 0) + 1);

  // Completed = played: status done, 4+ people, at least one score in.
  const completed = events.filter((e) => e.status === 'done' && (counts.get(e.id) ?? 0) >= 4 && scored(e));

  // Repeat: of organizers with a completed mixer, how many completed 2+.
  const byHost = new Map<string, number>();
  for (const e of completed) { const h = e.host_id || `name:${(e.host_name ?? '').toLowerCase()}`; byHost.set(h, (byHost.get(h) ?? 0) + 1); }
  const organizers = byHost.size;
  const repeaters = [...byHost.values()].filter((n) => n >= 2).length;

  // Funnel, from the page itself.
  const rows = an ?? [];
  const sess = (name: string) => new Set(rows.filter((r) => r.event_name === name).map((r) => r.session_id));
  const drafted = sess('play_draft');
  const created = sess('play_created');
  const createdOfDrafted = [...drafted].filter((s) => created.has(s)).length;
  const secs = rows.filter((r) => r.event_name === 'play_created' && typeof (r.metadata as { ms?: unknown })?.ms === 'number')
    .map((r) => (r.metadata as { ms: number }).ms / 1000).filter((s) => s > 0 && s < 3600);
  const opens = rows.filter((r) => r.event_name === 'play_link_open').length;
  const joins = (rsvps ?? []).filter((r) => ids.has(r.event_id) && !r.is_host && r.status !== 'out' && r.created_at >= OPENS_TRACKED_FROM).length;

  const createRate = drafted.size ? createdOfDrafted / drafted.size : null;
  const medianSec = median(secs);
  const repeatRate = organizers ? repeaters / organizers : null;
  const joinRate = opens ? joins / opens : null;

  // The single thing to look at next.
  let next: string;
  if (!completed.length) next = `No mixer has been played yet (${events.length} created). The first real test: get one of them to "Done" with scores in.`;
  else if (completed.length < TARGETS.completed) next = `${completed.length} of ${TARGETS.completed} real mixers played. Keep recruiting organizers. Every completed one counts more than any new feature.`;
  else if ((repeatRate ?? 0) < TARGETS.repeatRate) next = `Plenty of mixers played, but only ${Math.round((repeatRate ?? 0) * 100)}% of organizers came back. Watch what happens after the first one.`;
  else next = 'Organizers are coming back. Time to ask which of them would pay.';

  return {
    days, since, next,
    created: events.length,
    metrics: [
      { key: 'create', label: 'First-time organizers who finish creating', value: createRate, fmt: 'pct', target: TARGETS.createRate, n: `${createdOfDrafted}/${drafted.size}` },
      { key: 'time', label: 'Median time to create', value: medianSec, fmt: 'sec', target: TARGETS.medianSec, lowerIsBetter: true, n: `${secs.length} timed` },
      { key: 'completed', label: 'Real mixers played (done, 4+ people, scored)', value: completed.length, fmt: 'int', target: TARGETS.completed, n: `${events.length} created` },
      { key: 'repeat', label: 'Organizers who ran 2+ played mixers (north star)', value: repeatRate, fmt: 'pct', target: TARGETS.repeatRate, n: `${repeaters}/${organizers}` },
      { key: 'join', label: 'Invite link opens that turn into joins', value: joinRate, fmt: 'pct', target: null, n: `${joins}/${opens}` },
    ],
  };
}
