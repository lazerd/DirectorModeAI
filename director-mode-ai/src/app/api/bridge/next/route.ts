/**
 * POST — the club-computer worker asks for its next job (Bearer BRIDGE_SECRET).
 * Every call is also its heartbeat. Jobs older than a day are left alone (stale).
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { clubspotClubId } from '@/lib/bridge/jobs';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const key = process.env.BRIDGE_SECRET;
  if (!key || req.headers.get('authorization') !== `Bearer ${key}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const db = getSupabaseAdmin();
  const club = clubspotClubId();
  await db.from('bridge_workers').upsert({ club_id: club, seen_at: new Date().toISOString(), info: { host: String(body?.host ?? '').slice(0, 60), v: body?.v ?? null } });
  for (let i = 0; i < 3; i++) {
    const { data: next } = await db.from('bridge_jobs').select('id').eq('status', 'queued').eq('club_id', club)
      .gte('created_at', new Date(Date.now() - 86_400_000).toISOString()).order('created_at').limit(1).maybeSingle();
    if (!next) return NextResponse.json({ job: null });
    const { data: claimed } = await db.from('bridge_jobs').update({ status: 'running', claimed_at: new Date().toISOString() })
      .eq('id', (next as any).id).eq('status', 'queued').select('id, kind, input').maybeSingle();
    if (claimed) return NextResponse.json({ job: claimed });
  }
  return NextResponse.json({ job: null });
}
