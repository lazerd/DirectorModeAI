import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { normalizeDraft, type PlayDraft } from '@/lib/play/core';

/**
 * One sentence → an event draft. The browser already has a no-AI reading
 * (parseSentence); this improves it. Times come back as the host's LOCAL wall
 * clock ("2026-11-20T18:00") and the browser turns that into a real instant.
 * Any failure returns 204 and the browser keeps its own reading.
 */
export const maxDuration = 20;
const KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;
const MODEL = process.env.AI_MODEL_ROUTER ?? 'claude-haiku-4-5';

const TOOL = {
  name: 'make_event',
  description: 'The tennis, pickleball or padel get-together the person described.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Short, warm title, max 6 words, e.g. "Friday Night Doubles Mixer". No emoji.' },
      sport: { type: 'string', enum: ['tennis', 'pickleball', 'padel'] },
      kind: { type: 'string', enum: ['game', 'social'], description: 'game = one court, a fixed group (e.g. a doubles 4some or a singles hit). social = rotating partners across courts (mixer, round robin).' },
      format: { type: 'string', enum: ['maximize-courts', 'king-of-court', 'team-battle', 'doubles', 'mixed-doubles', 'singles'], description: 'team-battle if two teams/clubs/groups play each other ("Team Battle", "us vs them", "Ryder Cup"). king-of-court if they say King of the Court or up-and-down-the-river. maximize-courts ("Optimize Courts": doubles where possible, singles with leftovers, every court full) is the DEFAULT for any social/mixer/round robin unless they say mixed or singles. A fixed 4some = doubles.' },
      local_start: { type: 'string', description: 'Start as local wall-clock "YYYY-MM-DDTHH:mm", resolved against the current local time given. Omit if no time was said.' },
      when_text: { type: 'string', description: 'How to say it, e.g. "Fri 6pm". Omit if no time.' },
      location: { type: 'string', description: 'Courts / park / club as said. Omit if none.' },
      level: { type: 'string', description: 'Level as said: "3.5–4.0", "4.0+", "DUPR 3.5", "beginners". Omit if none.' },
      spots: { type: 'integer', description: 'ONLY if they gave a number of players, or it is a single fixed game: total INCLUDING the person posting. "Need a fourth" = 4. "Need 2 more for doubles" = 4. Omit for a mixer/social/round robin with no number: the host checks in whoever shows up.' },
      courts: { type: 'integer' },
      round_minutes: { type: 'integer', description: 'Minutes per round for a social, if said.' },
      notes: { type: 'string', description: 'Anything else worth telling players (bring balls, cost, etc). Omit if none.' },
    },
    required: ['title', 'sport', 'kind', 'format'],
  },
};

export async function POST(req: Request) {
  if (!KEY) return new NextResponse(null, { status: 204 });
  try {
    const b = (await req.json()) as { text?: string; local?: string };
    const text = String(b.text ?? '').trim().slice(0, 500);
    if (!text) return new NextResponse(null, { status: 204 });
    const client = new Anthropic({ apiKey: KEY });
    const r = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'make_event' },
      messages: [{ role: 'user', content: `Current local time: ${String(b.local ?? '').slice(0, 40)}\n\nWhat they said:\n${text}` }],
    });
    const use = r.content.find((c) => c.type === 'tool_use');
    if (!use || use.type !== 'tool_use') return new NextResponse(null, { status: 204 });
    const x = use.input as Partial<PlayDraft> & { local_start?: string };
    return NextResponse.json({ draft: normalizeDraft({ ...x, starts_at: null }), local_start: x.local_start ?? null });
  } catch {
    return new NextResponse(null, { status: 204 });
  }
}
