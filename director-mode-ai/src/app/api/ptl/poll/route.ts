import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { checkRateLimit, clampText, clientIp } from '@/lib/ptl/guard';
import { PILOT_POLL_SLUG, cleanAnswers } from '@/lib/ptl/pilotPoll';

// POST /api/ptl/poll — save one person's pilot-poll answers.
// Same email again = update, so someone can come back and change their mind.
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!checkRateLimit(`ptl-poll:${clientIp(request)}`, 10)) {
    return NextResponse.json({ error: 'Too many submissions. Give it a minute.' }, { status: 429 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }

  const name = clampText(body?.name, 80);
  const email = clampText(body?.email, 160)?.toLowerCase() ?? null;
  if (!name) return NextResponse.json({ error: 'Add your name.' }, { status: 400 });
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'Add a valid email.' }, { status: 400 });
  }

  const answers = cleanAnswers(body?.answers);
  if (Object.keys(answers).length === 0) {
    return NextResponse.json({ error: 'Answer at least one question.' }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const { data: existing } = await db
    .from('ptl_poll_responses')
    .select('id')
    .eq('poll_slug', PILOT_POLL_SLUG)
    .ilike('email', email)
    .maybeSingle();

  const write = existing
    ? db
        .from('ptl_poll_responses')
        .update({ name, answers, updated_at: new Date().toISOString() })
        .eq('id', (existing as any).id)
    : db.from('ptl_poll_responses').insert({ poll_slug: PILOT_POLL_SLUG, name, email, answers });

  const { error } = await write;
  if (error) {
    console.error('ptl poll save failed', error);
    return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, updated: !!existing });
}
