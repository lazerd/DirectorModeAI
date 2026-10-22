import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';
import { runRecruiter } from '@/lib/connect/recruiter/run';

// GET /api/cron/recruiting-recruit — the RECRUITER engine of the recruiting flywheel.
// Evaluates new sourced jobs, ranks prospects, drafts outreach, and sends only
// what is allowed: approved rows and auto drafts to opted-in candidates.
// Club pitches and 990-prospect notes always wait for a human in /admin/recruiting.
// `?dryRun=1` runs everything except sending. POST: platform owner, same thing.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  return NextResponse.json({ dryRun, ...(await runRecruiter({ send: !dryRun })) });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isPlatformOwnerEmail(user.email)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  return NextResponse.json({ dryRun, ...(await runRecruiter({ send: !dryRun })) });
}
