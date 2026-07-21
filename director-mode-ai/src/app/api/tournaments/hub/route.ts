/**
 * Tournament HUB management (director-only).
 *
 *   GET  → the signed-in director's existing hubs [{ slug, title, count }]
 *   POST → create a new hub for an event, or add the event to an existing one.
 *          body: { eventId, mode: 'create' | 'join', title?, slug? }
 *          returns { slug, title }
 *
 * A hub is just a shared `hub_slug` across events; the public hub page lists
 * everything with that slug. Ownership is enforced against events.user_id.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/['"]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'hub'
  );
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('events')
    .select('hub_slug, hub_title')
    .eq('user_id', user.id)
    .not('hub_slug', 'is', null);

  const map = new Map<string, { slug: string; title: string; count: number }>();
  for (const r of (data as { hub_slug: string; hub_title: string | null }[]) || []) {
    const cur = map.get(r.hub_slug) || { slug: r.hub_slug, title: r.hub_title || r.hub_slug, count: 0 };
    cur.count += 1;
    if (r.hub_title) cur.title = r.hub_title;
    map.set(r.hub_slug, cur);
  }
  return NextResponse.json({ hubs: Array.from(map.values()).sort((a, b) => b.count - a.count) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { eventId, mode } = body as { eventId?: string; mode?: string; title?: string; slug?: string };
  if (!eventId || (mode !== 'create' && mode !== 'join')) {
    return NextResponse.json({ error: 'eventId and mode (create|join) required' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: ev } = await admin.from('events').select('id, user_id, name').eq('id', eventId).maybeSingle();
  if (!ev || (ev as any).user_id !== user.id) {
    return NextResponse.json({ error: 'Event not found or not yours' }, { status: 403 });
  }

  let hub_slug: string;
  let hub_title: string;

  if (mode === 'create') {
    const title = (body.title || (ev as any).name || 'Tournament Hub').toString().trim().slice(0, 80);
    hub_title = title;
    hub_slug = `${slugify(title)}-${Math.random().toString(36).slice(2, 6)}`;
  } else {
    // join: adopt an existing hub the director owns
    const slug = (body.slug || '').toString().trim();
    if (!slug) return NextResponse.json({ error: 'slug required to join' }, { status: 400 });
    const { data: existing } = await admin
      .from('events')
      .select('hub_title')
      .eq('user_id', user.id)
      .eq('hub_slug', slug)
      .limit(1)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Hub not found' }, { status: 404 });
    hub_slug = slug;
    hub_title = (existing as any).hub_title || slug;
  }

  const { error } = await admin
    .from('events')
    .update({ hub_slug, hub_title })
    .eq('id', eventId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ slug: hub_slug, title: hub_title });
}
