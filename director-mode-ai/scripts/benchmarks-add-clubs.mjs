#!/usr/bin/env node
// Augment benchmarks.json with hand-verified 990 rows that the original ingest
// missed. Use when a club/director you KNOW has a 990 isn't showing up — the
// IRS 990 only lists officers + the ~5-7 highest-paid employees, and the
// original pipeline both (a) under-captured the "highest compensated employees"
// subsection and (b) used too narrow a title->dept classifier (e.g. it didn't
// recognize "HEAD OF RS&F" = Racquet Sports & Fitness as Tennis/Racquets).
//
// Every record here is transcribed from the club's ProPublica filing, pairing
// each person's comp with the SAME filing's revenue/year so pct stays correct.
// Dedups by (ein, name, year) so it's safe to re-run.
//
//   node scripts/benchmarks-add-clubs.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'app', 'benchmarks', '_data');
const BENCH = join(DATA_DIR, 'benchmarks.json');
const ZIPS = join(DATA_DIR, 'zipcentroids.json');

const STATE_REGION = {
  CA: 'West', OR: 'West', WA: 'West', NV: 'West', AZ: 'West', CO: 'West', UT: 'West',
  ID: 'West', MT: 'West', WY: 'West', NM: 'West', HI: 'West', AK: 'West',
  // (extend as needed; only West states are used by the records below)
};

// --- Verified rows to add (from each club's ProPublica 990 filing) ---
// reported/other are the two comp columns; total/pct/lat/lng/region are derived.
const RECORDS = [
  {
    club: 'BELVEDERE TENNIS CLUB', ein: '94-1563343', state: 'CA', zip: '94920',
    dept: 'Tennis/Racquets', title: 'DIRECTOR OF TENNIS', name: 'ANOOSH DAVOUDZADEH',
    reported: 191152, other: 3820, revenue: 2737682, year: '2024', recent: true,
  },
  {
    club: 'ORINDA COUNTRY CLUB', ein: '94-0735460', state: 'CA', zip: '94563',
    dept: 'Tennis/Racquets', title: 'HEAD OF RS&F', name: 'TYLER BROWNE',
    reported: 202313, other: 22243, revenue: 17104048, year: '2024', recent: true,
  },
];

const data = JSON.parse(readFileSync(BENCH, 'utf8'));
const zips = JSON.parse(readFileSync(ZIPS, 'utf8'));

const seen = new Set(data.map((r) => `${r.ein}|${(r.name || '').toUpperCase()}|${r.year}`));

let added = 0;
for (const rec of RECORDS) {
  const key = `${rec.ein}|${rec.name.toUpperCase()}|${rec.year}`;
  if (seen.has(key)) {
    console.log(`skip (exists): ${rec.name} @ ${rec.club} ${rec.year}`);
    continue;
  }
  const total = rec.reported + rec.other;
  const centroid = zips[rec.zip] || [null, null];
  const row = {
    club: rec.club,
    ein: rec.ein,
    state: rec.state,
    region: STATE_REGION[rec.state] || '',
    dept: rec.dept,
    title: rec.title,
    name: rec.name,
    reported: rec.reported,
    other: rec.other,
    total,
    revenue: rec.revenue,
    pct: rec.revenue ? Math.round((total / rec.revenue) * 10000) / 10000 : null,
    year: rec.year,
    url: `https://projects.propublica.org/nonprofits/organizations/${rec.ein.replace('-', '')}`,
    recent: rec.recent,
    zip: rec.zip,
    lat: centroid[0],
    lng: centroid[1],
  };
  data.push(row);
  seen.add(key);
  added++;
  console.log(`add: ${row.name} — ${row.title} @ ${row.club} ${row.year} · $${total.toLocaleString()} · ${(row.pct * 100).toFixed(2)}% of rev`);
}

writeFileSync(BENCH, JSON.stringify(data));
console.log(`\nDone. Added ${added} row(s). Total rows: ${data.length}`);
