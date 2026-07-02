#!/usr/bin/env node
// Bake the benchmark_removals table (owner deletes made on /benchmarks) into
// the dataset: strip matching rows from benchmarks.json and add club-scope
// EINs to 990-blocklist.json so future ingests skip them entirely.
//
// The /benchmarks page hides removals at runtime the moment Darrin clicks ✕;
// this script makes those deletions permanent so every OTHER surface that
// reads benchmarks.json directly (score, advisor, profile, connect prospects)
// stops seeing them too. Run any time, and always before/after a 990 refresh:
//
//   node --env-file=.env.local scripts/990-apply-removals.mjs        # apply
//   node --env-file=.env.local scripts/990-apply-removals.mjs --dry  # preview

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.join(__dirname, '..', 'src', 'app', 'benchmarks', '_data', 'benchmarks.json');
const BLOCKLIST = path.join(__dirname, '990-blocklist.json');
const DRY = process.argv.includes('--dry');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('missing Supabase env — run with: node --env-file=.env.local scripts/990-apply-removals.mjs');
  process.exit(1);
}

const res = await fetch(`${url}/rest/v1/benchmark_removals?select=key,scope,ein,person,year`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!res.ok) {
  console.error(`benchmark_removals fetch failed (${res.status}) — has the migration been run?`);
  process.exit(1);
}
const removals = await res.json();
if (!removals.length) {
  console.log('no removals recorded — nothing to do');
  process.exit(0);
}

const clubEins = new Set(removals.filter((r) => r.scope === 'club').map((r) => r.ein));
const rowKeys = new Set(removals.filter((r) => r.scope === 'row').map((r) => `${r.ein}|${r.person}|${r.year}`));

const data = JSON.parse(fs.readFileSync(BENCH, 'utf8'));
const kept = data.filter((r) => !clubEins.has(r.ein) && !rowKeys.has(`${r.ein}|${r.name}|${r.year}`));
const dropped = data.length - kept.length;

const bl = JSON.parse(fs.readFileSync(BLOCKLIST, 'utf8'));
const newBlocks = [...clubEins].map((e) => e.replace(/-/g, '')).filter((e) => !bl.eins.includes(e));

console.log(`removals on record: ${removals.length} (${clubEins.size} whole clubs, ${rowKeys.size} single rows)`);
console.log(`rows to strip from benchmarks.json: ${dropped} (${data.length} -> ${kept.length})`);
console.log(`EINs to add to 990-blocklist.json: ${newBlocks.length}`);

if (DRY) {
  console.log('--dry: not written');
  process.exit(0);
}
fs.writeFileSync(BENCH, JSON.stringify(kept, null, 1));
bl.eins.push(...newBlocks);
fs.writeFileSync(BLOCKLIST, JSON.stringify(bl, null, 1));
console.log('written. Commit + deploy to make it live everywhere.');
