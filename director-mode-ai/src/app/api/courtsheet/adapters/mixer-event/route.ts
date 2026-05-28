import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { syncMixerEvent, cancelMixerEvent } from '@/lib/courtsheet/adapters/mixer';
import { ADAPTERS_ENABLED } from '@/lib/courtsheet/adapters/common';

export const dynamic = 'force-dynamic';

/**
 * POST /api/courtsheet/adapters/mixer-event
 *   body: { event_id, op?: 'sync' | 'cancel' }
 *
 * Called by the client AFTER inserting an events row, OR by server-side
 * routes that mutate event scheduling. No-op when ENABLE_COURTSHEET_WRITES
 * is unset — the response says so explicitly.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const event_id = body?.event_id as string | undefined;
  const op = (body?.op as 'sync' | 'cancel' | undefined) ?? 'sync';
  if (!event_id) return NextResponse.json({ error: 'Missing event_id' }, { status: 400 });

  if (!ADAPTERS_ENABLED) {
    return NextResponse.json({ adapter: 'disabled', reason: 'ENABLE_COURTSHEET_WRITES is off' });
  }

  const result =
    op === 'cancel' ? await cancelMixerEvent(event_id) : await syncMixerEvent(event_id);
  return NextResponse.json({ result });
}
