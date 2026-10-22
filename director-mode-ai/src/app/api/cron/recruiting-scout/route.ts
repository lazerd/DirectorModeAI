import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';
import { runScout } from '@/lib/connect/scout/run';
import { runContacts } from '@/lib/connect/scout/contacts';

// /api/cron/recruiting-scout — the Scout half of the recruiting flywheel.
//
// Scrapes the public racquets job boards (RSPA, PTR, KK&W, MyCoachingTree,
// Hospitality Online) politely, extracts facts + our own summary, matches the
// club to its Form 990, estimates comp when unposted, upserts
// connect_sourced_jobs and expires stale rows; then looks up decision-makers
// on club websites for jobs that have none. Sends nothing.
//
// GET: Vercel cron (Bearer CRON_SECRET). POST: the platform owner, signed in,
// to run it by hand. `?dryRun=1` writes nothing; `?sources=rspa,ptr` limits it;
// `?contacts=0` skips the contact finder.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SCRAPE_BUDGET_MS = 170_000;
const TOTAL_BUDGET_MS = 270_000;

async function run(request: NextRequest) {
  const started = Date.now();
  const p = request.nextUrl.searchParams;
  const dryRun = p.get('dryRun') === '1';
  const sources = p.get('sources')?.split(',').map((s) => s.trim()).filter(Boolean);
  const db = getSupabaseAdmin();

  const scout = await runScout({ db, write: !dryRun, sources, budgetMs: SCRAPE_BUDGET_MS });
  const contacts =
    p.get('contacts') === '0'
      ? null
      : await runContacts({ db, write: !dryRun, limit: 12, deadline: started + TOTAL_BUDGET_MS });

  return NextResponse.json({ ok: true, dryRun, ms: Date.now() - started, scout, contacts });
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return await run(request);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isPlatformOwnerEmail(user.email)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    return await run(request);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
