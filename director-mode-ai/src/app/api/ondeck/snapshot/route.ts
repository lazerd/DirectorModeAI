import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Publish a wait-board snapshot for the public board.
 *
 * The announcer page on the tournament desk holds Darrin's Serve Tennis
 * token and computes the board locally; it posts the finished, sanitised
 * result here. The token itself never leaves that laptop, and the public
 * board reads only what this route stored.
 *
 * Writing requires a signed-in ClubMode user — otherwise anyone could
 * publish a fake order of play to a board players are trusting.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Sign in to ClubMode on this device to publish the public board.' },
      { status: 401 }
    );
  }

  let body: { slug?: string; title?: string; payload?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  const slug = (body.slug ?? '').trim().toLowerCase();
  if (!/^[a-z0-9-]{3,64}$/.test(slug)) {
    return NextResponse.json({ error: 'bad_slug' }, { status: 400 });
  }
  if (!body.payload || typeof body.payload !== 'object') {
    return NextResponse.json({ error: 'bad_payload' }, { status: 400 });
  }

  const service = await createServiceClient();
  const { error } = await service
    .from('td_snapshots')
    .upsert(
      {
        slug,
        title: (body.title ?? '').slice(0, 200),
        payload: body.payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'slug' }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
