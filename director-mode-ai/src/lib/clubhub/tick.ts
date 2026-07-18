import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { generateBurst, personaName, type HubMessage } from './generate';

// Shared Club Hub "tick": generate one burst of persona messages continuing the
// room. Kept small (a single model call) so it fits comfortably inside any
// serverless function timeout. Called on-demand when directors are in the room
// (src/app/api/club-hub/refresh) and available to a cron route for future use.

type Row = HubMessage & { reply_to: string | null };
const RECENT_WINDOW = 40;
export const REFRESH_THRESHOLD_MS = 4 * 60 * 1000; // ambient simmer cadence (humans bypass this)

type Admin = ReturnType<typeof getSupabaseAdmin>;

async function loadRecent(admin: Admin): Promise<Row[]> {
  const { data } = await admin
    .from('club_hub_messages')
    .select('id, author_name, persona_id, is_persona, body, created_at, reply_to')
    .order('created_at', { ascending: false })
    .limit(RECENT_WINDOW);
  return ((data as Row[]) || []).slice().reverse();
}

// A recent human post that no persona has replied to yet.
function unansweredHuman(recent: Row[]): Row | null {
  const lastHuman = [...recent].reverse().find((m) => !m.is_persona);
  if (!lastHuman) return null;
  const answered = recent.some((m) => m.is_persona && m.created_at > lastHuman.created_at);
  return answered ? null : lastHuman;
}

async function insertBurst(
  admin: Admin,
  messages: { persona_id: string; body: string }[],
  replyTo: string | null,
) {
  const base = Date.now();
  const rows = messages.map((m, i) => ({
    body: m.body,
    is_persona: true,
    persona_id: m.persona_id,
    author_name: personaName(m.persona_id),
    reply_to: i === 0 ? replyTo : null,
    created_at: new Date(base + i * 5000).toISOString(),
  }));
  const { error } = await admin.from('club_hub_messages').insert(rows);
  return { inserted: error ? 0 : rows.length, error: error?.message };
}

type BurstResult = { ok: boolean; mode: string; inserted: number; skipped?: string; error?: string };

async function generateAndInsert(admin: Admin, recent: Row[], human: Row | null): Promise<BurstResult> {
  const gen = await generateBurst(recent, human ? { answerHuman: human, count: 3 } : { count: 3 });
  if (!gen.ok) return { ok: false, mode: 'error', inserted: 0, error: gen.error };
  const res = await insertBurst(admin, gen.messages, human?.id ?? null);
  return {
    ok: !res.error,
    mode: recent.length === 0 ? 'seed' : human ? 'answer-human' : 'simmer',
    inserted: res.inserted,
    error: res.error,
  };
}

/**
 * On-demand tick with throttling. ALWAYS generates when a real director has an
 * unanswered post (so replies are near-instant); otherwise only generates
 * ambient banter if the room has been quiet longer than `throttleMs`.
 */
export async function maybeRunBurst(admin: Admin, throttleMs: number): Promise<BurstResult> {
  const recent = await loadRecent(admin);
  const human = unansweredHuman(recent);
  if (!human) {
    const last = recent[recent.length - 1];
    const age = last ? Date.now() - new Date(last.created_at).getTime() : null;
    if (age !== null && age < throttleMs) return { ok: true, mode: 'skip', inserted: 0, skipped: 'fresh' };
  }
  return generateAndInsert(admin, recent, human);
}

/** Unconditional single burst (for cron / manual triggers). */
export async function runOneBurst(admin: Admin): Promise<BurstResult> {
  const recent = await loadRecent(admin);
  return generateAndInsert(admin, recent, unansweredHuman(recent));
}
