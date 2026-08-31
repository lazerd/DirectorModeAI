import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireTeam, isError } from '@/lib/captain/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * POST /api/captain/read-scorecard — read a photo of the paper scorecard and
 * return per-court scores for the captain to check.
 *
 * EXTRACTION ONLY. Nothing is saved: the captain reviews what came back and
 * presses the existing save button. A scorecard is handwriting on a windy court
 * — sometimes in two hands, sometimes with the sets crossed out and rewritten —
 * so this is a first draft, not an authority. Results feed play counts, playoff
 * eligibility and partnership records, and a silently wrong score is worse than
 * no score at all.
 *
 * Follows the same shape as /api/stringing/import-receipt: same model env, same
 * rate limiting, same base64 body, same tool-use extraction.
 */
export const dynamic = 'force-dynamic';

const MODEL = process.env.AI_MODEL_VISION ?? 'claude-opus-4-8';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_BYTES = 12 * 1024 * 1024;

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 8;
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateOk(key: string): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) { buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS }); return true; }
  if (b.count >= RATE_MAX) return false;
  b.count++; return true;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const matchId = String(body?.match_id || '');
  if (!matchId) return NextResponse.json({ error: 'match_id is required.' }, { status: 400 });

  const db = await createServiceClient();
  const { data: match } = await db
    .from('captain_matches')
    .select('id, team_id, opponent, is_home, singles_courts, doubles_courts')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });

  const ctx = await requireTeam(match.team_id as string);
  if (isError(ctx)) return ctx.error;
  if (!rateOk(ctx.userId)) {
    return NextResponse.json({ error: 'Too many uploads — give it a moment.' }, { status: 429 });
  }
  if (!ANTHROPIC_KEY) {
    return NextResponse.json(
      { error: 'Scorecard reading is not configured (missing ANTHROPIC_API_KEY).' },
      { status: 503 },
    );
  }

  const mediaType = String(body?.mediaType || '');
  const data = String(body?.data || '');
  if (!data) return NextResponse.json({ error: 'No photo uploaded.' }, { status: 400 });
  if (!IMAGE_TYPES.has(mediaType)) {
    return NextResponse.json({ error: 'Upload a photo (JPG, PNG or WebP).' }, { status: 400 });
  }
  if (Math.ceil((data.length * 3) / 4) > MAX_BYTES) {
    return NextResponse.json({ error: 'Photo is too large — keep it under ~9 MB.' }, { status: 413 });
  }

  /**
   * Give the model the lineup. Scorecards identify a line by the players on it
   * far more reliably than by a court number — the number is often missing,
   * and the two teams frequently number their courts differently.
   */
  const { data: lineups } = await db
    .from('captain_lineups')
    .select('court_number, court_type, player1_id, player2_id')
    .eq('match_id', matchId)
    .order('court_number');

  const ids = [...new Set(((lineups as any[]) || []).flatMap((l) => [l.player1_id, l.player2_id]).filter(Boolean))];
  const { data: people } = ids.length
    ? await db.from('captain_players').select('id, name').in('id', ids)
    : { data: [] as { id: string; name: string }[] };
  const nameOf = new Map(((people as { id: string; name: string }[]) || []).map((p) => [p.id, p.name]));

  const roster = ((lineups as any[]) || []).map((l) => ({
    court_number: l.court_number as number,
    court_type: l.court_type as string,
    players: [l.player1_id, l.player2_id]
      .filter(Boolean)
      .map((id: string) => nameOf.get(id) || 'unknown'),
  }));

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const content: any[] = [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
    {
      type: 'text',
      text:
        'This is a photo of a paper tennis league scorecard for a team match.\n\n' +
        `Our team is "${ctx.team.name}"${match.opponent ? `, playing ${match.opponent}` : ''}, ` +
        `${match.is_home ? 'at home' : 'away'}.\n\n` +
        'Our lineup, so you can match each line by the players written on it:\n' +
        roster.map((r) => `- Court ${r.court_number} (${r.court_type}): ${r.players.join(' / ')}`).join('\n') +
        '\n\nFor each of OUR courts, read the set scores and decide whether OUR pair won. ' +
        'Report the score from OUR perspective — if we lost 6-4 6-3, the score is "4-6, 3-6". ' +
        'A court marked default, DEF, retired or walkover was not played: set defaulted true and still say who took the point. ' +
        'Use null for anything you genuinely cannot read rather than guessing — a wrong score is worse than a blank one. ' +
        'Call record_scorecard exactly once.',
    },
  ];

  const tools: any[] = [
    {
      name: 'record_scorecard',
      description: 'Record the per-court results read off the scorecard.',
      input_schema: {
        type: 'object',
        properties: {
          courts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                court_number: { type: 'integer', description: 'Our court number from the lineup above' },
                score: {
                  type: ['string', 'null'],
                  description: 'Set scores from OUR perspective, e.g. "6-4, 3-6, 10-7". Null if unreadable.',
                },
                won: { type: ['boolean', 'null'], description: 'Did OUR pair win this court?' },
                defaulted: { type: 'boolean', description: 'True if nobody played it (default/walkover/retired)' },
                confidence: {
                  type: 'string',
                  enum: ['high', 'medium', 'low'],
                  description: 'How legible this line was',
                },
              },
              required: ['court_number', 'defaulted'],
            },
          },
        },
        required: ['courts'],
      },
    },
  ];

  let msg: any;
  try {
    msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      tools,
      tool_choice: { type: 'tool', name: 'record_scorecard' } as any,
      messages: [{ role: 'user', content }],
    } as any);
  } catch (e: any) {
    const status = e?.status ?? 500;
    return NextResponse.json(
      {
        error:
          status === 400
            ? 'Couldn’t read that photo — try a straighter, brighter shot of the card.'
            : 'Vision service error, please try again.',
      },
      { status: status === 400 ? 400 : 502 },
    );
  }

  const block = (msg?.content || []).find((b: any) => b.type === 'tool_use');
  const courts = (block?.input?.courts ?? []) as any[];
  const known = new Set(roster.map((r) => r.court_number));

  return NextResponse.json({
    courts: courts
      // Drop anything that isn't one of our courts rather than inventing rows.
      .filter((c) => known.has(Number(c.court_number)))
      .map((c) => ({
        court_number: Number(c.court_number),
        score: typeof c.score === 'string' && c.score.trim() ? c.score.trim() : null,
        won: typeof c.won === 'boolean' ? c.won : null,
        defaulted: c.defaulted === true,
        confidence: ['high', 'medium', 'low'].includes(c.confidence) ? c.confidence : 'medium',
      })),
  });
}
