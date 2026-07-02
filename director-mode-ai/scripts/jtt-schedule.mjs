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
const SLUG = 'lamorinda-jtt-summer-2026';

const { data: league } = await admin.from('leagues').select('id').eq('slug', SLUG).single();
const { data: clubs } = await admin.from('league_clubs').select('id, short_code, name').eq('league_id', league.id);
const cs = new Map(clubs.map(c => [c.id, c.short_code]));
const cn = new Map(clubs.map(c => [c.id, c.name]));
const { data: divs } = await admin.from('league_divisions').select('id, short_code, start_time, day_of_week').eq('league_id', league.id).order('sort_order');
const divInfo = new Map(divs.map(d => [d.id, d]));

const { data: mus } = await admin
  .from('league_team_matchups')
  .select('match_date, start_time, home_club_id, away_club_id, division_id')
  .eq('division_id', divs.map(d => d.id)[0]); // placeholder, replaced below

// pull all matchups across divisions
const { data: all } = await admin
  .from('league_team_matchups')
  .select('match_date, start_time, home_club_id, away_club_id, division_id')
  .in('division_id', divs.map(d => d.id))
  .order('match_date');

const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function fmtDate(d) {
  const [y,m,day] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m-1, day));
  return `${DOW[dt.getUTCDay()]} ${d}`;
}
function fmtTime(t) { return t ? t.slice(0,5) : ''; }

// Group by date
const byDate = {};
for (const m of all) {
  (byDate[m.match_date] ||= []).push(m);
}

console.log('FULL SCHEDULE — Lamorinda JTT Summer 2026\n');
const divOrder = { '10U':0, '12U':1, '13O':2, 'OPEN':3 };
for (const date of Object.keys(byDate).sort()) {
  console.log(fmtDate(date));
  const rows = byDate[date].sort((a,b) => {
    const da = divInfo.get(a.division_id).short_code, db = divInfo.get(b.division_id).short_code;
    return (divOrder[da]??9) - (divOrder[db]??9);
  });
  for (const m of rows) {
    const div = divInfo.get(m.division_id);
    const time = fmtTime(m.start_time || div.start_time);
    const away = cs.get(m.away_club_id), home = cs.get(m.home_club_id);
    const star = (away==='SH'&&home==='MCC')||(away==='MCC'&&home==='SH') ? '   <-- SH vs MCC' : '';
    console.log(`   ${div.short_code.padEnd(5)} ${time}  ${away} @ ${home}${star}`);
  }
  console.log('');
}

console.log('================================================');
console.log('SLEEPY HOLLOW vs MCC — all meetings + location');
console.log('================================================');
const shmcc = all.filter(m => {
  const a=cs.get(m.away_club_id), h=cs.get(m.home_club_id);
  return (a==='SH'&&h==='MCC')||(a==='MCC'&&h==='SH');
}).sort((a,b)=>a.match_date.localeCompare(b.match_date));
for (const m of shmcc) {
  const div = divInfo.get(m.division_id);
  const time = fmtTime(m.start_time || div.start_time);
  const away = cs.get(m.away_club_id), home = cs.get(m.home_club_id);
  console.log(`  ${fmtDate(m.match_date)}  ${div.short_code.padEnd(5)} ${time}  ${away} @ ${home}   |  LOCATION: ${cn.get(m.home_club_id)} (${home})`);
}
