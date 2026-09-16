/**
 * import-rspa-entrants.mjs — the 48 juniors entered in RSPA/USPTA Jr Circuit #2
 * at Sleepy Hollow (19–20 Sep 2026), into PlayerVault.
 *
 *   node scripts/import-rspa-entrants.mjs [--dry]
 *
 * Why: to invite them to the Dunkin' Junior Tennis Quads on Sat Oct 3 (10U and
 * 12U). A circuit entrant already travels to Orinda for a Saturday of tennis,
 * which is the whole ask.
 *
 * WHOSE ADDRESSES THESE ARE: juniors, so the email and phone on a TopDog entry
 * are a PARENT'S. They are stored as the player's contact because that is what
 * the tournament software hands over, and every one of them gave it to enter
 * an event this club runs. `notes` records where each came from so nobody has
 * to guess later. Half of these families belong to other clubs (Orinda CC,
 * Blackhawk, Moraga, Round Hill, Diablo, Meadow, Rancho Colorados) — fine for
 * a circuit invitation, not a list to sell anything else to.
 *
 * IDEMPOTENT: matched on (director, lower(email), full_name).
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const DRY = process.argv.includes('--dry');
const OWNER_EMAIL = 'darrinjco@gmail.com';
const EVENT = 'RSPA/USPTA Jr Circuit #2, Sleepy Hollow, Sep 19–20 2026';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** [division, "Last,First M", city, phone, email, rating, club] — the entrant report, verbatim. */
const ROWS = [
  ["Boys' 14", 'Batra,Sahej Preet S', 'Orinda', '408-680-9024', 'harmanbatra@yahoo.com', 1.38, 'Sleepy Hollow Swim And Tennis'],
  ["Boys' 10", 'Cardenas,Massimo', 'Walnut Creek', '415-572-9295', 'abbyccardenas@gmail.com', 0, 'NorCal RSPA/USPTA Jr Circuit'],
  ["Boys' 10", 'Chiu,Jacob', 'Orinda', '415-823-5315', 'shirley.chuang@gmail.com', 0, 'NorCal RSPA/USPTA Jr Circuit'],
  ["Girls' 14", 'Chiu,Sofia', 'Orinda', '415-823-5315', 'shirley.chuang@gmail.com', 3.512, 'Sleepy Hollow Swim And Tennis'],
  ["Boys' 10", 'Choi,Owen', 'Orinda', '310-619-0594', 'lee.christine@gmail.com', 0, 'Orinda Country Club'],
  ["Boys' 10", 'Cohen,Gavin R', 'Alamo', '925-788-8058', 'darrinjco@gmail.com', 2.5, 'Sleepy Hollow Swim And Tennis'],
  ["Girls' 14", 'Coleman,Bailey', 'Orinda', '703-585-0707', 'eddacoleman@gmail.com', 4.25, 'NorCal RSPA/USPTA Jr Circuit'],
  ["Boys' 10", 'Collins,Declan', 'Orinda', '415-307-2665', 'lucas_collinsnz@yahoo.co.nz', 1.5, 'NorCal RSPA/USPTA Jr Circuit'],
  ["Girls' 12", 'Coyle,Alice', 'Orinda', '510-406-0205', 'aecoyle7@gmail.com', 1, 'Sleepy Hollow Swim And Tennis'],
  ["Boys' 10", 'Eggert,John', 'Orinda', '415-203-0390', 'stepheggert@gmail.com', 1, 'Orinda Country Club'],
  ["Boys' 10", 'Fakhouri,Fares T', 'Orinda', '925-542-4618', 'minachang80@gmail.com', 0, 'NorCal RSPA/USPTA Jr Circuit'],
  ["Girls' 10", 'Fakhouri,Hana S', 'Orinda', '925-542-4618', 'minachang80@gmail.com', 1.5, 'NorCal RSPA/USPTA Jr Circuit'],
  ["Boys' 12", 'Frase,Aidan A', 'Orinda', '510-432-0043', 'gavinfrase@gmail.com', 0, 'Orinda Country Club'],
  ["Boys' 10", 'Frase,Rory', 'Orinda', '', 'gavinfrase@gmail.com', 0, 'Orinda Country Club'],
  ["Girls' 12", 'Friedli,Kylie', 'Lafayette', '408-707-6894', 'lstoll2002@yahoo.com', 0, 'Rancho Colorados Swim & Tennis Club'],
  ["Boys' 14", 'Gonzales,Declan H', 'Orinda', '925-528-1058', 'maureen.mccuaig@gmail.com', 1.476, 'Moraga Country Club'],
  ["Boys' 14", 'Gonzales,Declan M', 'Alamo', '530-304-6168', 'aliciamcmahon@gmail.com', 0, 'Diablo Country Club'],
  ["Boys' 14", 'Graham,Tyler', 'Lafayette', '415-846-1821', 'iamtylergraham@gmail.com', 1.5, 'Sleepy Hollow Swim And Tennis'],
  ["Boys' 12", 'Haque,Izar', 'Orinda', '650-417-5408', 'ooyshee@gmail.com', 0, 'Sleepy Hollow Swim And Tennis'],
  ["Girls' 12", 'Hull,Emily', 'Danville', '', 'traceyn@gmail.com', 0, 'Blackhawk Country Club'],
  ["Girls' 12", 'Jose,Karina', 'Orinda', '203-589-9341', 'powell.jose@gmail.com', 0, 'Sleepy Hollow Swim And Tennis'],
  ["Girls' 14", 'Jose,Riya', 'Orinda', '', 'deepaprasad@gmail.com', 0, 'Orinda Country Club'],
  ["Girls' 12", 'Khaiser,Noor', 'Danville', '309-256-4020', 'amkhaiser@gmail.com', 0, 'Blackhawk Country Club'],
  ["Boys' 14", 'Koester,Noah R', 'Orinda', '', 'anthony.w.koester@gmail.com', 0, 'Sleepy Hollow Swim And Tennis'],
  ["Boys' 14", 'Koester,Wyatt A', 'Orinda', '650-529-5188', 'seejillsee@aol.com', 0, 'Sleepy Hollow Swim And Tennis'],
  ["Girls' 14", 'Koffman,Sutton D', 'Orinda', '415-710-7008', 'shannon.koffman@gmail.com', 2.5, 'Sleepy Hollow Swim And Tennis'],
  ["Boys' 10", 'Korpi,Luke', 'Orinda', '415-855-0519', 'david.korpi@gmail.com', 0, 'Orinda Country Club'],
  ["Girls' 12", 'Kubas,Matilda', 'Orinda', '', 'morgankubas@gmail.com', 0, 'Orinda Country Club'],
  ["Boys' 14", 'Lee,Jason', 'Orinda', '510-414-8321', 'slee.two@gmail.com', 0, 'Meadow Swim & Tennis Club'],
  ["Girls' 14", 'Li,Fiona', 'Alamo', '925-817-0763', 'ftsaimd@gmail.com', 0, 'NorCal RSPA/USPTA Jr Circuit'],
  ["Boys' 14", 'Lin,Connor', 'Alamo', '925-822-2448', 'jmlin1979@gmail.com', 0, 'NorCal RSPA/USPTA Jr Circuit'],
  ["Boys' 10", 'Liu,Bodhi', 'Danville', '', 'rchundru@gmail.com', 0, 'Blackhawk Country Club'],
  ["Boys' 12", 'Liu,Kiran', 'Danville', '415-260-5035', 'rchundru@gmail.com', 0, 'Blackhawk Country Club'],
  ["Girls' 10", 'Lucia,Olivia F', 'Danville', '925-963-7501', 'j9smc@aol.com', 0, 'Blackhawk Country Club'],
  ["Boys' 12", 'McGinley,James J', 'Orinda', '415-710-1191', 'ellie.knight@gmail.com', 0, 'Orinda Country Club'],
  ["Boys' 12", 'Moldavsky,Max T', 'Orinda', '310-592-9811', 'max.moldavsky@icloud.com', 1.488, 'Sleepy Hollow Swim And Tennis'],
  ["Boys' 14", 'Nixon,Phineas', 'Orinda', '925-408-9179', 'debby@deborahcoleman.com', 0, 'Sleepy Hollow Swim And Tennis'],
  ["Girls' 14", 'Orvis,Sloane', 'Orinda', '408-857-5314', 'leeannsemailis@hotmail.com', 2, 'NorCal RSPA/USPTA Jr Circuit'],
  ["Boys' 10", 'Pathare,Niam R', 'Pleasant Hill', '408-497-1529', 'parulc@gmail.com', 0, 'Round Hill Country Club'],
  ["Boys' 12", 'Pejham,Daniel', 'Danville', '925-487-1415', 'spejham1@yahoo.com', 3, 'NorCal RSPA/USPTA Jr Circuit'],
  ["Girls' 12", 'Rajaraman,Gitanjali D', 'Orinda', '310-909-3493', 'chitrab@gmail.com', 2.928, 'Sleepy Hollow Swim And Tennis'],
  ["Girls' 14", 'Rajaraman,Vedica A', 'Orinda', '714-713-3315', 'vedicarajaraman@gmail.com', 0, 'Sleepy Hollow Swim And Tennis'],
  ["Girls' 14", 'Ross,Violet', 'Lafayette', '415-314-0366', 'dariana@gmail.com', 1.5, 'Orinda Country Club'],
  ["Boys' 10", 'Soares-Orden,Micah', 'Walnut Creek', '206-372-0298', 'raorden@gmail.com', 0, 'NorCal RSPA/USPTA Jr Circuit'],
  ["Boys' 10", 'Stocker,Bennett J', 'Orinda', '415-265-2660', 'paigerstocker@gmail.com', 0, 'Orinda Country Club'],
  ["Boys' 12", 'Tambawala,Kabir', 'Lafayette', '408-896-7628', 'goreprachi@gmail.com', 0, 'Rancho Colorados Swim & Tennis Club'],
  ["Boys' 14", 'Tseng,Declan J', 'Lafayette', '415-816-2877', 'mtseng14@gmail.com', 1.548, 'Orinda Country Club'],
  ["Girls' 12", 'Wilson,Brooklyn', 'Lafayette', '203-273-3105', 'sammywilson@mac.com', 1, 'Sleepy Hollow Swim And Tennis'],
];

/** "Batra,Sahej Preet S" → "Sahej Preet S Batra". */
const displayName = (entrant) => {
  const [last, rest] = entrant.split(',');
  return `${(rest || '').trim()} ${last.trim()}`.trim();
};

async function main() {
  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const owner = list.users.find((u) => (u.email || '').toLowerCase() === OWNER_EMAIL);
  if (!owner) throw new Error(`No account for ${OWNER_EMAIL}`);

  const { data: have } = await db
    .from('cc_vault_players')
    .select('id, full_name, email, notes')
    .eq('director_id', owner.id);
  const key = (name, email) => `${name.toLowerCase()}|${(email || '').toLowerCase()}`;
  const existing = new Map((have ?? []).map((p) => [key(p.full_name, p.email), p]));

  let added = 0;
  let updated = 0;
  for (const [division, entrant, city, phone, email, rating, club] of ROWS) {
    const full_name = displayName(entrant);
    // The division IS the age group: a 10s entrant is 10-and-under, and that is
    // all TopDog tells us. Store it as the top of the bracket, not a guess at a
    // birthday, and keep the division itself in the notes.
    const age = Number(division.match(/\d+/)[0]);
    const gender = division.startsWith('Boys') ? 'male' : 'female';
    const notes = [
      `${division}s at ${EVENT}.`,
      `Plays out of ${club}. ${city}, CA.`,
      'Email and phone are the parent/guardian contact from the tournament entry.',
    ].join(' ');

    const row = {
      director_id: owner.id,
      full_name,
      email: email || null,
      phone: phone || null,
      gender,
      age,
      // TopDog's circuit rating, not USTA/NTRP — 0 means unrated, so leave those null.
      usta_rating: rating > 0 ? rating : null,
      rating_source: rating > 0 ? 'manual' : null,
      primary_sport: 'tennis',
      sports: ['tennis'],
      membership_status: club.startsWith('Sleepy Hollow') ? 'active' : 'guest',
      notes,
    };

    const found = existing.get(key(full_name, email));
    if (DRY) {
      found ? (updated += 1) : (added += 1);
      continue;
    }
    if (found) {
      const { error } = await db.from('cc_vault_players').update(row).eq('id', found.id);
      if (error) throw new Error(`${full_name}: ${error.message}`);
      updated += 1;
    } else {
      const { error } = await db.from('cc_vault_players').insert(row);
      if (error) throw new Error(`${full_name}: ${error.message}`);
      added += 1;
    }
  }

  const tens = ROWS.filter(([d]) => /\b10\b/.test(d)).length;
  const twelves = ROWS.filter(([d]) => /\b12\b/.test(d)).length;
  console.log(
    `${DRY ? 'Would add' : 'Added'} ${added}, ${DRY ? 'would update' : 'updated'} ${updated} of ${ROWS.length} entrants.`,
  );
  console.log(`Dunkin' Quads target (10U + 12U): ${tens + twelves} players — ${tens} in the 10s, ${twelves} in the 12s.`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
