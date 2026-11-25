/**
 * POST { id, ok, result?, error? } — the worker reports a job. If the director stopped waiting
 * (input.notify), the result's `text` is texted to their line.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendTo, type Channel } from '@/lib/textstaff/channels';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const key = process.env.BRIDGE_SECRET;
  if (!key || req.headers.get('authorization') !== `Bearer ${key}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!b?.id) return NextResponse.json({ error: 'id' }, { status: 400 });
  const db = getSupabaseAdmin();
  const { data } = await db.from('bridge_jobs')
    .update({ status: b.ok ? 'done' : 'failed', result: b.result ?? null, error: b.ok ? null : String(b.error ?? 'failed').slice(0, 500), done_at: new Date().toISOString() })
    .eq('id', b.id).select('user_id, input').maybeSingle();
  const job = data as { user_id: string | null; input: Record<string, any> } | null;
  const text = b.ok ? b.result?.text : `That didn't work on the club computer: ${String(b.error ?? '').slice(0, 200)}`;
  if (job?.user_id && job.input?.notify && text) {
    const { data: lines } = await db.from('text_lines').select('id, channel, address').eq('user_id', job.user_id).eq('status', 'active').not('address', 'is', null);
    for (const l of ((lines as { id: string; channel: Channel; address: string }[] | null) ?? [])) {
      await sendTo(l.channel, l.address, String(text), { userId: job.user_id, lineId: l.id, kind: 'reply' });
    }
  }
  return NextResponse.json({ ok: true });
}
