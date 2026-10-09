import Anthropic from '@anthropic-ai/sdk';

/**
 * Which action packs a request needs.
 *
 * Every pack's tools together are ~18k tokens. Sending all of them on every
 * request made the first message of a session cost ~7 cents in cache writes
 * alone — the whole reason the meter read 10¢ an answer. A small model reads the
 * request (and the last few turns, so "yes, do it" keeps the pack the preview
 * came from) and names the one to three packs it needs; the agent sees only
 * those. Any failure falls back to every pack: a dearer answer, never a wrong one.
 */

export const PACK_SUMMARIES: Record<string, string> = {
  programs: 'classes/clinics/programs: create, next session, extend, cancel a date or a class, edit, add/withdraw a student, what we offer and prices, is X scheduled',
  attendance: 'who came to a class meeting, mark attendance, is attendance in, drop-ins owed, makeups, paid outside (Venmo), extra session',
  courts: 'court sheet: what is booked, block/book/move/shorten/cancel courts, what is happening today/this week, free dates for teams',
  captain: 'CaptainMode USTA/JTT teams: lineups, who sits, subs, availability, season counts, add player, email lineup/confirmations/opposing captain',
  leagues: 'LeagueMode leagues/JTT divisions: matchups, standings, lineups, enter scores, add/remove kid, WTN/NTRP ratings, reschedule a matchup',
  comms: 'email members/parents/families: build an audience, who would get it, send, send me a test, stop/resume emails to someone',
  'club-site': 'club website, class listings, skip dates, class prices, court rates and booking prices, court bookings list',
  calendar: 'year calendar planning: list, suggest dates, add/move/drop calendar events, idea catalog',
  jtt: 'JTT match-day on a matchup page: check kids in/out, add/remove a player today',
  benchmarks: 'director compensation benchmarks and candidate search',
  events: 'tournaments/quads/mixers/team battles: what is live or open, signups by division and today, who paid/owes, share link/QR, build or fix the match schedule, check conflicts, generate draw, late entry, withdraw/move alternate in, extend payment/registration deadline, enter a score, this year vs last year, create a draft mixer/team battle',
  people: 'PlayerVault members: look up email/phone/membership/access level, fix a name or contact, remove a duplicate, why someone is not getting emails, bulk add members; CourtConnect pickup games: post a game, who said yes/no, add a guest, cancel a game; LessonMode: lessons today/this week, cancel a lesson',
  ops: 'how are we doing / board-meeting numbers, revenue for a class or event, who still owes money, court utilization by month; stringing jobs (log a job, ready/overdue rackets, email ready, restring nudge, mark jobs or stringer paid); maintenance work orders (add, what is open, mark done) and daily checklist',
};

const ROUTER_MODEL = process.env.AI_MODEL_ROUTER ?? 'claude-haiku-4-5';

export async function routePacks(
  client: Anthropic,
  available: string[],
  message: string,
  history: { role: string; content: string }[],
  page: string | undefined,
): Promise<{ domains: string[] | null; usage: unknown }> {
  if (available.length <= 2) return { domains: null, usage: null };
  const catalog = available.map((d) => `- ${d}: ${PACK_SUMMARIES[d] ?? d}`).join('\n');
  const recent = history
    .slice(-4)
    .map((m) => `${m.role}: ${String(m.content).slice(0, 400)}`)
    .join('\n');
  try {
    const r = await client.messages.create({
      model: ROUTER_MODEL,
      max_tokens: 60,
      system:
        'You route a club director\'s request to action packs. Reply with ONLY a JSON array of pack names from the list, ' +
        'most relevant first, at most 3. If the request continues the conversation (e.g. "yes", "do it", "send it"), include the pack the conversation was using. ' +
        'If it is a general question needing no action, reply [].',
      messages: [
        {
          role: 'user',
          content: `Packs:\n${catalog}\n\nPage: ${page ?? '(none)'}\n\nRecent conversation:\n${recent || '(none)'}\n\nNew request: ${message.slice(0, 1500)}`,
        },
      ],
    });
    const text = r.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    const parsed = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? 'null');
    if (!Array.isArray(parsed)) return { domains: null, usage: r.usage };
    return { domains: parsed.filter((d: unknown) => typeof d === 'string' && available.includes(d)).slice(0, 3), usage: r.usage };
  } catch {
    return { domains: null, usage: null };
  }
}

export { ROUTER_MODEL };
