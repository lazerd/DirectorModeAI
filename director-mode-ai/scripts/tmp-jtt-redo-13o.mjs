// 13O: check out Griffin White + Everett Johnson (-> 12 players), then re-assign
// Round 1 (fresh) and Round 2 (avoids R1). Dry by default; --apply to write.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const LEAGUE = '06a4c86d-2c15-45a4-abb2-6ca595776a28';
const REMOVE = ['griffin white', 'everett johnson'];

const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const norm = (s) => (s || '').trim().toLowerCase();

function assignMashup(roundLines, available, priorLines) {
  const lad = (r) => r.ladder_position ?? 9999;
  const pk = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const faced = new Set();
  for (const l of priorLines) { const hs = [l.home_player1_id, l.home_player2_id].filter(Boolean); const as = [l.away_player1_id, l.away_player2_id].filter(Boolean); for (const h of hs) for (const a of as) faced.add(pk(h, a)); }
  const hasFaced = (x, y) => faced.has(pk(x, y));
  let pool = available.filter((r) => r.status === 'active').sort((a, b) => lad(a) - lad(b) || a.id.localeCompare(b.id));
  const take = (id) => { pool = pool.filter((p) => p.id !== id); };
  const byLine = (a, b) => a.line_number - b.line_number;
  const singles = roundLines.filter((l) => l.line_type === 'singles').sort(byLine);
  const doubles = roundLines.filter((l) => l.line_type === 'doubles').sort(byLine);
  const patches = [];
  const emit = (id, a, b) => patches.push({ id, home_player1_id: a[0]?.id ?? null, home_player2_id: a[1]?.id ?? null, away_player1_id: b[0]?.id ?? null, away_player2_id: b[1]?.id ?? null, counts_for_team: false });
  for (const l of doubles) {
    const byClub = new Map();
    for (const r of pool) { const arr = byClub.get(r.club_id) || []; arr.push(r); byClub.set(r.club_id, arr); }
    const cwp = [...byClub.entries()].filter(([, a]) => a.length >= 2).sort((x, y) => y[1].length - x[1].length || lad(x[1][0]) - lad(y[1][0]));
    let A, B;
    if (cwp.length >= 2) { A = cwp[0][1].slice(0, 2); const o = cwp.slice(1); const f = o.find(([, a]) => !a.slice(0, 2).some((p) => A.some((s) => hasFaced(s.id, p.id)))); B = (f || o[0])[1].slice(0, 2); }
    else { const four = pool.slice(0, 4); if (four.length < 4) continue; A = [four[0], four[3]]; B = [four[1], four[2]]; }
    for (const r of [...A, ...B]) take(r.id); emit(l.id, [A[0], A[1]], [B[0], B[1]]);
  }
  for (const l of singles) {
    if (pool.length === 0) { emit(l.id, [undefined, undefined], [undefined, undefined]); continue; }
    const a = pool[0]; take(a.id);
    if (pool.length === 0) { emit(l.id, [a, undefined], [undefined, undefined]); continue; }
    const b = pool.find((r) => r.club_id !== a.club_id && !hasFaced(a.id, r.id)) || pool.find((r) => !hasFaced(a.id, r.id)) || pool.find((r) => r.club_id !== a.club_id) || pool[0];
    take(b.id); emit(l.id, [a, undefined], [b, undefined]);
  }
  // 2-opt repair
  const sp = patches.filter((p) => p.home_player1_id && p.away_player1_id && !p.home_player2_id && !p.away_player2_id);
  for (const p of sp) { if (!hasFaced(p.home_player1_id, p.away_player1_id)) continue; for (const q of sp) { if (q === p) continue; if (!hasFaced(p.home_player1_id, q.away_player1_id) && !hasFaced(q.home_player1_id, p.away_player1_id)) { const t = p.away_player1_id; p.away_player1_id = q.away_player1_id; q.away_player1_id = t; break; } } }
  return patches;
}

async function main() {
  const { data: divs } = await admin.from('league_divisions').select('id, short_code').eq('league_id', LEAGUE);
  const div = divs.find((d) => d.short_code.includes('13'));
  const { data: t } = await admin.from('league_team_matchups').select('id, division_id').eq('match_date', '2026-06-30');
  const mu = t.find((m) => m.division_id === div.id);
  const { data: clubs } = await admin.from('league_clubs').select('id, short_code').eq('league_id', LEAGUE);

  // pool = checked-in players
  const { data: ci } = await admin.from('league_matchup_checkins').select('roster_id').eq('matchup_id', mu.id);
  const { data: roster } = await admin.from('league_team_rosters').select('id, player_name, club_id, ladder_position, status').in('id', ci.map((c) => c.roster_id));
  const removeIds = roster.filter((r) => REMOVE.includes(norm(r.player_name))).map((r) => r.id);
  console.log('removing (check out):', roster.filter((r) => removeIds.includes(r.id)).map((r) => r.player_name).join(', ') || 'NONE FOUND');
  const pool = roster.filter((r) => !removeIds.includes(r.id));
  const nm = (id) => (id ? roster.find((p) => p.id === id)?.player_name || id : null);
  console.log('pool now:', pool.length);

  const { data: lines } = await admin.from('league_matchup_lines').select('*').eq('matchup_id', mu.id);
  const r1 = lines.filter((l) => (l.round_number ?? 1) === 1).sort((a, b) => a.line_number - b.line_number);
  const r2 = lines.filter((l) => (l.round_number ?? 1) === 2).sort((a, b) => a.line_number - b.line_number);

  const r1patch = assignMashup(r1.map((l) => ({ ...l, line_type: l.line_type, line_number: l.line_number })), pool, []);
  const r2patch = assignMashup(r2.map((l) => ({ ...l, line_type: l.line_type, line_number: l.line_number })), pool, r1patch);

  const show = (label, lns, patch) => {
    console.log(`\n${label}:`);
    for (const p of patch) { const ln = lns.find((l) => l.id === p.id).line_number; const hs = [p.home_player1_id, p.home_player2_id].filter(Boolean).map(nm); const as = [p.away_player1_id, p.away_player2_id].filter(Boolean).map(nm); console.log(`  C${ln}: ${hs.join('/') || '(empty)'} vs ${as.join('/') || '(empty)'}`); }
  };
  show('Round 1', r1, r1patch);
  show('Round 2', r2, r2patch);
  // rematch check
  const pk = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`); const f1 = new Set();
  for (const p of r1patch) { const hs = [p.home_player1_id, p.home_player2_id].filter(Boolean); const as = [p.away_player1_id, p.away_player2_id].filter(Boolean); for (const h of hs) for (const a of as) f1.add(pk(h, a)); }
  let rm = 0; for (const p of r2patch) { const hs = [p.home_player1_id, p.home_player2_id].filter(Boolean); const as = [p.away_player1_id, p.away_player2_id].filter(Boolean); for (const h of hs) for (const a of as) if (f1.has(pk(h, a))) rm++; }
  console.log(`\nR2 rematches vs R1: ${rm}`);

  if (!APPLY) { console.log('\nDRY-RUN — pass --apply.'); return; }
  if (removeIds.length) await admin.from('league_matchup_checkins').delete().eq('matchup_id', mu.id).in('roster_id', removeIds);
  for (const [lns, patch] of [[r1, r1patch], [r2, r2patch]]) {
    await admin.from('league_matchup_lines').update({ home_player1_id: null, home_player2_id: null, away_player1_id: null, away_player2_id: null }).in('id', lns.map((l) => l.id));
    for (const p of patch) await admin.from('league_matchup_lines').update({ home_player1_id: p.home_player1_id, home_player2_id: p.home_player2_id, away_player1_id: p.away_player1_id, away_player2_id: p.away_player2_id, counts_for_team: p.counts_for_team }).eq('id', p.id);
  }
  console.log('\nAPPLIED.');
}
main().catch((e) => { console.error('ERR', e.stack); process.exit(1); });
