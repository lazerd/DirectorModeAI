/**
 * Filing a host club's email against a team: read it with the model, work out
 * which match it is about, and store it as a pending suggestion. Shared by the
 * paste box on the match page and the forwarding-address webhook, so the two
 * can never read the same email differently.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CLUB_TZ, resolveClubTimeZone } from './clubTime';
import {
  pickMatch,
  scheduleWarnings,
  suggestFields,
  type HostNoteExtract,
  type HostNoteFields,
  type MatchLite,
  withoutOurPeople,
} from './hostNote';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

const MODEL = process.env.AI_MODEL_WRITER ?? 'claude-opus-5';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;

export const MATCH_FIELDS =
  'id, match_at, is_home, opponent, location, arrival_note, opposing_captain_name, opposing_captain_email, opposing_captain_phone, status';

export class HostNoteError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Read one email. Throws HostNoteError with a captain-readable message. */
export async function extractHostNote(input: {
  teamName: string;
  body: string;
  subject?: string | null;
  from?: string | null;
  matches: MatchLite[];
  timeZone: string;
}): Promise<HostNoteExtract> {
  if (!ANTHROPIC_KEY) throw new HostNoteError('Reading emails is not configured (missing ANTHROPIC_API_KEY).', 503);
  const fixtures = input.matches
    .map((m) => {
      const when = new Intl.DateTimeFormat('en-US', {
        timeZone: input.timeZone,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(m.match_at));
      return `- ${when}: ${m.is_home ? 'home vs' : 'away at'} ${m.opponent || 'TBD'}`;
    })
    .join('\n');

  const prompt =
    `Our tennis team is "${input.teamName}". Its schedule:\n${fixtures}\n\n` +
    'Below is an email (possibly forwarded, possibly pasted with its headers) from or about the club ' +
    'HOSTING one of these matches. Pull out what our players need to know to show up.\n\n' +
    '- arrival_note: 1–4 short plain sentences a player reads the night before: warm-up courts/time, ' +
    'check-in, parking, what is provided (water, ice, restrooms), anything to bring. No greetings, no ' +
    '"looking forward to hosting you", no sign-off, and do not repeat the date or the match start time. ' +
    'Null if the email has none of that.\n' +
    '- match_date (YYYY-MM-DD) and start_time (24h HH:MM) as the host states them, or null. The emails ' +
    `are written in ${new Date().getFullYear()} season terms; resolve "Tuesday 9/22" against the schedule above.\n` +
    "- host_club: the hosting club's name as written. address: only if a street address is given.\n" +
    '- captains: the host team\'s captains named or copied on the email — sender first — with email and ' +
    'phone when shown. Never include our own team\'s people.\n' +
    '- about_a_match: false if this is not about one of these matches at all.\n\n' +
    `${input.from ? `From: ${input.from}\n` : ''}${input.subject ? `Subject: ${input.subject}\n` : ''}\n` +
    input.body.slice(0, 12000);

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
  let msg: { content?: { type: string; input?: unknown }[] };
  try {
    msg = (await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools: [
        {
          name: 'record_host_note',
          description: "Record the match details from the host club's email.",
          input_schema: {
            type: 'object',
            properties: {
              about_a_match: { type: 'boolean' },
              match_date: { type: ['string', 'null'] },
              start_time: { type: ['string', 'null'] },
              host_club: { type: ['string', 'null'] },
              address: { type: ['string', 'null'] },
              arrival_note: { type: ['string', 'null'] },
              captains: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    email: { type: ['string', 'null'] },
                    phone: { type: ['string', 'null'] },
                  },
                  required: ['name'],
                },
              },
            },
            required: ['about_a_match', 'match_date', 'start_time', 'host_club', 'arrival_note', 'captains'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'record_host_note' },
      messages: [{ role: 'user', content: prompt }],
    } as never)) as never;
  } catch {
    throw new HostNoteError('Could not read that email just now. Try again in a moment.', 502);
  }

  const raw = ((msg.content || []).find((b) => b.type === 'tool_use')?.input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    about_a_match: raw.about_a_match !== false,
    match_date: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.match_date)) ? String(raw.match_date) : null,
    start_time: /^\d{2}:\d{2}$/.test(String(raw.start_time)) ? String(raw.start_time) : null,
    host_club: str(raw.host_club),
    address: str(raw.address),
    arrival_note: str(raw.arrival_note),
    captains: (Array.isArray(raw.captains) ? raw.captains : [])
      .map((c: Record<string, unknown>) => ({ name: str(c?.name) || '', email: str(c?.email), phone: str(c?.phone) }))
      .filter((c) => c.name)
      .slice(0, 4),
  };
}

export type FiledNote = {
  id: string;
  match_id: string | null;
  source: 'paste' | 'email';
  from_email: string | null;
  subject: string | null;
  created_at: string;
  extracted: HostNoteExtract;
  /** Present when the note is filed on a match. */
  current?: HostNoteFields;
  suggested?: HostNoteFields;
  warnings?: string[];
};

/** Everyone on our side of the email: roster, team contacts, captain and co-captains. */
async function ourPeople(db: SupabaseClient, teamId: string): Promise<{ names: string[]; emails: string[] }> {
  const [{ data: team }, { data: staff }, { data: players }, { data: contacts }] = await Promise.all([
    db.from('captain_teams').select('captain_user_id').eq('id', teamId).maybeSingle(),
    db.from('captain_team_staff').select('user_id').eq('team_id', teamId),
    db.from('captain_players').select('name, email').eq('team_id', teamId),
    db.from('captain_team_contacts').select('name, email').eq('team_id', teamId),
  ]);
  const userIds = [
    (team as { captain_user_id?: string } | null)?.captain_user_id,
    ...((staff as { user_id: string }[] | null) ?? []).map((s) => s.user_id),
  ].filter(Boolean) as string[];

  const names: string[] = [];
  const emails: string[] = [];
  for (const p of [...((players as { name: string; email: string | null }[] | null) ?? []), ...((contacts as { name: string; email: string | null }[] | null) ?? [])]) {
    if (p.name) names.push(p.name);
    if (p.email) emails.push(p.email);
  }
  if (userIds.length) {
    const { data: profiles } = await db.from('profiles').select('full_name').in('id', userIds);
    for (const pr of (profiles as { full_name: string | null }[] | null) ?? []) if (pr.full_name) names.push(pr.full_name);
    const admin = getSupabaseAdmin();
    for (const id of userIds) {
      const { data } = await admin.auth.admin.getUserById(id);
      if (data?.user?.email) emails.push(data.user.email);
    }
  }
  return { names, emails };
}

/** Read, match and store an email as a pending note on a team. */
export async function fileHostNote(
  db: SupabaseClient,
  team: { id: string; name: string; club_id: string | null },
  input: {
    source: 'paste' | 'email';
    body: string;
    subject?: string | null;
    from?: string | null;
    resendEmailId?: string | null;
    /** The paste box knows the match; the webhook has to work it out. */
    matchId?: string | null;
  },
): Promise<FiledNote> {
  const timeZone = await resolveClubTimeZone(getSupabaseAdmin(), team.club_id).catch(() => CLUB_TZ);
  const { data: rows } = await db.from('captain_matches').select(MATCH_FIELDS).eq('team_id', team.id).order('match_at');
  const matches = (rows as MatchLite[] | null) ?? [];

  const read = await extractHostNote({
    teamName: team.name,
    body: input.body,
    subject: input.subject,
    from: input.from,
    matches,
    timeZone,
  });
  const extracted = { ...read, captains: withoutOurPeople(read.captains, await ourPeople(db, team.id)) };

  const matchId =
    input.matchId && matches.some((m) => m.id === input.matchId)
      ? input.matchId
      : extracted.about_a_match
        ? pickMatch(matches, extracted, new Date(), timeZone)
        : null;

  const { data: note, error } = await db
    .from('captain_host_notes')
    .insert({
      team_id: team.id,
      match_id: matchId,
      source: input.source,
      from_email: input.from ?? null,
      subject: input.subject ?? null,
      body: input.body.slice(0, 20000),
      extracted,
      resend_email_id: input.resendEmailId ?? null,
    })
    .select('id, match_id, source, from_email, subject, created_at, extracted')
    .single();
  if (error) throw new HostNoteError(error.message, 500);

  return withSuggestion(note as FiledNote, matches, timeZone);
}

/** Attach current values, suggestions and schedule warnings for the note's match. */
export function withSuggestion(note: FiledNote, matches: MatchLite[], timeZone: string): FiledNote {
  const match = matches.find((m) => m.id === note.match_id);
  if (!match) return note;
  return {
    ...note,
    current: {
      location: match.location,
      arrival_note: match.arrival_note,
      opposing_captain_name: match.opposing_captain_name,
      opposing_captain_email: match.opposing_captain_email,
      opposing_captain_phone: match.opposing_captain_phone,
    },
    suggested: suggestFields(match, note.extracted),
    warnings: scheduleWarnings(match, note.extracted, timeZone),
  };
}
