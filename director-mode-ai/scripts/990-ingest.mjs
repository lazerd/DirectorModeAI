#!/usr/bin/env node
// IRS Form 990 re-ingest for the benchmarks dataset.
//
// Pulls Part VII (officers + highest-paid employees) compensation straight from
// the authoritative IRS e-file XML, for every racquet / golf / country / athletic
// club we can find — plus a refresh of every club already in benchmarks.json.
//
// The IRS only ships full e-file data as ~1.2GB-per-batch ZIPs (13 batches/yr),
// and individual XML endpoints are blocked. So instead of downloading ~15GB, we
// use the ZIP central directory + HTTP range reads to fetch ONLY the few-KB XMLs
// we actually want (~3-4k clubs, ~a few hundred MB total).
//
// Stage: discovery (index CSVs) -> per-batch range extraction -> rows.jsonl
// Resumable: re-running skips EINs already in rows.jsonl. Run 990-merge.mjs next.
//
//   node scripts/990-ingest.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE = 'C:/Users/darri/AppData/Local/Temp/claude/C--Users-darri/c562ea4e-4206-4435-806d-e6804043334a/scratchpad/990cache';
const ROWS = path.join(CACHE, 'rows.jsonl');
const LOG = path.join(CACHE, 'ingest.log');
const BENCH = path.join(__dirname, '..', 'src', 'app', 'benchmarks', '_data', 'benchmarks.json');
fs.mkdirSync(CACHE, { recursive: true });

const YEARS = [2025, 2024, 2023];           // newest first; we keep the latest filing per EIN
const UA = { 'User-Agent': 'clubmode-benchmarks-ingest/1.0 (darrinjco@gmail.com)' };
const CONCURRENCY = 8;

// Clubs we care about by name. Country/golf/tennis/racquet/athletic/etc.
const INCLUDE = /(COUNTRY CLUB|GOLF AND COUNTRY|GOLF & COUNTRY|GOLF CLUB|GOLF LINKS|TENNIS CLUB|TENNIS CENTER|RACQUET|RACKET|ATHLETIC CLUB|FIELD CLUB|YACHT CLUB|HUNT CLUB|UNIVERSITY CLUB|CITY CLUB|TOWN CLUB|PLATFORM TENNIS|BATH AND TENNIS|BATH & TENNIS|SWIM AND TENNIS|SWIM & TENNIS|SWIM AND RACQUET|SWIM & RACQUET|SWIM AND RACKET|TENNIS AND SWIM|TENNIS & SWIM|PADDLE|CRICKET CLUB|LAWN CLUB|BEACH AND TENNIS|BEACH & TENNIS|GOLF & C C|GOLF AND CC)/;
// Drop obvious non-operating orgs (their Part VII isn't club directors).
const EXCLUDE = /(FOUNDATION|SCHOLARSHIP|CHARITABLE|BOOSTER|ALUMNI|MEMORIAL FUND|ENDOWMENT|JUNIOR GOLF|JUNIOR TENNIS|YOUTH|PAC\b|POLITICAL|HOMEOWNER|PROPERTY OWNER|CONDOMINIUM|MASTER ASSOCIATION|HOA\b)/;

const log = (m) => { console.log(m); try { fs.appendFileSync(LOG, m + '\n'); } catch {} };

async function fetchBuf(url, headers, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { ...UA, ...headers } });
      if (r.status === 200 || r.status === 206) return Buffer.from(await r.arrayBuffer());
      if (r.status === 404) return null;
    } catch (e) { /* retry */ }
    await new Promise((res) => setTimeout(res, 400 * (i + 1)));
  }
  return null;
}

async function ensureIndex(year) {
  const p = path.join(CACHE, `index_${year}.csv`);
  if (fs.existsSync(p) && fs.statSync(p).size > 1e6) return p;
  log(`downloading IRS index ${year}...`);
  const buf = await fetchBuf(`https://apps.irs.gov/pub/epostcard/990/xml/${year}/index_${year}.csv`, {});
  if (!buf) throw new Error(`index ${year} download failed`);
  fs.writeFileSync(p, buf);
  return p;
}

// ---- Stage 1: discovery -> Map<ein, {ein,name,taxPeriod,oid,batch,year}> ----
async function discover() {
  let blocked = new Set();
  try { blocked = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '990-blocklist.json'), 'utf8')).eins.map((e) => String(e).replace(/\D/g, ''))); } catch {}
  const existingEins = new Set();
  try {
    const data = JSON.parse(fs.readFileSync(BENCH, 'utf8'));
    for (const r of data) if (r.ein) existingEins.add(r.ein.replace(/-/g, ''));
  } catch {}
  log(`existing benchmarks EINs: ${existingEins.size}`);

  const best = new Map(); // ein -> chosen filing (max taxPeriod)
  for (const year of YEARS) {
    const p = await ensureIndex(year);
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    let matched = 0;
    for (const l of lines) {
      const c = l.split(',');
      if (c.length < 10) continue;
      // TAXPAYER_NAME (col 5) can contain commas, which shifts a naive split.
      // The first 5 cols and last 4 cols are comma-free, so anchor from both ends.
      const ein = c[2];
      const taxPeriod = c[3];
      const rtype = c[c.length - 4] || '';
      const oid = c[c.length - 2];
      const batch = (c[c.length - 1] || '').trim();
      const name = c.slice(5, c.length - 4).join(',');
      if (rtype !== '990') continue;                 // need full Part VII
      if (blocked.has(ein)) continue;                 // known non-club orgs
      const wanted = existingEins.has(ein) || (INCLUDE.test(name) && !EXCLUDE.test(name));
      if (!wanted) continue;
      matched++;
      const prev = best.get(ein);
      if (!prev || taxPeriod > prev.taxPeriod) best.set(ein, { ein, name, taxPeriod, oid, batch, year });
    }
    log(`index ${year}: ${matched} candidate 990 filings`);
  }
  log(`unique target clubs: ${best.size}`);
  return best;
}

// ---- ZIP central directory (range-read) ----
async function loadBatchDir(year, batch) {
  const cdCache = path.join(CACHE, `cd_${year}_${batch}.json`);
  if (fs.existsSync(cdCache)) return JSON.parse(fs.readFileSync(cdCache, 'utf8'));
  const url = `https://apps.irs.gov/pub/epostcard/990/xml/${year}/${batch}.zip`;
  const head = await fetch(url, { method: 'HEAD', headers: UA });
  const len = Number(head.headers.get('content-length'));
  if (!len) { log(`  ! no length for ${batch}`); return null; }
  // EOCD in last 64KB
  const tail = await fetchBuf(url, { Range: `bytes=${len - 65536}-${len - 1}` });
  if (!tail) { log(`  ! tail fetch failed ${batch}`); return null; }
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
  if (eocd < 0) { log(`  ! no EOCD ${batch}`); return null; }
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOff = tail.readUInt32LE(eocd + 16);
  const cd = await fetchBuf(url, { Range: `bytes=${cdOff}-${cdOff + cdSize - 1}` });
  const map = {};
  let off = 0;
  while (off + 46 <= cd.length && cd.readUInt32LE(off) === 0x02014b50) {
    const method = cd.readUInt16LE(off + 10);
    const compSize = cd.readUInt32LE(off + 20);
    const fnLen = cd.readUInt16LE(off + 28);
    const exLen = cd.readUInt16LE(off + 30);
    const cmLen = cd.readUInt16LE(off + 32);
    const localOff = cd.readUInt32LE(off + 42);
    const name = cd.toString('latin1', off + 46, off + 46 + fnLen);
    const base = name.slice(name.lastIndexOf('/') + 1); // strip the batch folder prefix (2024 zips have it, 2025 don't)
    map[base] = { method, compSize, localOff };
    off += 46 + fnLen + exLen + cmLen;
  }
  fs.writeFileSync(cdCache, JSON.stringify(map));
  return map;
}

async function fetchXml(year, batch, entry) {
  const url = `https://apps.irs.gov/pub/epostcard/990/xml/${year}/${batch}.zip`;
  const winLen = 30 + 4096 + entry.compSize;
  const w = await fetchBuf(url, { Range: `bytes=${entry.localOff}-${entry.localOff + winLen - 1}` });
  if (!w || w.readUInt32LE(0) !== 0x04034b50) return null;
  const lfnLen = w.readUInt16LE(26);
  const lexLen = w.readUInt16LE(28);
  const dataStart = 30 + lfnLen + lexLen;
  const comp = w.subarray(dataStart, dataStart + entry.compSize);
  try {
    const xml = entry.method === 0 ? comp : zlib.inflateRawSync(comp);
    return xml.toString('utf8');
  } catch { return null; }
}

// ---- Parse Part VII from a 990 XML ----
const g = (xml, tag) => { const m = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`)); return m ? m[1] : null; };
function parseXml(xml, fallback) {
  const taxYr = g(xml, 'TaxYr') || (fallback.taxPeriod ? fallback.taxPeriod.slice(0, 4) : null);
  const revenue = Number(g(xml, 'CYTotalRevenueAmt') || g(xml, 'TotalRevenueAmt') || 0) || null;
  // Filer business name + address
  const filerBlock = (xml.match(/<Filer[\s\S]*?<\/Filer>/) || [''])[0];
  const name = (filerBlock.match(/<BusinessNameLine1Txt>([^<]+)/) || xml.match(/<BusinessNameLine1Txt>([^<]+)/) || [])[1] || fallback.name;
  const state = (filerBlock.match(/<StateAbbreviationCd>([^<]+)/) || [])[1] || null;
  const zip = (filerBlock.match(/<ZIPCd>([^<]+)/) || [])[1] || null;
  const people = [];
  for (const b of xml.split('<Form990PartVIISectionAGrp>').slice(1)) {
    const pn = (b.match(/<PersonNm>([^<]+)/) || [])[1];
    if (!pn) continue;
    const title = (b.match(/<TitleTxt>([^<]+)/) || [])[1] || '';
    const reported = Number((b.match(/<ReportableCompFromOrgAmt>(\d+)/) || [])[1] || 0);
    const other = Number((b.match(/<OtherCompensationAmt>(\d+)/) || [])[1] || 0);
    people.push({ name: pn.trim(), title: title.trim(), reported, other });
  }
  return { name: (name || '').trim(), state, zip: zip ? zip.slice(0, 5) : null, taxYr, revenue, people };
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  });
  await Promise.all(workers);
}

// Distinct batch zip names for a year (from the index's XML_BATCH_ID column).
function getBatchList(year) {
  const lines = fs.readFileSync(path.join(CACHE, `index_${year}.csv`), 'utf8').split('\n');
  const set = new Set();
  for (const l of lines) { const c = l.split(','); if (c.length < 10) continue; const b = (c[c.length - 1] || '').trim(); if (b.startsWith(`${year}_`)) set.add(b); }
  return [...set].sort();
}

// Build basename -> {batch, method, compSize, localOff} across ALL of a year's
// batch zips. The index's per-row batch column is unreliable, so we search the
// whole year's central directories (each cached) to locate every object_id.
async function buildYearIndex(year) {
  const map = new Map();
  for (const batch of getBatchList(year)) {
    const dir = await loadBatchDir(year, batch);
    if (!dir) { log(`  ! no dir ${batch}`); continue; }
    for (const base in dir) if (!map.has(base)) map.set(base, { batch, ...dir[base] });
    log(`  indexed ${batch}: ${Object.keys(dir).length} entries (year total ${map.size})`);
  }
  return map;
}

async function main() {
  const targets = await discover();

  // Resume: skip EINs already extracted.
  const done = new Set();
  if (fs.existsSync(ROWS)) for (const l of fs.readFileSync(ROWS, 'utf8').split('\n')) { if (!l) continue; try { done.add(JSON.parse(l).ein); } catch {} }
  log(`already extracted: ${done.size}`);

  // Group remaining targets by index year.
  const byYear = new Map();
  for (const t of targets.values()) {
    if (done.has(t.ein)) continue;
    if (!byYear.has(t.year)) byYear.set(t.year, []);
    byYear.get(t.year).push(t);
  }

  let extracted = 0, empty = 0;
  const out = fs.createWriteStream(ROWS, { flags: 'a' });
  for (const [year, list] of byYear) {
    log(`building ${year} directory index for ${list.length} targets...`);
    const yearIdx = await buildYearIndex(year);
    await pool(list, CONCURRENCY, async (t) => {
      const entry = yearIdx.get(`${t.oid}_public.xml`);
      if (!entry) { empty++; return; }
      const xml = await fetchXml(year, entry.batch, entry);
      if (!xml) { empty++; return; }
      const parsed = parseXml(xml, t);
      out.write(JSON.stringify({ ein: t.ein, ...parsed }) + '\n');
      extracted++;
    });
    log(`year ${year}: total extracted ${extracted}, missing ${empty}`);
  }
  out.end();
  log(`DONE. extracted ${extracted} filings, ${empty} missing/empty. rows -> ${ROWS}`);
}

main().catch((e) => { log('FATAL ' + e.stack); process.exit(1); });
