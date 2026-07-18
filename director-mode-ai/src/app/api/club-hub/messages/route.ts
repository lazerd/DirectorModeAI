import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const MAX_LEN = 2000;

// Display name for a human poster, from their auth profile. Personas are
// undisclosed, so humans just appear with a normal first-name-ish handle.
function displayName(user: any): string {
  const meta = user?.user_metadata ?? {};
  const full = String(meta.full_name || meta.name || '').trim();
  if (full) return full.split(/\s+/)[0]; // first name, to match the room's style
  const email = String(user?.email || '').trim();
  if (email) return email.split('@')[0];
  return 'Director';
}

// GET /api/club-hub/messages?before=<iso>&limit=50 — recent messages, chronological.
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = Math.max(1, Math.min(100, Number(searchParams.get('limit')) || 50));
  const before = searchParams.get('before');

  let q = supabase
    .from('club_hub_messages')
    .select('id, author_name, persona_id, is_persona, body, reply_to, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) q = q.lt('created_at', before);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: (data || []).slice().reverse() });
}

// POST /api/club-hub/messages { body, reply_to? } — post as the current user.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please log in to post.' }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const body = String(raw?.body ?? '').trim().slice(0, MAX_LEN);
  if (!body) return NextResponse.json({ error: 'Message is empty.' }, { status: 400 });
  const reply_to = raw?.reply_to ? String(raw.reply_to) : null;

  const { data, error } = await supabase
    .from('club_hub_messages')
    .insert({ body, reply_to, is_persona: false, user_id: user.id, author_name: displayName(user) })
    .select('id, author_name, persona_id, is_persona, body, reply_to, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message: data });
}
