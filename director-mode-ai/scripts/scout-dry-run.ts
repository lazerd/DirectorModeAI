/**
 * Recruiting Scout — scrape every public job board and print what it found.
 *
 *   npx tsx scripts/scout-dry-run.ts                 # read-only: scrape + extract, print, write nothing
 *   npx tsx scripts/scout-dry-run.ts --write         # same, then upsert connect_sourced_jobs + find contacts
 *   npx tsx scripts/scout-dry-run.ts --write --use-cache   # write the rows the last dry run saved (no re-scrape)
 *   npx tsx scripts/scout-dry-run.ts --sources=rspa,ptr
 *   npx tsx scripts/scout-dry-run.ts --contacts-only --write
 *
 * A dry run reads the DB (to skip postings it already has) but never writes.
 * It saves its rows to the OS temp dir so a following --write --use-cache
 * doesn't pay for the model calls twice. No emails are ever sent.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// The scripts in this repo read .env.local themselves; there is no dotenv.
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const i = line.indexOf('=');
  if (i < 1 || line.trimStart().startsWith('#')) continue;
  const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

const CACHE = join(tmpdir(), 'clubmode-scout-cache.json');

async function main() {
  const { getSupabaseAdmin } = await import('../src/lib/supabase/admin');
  const { runScout, writeSourcedJobs, enrich } = await import('../src/lib/connect/scout/run');
  const { runContacts } = await import('../src/lib/connect/scout/contacts');

  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const useCache = args.includes('--use-cache');
  const contactsOnly = args.includes('--contacts-only');
  const sources = args.find((a) => a.startsWith('--sources='))?.slice(10).split(',').filter(Boolean);
  const db = getSupabaseAdmin();

  if (!contactsOnly) {
    if (useCache) {
      if (!existsSync(CACHE)) throw new Error(`no cache at ${CACHE} — run a dry run first`);
      const c = JSON.parse(readFileSync(CACHE, 'utf8'));
      // Re-derive fingerprint / 990 match / comp estimate with the current code, then dedupe again.
      const byFp = new Map<string, any>();
      for (const r of c.rows) {
        const { fingerprint: _f, lat: _a, lng: _b, club_ein: _e, club_revenue: _r, est_comp: _c, ...base } = r;
        const row = enrich(base);
        if (!byFp.has(row.fingerprint)) byFp.set(row.fingerprint, row);
      }
      const rows = [...byFp.values()];
      console.log(`Writing ${rows.length} cached rows from ${c.at} (${rows.filter((r) => r.club_ein).length} matched to a 990)…`);
      const w = await writeSourcedJobs(db, rows, c.knownIds || []);
      console.log(JSON.stringify(w, null, 2));
    } else {
      console.log(`Scout ${write ? 'WRITE' : 'DRY'} run — sources: ${sources?.join(',') || 'all'}`);
      const s = await runScout({ db, write, sources, budgetMs: 30 * 60_000, returnRows: true });
      for (const src of s.sources) {
        console.log(`\n=== ${src.source}: listed ${src.listed}, known ${src.known}, extracted ${src.extracted}, kept ${src.kept}, rejected ${src.rejected}, deferred ${src.deferred}`);
        for (const e of src.errors.slice(0, 5)) console.log(`  ! ${e}`);
        for (const j of src.samples) {
          const pay = j.comp_text || (j.est_comp ? `est. $${j.est_comp.toLocaleString()}` : '—');
          console.log(`  • ${j.club_name} — ${j.title} [${j.role_level}] · ${[j.city, j.state].filter(Boolean).join(', ')} · ${pay}${j.club_ein ? ` · 990 ${j.club_ein}` : ''}`);
          console.log(`      ${(j.summary || '').slice(0, 220)}`);
          console.log(`      ${j.source_url}`);
        }
      }
      console.log(`\nUnique jobs after cross-source dedupe: ${s.rows?.length ?? 0} · matched to a 990: ${s.matched990}`);
      if (write) console.log(`DB: inserted ${s.inserted}, updated ${s.updated}, touched ${s.touched}, expired ${s.expired}`);
      for (const e of s.errors) console.log(`  ! ${e}`);
      writeFileSync(CACHE, JSON.stringify({ at: s.finishedAt, rows: s.rows, knownIds: s.knownIds }));
      console.log(`(rows cached to ${CACHE})`);
    }
  }

  if (write || contactsOnly) {
    console.log('\nContact finder…');
    const c = await runContacts({ db, write, limit: Number(args.find((a) => a.startsWith('--contacts='))?.slice(11) || 15) });
    console.log(JSON.stringify(c, null, 2));
  }

  if (write || contactsOnly) {
    const count = async (t: string, f?: (q: any) => any) => {
      let q = db.from(t).select('id', { count: 'exact', head: true });
      if (f) q = f(q);
      return (await q).count;
    };
    console.log('\nRow counts:', {
      sourced_jobs: await count('connect_sourced_jobs'),
      sourced_active: await count('connect_sourced_jobs', (q) => q.eq('status', 'active')),
      with_990: await count('connect_sourced_jobs', (q) => q.not('club_ein', 'is', null)),
      club_contacts: await count('connect_club_contacts'),
      contacts_with_email: await count('connect_club_contacts', (q) => q.not('email', 'is', null)),
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
