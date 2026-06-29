#!/usr/bin/env node
// Remove exact duplicate rows from benchmarks.json. The original ingest emitted
// a handful of duplicate Part VII entries (same EIN + person + year + title +
// comp), which show up as "stuck" repeated rows in every search result that
// includes them. Keeps the first occurrence of each. Safe to re-run.
//
//   node scripts/benchmarks-dedupe.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCH = join(__dirname, '..', 'src', 'app', 'benchmarks', '_data', 'benchmarks.json');

const data = JSON.parse(readFileSync(BENCH, 'utf8'));
const seen = new Set();
const out = [];
const removed = [];

for (const r of data) {
  const key = `${r.ein}|${(r.name || '').toUpperCase()}|${r.year}|${r.title}|${r.total}`;
  if (seen.has(key)) {
    removed.push(`${r.name} — ${r.title} @ ${r.club} (${r.year})`);
    continue;
  }
  seen.add(key);
  out.push(r);
}

writeFileSync(BENCH, JSON.stringify(out));
console.log(`Removed ${removed.length} duplicate row(s):`);
removed.forEach((r) => console.log('  -', r));
console.log(`Rows: ${data.length} -> ${out.length}`);
