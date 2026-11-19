import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { standings, teamScore, type GuestMixer } from '@/lib/mixer/guestMixer';
import { awards } from './core';

/**
 * "Call the game": an AI sportscaster recap built ONLY from facts we recorded
 * (scores, partners, the crown). Every player gets one line about them. Players
 * can soften or skip their own line. Nothing is invented: the model is handed a
 * fact sheet and told to use nothing else.
 */
const KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;
const MODEL = process.env.AI_MODEL_RECAP ?? 'claude-sonnet-5-5';

export type Spice = 'mild' | 'club' | 'locker';
export interface RecapLine { id: string; name: string; tag: string; line: string; skipped?: boolean }
export interface Recap { headline: string; story: string; lines: RecapLine[]; spice: Spice; crown?: string | null; at: string }

export interface CrownChange { place: string; before: string | null; after: string | null }

function facts(m: GuestMixer, title: string, crown: CrownChange | null) {
  const name = (id: string) => m.players.find((p) => p.id === id)?.name ?? '?';
  const st = standings(m);
  const rounds = m.rounds.map((r) => ({
    round: r.number,
    matches: r.matches.filter((x) => x.scoreA != null && x.scoreB != null).map((x) => ({
      court: x.court, team1: x.teamA.map(name), team2: x.teamB.map(name), score: `${x.scoreA}-${x.scoreB}`,
    })),
    sat: r.sittingOut.map(name),
  }));
  // streaks per player
  const streak: Record<string, string> = {};
  for (const p of m.players) {
    const seq: string[] = [];
    for (const r of m.rounds) for (const x of r.matches) {
      if (x.scoreA == null || x.scoreB == null) continue;
      if (x.teamA.includes(p.id)) seq.push(x.scoreA > x.scoreB ? 'W' : x.scoreA < x.scoreB ? 'L' : 'T');
      if (x.teamB.includes(p.id)) seq.push(x.scoreB > x.scoreA ? 'W' : x.scoreB < x.scoreA ? 'L' : 'T');
    }
    streak[p.name] = seq.join('');
  }
  return {
    event: title,
    standings: st.map((s, i) => ({ place: i + 1, name: s.name, wins: s.wins, losses: s.losses, games_for: s.gamesFor, games_against: s.gamesAgainst, results_in_order: streak[s.name] })),
    awards: awards(m).map((a) => ({ award: a.title, who: a.who, why: a.why })),
    rounds,
    team_battle: m.format === 'team-battle' ? { teams: m.players.reduce((acc, p) => { if (p.team) (acc[p.team] ||= []).push(p.name); return acc; }, {} as Record<string, string[]>), courts_won: teamScore(m), team_names: (m as GuestMixer & { teamNames?: unknown }).teamNames ?? null } : null,
    king_of_the_court: crown ? { place: crown.place, before_tonight: crown.before, after_tonight: crown.after, changed_hands: !!crown.after && crown.before !== crown.after } : null,
  };
}

const TOOL = {
  name: 'call_the_game',
  description: 'The recap of a rec tennis/pickleball night.',
  input_schema: {
    type: 'object' as const,
    properties: {
      headline: { type: 'string', description: 'Newspaper sports-page headline, max 12 words. Names real players. Punchy, funny.' },
      story: { type: 'string', description: '3 sentences, sportscaster voice, built only from the facts. Mention the crown if it changed hands.' },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Exactly as in standings.' },
            tag: { type: 'string', description: '2-3 word nickname for tonight, e.g. "Human Backboard", "Comeback Kid", "Carried Hard".' },
            line: { type: 'string', description: 'One sentence (max 22 words) about this player tonight, grounded in their real results.' },
          },
          required: ['name', 'tag', 'line'],
        },
      },
    },
    required: ['headline', 'story', 'lines'],
  },
};

const SPICE: Record<Spice, string> = {
  mild: 'Warm and celebratory. Gentle humor only. Everyone should feel good.',
  club: 'Playful ribbing like friends at the club bar. Tease results, never the person.',
  locker: 'Locker-room roast. Sharper teasing about results, still affectionate.',
};

const RULES = `Hard rules:
- Use ONLY the facts given. Never invent shots, points, injuries, or anything not in the data.
- Tease results and play (scores, streaks, partners, sitting out), NEVER looks, body, age, gender, ethnicity, money, or anything personal.
- No profanity. Nothing a club would be embarrassed to see on a screen.
- One line for EVERY player in standings.`;

export async function callTheGame(m: GuestMixer, title: string, spice: Spice, crown: CrownChange | null): Promise<Recap | null> {
  if (!KEY) return null;
  const st = standings(m);
  if (!st.length) return null;
  const client = new Anthropic({ apiKey: KEY });
  const r = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    tools: [TOOL],
    tool_choice: { type: 'auto' },
    system: `You are the sportscaster for a recreational tennis/pickleball group. Tone: ${SPICE[spice]}\n${RULES}`,
    messages: [{ role: 'user', content: `Call the call_the_game tool with the recap. Facts from tonight (JSON):\n${JSON.stringify(facts(m, title, crown))}` }],
  });
  const use = r.content.find((c) => c.type === 'tool_use');
  if (!use || use.type !== 'tool_use') return null;
  const x = use.input as { headline: string; story: string; lines: { name: string; tag: string; line: string }[] };
  const byName = new Map(m.players.map((p) => [p.name.toLowerCase(), p.id]));
  const lines: RecapLine[] = (x.lines ?? []).map((l) => ({ id: byName.get(String(l.name).toLowerCase()) ?? '', name: l.name, tag: String(l.tag).slice(0, 40), line: String(l.line).slice(0, 240) })).filter((l) => l.id);
  const crownLine = crown?.after && crown.before !== crown.after
    ? `👑 ${crown.after} takes the crown at ${crown.place}${crown.before ? ` from ${crown.before}` : ''}.`
    : crown?.after ? `👑 ${crown.after} still rules ${crown.place}.` : null;
  return { headline: String(x.headline).slice(0, 140), story: String(x.story).slice(0, 700), lines, spice, crown: crownLine, at: new Date().toISOString() };
}

/** Rewrite one player's line, gentler. */
export async function softenLine(m: GuestMixer, title: string, line: RecapLine): Promise<string | null> {
  if (!KEY) return null;
  const client = new Anthropic({ apiKey: KEY });
  const r = await client.messages.create({
    model: MODEL, max_tokens: 200,
    system: `You write one warm, kind, celebratory sentence (max 22 words) about a rec tennis/pickleball player's night, using ONLY the facts given. No teasing at all.\n${RULES}`,
    messages: [{ role: 'user', content: `Player: ${line.name}\nFacts (JSON): ${JSON.stringify(facts(m, title, null))}\nReply with only the sentence.` }],
  });
  const t = r.content.find((c) => c.type === 'text');
  return t && t.type === 'text' ? t.text.trim().replace(/^"|"$/g, '').slice(0, 240) : null;
}

/* ---------- Pre-game: "Tale of the Tape". The invite is the entertainment. ---------- */
export interface Preview { headline: string; lines: { id: string; name: string; line: string }[]; at: string }

const HYPE_RULES = `You are the hype announcer for a recreational tennis/pickleball game being organized.
- Playful fight-night / sports-betting energy, but warm. Everyone should want to be in it.
- You know NOTHING about these players' skill: never claim stats, results, ratings, or history. Joke about the occasion, the time, the place, showing up, bragging rights.
- Never mention looks, body, age, gender, ethnicity, money or anything personal. No profanity.
- Wit over volume: no ALL CAPS, at most one exclamation mark per line, no cliches like "in the building" or "heating up". Dry, clever, specific to the time and place.
- Never state how many spots are open or how many players are in: the page shows the live count right below you, and a number you write goes stale on the next join.
- These players have CONFIRMED, they have not arrived. Never say they showed up, arrived or are at the courts. Get the time right or leave it out.
- Match the format you are given: no "bracket", "seeds" or "draw" unless it is a tournament.`;

export async function hypePreview(ev: { title: string; when: string | null; location: string | null; level: string | null; spots: number; sport: string; format?: string }, players: { id: string; name: string }[]): Promise<Preview | null> {
  if (!KEY) return null;
  const client = new Anthropic({ apiKey: KEY });
  const r = await client.messages.create({
    model: process.env.AI_MODEL_ROUTER ?? 'claude-haiku-4-5',
    max_tokens: 700,
    system: HYPE_RULES,
    messages: [{ role: 'user', content: `Game: ${JSON.stringify({ ...ev, players_in: players.map((p) => p.name) })}
Reply with JSON only: {"headline": "<max 10 words, fight-night poster style>", "lines": [{"name": "<exact name>", "line": "<max 14 words, betting-line style hype>"}]} with one line per player in players_in.` }],
  });
  const t = r.content.find((c) => c.type === 'text');
  if (!t || t.type !== 'text') return null;
  try {
    const j = JSON.parse(t.text.slice(t.text.indexOf('{'), t.text.lastIndexOf('}') + 1)) as { headline: string; lines: { name: string; line: string }[] };
    const byName = new Map(players.map((p) => [p.name.toLowerCase(), p.id]));
    return {
      headline: String(j.headline).slice(0, 100),
      lines: (j.lines ?? []).map((l) => ({ id: byName.get(String(l.name).toLowerCase()) ?? '', name: l.name, line: String(l.line).slice(0, 160) })).filter((l) => l.id),
      at: new Date().toISOString(),
    };
  } catch { return null; }
}

/** One line for a player who just tapped "I'm in". */
export async function hypeJoin(ev: { title: string; when: string | null; location: string | null; format?: string }, name: string, others: string[]): Promise<string | null> {
  if (!KEY) return null;
  const client = new Anthropic({ apiKey: KEY });
  const r = await client.messages.create({
    model: process.env.AI_MODEL_ROUTER ?? 'claude-haiku-4-5',
    max_tokens: 80,
    system: HYPE_RULES,
    messages: [{ role: 'user', content: `${name} just confirmed for "${ev.title}"${ev.format ? ' (format: ' + ev.format + ')' : ''}${ev.when ? ' (' + ev.when + ')' : ''}${ev.location ? ' at ' + ev.location : ''}. Already in: ${others.join(', ') || 'nobody yet'}. Write ONE announcer line (max 14 words) about ${name} confirming. Reply with only the line.` }],
  });
  const t = r.content.find((c) => c.type === 'text');
  return t && t.type === 'text' ? t.text.trim().replace(/^"|"$/g, '').slice(0, 160) : null;
}
