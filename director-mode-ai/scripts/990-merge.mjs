#!/usr/bin/env node
// Merge the 990 re-ingest (rows.jsonl from 990-ingest.mjs) into benchmarks.json.
//
// Classifies each Part VII person into GM / Golf / Tennis-Racquets (or drops
// them), derives region / pct / lat-lng, and ADDS any (ein, name, year) not
// already present — never removes existing rows. Then recomputes the `recent`
// flag per club (newest tax year) and strips exact duplicates.
//
//   node scripts/990-merge.mjs            # apply
//   node scripts/990-merge.mjs --dry      # report only, no write

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE = 'C:/Users/darri/AppData/Local/Temp/claude/C--Users-darri/c562ea4e-4206-4435-806d-e6804043334a/scratchpad/990cache';
const ROWS = path.join(CACHE, 'rows.jsonl');
const DATA_DIR = path.join(__dirname, '..', 'src', 'app', 'benchmarks', '_data');
const BENCH = path.join(DATA_DIR, 'benchmarks.json');
const ZIPS = path.join(DATA_DIR, 'zipcentroids.json');
const DRY = process.argv.includes('--dry');

const REGION = {};
for (const s of 'CT ME MA NH RI VT NJ NY PA'.split(' ')) REGION[s] = 'Northeast';
for (const s of 'IL IN MI OH WI IA KS MN MO NE ND SD'.split(' ')) REGION[s] = 'Midwest';
for (const s of 'DE FL GA MD NC SC VA DC WV AL KY MS TN AR LA OK TX'.split(' ')) REGION[s] = 'South';
for (const s of 'AZ CO ID MT NV NM UT WY AK CA HI OR WA'.split(' ')) REGION[s] = 'West';

const norm = (t) => (t || '').toUpperCase().replace(/&AMP;/g, '&').replace(/\s+/g, ' ').trim();

// title (+ club context) -> dept | null. Precedence: Tennis > Golf > GM.
function classify(title, club) {
  const t = norm(title);
  const c = norm(club);
  const TENNIS = /TENNIS|RACQUET|RACKET|\bRS&?F\b|PICKLEBALL|PADDLE|PLATFORM TENNIS|SQUASH/;
  const GOLF_CORE = /GOLF|PGA|GREENS|LINKS/;
  const GOLF_ROLE = /PRO|PROFESSIONAL|DIRECTOR|HEAD|\bDIR\b|SHOP|INSTRUCT/;
  const GOLF_NOT = /MAINTENANCE|SUPERINTENDENT|GROUNDS|GREENSKEEP|MECHANIC/;
  // "GENERAL MAN" catches IRS-truncated titles (GENERAL MANAGER -> "GENERAL MANA").
  const GM = /GENERAL MAN|GEN\.? ?MANAGER|GEN\.? ?MGR|GENERAL MGR|\bGM\b|CHIEF OPERATING|\bCOO\b|CHIEF EXECUTIVE|\bCEO\b|EXECUTIVE DIRECTOR|CLUB MANAGER|MANAGING DIRECTOR|DIRECTOR OF OPERATIONS|CLUBHOUSE MANAGER/;
  const HEADPRO_GENERIC = /\bHEAD (TEACHING )?PRO(FESSIONAL)?\b|\bTEACHING PRO(FESSIONAL)?\b|DIRECTOR OF (RACQUETS|PROFESSIONAL)/;

  if (TENNIS.test(t)) return 'Tennis/Racquets';
  if (GOLF_CORE.test(t) && GOLF_ROLE.test(t) && !GOLF_NOT.test(t)) return 'Golf';
  // generic "head pro" at a clearly racquet/swim (non-golf) club -> tennis
  if (HEADPRO_GENERIC.test(t) && /TENNIS|RACQUET|RACKET|SWIM|BATH/.test(c) && !/GOLF|COUNTRY/.test(c)) return 'Tennis/Racquets';
  if (GM.test(t)) return 'GM';
  return null;
}

const fmtEin = (e) => { const d = String(e).replace(/\D/g, '').padStart(9, '0'); return `${d.slice(0, 2)}-${d.slice(2)}`; };

function main() {
  if (!fs.existsSync(ROWS)) { console.error('no rows.jsonl yet — run 990-ingest.mjs first'); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(BENCH, 'utf8'));
  const zips = JSON.parse(fs.readFileSync(ZIPS, 'utf8'));

  const key = (ein, name, year) => `${fmtEin(ein)}|${(name || '').toUpperCase().trim()}|${year}`;
  const have = new Set(data.map((r) => key(r.ein, r.name, r.year)));
  const existingEins = new Set(data.map((r) => fmtEin(r.ein)));

  const filings = fs.readFileSync(ROWS, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  let added = 0, dropped = 0;
  const newClubs = new Set();
  const deptCount = { 'Tennis/Racquets': 0, Golf: 0, GM: 0 };

  for (const f of filings) {
    if (!f.taxYr || !f.people) continue;
    const ein = fmtEin(f.ein);
    const state = f.state || '';
    const centroid = f.zip && zips[f.zip] ? zips[f.zip] : [null, null];
    for (const p of f.people) {
      const dept = classify(p.title, f.name);
      if (!dept) { dropped++; continue; }
      const total = (p.reported || 0) + (p.other || 0);
      if (total <= 0) { dropped++; continue; }
      const k = key(ein, p.name, f.taxYr);
      if (have.has(k)) continue;
      have.add(k);
      if (!existingEins.has(ein)) newClubs.add(ein);
      data.push({
        club: f.name,
        ein,
        state,
        region: REGION[state] || '',
        dept,
        title: norm(p.title),
        name: p.name,
        reported: p.reported || 0,
        other: p.other || 0,
        total,
        revenue: f.revenue || 0,
        pct: f.revenue ? Math.round((total / f.revenue) * 10000) / 10000 : null,
        year: String(f.taxYr),
        url: `https://projects.propublica.org/nonprofits/organizations/${ein.replace('-', '')}`,
        recent: false, // recomputed below
        zip: f.zip || null,
        lat: centroid[0],
        lng: centroid[1],
      });
      added++;
      deptCount[dept]++;
    }
  }

  // Recompute `recent`: newest tax year per club is the recent filing.
  const maxYearByEin = new Map();
  for (const r of data) { const e = fmtEin(r.ein); const y = Number(r.year) || 0; if (y > (maxYearByEin.get(e) || 0)) maxYearByEin.set(e, y); }
  for (const r of data) r.recent = (Number(r.year) || 0) === maxYearByEin.get(fmtEin(r.ein));

  // Strip exact dupes (defensive).
  const seen = new Set(); const out = [];
  for (const r of data) { const dk = `${r.ein}|${(r.name || '').toUpperCase()}|${r.year}|${r.title}|${r.total}`; if (seen.has(dk)) continue; seen.add(dk); out.push(r); }

  console.log(`filings parsed:       ${filings.length}`);
  console.log(`rows added:           ${added}  (tennis ${deptCount['Tennis/Racquets']}, golf ${deptCount.Golf}, gm ${deptCount.GM})`);
  console.log(`people dropped:       ${dropped} (no dept / zero comp)`);
  console.log(`brand-new clubs:      ${newClubs.size}`);
  console.log(`exact dupes removed:  ${data.length - out.length}`);
  console.log(`total rows: ${JSON.parse(fs.readFileSync(BENCH, 'utf8')).length} -> ${out.length}`);

  if (DRY) { console.log('\n--dry: not written'); return; }
  fs.writeFileSync(BENCH, JSON.stringify(out));
  console.log('\nwritten.');
}

main();
