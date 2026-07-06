// Season-end JTT tournament seeding.
//
// Computes a DIVISION-WIDE regular-season strength ranking (across all clubs)
// from head-to-head results in league_matchup_lines, then — once players have
// signed up + paid — slices the entrants into Compass draws of 8 (A flight =
// top 8 by season strength, B = next 8, C = next 8, ...) and prints/writes the
// seeds.
//
// Why not use league_team_rosters.ladder_position? That column is ranked
// PER CLUB (each club's own 1..N), so it can't order players across clubs.
// This script builds a true cross-club ranking from actual match results.
//
// Usage:
//   node scripts/jtt-tournament-seed.mjs                 # preview all divisions
//   node scripts/jtt-tournament-seed.mjs 12U             # one division, ranking + (if any) entrant flights
//   node scripts/jtt-tournament-seed.mjs 12U --write     # persist seed + flight onto tournament_entries
//
// Ranking key: net wins (W-L) desc -> total wins desc -> win% desc ->
//              per-club ladder_position asc -> name. Unmatched entrants (no
//              season record found by name/email) are seeded last and flagged.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const JTT_LEAGUE_ID = '06a4c86d-2c15-45a4-abb2-6ca595776a28';
const DIV_TO_SLUG = {
  '10U': 'jtt-season-end-10u',
  '12U': 'jtt-season-end-12u',
  '13O': 'jtt-season-end-13o',
  'OPEN': 'jtt-season-end-open',
};

const arg = process.argv[2];
const WRITE = process.argv.includes('--write');
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// --- Load divisions ---
const { data: divisions } = await admin
  .from('league_divisions')
  .select('id, short_code, name, sort_order')
  .eq('league_id', JTT_LEAGUE_ID)
  .order('sort_order');

const targets = arg && !arg.startsWith('--')
  ? divisions.filter((d) => d.short_code === arg.toUpperCase())
  : divisions;

if (targets.length === 0) {
  console.error(`No division matched "${arg}". Options: ${divisions.map((d) => d.short_code).join(', ')}`);
  process.exit(1);
}

for (const div of targets) {
  console.log(`\n========== ${div.name} (${div.short_code}) ==========`);

  // Rosters in this division (name + club + per-club ladder + utr).
  const { data: rosters } = await admin
    .from('league_team_rosters')
    .select('id, player_name, player_email, ladder_position, utr, club_id, league_clubs(short_code)')
    .eq('division_id', div.id);

  const rec = new Map(); // roster_id -> {wins, losses}
  for (const r of rosters) rec.set(r.id, { wins: 0, losses: 0 });

  // All completed lines in this division.
  const { data: matchups } = await admin
    .from('league_team_matchups')
    .select('id')
    .eq('division_id', div.id);
  const matchupIds = (matchups || []).map((m) => m.id);

  if (matchupIds.length) {
    const { data: lines } = await admin
      .from('league_matchup_lines')
      .select('home_player1_id, home_player2_id, away_player1_id, away_player2_id, winner')
      .in('matchup_id', matchupIds)
      .not('winner', 'is', null);

    for (const ln of lines || []) {
      const home = [ln.home_player1_id, ln.home_player2_id].filter(Boolean);
      const away = [ln.away_player1_id, ln.away_player2_id].filter(Boolean);
      const winners = ln.winner === 'home' ? home : away;
      const losers = ln.winner === 'home' ? away : home;
      for (const id of winners) if (rec.has(id)) rec.get(id).wins++;
      for (const id of losers) if (rec.has(id)) rec.get(id).losses++;
    }
  }

  // Division-wide ranking of every rostered player.
  const ranked = rosters
    .map((r) => {
      const { wins, losses } = rec.get(r.id);
      const played = wins + losses;
      return {
        roster_id: r.id,
        name: r.player_name,
        email: r.player_email,
        club: r.league_clubs?.short_code || '?',
        wins, losses, played,
        net: wins - losses,
        winPct: played ? wins / played : 0,
        ladder: r.ladder_position ?? 9999,
        utr: r.utr ?? 0,
      };
    })
    .sort((a, b) =>
      b.net - a.net ||
      b.wins - a.wins ||
      b.winPct - a.winPct ||
      a.ladder - b.ladder ||
      a.name.localeCompare(b.name));

  const byName = new Map(ranked.map((p) => [norm(p.name), p]));
  const byEmail = new Map(ranked.filter((p) => p.email).map((p) => [norm(p.email), p]));
  const rankOf = new Map(ranked.map((p, i) => [p.roster_id, i + 1]));

  // Paid entrants for this division's tournament event, if any yet.
  const slug = DIV_TO_SLUG[div.short_code];
  const { data: ev } = await admin.from('events').select('id').eq('slug', slug).maybeSingle();
  let entries = [];
  if (ev) {
    const { data: es } = await admin
      .from('tournament_entries')
      .select('id, player_name, player_email, position, payment_status')
      .eq('event_id', ev.id)
      .in('position', ['in_draw']);
    entries = es || [];
  }

  if (entries.length === 0) {
    console.log(`No paid entrants yet. Season-strength ranking preview (top 24 of ${ranked.length}):`);
    ranked.slice(0, 24).forEach((p, i) => {
      const flight = String.fromCharCode(65 + Math.floor(i / 8));
      console.log(`  ${String(i + 1).padStart(2)}. [${flight}] ${p.name.padEnd(22)} ${p.club.padEnd(4)} ${p.wins}-${p.losses}`);
    });
    continue;
  }

  // Attach each entrant to their season rank; unmatched go last.
  const seeded = entries.map((e) => {
    const hit = byName.get(norm(e.player_name)) || (e.player_email && byEmail.get(norm(e.player_email)));
    return {
      entry_id: e.id,
      name: e.player_name,
      matched: !!hit,
      club: hit?.club || '—',
      record: hit ? `${hit.wins}-${hit.losses}` : 'no season record',
      seasonRank: hit ? rankOf.get(hit.roster_id) : Infinity,
    };
  }).sort((a, b) => a.seasonRank - b.seasonRank || a.name.localeCompare(b.name));

  console.log(`${seeded.length} paid entrants -> ${Math.ceil(seeded.length / 8)} compass draw(s) of 8:`);
  const updates = [];
  seeded.forEach((s, i) => {
    const flight = String.fromCharCode(65 + Math.floor(i / 8));
    const seedInFlight = (i % 8) + 1;
    updates.push({ id: s.entry_id, seed: i + 1, flight });
    const flag = s.matched ? '' : '  <-- no season match, verify seeding by hand';
    console.log(`  ${flight}${seedInFlight}  ${s.name.padEnd(22)} ${s.club.padEnd(4)} ${s.record}${flag}`);
  });

  if (WRITE) {
    for (const u of updates) {
      await admin.from('tournament_entries')
        .update({ seed: u.seed, notes: `Flight ${u.flight}` })
        .eq('id', u.id);
    }
    console.log(`  -> wrote seed + flight to ${updates.length} entries.`);
  } else {
    console.log('  (preview only — rerun with --write to save seeds onto the entries)');
  }
}

console.log('\nDone.');
