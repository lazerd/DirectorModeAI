import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { syncQuadsEvent } from '@/lib/courtsheet/adapters/quads';
import { ADAPTERS_ENABLED } from '@/lib/courtsheet/adapters/common';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const event_id = body?.event_id as string | undefined;
  if (!event_id) return NextResponse.json({ error: 'Missing event_id' }, { status: 400 });

  if (!ADAPTERS_ENABLED) {
    return NextResponse.json({ adapter: 'disabled', reason: 'ENABLE_COURTSHEET_WRITES is off' });
  }

  const result = await syncQuadsEvent(event_id);
  return NextResponse.json({ result });
}
