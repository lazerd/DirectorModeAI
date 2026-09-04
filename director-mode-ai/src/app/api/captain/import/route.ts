/**
 * POST /api/captain/import — paste-to-import (CaptainMode spec §7).
 *
 * The captain opens their team page on any site (USTA TennisLink, TopDog,
 * tenniscores, a spreadsheet), selects all, copies, and pastes it here. An LLM
 * pulls out the roster and schedule; we validate with zod and hand back a
 * PREVIEW. Nothing is written until the captain confirms.
 *
 * Two calls:
 *   { team_id, text }                      -> { players[], matches[], notes[] }   (parse only)
 *   { team_id, commit: true, players, matches } -> { added: { players, matches } } (write)
 *
 * The commit step re-validates and skips anything already on the team, so a
 * double-click or a re-paste can never duplicate a player or a match.
 */

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { requireTeam, isError } from '@/lib/captain/server';
import { defaultCourts } from '@/lib/captain/leagues';
import { recordAiUsage } from '@/lib/billing';

export const dynamic = 'force-dynamic';

const MODEL = process.env.AI_MODEL_AGENT ?? 'claude-sonnet-4-6';
const KEY = process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY;

/** Paste bodies are big; cap it so one paste can't blow up a token bill. */
const MAX_CHARS = 60_000;

const PlayerZ = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().nullable().optional(),
  rating: z.number().min(1).max(7).nullable().optional(),
  is_sub: z.boolean().optional(),
});

const MatchZ = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  // Nullable on purpose: "I could not tell" is a real answer, and forcing it
  // into a boolean turned every uncertain match into an away match.
  is_home: z.boolean().nullable(),
  opponent: z.string().max(200).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
});

const ParsedZ = z.object({
  players: z.array(PlayerZ).max(200),
  matches: z.array(MatchZ).max(100),
  notes: z.array(z.string().max(300)).max(10).optional(),
});

type Parsed = z.infer<typeof ParsedZ>;

/**
 * Build a timestamptz for a wall-clock date/time at the club, without pulling in
 * a tz library. Ask Intl what UTC offset America/Los_Angeles had on that date so
 * matches land at the right local hour on both sides of the DST change.
 */
/**
 * ⚠️ `time` is REQUIRED. There is no default, and there must never be one.
 *
 * This used to fall back to '09:30' — the start time of one adult league,
 * hardcoded into a shared path. When an LLM extraction came back without a
 * time, every Junior Team Tennis match silently became 9:30am instead of 4:00pm
 * and the availability email went to parents with the wrong hour on it. A
 * missing time has to stop the row, not quietly acquire a plausible one:
 * families set alarms by this.
 */
function clubTimestamp(date: string, time: string): string {
  const hhmm = time;
  const naive = new Date(`${date}T${hhmm}:00Z`);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    timeZoneName: 'longOffset',
  });
  const part = fmt.formatToParts(naive).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-08:00';
  const offset = part.replace('GMT', '') || '-08:00';
  return `${date}T${hhmm}:00${offset}`;
}

const SYSTEM = `You extract tennis league team data from a page a captain pasted in.

Return ONLY JSON matching this shape:
{
  "players": [{ "name": string, "email": string|null, "rating": number|null, "is_sub": boolean }],
  "matches": [{ "date": "YYYY-MM-DD", "time": "HH:MM"|null, "is_home": boolean,
                "opponent": string|null, "location": string|null }],
  "notes": [string]
}

Rules:
- Extract only what is actually present. Never invent a player, a date, or an email.
- "rating" is the NTRP number (e.g. 3.5). Use null if the page does not show one.
- "time" is 24-hour local time. Use null if the page shows no time.
- "time": read it off the page. NEVER guess one. If the page shows no start time
  for a match, return null — a wrong time is far worse than a missing one.
- is_home: true when THIS team hosts, false when the other team does. Many
  schedules have explicit "Home Team" and "Visiting Team" columns — use them.
  Return NULL if you genuinely cannot tell, and add a note. Do not guess, and in
  particular do not default to false: that silently turns every home match into
  an away one.
- Some league sites (notably TopDog flex leagues) publish every match on a
  placeholder SUNDAY that represents the week, not the day of play. If you see a
  schedule where nearly every match falls on a Sunday, still return the dates
  exactly as printed, and add a note: "Dates look like weekly Sunday placeholders
  - confirm the real weekday before relying on them."
- Put anything ambiguous or dropped into "notes" so the captain can see it.
- If the paste has no roster, return an empty players array. Same for matches.`;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    text?: string;
    commit?: boolean;
    players?: unknown;
    matches?: unknown;
  };

  const teamId = (body.team_id || '').toString();
  const ctx = await requireTeam(teamId);
  if (isError(ctx)) return ctx.error;
  const { db, userId } = ctx;

  // ---------------------------------------------------------------- commit --
  if (body.commit) {
    const parsed = ParsedZ.safeParse({
      players: body.players ?? [],
      matches: body.matches ?? [],
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'That import did not look right. Re-paste and try again.' },
        { status: 400 },
      );
    }

    const { data: existingPlayers } = await db
      .from('captain_players')
      .select('name')
      .eq('team_id', teamId);
    const haveName = new Set(
      ((existingPlayers as { name: string }[]) || []).map((p) => p.name.trim().toLowerCase()),
    );

    const { data: existingMatches } = await db
      .from('captain_matches')
      .select('match_at')
      .eq('team_id', teamId);
    const haveWhen = new Set(
      ((existingMatches as { match_at: string }[]) || []).map((m) =>
        new Date(m.match_at).toISOString(),
      ),
    );

    const newPlayers = parsed.data.players
      .filter((p) => !haveName.has(p.name.trim().toLowerCase()))
      .map((p) => ({
        team_id: teamId,
        name: p.name.trim(),
        email: p.email || null,
        rating: p.rating ?? null,
        rating_type: 'self',
        is_sub: p.is_sub ?? false,
      }));

    const courts = defaultCourts(ctx.team);
    /*
     * A match with no start time is NOT imported. There is nothing sensible to
     * write into match_at, and everything downstream — the availability email,
     * the calendar invite, the day-before reminder — states that time as fact.
     */
    const timeless = parsed.data.matches.filter((m) => !m.time);

    const newMatches = parsed.data.matches
      .filter((m) => !!m.time)
      .map((m) => ({
        team_id: teamId,
        match_at: clubTimestamp(m.date, m.time as string),
        // Unknown home/away is recorded as away but SAID OUT LOUD below, so the
        // captain fixes it rather than discovering it in a parent's reply.
        is_home: m.is_home ?? false,
        opponent: m.opponent || null,
        location: m.location || null,
        // Was hardcoded 0 singles / 4 doubles — the shape of one East Bay
        // women's league. An imported JTT schedule needs 2 + 2, so the team's
        // own league decides, and any match can still be edited after.
        singles_courts: courts.singles,
        doubles_courts: courts.doubles,
      }))
      .filter((m) => !haveWhen.has(new Date(m.match_at).toISOString()));

    if (newPlayers.length) {
      const { error } = await db.from('captain_players').insert(newPlayers);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (newMatches.length) {
      const { error } = await db.from('captain_matches').insert(newMatches);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const unsureHome = parsed.data.matches.filter((m) => m.is_home === null && m.time);

    return NextResponse.json({
      added: { players: newPlayers.length, matches: newMatches.length },
      /*
       * Named, not counted. "2 matches need attention" sends a captain hunting;
       * the dates tell them exactly which rows to open.
       */
      needsAttention: [
        ...timeless.map(
          (m) => `${m.date}: no start time on the page — not imported. Add it by hand.`,
        ),
        ...unsureHome.map(
          (m) => `${m.date}: could not tell home from away — set as AWAY, check it.`,
        ),
      ],
      skipped: {
        players: parsed.data.players.length - newPlayers.length,
        matches: parsed.data.matches.length - newMatches.length,
      },
    });
  }

  // ----------------------------------------------------------------- parse --
  if (!KEY) return NextResponse.json({ error: 'AI not configured' }, { status: 500 });

  const text = (body.text || '').toString().trim();
  if (!text) return NextResponse.json({ error: 'Nothing pasted.' }, { status: 400 });
  if (text.length > MAX_CHARS) {
    return NextResponse.json(
      { error: `That paste is too long (${text.length} characters, limit ${MAX_CHARS}).` },
      { status: 400 },
    );
  }

  const anthropic = new Anthropic({ apiKey: KEY });
  let raw = '';
  let msg;
  try {
    msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: 'user', content: text }],
    });
    raw = msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
  } catch {
    return NextResponse.json(
      { error: 'Could not read that paste. Try again in a moment.' },
      { status: 502 },
    );
  }

  void recordAiUsage(userId, msg.usage?.input_tokens ?? 0, msg.usage?.output_tokens ?? 0);

  // The model is told to return bare JSON, but tolerate a ```json fence.
  const jsonText = raw.replace(/^[\s\S]*?```(?:json)?/, '').replace(/```[\s\S]*$/, '') || raw;
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw.trim().startsWith('{') ? raw.trim() : jsonText.trim());
  } catch {
    return NextResponse.json(
      { error: "That paste didn't contain a roster or schedule I could read." },
      { status: 422 },
    );
  }

  const parsed = ParsedZ.safeParse(candidate);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "That paste didn't contain a roster or schedule I could read." },
      { status: 422 },
    );
  }

  const preview: Parsed = parsed.data;
  if (!preview.players.length && !preview.matches.length) {
    return NextResponse.json(
      { error: 'No players or matches found in that paste.' },
      { status: 422 },
    );
  }

  return NextResponse.json(preview);
}
