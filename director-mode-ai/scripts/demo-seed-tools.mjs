/**
 * demo-seed-tools.mjs — fill the tool areas the main demo-seed leaves empty, so
 * the hype-video walkthrough shows every tool alive: LeagueMode, Lessons/CoachMode,
 * StringingMode, PlayerVault, and CourtConnect. Idempotent (wipes its own demo rows
 * first). Run AFTER demo-seed.mjs:
 *
 *   node scripts/demo-seed-tools.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const DEMO_EMAIL = 'demo@coachmode.ai';
const DEMO_DOMAIN = 'meridian.demo'; // tag rows we own so re-runs stay clean
const CLUB_TZ = 'America/Los_Angeles';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function ins(table, row, sel = 'id') {
  const { data, error } = await db.from(table).insert(row).select(sel).single();
  if (error) throw new Error(`${table}: ${error.message}${error.details ? ' — ' + error.details : ''}`);
  return data;
}
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const at = (n, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d.toISOString(); };

async function main() {
  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  const userId = list?.users?.find((u) => u.email === DEMO_EMAIL)?.id;
  if (!userId) throw new Error('demo user not found — run demo-seed.mjs first');
  const { data: club } = await db.from('cc_clubs').select('id, name').eq('owner_id', userId).limit(1).single();
  const clubId = club.id;
  console.log(`\n🎾 Filling tool demos for "${club.name}"\n`);

  // ---------- LeagueMode ----------
  await db.from('leagues').delete().eq('director_id', userId);
  for (const [name, type, fmt, d0, d1, status] of [
    ['Summer Flex Singles League', 'round_robin', 'individual', iso(-7), iso(35), 'running'],
    ['Fall Ladies Interclub', 'round_robin', 'team', iso(30), iso(110), 'open'],
    ['Wednesday Night Mixed 7.0', 'compass', 'individual', iso(-14), iso(21), 'running'],
  ]) {
    await ins('leagues', { director_id: userId, club_id: clubId, name, slug: slugify(name) + '-' + Math.random().toString(36).slice(2, 6), start_date: d0, end_date: d1, status, league_type: type, format: fmt, description: 'In-house league run in ClubMode.' });
  }
  console.log('· LeagueMode — 3 leagues');

  // ---------- Lessons / CoachMode ----------
  let coach = (await db.from('lesson_coaches').select('id').eq('profile_id', userId).maybeSingle()).data;
  if (!coach) coach = await ins('lesson_coaches', { profile_id: userId, display_name: 'Demo Director', slug: 'demo-director-' + Math.random().toString(36).slice(2, 6), email: DEMO_EMAIL, club_id: clubId });
  const coachId = coach.id;
  // clean prior demo clients/links/slots for this coach
  const priorLinks = (await db.from('lesson_client_coaches').select('client_id').eq('coach_id', coachId)).data || [];
  await db.from('lesson_client_coaches').delete().eq('coach_id', coachId);
  if (priorLinks.length) await db.from('lesson_clients').delete().in('id', priorLinks.map((l) => l.client_id)).like('email', `%@${DEMO_DOMAIN}`);
  await db.from('lesson_slots').delete().eq('coach_id', coachId);
  const CLIENTS = ['Marcus Webb', 'Diana Foster', 'Priya Nair', 'Ben Sorensen', 'Grace Lin', 'Tom Bradley', 'Aisha Khan', 'Leo Marchetti'];
  const clientIds = [];
  for (const name of CLIENTS) {
    const c = await ins('lesson_clients', { name, email: slugify(name) + '@' + DEMO_DOMAIN, phone: '415-555-0' + (100 + clientIds.length) });
    clientIds.push(c.id);
    await db.from('lesson_client_coaches').insert({ client_id: c.id, coach_id: coachId, status: 'approved', approved_at: new Date().toISOString() });
  }
  // slots: two open in the next few days (a cancellation to fill), some booked, one cancelled
  const slots = [
    { start_time: at(1, 16), end_time: at(1, 17), status: 'open', location: 'Court 3' },
    { start_time: at(2, 9), end_time: at(2, 10), status: 'open', location: 'Court 1' },
    { start_time: at(0, 15), end_time: at(0, 16), status: 'booked', location: 'Court 2', booked_by_client_id: clientIds[0], booked_at: new Date().toISOString() },
    { start_time: at(3, 10), end_time: at(3, 11), status: 'booked', location: 'Court 4', booked_by_client_id: clientIds[1], booked_at: new Date().toISOString() },
    { start_time: at(1, 8), end_time: at(1, 9), status: 'cancelled', location: 'Court 1', cancelled_at: new Date().toISOString(), cancellation_reason: 'Player sick — open it up' },
  ];
  for (const s of slots) await db.from('lesson_slots').insert({ coach_id: coachId, ...s });
  // a couple recap notes so CoachMode shows history
  for (let i = 0; i < 3; i++) await db.from('lesson_notes').insert({ coach_id: coachId, client_id: clientIds[i], club_id: clubId, lesson_date: iso(-2 - i), focus_area: ['Serve', 'Backhand', 'Net play'][i], content: 'Worked on ' + ['toss consistency', 'topspin drive', 'volley footwork'][i] + '.', ai_summary: 'Solid progress; keep reps up before next week.' });
  console.log('· Lessons/CoachMode — coach + 8 clients, 5 slots, 3 recaps');

  // ---------- StringingMode ----------
  const custIds = (await db.from('stringing_customers').select('id').eq('user_id', userId)).data || [];
  if (custIds.length) { await db.from('stringing_jobs').delete().in('customer_id', custIds.map((c) => c.id)); await db.from('stringing_customers').delete().eq('user_id', userId); }
  const STR = [['Marcus Webb', 'Luxilon ALU Power 16L', 50, 48, 'done'], ['Diana Foster', 'Wilson NXT 16', 55, 55, 'picked_up'], ['Raj Patel', 'RPM Blast 17', 52, 50, 'in_progress'], ['Elena Vasquez', 'Solinco Hyper-G 16L', 48, 46, 'pending'], ['Ben Sorensen', 'Gut/Poly Hybrid', 58, 54, 'done'], ['Grace Lin', 'Yonex Poly Tour Pro 16', 51, 49, 'pending']];
  for (const [name, str, mt, ct, status] of STR) {
    const c = await ins('stringing_customers', { user_id: userId, club_id: clubId, full_name: name, email: slugify(name) + '@' + DEMO_DOMAIN, phone: '415-555-02' + STR.indexOf(STR.find((x) => x[0] === name)) });
    await db.from('stringing_jobs').insert({ customer_id: c.id, requested_by_user_id: userId, custom_string_name: str, main_tension_lbs: mt, cross_tension_lbs: ct, status, quoted_ready_at: at(status === 'pending' ? 2 : 0, 17), completed_at: status === 'done' || status === 'picked_up' ? new Date().toISOString() : null, picked_up_at: status === 'picked_up' ? new Date().toISOString() : null });
  }
  console.log('· StringingMode — 6 customers + jobs across the pipeline');

  // ---------- PlayerVault ----------
  await db.from('cc_vault_players').delete().eq('director_id', userId);
  const VAULT = [
    ['Marcus Webb', 'male', 42, 4.5, 6.8, 6.2], ['Diana Foster', 'female', 38, 4.0, 5.9, 5.4], ['Raj Patel', 'male', 29, 5.0, 8.1, 7.6],
    ['Elena Vasquez', 'female', 34, 4.5, 6.4, 6.0], ['Tom Bradley', 'male', 51, 3.5, 4.2, 4.0], ['Priya Nair', 'female', 27, 4.5, 7.0, 6.5],
    ['Chris Donovan', 'male', 45, 4.0, 5.5, 5.1], ['Aisha Khan', 'female', 31, 5.0, 8.4, 7.9], ['Ben Sorensen', 'male', 36, 4.5, 6.7, 6.3],
    ['Grace Lin', 'female', 24, 5.5, 9.2, 8.7], ['Marco Rossi', 'male', 40, 4.0, 5.8, 5.5], ['Nina Petrova', 'female', 33, 4.5, 6.9, 6.4],
  ];
  for (const [full_name, gender, age, usta, us, ud] of VAULT) {
    const { error: ve } = await db.from('cc_vault_players').insert({ director_id: userId, full_name, email: slugify(full_name) + '@' + DEMO_DOMAIN, gender, age, usta_rating: usta, utr_singles: us, utr_doubles: ud, utr_rating: us, primary_sport: 'tennis', sports: ['tennis'], rating_source: 'manual', membership_status: 'active' });
    if (ve) throw new Error('cc_vault_players: ' + ve.message);
  }
  console.log('· PlayerVault — 12 players with ratings');

  // ---------- CourtConnect (find a foursome) ----------
  const evs = (await db.from('cc_events').select('id').eq('created_by', userId)).data || [];
  if (evs.length) { await db.from('cc_event_players').delete().in('event_id', evs.map((e) => e.id)); await db.from('cc_events').delete().eq('created_by', userId); }
  const CCE = [
    ['Saturday AM Doubles — need a 4th', 'open_play', iso(2), '08:00', '10:00', 4, 3, 3.5, 4.5, 'open'],
    ['Sunday Mixed Foursome', 'open_play', iso(3), '10:00', '12:00', 4, 2, 3.0, 4.0, 'open'],
    ['Tuesday Night Rally', 'open_play', iso(5), '18:30', '20:00', 8, 5, 3.5, 5.0, 'open'],
    ['Ladies 3.5 Round Robin', 'open_play', iso(6), '09:00', '11:00', 8, 6, 3.0, 4.0, 'open'],
    ['Weekend Warm-up (last week)', 'open_play', iso(-4), '08:00', '10:00', 4, 4, 3.5, 4.5, 'completed'],
  ];
  for (const [title, type, d, s, e, max, filled, mn, mx, status] of CCE) {
    const ev = await ins('cc_events', { created_by: userId, title, event_type: type, sport: 'tennis', event_date: d, start_time: s, end_time: e, timezone: CLUB_TZ, location: club.name, court_count: 1, max_players: max, skill_min: mn, skill_max: mx, is_public: true, status, auto_close: true });
    for (let i = 0; i < filled; i++) await db.from('cc_event_players').insert({ event_id: ev.id, guest_name: ['Marcus W.', 'Diana F.', 'Raj P.', 'Elena V.', 'Tom B.', 'Priya N.'][i] || 'Player', status: 'accepted', response_order: i + 1, responded_at: new Date().toISOString() });
  }
  console.log('· CourtConnect — 5 open-play events with signups');

  console.log('\n✅ Tool demos filled. Re-run anytime to reset.\n');
}
main().catch((e) => { console.error('\n❌', e.message || e); process.exit(1); });
