import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE='https://club.coachmode.ai';
const SH_13O_TOKEN='920265ad86a84df782b199e2de083386';

// 1) Register test player via live API
const reg = await fetch(`${BASE}/api/leagues/join/${SH_13O_TOKEN}`, {method:'POST',headers:{'Content-Type':'application/json'},
  body: JSON.stringify({player_name:'ZZ Test Player', parent_name:'Darrin', parent_email:'darrinjco@gmail.com', parent_phone:'555-0100'})});
const regJ = await reg.json();
console.log('1) signup:', reg.status, JSON.stringify(regJ));
const ptoken = regJ.player_token;
if(!ptoken){ console.log('no token, abort'); process.exit(1); }

// 2) GET reservation page data
const rsvp = await fetch(`${BASE}/api/leagues/rsvp/${ptoken}`);
const rsvpJ = await rsvp.json();
console.log(`2) reservation: ${rsvp.status} — ${rsvpJ.matchups?.length} matchups for ${rsvpJ.player?.name}`);
const firstMu = rsvpJ.matchups?.[0];
console.log('   first matchup:', firstMu ? `${firstMu.date} ${firstMu.home?'vs':'@'} ${firstMu.opponent} status=${firstMu.status}` : 'none');

// 3) Set availability YES on first matchup
if(firstMu){
  const set = await fetch(`${BASE}/api/leagues/rsvp/${ptoken}`, {method:'POST',headers:{'Content-Type':'application/json'},
    body: JSON.stringify({matchup_id:firstMu.matchup_id, status:'yes'})});
  console.log('3) set YES:', set.status, await set.text());
  // verify checkin synced
  const { data: ci } = await admin.from('league_matchup_checkins').select('roster_id').eq('matchup_id', firstMu.matchup_id);
  const { data: rost } = await admin.from('league_team_rosters').select('id').eq('player_token', ptoken).single();
  console.log('   checkin synced?', ci.some(c=>c.roster_id===rost.id) ? 'YES ✅' : 'no ❌');
}

// 4) parent_email coverage on REAL SH rosters (to decide email-test safety)
const { data: league } = await admin.from('leagues').select('id').eq('slug','lamorinda-jtt-summer-2026').single();
const { data: clubs } = await admin.from('league_clubs').select('id, short_code').eq('league_id', league.id);
const SH = clubs.find(c=>c.short_code==='SH').id;
const { data: shros } = await admin.from('league_team_rosters').select('player_name, parent_email').eq('club_id', SH);
const withEmail = shros.filter(r=>r.parent_email && r.player_name!=='ZZ Test Player');
console.log(`\n4) REAL SH players with a parent_email: ${withEmail.length} of ${shros.length-1}`);
if(withEmail.length) console.log('   e.g.:', withEmail.slice(0,5).map(r=>r.player_name).join(', '));

console.log('\nTEST PLAYER token (for cleanup):', ptoken);
