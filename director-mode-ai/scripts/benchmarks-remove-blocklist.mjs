#!/usr/bin/env node
// Strip blocklisted EINs (scripts/990-blocklist.json) from benchmarks.json.
// Non-club orgs that slipped in (medical centers, kennel club, etc.). Safe to
// re-run. The same blocklist is honored by 990-ingest.mjs and 990-merge.mjs so
// they don't come back on the next re-ingest.
//
//   node scripts/benchmarks-remove-blocklist.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.join(__dirname, '..', 'src', 'app', 'benchmarks', '_data', 'benchmarks.json');
const block = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '990-blocklist.json'), 'utf8')).eins.map((e) => String(e).replace(/\D/g, '')));

const data = JSON.parse(fs.readFileSync(BENCH, 'utf8'));
const removed = [];
const out = data.filter((r) => {
  if (block.has((r.ein || '').replace(/\D/g, ''))) { removed.push(`${r.club} — ${r.name}`); return false; }
  return true;
});
fs.writeFileSync(BENCH, JSON.stringify(out));
console.log(`Removed ${removed.length} blocklisted row(s):`);
removed.forEach((r) => console.log('  -', r));
console.log(`Rows: ${data.length} -> ${out.length}`);
