import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { pastPaidEvents, juniorLeagueSources } from '@/lib/campaigns/sources';

// GET /api/campaigns/past-events?eventId=<id>
//
// The pool behind "Invite past players": which of this director's past events
// have paying families, and how many. The panel renders these as checkboxes so
// a director can pull from last season's 12U draw but leave out the Open one.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const eventId = req.nextUrl.searchParams.get('eventId') || '';
  if (!eventId) return NextResponse.json({ error: 'Missing eventId' }, { status: 400 });

  // Own the target before revealing anything about the director's other events.
  const admin = getSupabaseAdmin();
  const { data: ev } = await admin.from('events').select('user_id').eq('id', eventId).maybeSingle();
  if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  if ((ev as { user_id: string }).user_id !== user.id) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  /*
   * Past paid events AND the club's own junior league rosters. The second is
   * the obvious audience for a junior event and was missing: last summer's JTT
   * players never paid the club through an event, so nothing here could see
   * them.
   */
  const events = [
    ...(await pastPaidEvents(user.id, eventId)),
    ...(await juniorLeagueSources(user.id)),
  ];
  return NextResponse.json({ events });
}
