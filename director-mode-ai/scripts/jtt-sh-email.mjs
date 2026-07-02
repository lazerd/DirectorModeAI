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
const SH = clubs.find(c => c.short_code === 'SH').id;
const { data: divs } = await admin.from('league_divisions').select('id, short_code, start_time').eq('league_id', league.id).order('sort_order');
const divInfo = new Map(divs.map(d => [d.id, d]));

const { data: all } = await admin
  .from('league_team_matchups')
  .select('match_date, start_time, home_club_id, away_club_id, division_id')
  .in('division_id', divs.map(d => d.id))
  .order('match_date');

const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function lbl(d){const[y,m,dy]=d.split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,dy));return `${DOW[dt.getUTCDay()]} ${MON[m-1]} ${dy}`;}
function tm(t){if(!t)return '';let[h,mi]=t.split(':').map(Number);const ap=h>=12?'pm':'am';h=h%12||12;return `${h}${mi?':'+String(mi).padStart(2,'0'):''}${ap}`;}

const sh = all.filter(m => m.home_club_id === SH || m.away_club_id === SH);
const byDate = {};
for (const m of sh) (byDate[m.match_date] ||= []).push(m);
const order = {'10U':0,'12U':1,'13O':2,'OPEN':3};
const lab = {'10U':'10U','12U':'12U','13O':'13+','OPEN':'Open'};

for (const date of Object.keys(byDate).sort()) {
  console.log(lbl(date));
  const rows = byDate[date].sort((a,b)=>order[divInfo.get(a.division_id).short_code]-order[divInfo.get(b.division_id).short_code]);
  for (const m of rows) {
    const di = divInfo.get(m.division_id);
    const t = tm(m.start_time||di.start_time);
    const home = m.home_club_id===SH;
    const opp = home ? cn.get(m.away_club_id) : cn.get(m.home_club_id);
    const loc = home ? 'HOME (Sleepy Hollow)' : `AWAY — travel to ${cn.get(m.home_club_id)}`;
    console.log(`   ${lab[di.short_code].padEnd(4)} ${t.padEnd(7)} vs ${opp.padEnd(18)} ${loc}`);
  }
  console.log('');
}
