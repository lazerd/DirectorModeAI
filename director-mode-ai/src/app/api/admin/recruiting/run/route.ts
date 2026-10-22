import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/connect/recruiter/adminAuth';
import { runRecruiter } from '@/lib/connect/recruiter/run';
import { APP_URL } from '@/lib/appUrl';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST { engine: 'recruiter' | 'scout', dryRun?: boolean }
// recruiter runs in-process; scout is the sibling cron (/api/cron/recruiting-scout), called with CRON_SECRET.
export async function POST(req: Request) {
  const gate = await requireOwner();
  if ('response' in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  if (body.engine === 'scout') {
    const origin = new URL(req.url).origin || APP_URL;
    const res = await fetch(`${origin}/api/cron/recruiting-scout`, {
      headers: process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {},
      cache: 'no-store',
    }).catch((e: unknown) => ({ ok: false, status: 0, json: async () => ({ error: String(e) }) }) as unknown as Response);
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ error: res.status === 404 ? 'Scout cron is not deployed yet.' : out.error || `scout failed (${res.status})` }, { status: 502 });
    return NextResponse.json({ ok: true, scout: out });
  }
  const result = await runRecruiter({ send: body.dryRun !== true });
  return NextResponse.json({ ok: true, recruiter: result });
}
