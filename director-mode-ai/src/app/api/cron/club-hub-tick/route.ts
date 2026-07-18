import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { generateBurst, personaName, type HubMessage } from '@/lib/clubhub/generate';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Scheduled "tick" that keeps Club Hub alive. Vercel Cron calls this on a
// schedule (see vercel.json). Each run:
//   - if the room is empty, seeds a backdated backlog so it's never blank;
//   - if a real director has an unanswered post, has personas answer it;
//   - otherwise adds a small simmer of persona banter.
// Persona rows are inserted with the service role (bypasses RLS).

const RECENT_WINDOW = 40;

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization');
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. In prod we require it.
  if (process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
    return auth === `Bearer ${process.env.CRON_SECRET}`;
  }
  return true;
}

type Row = HubMessage & { reply_to: string | null };

async function loadRecent(admin: ReturnType<typeof getSupabaseAdmin>): Promise<Row[]> {
  const { data } = await admin
    .from('club_hub_messages')
    .select('id, author_name, persona_id, is_persona, body, created_at, reply_to')
    .order('created_at', { ascending: false })
    .limit(RECENT_WINDOW);
  return ((data as Row[]) || []).slice().reverse(); // chronological
}

// Insert a burst of persona messages, staggered a few seconds apart so ordering
// is stable. Optionally links the first message as a reply to a human post.
async function insertBurst(
  admin: ReturnType<typeof getSupabaseAdmin>,
  messages: { persona_id: string; body: string }[],
  opts?: { baseTime?: number; replyTo?: string | null },
) {
  const base = opts?.baseTime ?? Date.now();
  const rows = messages.map((m, i) => ({
    body: m.body,
    is_persona: true,
    persona_id: m.persona_id,
    author_name: personaName(m.persona_id),
    reply_to: i === 0 ? opts?.replyTo ?? null : null,
    created_at: new Date(base + i * 7000).toISOString(),
  }));
  const { error } = await admin.from('club_hub_messages').insert(rows);
  return { inserted: error ? 0 : rows.length, error: error?.message };
}

// Find a recent human post that no persona has replied to yet.
function unansweredHuman(recent: Row[]): Row | null {
  const lastHuman = [...recent].reverse().find((m) => !m.is_persona);
  if (!lastHuman) return null;
  const answered = recent.some((m) => m.is_persona && m.created_at > lastHuman.created_at);
  return answered ? null : lastHuman;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try { admin = getSupabaseAdmin(); }
  catch (e: any) { return NextResponse.json({ error: e?.message || 'no admin client' }, { status: 500 }); }

  const { count } = await admin
    .from('club_hub_messages')
    .select('id', { count: 'exact', head: true });

  // ---- Seed an empty room with a backdated, established-looking backlog. ----
  if ((count ?? 0) === 0) {
    const SEED_BURSTS = 4;
    const DAY = 24 * 60 * 60 * 1000;
    let history: HubMessage[] = [];
    let totalInserted = 0;
    // Spread the backlog from ~4 days ago up to ~1 hour ago.
    const startAt = Date.now() - 4 * DAY;
    const step = (4 * DAY - 60 * 60 * 1000) / SEED_BURSTS;
    for (let b = 0; b < SEED_BURSTS; b++) {
      const gen = await generateBurst(history, { count: 4 });
      if (!gen.ok) break;
      const baseTime = startAt + b * step;
      const res = await insertBurst(admin, gen.messages, { baseTime });
      totalInserted += res.inserted;
      // Feed generated messages back as context for the next burst's continuity.
      history = history.concat(gen.messages.map((m, i) => ({
        id: `seed-${b}-${i}`, author_name: personaName(m.persona_id),
        persona_id: m.persona_id, is_persona: true, body: m.body,
        created_at: new Date(baseTime + i * 7000).toISOString(),
      })));
    }
    return NextResponse.json({ ok: true, mode: 'seed', inserted: totalInserted });
  }

  // ---- Normal tick. ----
  const recent = await loadRecent(admin);
  const human = unansweredHuman(recent);
  const gen = await generateBurst(recent, human ? { answerHuman: human, count: 3 } : { count: 3 });
  if (!gen.ok) return NextResponse.json({ ok: false, error: gen.error }, { status: 502 });

  const res = await insertBurst(admin, gen.messages, { replyTo: human?.id ?? null });
  return NextResponse.json({
    ok: true,
    mode: human ? 'answer-human' : 'simmer',
    inserted: res.inserted,
    ...(res.error ? { error: res.error } : {}),
  });
}
