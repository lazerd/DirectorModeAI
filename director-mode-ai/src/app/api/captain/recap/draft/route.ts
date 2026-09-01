/**
 * POST /api/captain/recap/draft — write the captain a recap message.
 *
 *   { match_id, instructions?, current? }        — drafted for a real result
 *   { team_id, outcome, instructions?, current? } — a template, ahead of time
 *
 * DRAFTS ONLY. Nothing is saved and nothing is sent: the words land in the
 * editor the captain was already looking at, and the existing preview → send
 * path is still what puts them in anyone's inbox.
 *
 * The model is given the scoreline, not the scorecard. It writes the message
 * around {opponent} / {score} / {record} placeholders and is forbidden from
 * naming players or quoting court scores — those are printed in the generated
 * scoreboard directly underneath, and a paragraph that repeats them is how a
 * recap gets long enough to stop being read. Keeping it placeholder-shaped is
 * also what makes "save this as my win template" honest: it still reads right
 * for the next win.
 */
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireTeam, isError } from '@/lib/captain/server';
import { createServiceClient } from '@/lib/supabase/server';
import { loadRecapContext, RECAP_MATCH_COLUMNS } from '@/lib/captain/recapData';
import {
  DEFAULT_RECAP,
  RECAP_OUTCOMES,
  templateFor,
  type RecapOutcome,
} from '@/lib/captain/recap';

export const dynamic = 'force-dynamic';

/** Its own variable so the writing model is not tied to the vision default. */
const MODEL = process.env.AI_MODEL_WRITER ?? 'claude-opus-5';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;

// A recap is written a handful of times a week; this is a mis-click guard.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateOk(key: string): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (b.count >= RATE_MAX) return false;
  b.count++;
  return true;
}

const TONE: Record<RecapOutcome, string> = {
  win: 'We won. Celebrate the team without gloating about the opponent, and without sounding like a corporate announcement.',
  loss: "We lost. Warm, unbothered, forward-looking — the captain's job here is to make people want to come back next week. Never single anyone out, never explain the loss, never say 'unfortunately'.",
  tie: 'The courts split evenly. Even-handed — neither a celebration nor a consolation.',
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    match_id?: string;
    team_id?: string;
    outcome?: RecapOutcome;
    /** The captain's steer, e.g. "mention that it was Nikki's first match back". */
    instructions?: string;
    /** What is in the editor now, so a re-roll comes back different. */
    current?: { subject?: string; body?: string };
  };

  const db = await createServiceClient();

  let teamName: string;
  let outcome: RecapOutcome;
  let facts: string[] = [];
  let userId: string;

  if (body.match_id) {
    const { data: matchRow } = await db
      .from('captain_matches')
      .select(RECAP_MATCH_COLUMNS)
      .eq('id', body.match_id)
      .maybeSingle();
    if (!matchRow) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });

    const auth = await requireTeam((matchRow as Record<string, unknown>).team_id as string);
    if (isError(auth)) return auth.error;
    userId = auth.userId;
    teamName = auth.team.name;

    const ctx = await loadRecapContext(db, matchRow as unknown as Record<string, unknown>, auth.teamId);
    if (!ctx.hasResults) {
      return NextResponse.json(
        { error: 'Save the court scores first — the draft is written around the result.' },
        { status: 400 },
      );
    }
    outcome = ctx.tally.outcome;

    const swept = ctx.tally.lost === 0 && ctx.tally.won > 1;
    const swept_against = ctx.tally.won === 0 && ctx.tally.lost > 1;
    const oneCourt = Math.abs(ctx.tally.won - ctx.tally.lost) === 1;
    facts = [
      `Team: ${teamName}`,
      `Opponent: ${ctx.match.opponent || 'the other club'}`,
      `We played ${ctx.match.isHome ? 'at home' : 'away'}.`,
      `Courts won ${ctx.tally.won}, lost ${ctx.tally.lost} — the scoreline is "${ctx.tally.scoreline}".`,
      `Season record after this match: ${ctx.record.label}.`,
      swept ? 'We took every court.' : null,
      swept_against ? 'They took every court.' : null,
      oneCourt && !swept && !swept_against ? 'It came down to a single court.' : null,
      ctx.courts.some((c) => c.defaulted) ? 'One court was a default — nobody played it.' : null,
      // Deliberately unnamed: the email prints "Next up: <date> vs <team>"
      // under the message, and a draft that names it says it twice.
      ctx.nextMatch
        ? 'There is another match still to come. Do NOT name the next opponent or its date — the email prints those directly below your message.'
        : 'This was the last match on the schedule.',
    ].filter(Boolean) as string[];
  } else {
    if (!body.team_id || !body.outcome || !RECAP_OUTCOMES.includes(body.outcome)) {
      return NextResponse.json(
        { error: 'Pass a match_id, or a team_id and outcome.' },
        { status: 400 },
      );
    }
    const auth = await requireTeam(body.team_id);
    if (isError(auth)) return auth.error;
    userId = auth.userId;
    teamName = auth.team.name;
    outcome = body.outcome;
    facts = [
      `Team: ${teamName}`,
      'This is the reusable template for EVERY match with this result, so it must read right for any opponent and any scoreline. Lean on the placeholders.',
    ];
  }

  if (!rateOk(userId)) {
    return NextResponse.json({ error: 'Slow down a moment — try again shortly.' }, { status: 429 });
  }
  if (!ANTHROPIC_KEY) {
    return NextResponse.json(
      { error: 'Drafting is not configured (missing ANTHROPIC_API_KEY).' },
      { status: 503 },
    );
  }

  const current = [body.current?.subject, body.current?.body]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join('\n\n');
  const steer = (body.instructions || '').trim().slice(0, 500);

  const system = [
    'You write the short email a tennis league captain sends her own team after a match.',
    'Her voice: warm, plain, a bit funny, never corporate, never a press release. She is a teammate, not a brand.',
    'Rules you never break:',
    '- 2 to 3 short paragraphs, 80 words at the very most. Shorter is better.',
    '- Never name a player, never quote a court score, never invent anything that is not in the facts you are given. The email prints the full court-by-court scoreboard directly below your message.',
    '- Write placeholders rather than literals wherever one fits: {opponent}, {score}, {record}, {team}, {name} (the reader\'s first name). They are substituted per player when the email goes out.',
    '- Do not open with a greeting line like "Hi team," and do not sign off with a name — the email has neither.',
    '- Do not restate the headline; the email already prints the result in large type above your message.',
    '- At most two emoji in the whole message, and only where a person would actually use one.',
    '- Plain text only. Separate paragraphs with a blank line. No markdown, no bullet lists.',
    'Also write the subject line: under 60 characters, may use the same placeholders, no "Re:" and no all-caps.',
    'Call write_recap exactly once.',
  ].join('\n');

  const prompt = [
    `Tone for this one: ${TONE[outcome]}`,
    '',
    'Facts:',
    ...facts.map((f) => `- ${f}`),
    current
      ? `\nThe captain has this wording already and wants something DIFFERENT — same voice, new sentences, do not paraphrase it:\n"""\n${current.slice(0, 2000)}\n"""`
      : '',
    steer ? `\nWhat the captain asked for: ${steer}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

  let msg: { content?: { type: string; input?: unknown }[] };
  try {
    msg = (await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      tools: [
        {
          name: 'write_recap',
          description: 'Return the drafted recap for the captain to review and edit.',
          input_schema: {
            type: 'object',
            properties: {
              subject: { type: 'string', description: 'Subject line, under 60 characters.' },
              body: {
                type: 'string',
                description: 'The message. Paragraphs separated by a blank line.',
              },
            },
            required: ['subject', 'body'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'write_recap' },
      messages: [{ role: 'user', content: prompt }],
    } as never)) as never;
  } catch (e) {
    const status = (e as { status?: number })?.status ?? 500;
    return NextResponse.json(
      { error: status === 429 ? 'The writer is busy — try again in a moment.' : 'Could not write a draft. Try again.' },
      { status: status === 429 ? 429 : 502 },
    );
  }

  const block = (msg?.content || []).find((b) => b.type === 'tool_use');
  const out = (block?.input ?? {}) as { subject?: unknown; body?: unknown };
  const subject = typeof out.subject === 'string' ? out.subject.trim() : '';
  const draft = typeof out.body === 'string' ? out.body.trim() : '';

  if (!draft) {
    // Never hand back an empty editor — the captain's own words are still there.
    return NextResponse.json({ error: 'The draft came back empty. Try again.' }, { status: 502 });
  }

  const fallback = templateFor(outcome, []);
  return NextResponse.json({
    outcome,
    subject: subject || fallback.subject || DEFAULT_RECAP[outcome].subject,
    body: draft,
  });
}
