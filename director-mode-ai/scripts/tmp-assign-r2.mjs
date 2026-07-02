import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const MID='1a874285-bcda-4bf9-bd74-308a5b8f0063';
const { data: mu } = await admin.from('league_team_matchups').select('division_id, home_club_id, away_club_id').eq('id', MID).single();
const { data: ros } = await admin.from('league_team_rosters').select('id, player_name, club_id').eq('division_id', mu.division_id);
const id = (name, club) => { const r = ros.find(x=>x.player_name.toLowerCase()===name.toLowerCase() && x.club_id===(club==='H'?mu.home_club_id:mu.away_club_id)); if(!r){console.log('!! not found:',name,club);} return r?.id||null; };

// Round 2 lines (must be EMPTY — never touch filled ones)
const { data: r2 } = await admin.from('league_matchup_lines').select('*').eq('matchup_id', MID).eq('round_number', 2).order('line_number');
const empty = r2.filter(l => !(l.home_player1_id||l.home_player2_id||l.away_player1_id||l.away_player2_id));
if (empty.length !== r2.length) { console.log('ABORT: some Round 2 lines already have players — not overwriting.'); process.exit(1); }

// strength-balanced, rotates bench (Blake sat R1 -> plays R2; Nora sits R2). R1 singles->doubles, R1 doubles->singles.
const PLAN = [
  { ln:7,  type:'singles', H:['Blake Hong-DiGiovanni'],        A:['Nico'] },
  { ln:8,  type:'singles', H:['Molly Ranzal'],                 A:['Kai'] },
  { ln:9,  type:'singles', H:['Alice Coyle'],                  A:['Whitaker'] },
  { ln:10, type:'singles', H:['Lana Morgan'],                  A:['Alec'] },
  { ln:11, type:'doubles', H:['Adam Souissi','Jacob Chiu'],    A:['Owen King','Jackson'] },
  { ln:12, type:'doubles', H:['Scarlett Harmssen','Cameron Park'], A:['Will','Evan'] },
];
for (const p of PLAN) {
  const line = r2.find(l=>l.line_number===p.ln);
  if (!line) { console.log('!! no line', p.ln); continue; }
  const upd = {
    home_player1_id: id(p.H[0],'H'), home_player2_id: p.H[1]?id(p.H[1],'H'):null,
    away_player1_id: id(p.A[0],'A'), away_player2_id: p.A[1]?id(p.A[1],'A'):null,
  };
  const { error } = await admin.from('league_matchup_lines').update(upd).eq('id', line.id);
  console.log(error ? `L${p.ln} ERR ${error.message}` : `L${p.ln} ${p.type}: ${p.H.join('/')} vs ${p.A.join('/')}`);
}
console.log('\nRound 2 assigned (Nora sits this round — she played R1; Blake plays).');
