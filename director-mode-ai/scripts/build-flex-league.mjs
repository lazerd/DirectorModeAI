// Build the Sleepy Hollow Summer Flex League brackets in ClubMode.
//   node scripts/build-flex-league.mjs            # DRY RUN (no writes)
//   node scripts/build-flex-league.mjs --commit   # create events + entries + matches in PROD
//
// Creates 4 events (one per division). Entries = one row per player (singles)
// or per team (doubles). Matches = Compass Round 1 + every round-robin pool/
// flight match, each with an auto-minted score_token. After --commit it prints
// each player/team's scoring link: /tournaments/player/<player_token>.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const COMMIT = process.argv.includes('--commit');
const USER_ID = '7ff5078a-ee6d-46b7-9af7-20b35f62729d'; // owner of the existing prod tournament events
const BASE = 'https://club.coachmode.ai';

const C = {
  'Vi Le':['vdl314@gmail.com','914-837-3659'],'Walden Browne':['walden.browne@gmail.com','510-418-5650'],
  'Simon Chan':['simon.y.chan@gmail.com','925-698-8896'],'Sarah Binder':['mcneillhouse14@gmail.com','510-646-3616'],
  'Craig Sato':['csato@comcast.net','510-501-3935'],'Shannon Moore':['smoore76@gmail.com','415-846-2165'],
  'Heather Young':['hkyoung910@gmail.com','925-286-7656'],'Leah Branson':['Leahgoldsmith@gmail.com','925-322-3400'],
  'Anne Schwaikert':['anne.olson@gmail.com','925-708-0520'],'Daralisa Kelley':['daralisakelley@gmail.com','925-487-4355'],
  'Erica Desjardins':['erica.desjardins83@gmail.com','510-735-4348'],'Christina Gibbons':['clpeterson5@gmail.com','415-623-8905'],
  'Laurie Coyle':['laurie.coyle@gmail.com','510-406-0205'],'Decio Shimura':['dshimura@gmail.com','832-567-4039'],
  'Chelsea McClure':['chelsearing14@yahoo.com','415-260-0525'],'Jen Hill':['Yikesomally@gmail.com','650-704-4287'],
  'Julie Bryant':['bryantjuliana@gmail.com','415-401-5094'],'Harman Batra':['harmanbatra@yahoo.com','408-680-9024'],
  'Caedmon Patalano':['caedmonpelliccia@gmail.com','415-517-6845'],'Jennifer Stern':['jen.lai.stern@gmail.com','415-823-7184'],
  'Chitra Balasubramanian':['chitrab@gmail.com','714-713-3315'],'Jennifer Walker':['jennwalk3@gmail.com','312-961-4293'],
  'Gabe Fett':['gabrialjfett@gmail.com','650-477-9365'],'Leena Elias':['lkelias@gmail.com','925-768-6537'],
  'Powell Jose':['powell.jose@gmail.com','203-589-9341'],'Darryl Rains':['darryl.rains@gmail.com','650-296-0988'],
  'Yvette Girard':['yagirard@gmail.com','415-309-8134'],'Lauren Disston':['laurendisston@gmail.com','510-205-3035'],
  'Kersti Peter':['kersti.peter@gmail.com','925-285-6160'],'Danielle Hawley':['dtriv1224@gmail.com','206-409-9172'],
  'Dena McManis':['denamcmanis@gmail.com','415-350-6797'],'Blair Schmicker':['blairschmicker@gmail.com','415-710-3317'],
  'Megan Sullivan':['meganmariasullivan@gmail.com','206-930-8791'],'Justin White':['justinmwhite1@gmail.com','646-229-9211'],
  'Kate Woodcox':['Woodcoxkate@gmail.com','925-785-5425'],'Nancy Jiang':['njiang83@gmail.com','607-227-8795'],
  'Karen Yoo':['karenyoo@gmail.com','415-606-0383'],'Allison Weinstein':['apschwartz@gmail.com','949-701-0408'],
  'Alex Rogin':['roginalex@gmail.com','415-990-2539'],'Jessica Howard':['Jessieltweed@gmail.com','415-596-4773'],
  'Katie Shogan':['Katie.shogan@gmail.com','925-818-8169'],'Robyn Rogin':['robyn.rogin@gmail.com','415-531-7533'],
  'Jillian Helvey':['jhhelvey@gmail.com','480-528-5797'],'Adam Branson':['albranson@gmail.com','925-322-9969'],
  'Sinan Akay':['sinan.akay@gmail.com','415-490-8415'],'Tony Helvey':['ashelvey@gmail.com','480-707-9114'],
  'Jen Acker Parks':['jenackerparks@gmail.com','847-727-2002'],'Meghan Schmicker':['meghanschmicker@gmail.com','415-728-3142'],
  'Oliver Gibbons':['ogibbons@gmail.com','925-324-6397'],'Dimitry Lerner':['lernerdima@gmail.com','310-926-2451'],
  'Abhijeet Kumar':['abhijeet@me.com','415-412-4842'],'Liz Lawrence':['lizlawrencehomes@gmail.com','925-212-7081'],
  'Susie Hsu':['susihsu@yahoo.com','310-927-1548'],
};
const em = n => C[n]?.[0] ?? null, ph = n => C[n]?.[1] ?? null;
const pairs = a => { const r = []; for (let i=0;i<a.length;i++) for (let j=i+1;j<a.length;j++) r.push([a[i],a[j]]); return r; };

// Singles flights / compass
const MS_R1 = [['Harman Batra','Craig Sato'],['Blair Schmicker','Walden Browne'],['Darryl Rains','Simon Chan'],
  ['Justin White','Decio Shimura'],['Abhijeet Kumar','Gabe Fett'],['Alex Rogin','Dimitry Lerner'],
  ['Powell Jose','Oliver Gibbons'],['Tony Helvey','Adam Branson']];
const MS = [...new Set(MS_R1.flat())];
const WS_FLIGHTS = {
  A:['Jennifer Stern','Sarah Binder','Heather Young','Allison Weinstein'],
  B:['Chelsea McClure','Shannon Moore','Katie Shogan','Karen Yoo'],
  C:['Vi Le','Laurie Coyle','Caedmon Patalano','Nancy Jiang'],
  D:['Jillian Helvey','Erica Desjardins','Julie Bryant','Megan Sullivan'],
};
const MD_TEAMS = [['Walden Browne','Simon Chan'],['Sinan Akay','Adam Branson'],['Gabe Fett','Oliver Gibbons'],['Craig Sato','Justin White']];
const WD_POOLS = {
  CP1:[['Chitra Balasubramanian','Kersti Peter'],['Sarah Binder','Leena Elias'],['Yvette Girard','Dena McManis'],['Allison Weinstein','Jen Acker Parks']],
  CP2:[['Anne Schwaikert','Daralisa Kelley'],['Heather Young','Leah Branson'],['Robyn Rogin','Katie Shogan'],['Lauren Disston','Danielle Hawley']],
  HP1:[['Erica Desjardins','Christina Gibbons'],['Vi Le','Jen Hill'],['Jessica Howard','Liz Lawrence']],
  HP2:[['Julie Bryant','Jennifer Walker'],['Megan Sullivan','Kate Woodcox'],['Meghan Schmicker','Susie Hsu']],
};

// Build a normalized division spec: { slug, name, format, kind, entries:[{key,...}], matches:[[keyA,keyB]] }
function singlesDiv(slug, name, allNames, matchPairs) {
  return { slug, name, format:'rr-singles', kind:'singles',
    entries: allNames.map(n => ({ key:n, player_name:n, player_email:em(n), player_phone:ph(n) })),
    matches: matchPairs };
}
function doublesDiv(slug, name, pools) {
  const teams = Object.values(pools).flat();
  const entries = teams.map(([a,b]) => ({ key:a, player_name:a, player_email:em(a), player_phone:ph(a),
    partner_name:b, partner_email:em(b), partner_phone:ph(b) }));
  const matches = Object.values(pools).flatMap(pool => pairs(pool.map(t => t[0]))); // pair captains within pool
  return { slug, name, format:'rr-doubles', kind:'doubles', entries, matches };
}

const DIVS = [
  singlesDiv('mens-singles-flex-2026', "Men's Singles — Summer Flex League", MS, MS_R1),
  singlesDiv('womens-singles-flex-2026', "Women's Singles — Summer Flex League",
    Object.values(WS_FLIGHTS).flat(), Object.values(WS_FLIGHTS).flatMap(f => pairs(f))),
  doublesDiv('mens-doubles-flex-2026', "Men's Doubles — Summer Flex League", { P:MD_TEAMS }),
  doublesDiv('womens-doubles-flex-2026', "Women's Doubles — Summer Flex League", WD_POOLS),
];

function code() { const ch='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for (let i=0;i<6;i++) s+=ch[(i*7+slugSeed)%ch.length]; return s; }
let slugSeed = 11;

for (const d of DIVS) {
  console.log(`\n=== ${d.name} (${d.slug}) ===`);
  console.log(`  entries: ${d.entries.length} ${d.kind}   matches: ${d.matches.length}`);
  const missing = d.entries.filter(e => !e.player_email || (d.kind==='doubles' && !e.partner_email));
  if (missing.length) console.log(`  ⚠ missing email: ${missing.map(e=>e.player_name + (e.partner_name?'/'+e.partner_name:'')).join(', ')}`);
  console.log(`  sample matches: ${d.matches.slice(0,3).map(([a,b])=>`${a} vs ${b}`).join('  |  ')}`);

  if (!COMMIT) continue;

  // 1. event (reuse if slug exists)
  let { data: ev } = await admin.from('events').select('id').eq('slug', d.slug).maybeSingle();
  if (!ev) {
    slugSeed += 13;
    const { data, error } = await admin.from('events').insert({
      user_id: USER_ID, name: d.name, slug: d.slug, event_code: code(), match_format: d.format,
      event_date: '2026-06-22', end_date: '2026-08-30', num_courts: 0,
      public_registration: false, public_status: 'draft', is_paid: false,
      scoring_format: 'fixed_games', event_scoring_format: 'pro8',
      start_time: '09:00', daily_start_time: '09:00', daily_end_time: '18:00',
    }).select('id').single();
    if (error) { console.log(`  ✗ event insert: ${error.message}`); continue; }
    ev = data; console.log(`  ✓ event created ${ev.id}`);
  } else console.log(`  • event exists ${ev.id} (reusing)`);

  // 2. entries
  const rows = d.entries.map((e,i) => ({
    event_id: ev.id, player_name: e.player_name, player_email: e.player_email, player_phone: e.player_phone,
    partner_name: e.partner_name ?? null, partner_email: e.partner_email ?? null, partner_phone: e.partner_phone ?? null,
    position: 'in_draw', seed: i+1, payment_status: 'waived',
  }));
  const { data: ins, error: e2 } = await admin.from('tournament_entries').insert(rows).select('id, player_name, player_token');
  if (e2) { console.log(`  ✗ entries: ${e2.message}`); continue; }
  const idByKey = new Map(ins.map(r => [r.player_name, r.id]));
  console.log(`  ✓ ${ins.length} entries`);

  // 3. matches
  const mrows = d.matches.map(([a,b], i) => ({
    event_id: ev.id, bracket: 'main', round: 1, slot: i+1, match_type: d.kind,
    player1_id: idByKey.get(a), player3_id: idByKey.get(b), status: 'pending',
  }));
  const bad = mrows.filter(m => !m.player1_id || !m.player3_id);
  if (bad.length) { console.log(`  ✗ ${bad.length} matches missing entry id — aborting this division`); continue; }
  const { error: e3 } = await admin.from('tournament_matches').insert(mrows);
  if (e3) { console.log(`  ✗ matches: ${e3.message}`); continue; }
  console.log(`  ✓ ${mrows.length} matches`);

  // 4. links
  console.log(`  --- player links ---`);
  for (const r of ins) console.log(`    ${r.player_name}: ${BASE}/tournaments/player/${r.player_token}`);
}
console.log(COMMIT ? '\nDONE (committed to prod).' : '\nDRY RUN — add --commit to create in prod.');
