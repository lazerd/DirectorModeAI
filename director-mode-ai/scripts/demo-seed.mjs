/**
 * demo-seed.mjs — stage a complete, mid-flight demo environment.
 *
 * A finished tournament demos flat; the magic is watching it move. This script
 * builds an isolated demo CLUB, owned by an isolated demo USER, filled with
 * events caught mid-action:
 *
 *   • a Team Battle happening "tonight" — teams split, some rounds scored, a
 *     couple still live, walkout songs loaded so the DJ Console makes real sound
 *   • a singles tournament running now — players checked in, round 1 done,
 *     a semifinal in progress, a check-in queue waiting, so the Desk is alive
 *   • a week of real court bookings — camps, clinics, lessons, member time
 *   • a half-built calendar for next year — a school calendar imported and a
 *     handful of events placed
 *
 * It is IDEMPOTENT: every run wipes the demo club's data and rebuilds it fresh.
 * That is also how you RESET between run-throughs — just run it again right
 * before the meeting. It never touches the real Sleepy Hollow club.
 *
 *   node scripts/demo-seed.mjs
 *
 * Everything below CONFIG is safe to edit — most usefully CLUB_NAME, to put the
 * name of the club you're pitching to on the screen.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// ---------------- CONFIG ----------------
const CLUB_NAME = 'Meridian Racquet Club';   // ← rename to the prospect's club
const DEMO_EMAIL = 'demo@coachmode.ai';
const DEMO_PASSWORD = 'ClubModeDemo!2027';   // throwaway pitch account, no real data
const MEMBER_EMAIL = 'member@coachmode.ai';  // log in as this to show the MEMBER side
const MEMBER_PASSWORD = 'ClubModeMember!2027';
const CLUB_TZ = 'America/Los_Angeles';
const TZ_OFFSET = '-07:00';                  // PDT; switch to -08:00 in winter

// ---------------- setup ----------------
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Insert one row and return it, throwing the real DB error instead of null. */
async function ins(table, row) {
  const { data, error } = await db.from(table).insert(row).select('id').single();
  if (error) throw new Error(`${table}: ${error.message}${error.details ? ' — ' + error.details : ''}`);
  return data;
}

const code = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const iso = (d) => d.toISOString().slice(0, 10);
const pick = (arr, n) => arr.slice(0, n);

function dateNDaysOut(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
}
function nextSaturday() {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return iso(d);
}

const WALKOUTS = [
  { title: 'Ride of the Valkyries', artist: 'Wagner', url: 'https://archive.org/download/RideOfTheValkyries_201601/Ride%20of%20the%20Valkyries.mp3' },
  { title: '1812 Overture — Cannon Finale', artist: 'Tchaikovsky', url: 'https://archive.org/download/1812Overture_201912/1812%20Overture%20Finale.mp3' },
  { title: 'Mars, the Bringer of War', artist: 'Holst', url: 'https://archive.org/download/HolstThePlanets_201912/01_Mars_The_Bringer_of_War.mp3' },
  { title: 'In the Hall of the Mountain King', artist: 'Grieg', url: 'https://archive.org/download/grieg_peer_gynt_hall_mountain_king/Hall_of_the_Mountain_King.mp3' },
];

const NAMES = [
  'Marcus Webb', 'Diana Foster', 'Raj Patel', 'Elena Vasquez', 'Tom Bradley', 'Priya Nair',
  'Chris Donovan', 'Aisha Khan', 'Ben Sorensen', 'Grace Lin', 'Marco Rossi', 'Nina Petrova',
  'Sam Whitfield', 'Olivia Reyes', 'Derek Cho', 'Hannah Bauer', 'Leo Marchetti', 'Zoe Adler',
];

async function main() {
  console.log(`\n🎾 Seeding demo environment for "${CLUB_NAME}"\n`);

  // ---- demo user ----
  let userId;
  {
    const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = list?.users?.find((u) => u.email === DEMO_EMAIL);
    if (existing) {
      userId = existing.id;
      await db.auth.admin.updateUserById(userId, { password: DEMO_PASSWORD, email_confirm: true });
      console.log('· demo user exists →', DEMO_EMAIL);
    } else {
      const { data, error } = await db.auth.admin.createUser({
        email: DEMO_EMAIL, password: DEMO_PASSWORD, email_confirm: true,
      });
      if (error) throw error;
      userId = data.user.id;
      console.log('· created demo user →', DEMO_EMAIL);
    }
  }

  // Pro access so every tool is unlocked. The profile row is auto-created by a
  // trigger when the auth user is made; UPDATE it (upsert trips the billing
  // guard). Billing columns only accept writes from the service-role client —
  // which is what this is.
  await db.from('profiles').update({
    full_name: 'Demo Director', organization_name: CLUB_NAME,
    plan_tier: 'pro', subscription_status: 'active',
    current_period_end: new Date(Date.now() + 365 * 864e5).toISOString(),
  }).eq('id', userId);

  // ---- demo club ----
  let clubId;
  {
    const { data: club } = await db.from('cc_clubs').select('id').eq('owner_id', userId).eq('name', CLUB_NAME).maybeSingle();
    if (club) {
      clubId = club.id;
    } else {
      clubId = (await ins('cc_clubs', {
        owner_id: userId, name: CLUB_NAME, slug: slugify(CLUB_NAME) + '-' + code().slice(0, 4).toLowerCase(),
        sports: ['tennis'], is_public: false, timezone: CLUB_TZ, state: 'CA', zip: '94563',
        operating_hours: {}, join_code: code(),
      })).id;
    }
    await db.from('cc_club_members').upsert({ club_id: clubId, user_id: userId, role: 'owner' }, { onConflict: 'club_id,user_id' });
    console.log('· club ready →', CLUB_NAME);
  }

  // ---- a demo MEMBER, to show the member-facing side of the product ----
  {
    const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    let memberId = list?.users?.find((u) => u.email === MEMBER_EMAIL)?.id;
    if (memberId) {
      await db.auth.admin.updateUserById(memberId, { password: MEMBER_PASSWORD, email_confirm: true });
    } else {
      const { data, error } = await db.auth.admin.createUser({
        email: MEMBER_EMAIL, password: MEMBER_PASSWORD, email_confirm: true,
      });
      if (error) throw error;
      memberId = data.user.id;
    }
    await db.from('profiles').update({ full_name: 'Jordan Reeves' }).eq('id', memberId);
    await db.from('cc_club_members').upsert({ club_id: clubId, user_id: memberId, role: 'member' }, { onConflict: 'club_id,user_id' });
    console.log('· demo member →', MEMBER_EMAIL);
  }

  // ---- RESET: wipe prior demo data (children first) ----
  {
    const { data: evs } = await db.from('events').select('id').eq('club_id', clubId);
    const evIds = (evs ?? []).map((e) => e.id);
    if (evIds.length) {
      const { data: rds } = await db.from('rounds').select('id').in('event_id', evIds);
      const rdIds = (rds ?? []).map((r) => r.id);
      if (rdIds.length) await db.from('matches').delete().in('round_id', rdIds);
      await db.from('rounds').delete().in('event_id', evIds);
      await db.from('tournament_matches').delete().in('event_id', evIds);
      await db.from('tournament_entries').delete().in('event_id', evIds);
      await db.from('event_players').delete().in('event_id', evIds);
      await db.from('event_teams').delete().in('event_id', evIds);
      await db.from('events').delete().in('id', evIds);
    }
    await db.from('reservations').delete().eq('club_id', clubId);
    await db.from('courts').delete().eq('club_id', clubId); // after reservations (FK restrict)
    await db.from('players').delete().eq('club_id', clubId);
    const { data: plans } = await db.from('calendar_plans').select('id').eq('club_id', clubId);
    for (const p of plans ?? []) await db.from('calendar_plans').delete().eq('id', p.id);
    await db.from('calendar_constraints').delete().eq('club_id', clubId);
    await db.from('calendar_imports').delete().eq('club_id', clubId);
    console.log('· wiped prior demo data');
  }

  // ---- courts ----
  const courtIds = [];
  {
    for (let i = 1; i <= 8; i++) {
      const c = await ins('courts', {
        club_id: clubId, number: i, name: `Court ${i}`, sports: ['tennis'],
        surface: i <= 6 ? 'hard' : 'clay', indoor: i > 6, status: 'active', display_order: i,
      });
      courtIds.push(c.id);
    }
    console.log('· 8 courts');
  }

  await seedTeamBattle(clubId, userId);
  await seedTournament(clubId, userId);
  await seedCourtSheet(clubId, userId, courtIds);
  await seedCalendar(clubId, userId);

  const base = env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai';
  console.log(`\n✅ Demo ready. Log in for the pitch at ${base}/login\n`);
  console.log(`     DIRECTOR view:  ${DEMO_EMAIL}  /  ${DEMO_PASSWORD}`);
  console.log(`     MEMBER view:    ${MEMBER_EMAIL}  /  ${MEMBER_PASSWORD}  (lands on /member)\n`);
  console.log('   Re-run this script anytime to reset everything to mid-flight.\n');
}

// ============================================================
// Team Battle — tonight, mid-flight, walkouts loaded
// ============================================================
async function seedTeamBattle(clubId, userId) {
  const ev = await ins('events', {
    user_id: userId, club_id: clubId, name: 'Thursday Night Summer Slam',
    event_date: dateNDaysOut(0), start_time: '18:00', event_code: code(),
    slug: 'summer-slam-' + code().slice(0, 4).toLowerCase(),
    match_format: 'team-battle', scoring_format: 'fixed_games', num_courts: 6,
    team_battle_singles_courts: 3, team_battle_doubles_courts: 0,
    public_status: 'running',
  });

  // 12 players, 3 teams of 4, a few with walkout songs.
  const teams = [];
  for (const [name, color] of [['Red', '#ef4444'], ['White', '#e5e7eb'], ['Blue', '#3b82f6']]) {
    const t = await ins('event_teams', { event_id: ev.id, name, color });
    teams.push(t.id);
  }

  const roster = pick(NAMES, 12);
  const playerIds = [];
  for (let i = 0; i < 12; i++) {
    const w = i < WALKOUTS.length ? WALKOUTS[i] : null;
    const p = await ins('players', {
      user_id: userId, club_id: clubId, name: roster[i],
      walkout_song_url: w?.url ?? null, walkout_song_title: w?.title ?? null,
      walkout_song_artist: w?.artist ?? null, walkout_song_start_seconds: 0,
    });
    playerIds.push(p.id);
    await db.from('event_players').insert({
      event_id: ev.id, player_id: p.id, team_id: teams[i % 3],
      strength_order: Math.floor(i / 3) + 1,
      wins: 0, losses: 0, games_won: 0, games_lost: 0, active: true,
    });
  }

  // Round 1 — completed. Round 2 — half live. (Singles: p1 vs p3, winner_team 1|2.)
  const mk = async (roundNum, status, pairs) => {
    const rd = await ins('rounds', { event_id: ev.id, round_number: roundNum, status });
    let court = 1;
    for (const [a, b, s1, s2] of pairs) {
      const winner = s1 === s2 ? null : (s1 > s2 ? 1 : 2);
      await db.from('matches').insert({
        round_id: rd.id, court_number: court++, player1_id: a, player3_id: b,
        team1_score: s1, team2_score: s2, winner_team: winner,
      });
    }
    return rd.id;
  };

  // R1: three singles, all scored.
  await mk(1, 'completed', [
    [playerIds[0], playerIds[1], 6, 3],
    [playerIds[3], playerIds[4], 5, 6],
    [playerIds[6], playerIds[7], 6, 4],
  ]);
  // R2: one scored, two live (0-0, on court now).
  await mk(2, 'in_progress', [
    [playerIds[2], playerIds[5], 6, 2],
    [playerIds[8], playerIds[9], 0, 0],
    [playerIds[10], playerIds[11], 0, 0],
  ]);

  console.log('· Team Battle "Thursday Night Summer Slam" — mid-flight, 4 walkouts loaded');
}

// ============================================================
// Tournament — running now, Desk alive
// ============================================================
async function seedTournament(clubId, userId) {
  const ev = await ins('events', {
    user_id: userId, club_id: clubId, name: 'Fall Member Singles Championship',
    event_date: dateNDaysOut(0), start_time: '09:00', end_date: dateNDaysOut(1),
    event_code: code(), slug: 'fall-singles-' + code().slice(0, 4).toLowerCase(),
    match_format: 'single-elim-singles', scoring_format: 'fixed_games', num_courts: 6,
    public_status: 'running', public_registration: true,
  });

  // 10 entries: 8 in the draw + 2 waiting to check in.
  const roster = pick(NAMES, 10).reverse();
  const entryIds = [];
  for (let i = 0; i < 10; i++) {
    const inDraw = i < 8;
    const e = await ins('tournament_entries', {
      event_id: ev.id, player_name: roster[i], player_email: `player${i}@example.com`,
      seed: inDraw ? i + 1 : null, position: inDraw ? 'in_draw' : 'waitlist',
      checked_in_at: inDraw && i < 6 ? new Date().toISOString() : null,
      composite_rating: 4.5 - i * 0.1,
    });
    entryIds.push(e.id);
  }
  const E = entryIds;

  // 8-player single elim. player1_id = side a, player3_id = side b.
  const m = async (round, slot, a, b, opts = {}) => {
    const d = await ins('tournament_matches', {
      event_id: ev.id, bracket: 'main', round, slot, match_type: 'singles',
      player1_id: a, player3_id: b, court: opts.court ?? null,
      score: opts.score ?? null, winner_side: opts.winner ?? null,
      status: opts.status ?? 'pending', score_token: code() + code(),
    });
    return d.id;
  };

  // Round 1 — all four complete (one upset). Winners advance into the semis.
  await m(1, 1, E[0], E[7], { score: '6-2', winner: 'a', status: 'completed', court: 1 });
  await m(1, 2, E[3], E[4], { score: '5-7', winner: 'b', status: 'completed', court: 2 }); // 5-seed upsets 4
  await m(1, 3, E[2], E[5], { score: '6-4', winner: 'a', status: 'completed', court: 3 });
  await m(1, 4, E[1], E[6], { score: '6-1', winner: 'a', status: 'completed', court: 4 });

  // Semis — one live on court, one already done.
  await m(2, 1, E[0], E[4], { status: 'in_progress', court: 1 });               // 1 vs 5, playing now
  await m(2, 2, E[2], E[1], { score: '4-6', winner: 'b', status: 'completed', court: 2 }); // 2 beats 3

  // Final — waiting on the live semi.
  await m(3, 1, null, E[1], { status: 'pending' });

  console.log('· Tournament "Fall Member Singles Championship" — R1 done, a semi live, 6/8 checked in');
}

// ============================================================
// CourtSheet — a living week
// ============================================================
async function seedCourtSheet(clubId, userId, courtIds) {
  const rows = [];
  const at = (dayOffset, court, startH, endH, type, title) => {
    const d = dateNDaysOut(dayOffset);
    rows.push({
      club_id: clubId, court_id: courtIds[court], type, source: 'manual',
      title, status: 'confirmed', created_by: userId,
      starts_at: `${d}T${String(startH).padStart(2, '0')}:00:00${TZ_OFFSET}`,
      ends_at: `${d}T${String(endH).padStart(2, '0')}:00:00${TZ_OFFSET}`,
    });
  };

  // Junior camp, mornings, courts 1-4, weekdays 0-4.
  for (let day = 0; day < 5; day++) for (let c = 0; c < 4; c++) at(day, c, 9, 12, 'camp', 'Junior Summer Camp');
  // Adult clinics + lessons + member time across the week.
  at(0, 4, 10, 11, 'lesson', 'Private — Marcus W.');
  at(0, 5, 17, 19, 'member', 'Ladies Doubles');
  at(1, 4, 9, 10, 'lesson', 'Private — Diana F.');
  at(1, 5, 18, 20, 'event', 'Cardio Tennis');
  at(2, 5, 12, 13, 'lesson', 'Junior Dev — Group');
  at(2, 6, 19, 21, 'member', "Men's Night");
  at(3, 4, 8, 9, 'lesson', 'Private — Raj P.');
  at(3, 7, 18, 20, 'event', 'Friday Social');
  at(4, 5, 16, 18, 'member', 'Weekend Warm-up');

  await db.from('reservations').insert(rows);
  console.log(`· CourtSheet — ${rows.length} bookings across the week`);
}

// ============================================================
// CalendarMode — a half-built year
// ============================================================
async function seedCalendar(clubId, userId) {
  const year = new Date().getFullYear() + 1;
  const plan = await ins('calendar_plans', {
    club_id: clubId, owner_id: userId, year, name: `${CLUB_NAME} ${year}`,
    status: 'draft', goals: { events_per_month: 2, min_days_between: 10 },
  });

  // An imported school calendar (so tier 1 shows a chip + conflicts).
  const imp = await ins('calendar_imports', {
    club_id: clubId, plan_id: null, kind: 'pdf', label: 'Lakeside School District ' + year,
    filename: 'lakeside-sd-calendar.pdf', item_count: 6, summary: '6 dates', created_by: userId,
  });

  const con = (title, start, end, impact, tags = []) => ({
    club_id: clubId, plan_id: null, import_id: imp.id, source: 'school',
    title, starts_on: `${year}-${start}`, ends_on: `${year}-${end}`, impact, audience_tags: tags,
  });
  await db.from('calendar_constraints').insert([
    con('Spring Break', '03-23', '03-27', 'favorable', ['family', 'junior']),
    con('Winter Break', '12-21', '12-31', 'heavy', ['family', 'junior', 'adult']),
    con('Finals Week', '01-12', '01-16', 'heavy', ['junior']),
    con('No School — Teacher In-Service', '10-09', '10-09', 'favorable', ['junior', 'family']),
    con('Homecoming', '10-17', '10-17', 'blocking', ['junior', 'family']),
    con('Graduation', '06-06', '06-06', 'blocking', ['junior', 'family']),
  ]);

  // A few events already placed.
  const item = (title, key, dept, dateM, dateD, fee, att, courts) => ({
    plan_id: plan.id, club_id: clubId, title, catalog_key: key, department: dept,
    audience: [], status: 'scheduled', target_date: `${year}-${dateM}-${dateD}`,
    entry_fee_cents: fee, expected_attendance: att, expected_revenue_cents: fee * att,
    courts_needed: courts,
  });
  await db.from('calendar_items').insert([
    item('New Year Hangover Doubles', 'new-years-hangover-doubles', 'tennis', '01', '01', 0, 24, 6),
    item('Sweetheart Mixed Doubles', 'valentines-sweetheart-mixed', 'tennis', '02', '14', 4000, 32, 6),
    item('Stars & Stripes RR + BBQ', 'stars-and-stripes-rr', 'tennis', '07', '04', 4000, 72, 8),
    item('Club Championships', 'club-championships', 'tennis', '09', '12', 5000, 48, 8),
    item('Turkey Shoot', 'turkey-shoot', 'tennis', '11', '21', 2000, 40, 6),
  ]);

  console.log(`· CalendarMode — ${year} plan: school calendar imported + 5 events placed`);
}

main().catch((e) => { console.error('\n❌', e.message || e); process.exit(1); });
