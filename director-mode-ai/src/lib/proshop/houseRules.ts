import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { STAFF, STAFF_IDS } from '@/lib/proshop/staff';

/*
 * House rules: what the staff have been taught about ONE club (Darrin 11/26/26, "train the
 * agents"). STAFF in staff.ts is the same for every club; these are the club's own way of
 * doing things: who never gets billed, which courts matches go on, when billing runs.
 *
 * Stored per club + staff member in proshop_agents.rules; agent 'club' holds club-wide facts.
 * Every Ask Claude answer for the club (web chat, /proshop, text) carries them, so a rule
 * taught once by text holds everywhere. Directors add a rule by telling any staff member
 * "remember ..." (packs/houseRules.ts, previewed before it is saved).
 */

export interface HouseRule { text: string; source: 'seed' | 'director'; at: string }
export const CLUB_WIDE = 'club';
export const RULE_AGENTS = new Set([CLUB_WIDE, ...STAFF_IDS]);
const MAX_RULES_PER_AGENT = 40;
const MAX_RULE_CHARS = 300;

type Db = ReturnType<typeof getSupabaseAdmin>;

export async function loadHouseRules(db: Db, clubId: string): Promise<Record<string, HouseRule[]>> {
  const { data } = await db.from('proshop_agents').select('agent, rules').eq('club_id', clubId);
  const out: Record<string, HouseRule[]> = {};
  for (const r of (data as { agent: string; rules: HouseRule[] | null }[] | null) ?? []) {
    if (Array.isArray(r.rules) && r.rules.length) out[r.agent] = r.rules;
  }
  return out;
}

const nameOf = (id: string) => (id === CLUB_WIDE ? 'Everyone' : STAFF.find((s) => s.id === id)?.name ?? id);

/** The system-prompt block, or '' when the club has taught nothing yet. */
export function houseRulesPrompt(clubName: string, rules: Record<string, HouseRule[]>): string {
  const order = [CLUB_WIDE, ...STAFF.map((s) => s.id)];
  const sections = order
    .filter((id) => rules[id]?.length)
    .map((id) => `${nameOf(id)}:\n${rules[id].map((r) => `- ${r.text}`).join('\n')}`);
  if (!sections.length) return '';
  return `HOUSE RULES for ${clubName}. The director taught you these. They are how this club works and they override your general habits. Follow them without being reminded. When a rule decides the answer, lead with it (the number, the yes or no, the better option) in your first line; only then ask for anything still missing. Never answer a rule question with only a question. If a request would break one, say which rule and offer the version that keeps it.
${sections.join('\n\n')}`;
}

export function normalizeRule(text: unknown): string | null {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 4) return null;
  return t.slice(0, MAX_RULE_CHARS);
}

export async function addHouseRule(db: Db, clubId: string, agent: string, text: string, source: HouseRule['source'] = 'director') {
  const all = await loadHouseRules(db, clubId);
  const current = all[agent] ?? [];
  const norm = text.toLowerCase();
  if (current.some((r) => r.text.toLowerCase() === norm)) return { added: false, count: current.length };
  const next = [...current, { text, source, at: new Date().toISOString() }].slice(-MAX_RULES_PER_AGENT);
  const { error } = await db
    .from('proshop_agents')
    .upsert({ club_id: clubId, agent, rules: next, updated_at: new Date().toISOString() }, { onConflict: 'club_id,agent' });
  if (error) throw new Error(error.message);
  return { added: true, count: next.length };
}

export async function removeHouseRule(db: Db, clubId: string, agent: string, index: number) {
  const all = await loadHouseRules(db, clubId);
  const current = all[agent] ?? [];
  if (index < 0 || index >= current.length) return null;
  const [gone] = current.splice(index, 1);
  const { error } = await db
    .from('proshop_agents')
    .update({ rules: current, updated_at: new Date().toISOString() })
    .eq('club_id', clubId)
    .eq('agent', agent);
  if (error) throw new Error(error.message);
  return gone;
}
