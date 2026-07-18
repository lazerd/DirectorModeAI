import Anthropic from '@anthropic-ai/sdk';
import { PERSONAS, personaById, ROSTER_BRIEF } from './personas';

// Club Hub generation engine. One model call acts as the "writers' room" for the
// whole cast: given the recent transcript it emits a short burst of new messages
// from a few different personas, who react to each other and to any real
// director's post. Doing it in a single call (rather than one call per persona)
// is cheaper and produces more coherent back-and-forth banter.

const MODEL = process.env.AI_MODEL_AGENT ?? 'claude-sonnet-4-6';
const KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;

export type HubMessage = {
  id: string;
  author_name: string;
  persona_id: string | null;
  is_persona: boolean;
  body: string;
  created_at: string;
};

export type GeneratedMsg = { persona_id: string; body: string };

function transcript(recent: HubMessage[]): string {
  if (!recent.length) return '(the room is empty — no messages yet)';
  return recent
    .map((m) => `${m.author_name}${m.is_persona ? '' : ' (real director)'}: ${m.body}`)
    .join('\n');
}

const SYSTEM = `You write the ongoing group chat for "Club Hub" — a lively online community where directors and general managers of racquet-sports clubs (tennis, and some padel/pickleball) hang out, swap stories, ask questions, and share best practices. It should feel like a real, warm, funny professional Slack/Discord that people love checking in on.

THE CAST (voice any of them; they know each other well and reference each other by first name):
${ROSTER_BRIEF}

HOW TO WRITE THE ROOM:
- Produce a short burst of NEW messages continuing the conversation naturally.
- Messages are short and chatty — one to three sentences, like real chat. No essays.
- Personas react to each other: agree, tease, one-up with a story, answer a question, tag someone by first name, start a fresh topic sometimes.
- Keep it grounded in real club-operations life: leagues, mixers, member drama, staffing, court maintenance, weather, stringing, juniors, retention, events, pro shop, budgets, pickleball tension. Concrete specifics beat generic platitudes.
- Vary who speaks. Don't have the same persona post twice in a row. Match each persona's voice and obsessions.
- Never break character, never mention being an AI, a model, a prompt, or "generating" anything. Never claim a specific verifiable real identity or real club name beyond the character's general description.
- Wholesome and professional: no politics, no slurs, no explicit content, no real named people, no medical/legal advice.

OUTPUT FORMAT — return ONLY a JSON array (no prose, no code fences) of 2 to 4 objects:
[{"persona_id":"marcus","body":"..."}, ...]
Use persona_id values exactly from the cast list above.`;

function extractJson(text: string): GeneratedMsg[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch {
    return [];
  }
}

/**
 * Generate a burst of persona messages continuing the room. If `answerHuman` is
 * set, the burst is steered to helpfully engage that real director's post.
 * Returns validated messages (known persona_id, non-empty, length-capped).
 */
export async function generateBurst(
  recent: HubMessage[],
  opts?: { answerHuman?: HubMessage; count?: number },
): Promise<{ ok: true; messages: GeneratedMsg[] } | { ok: false; error: string }> {
  if (!KEY) return { ok: false, error: 'missing ANTHROPIC_API_KEY' };

  const want = Math.max(2, Math.min(4, opts?.count ?? 3));
  const instruction = opts?.answerHuman
    ? `A real director, ${opts.answerHuman.author_name}, just posted: "${opts.answerHuman.body}"\nContinue the room with ${want} messages in which the most relevant personas give genuinely useful, specific, friendly help answering them (and can banter a bit too). Address them by name.`
    : recent.length === 0
      ? `Kick off the room with ${want} opening messages that start a natural conversation among a few personas (a story, a question, a hot take).`
      : `Continue the room with ${want} natural new messages reacting to what was just said and/or opening a fresh thread.`;

  const client = new Anthropic({ apiKey: KEY });
  let response: Anthropic.Messages.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 900,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }] as unknown as Anthropic.Messages.TextBlockParam[],
      messages: [
        {
          role: 'user',
          content: `RECENT MESSAGES (oldest to newest):\n${transcript(recent)}\n\n${instruction}`,
        },
      ],
    });
  } catch (e: any) {
    return { ok: false, error: e?.message || 'model call failed' };
  }

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text).join('');

  const raw = extractJson(text);
  const validIds = new Set(PERSONAS.map((p) => p.id));
  const messages: GeneratedMsg[] = [];
  let last = '';
  for (const m of raw) {
    const id = String((m as any)?.persona_id ?? '').trim();
    const body = String((m as any)?.body ?? '').trim().slice(0, 600);
    if (!validIds.has(id) || !body) continue;
    if (id === last) continue; // avoid same persona twice in a row
    messages.push({ persona_id: id, body });
    last = id;
  }
  if (!messages.length) return { ok: false, error: 'no valid messages parsed' };
  return { ok: true, messages: messages.slice(0, 4) };
}

/** Resolve a persona's display name for storing on a message. */
export const personaName = (id: string): string => personaById(id)?.name ?? 'Director';
