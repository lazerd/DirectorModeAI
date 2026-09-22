/**
 * The adults who get the team's emails without being in a lineup.
 *
 * A coach, a co-captain, the parent who does the driving. Darrin added three
 * coaches, ticked "on team emails", sent the season availability poll — and
 * they got nothing, because the storage and the toggle existed and no send
 * ever read them. This is the one place that reads them, so a new email kind
 * cannot quietly forget.
 *
 * Deliberately a COPY of a player's email rather than its own template: the
 * useful thing for a coach is seeing exactly what the parents were asked, not
 * a summary of it. The per-player tokens inside are the players' own — which is
 * why this only ever copies a TEAM-WIDE send, never a single player's.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatPhone } from './phone';

export type TeamCc = { name: string; email: string; role: string };

type RosterAddress = { email: string | null; contact2_email?: string | null };

/**
 * Every address on the roster, parents included. A team contact who is also a
 * player's parent gets their own child's email, never a coach copy: on
 * 9/21/26 Ben Harmsen (Scarlett's second parent, also a "team parent"
 * contact) got the copy of a reminder to Jacob Chiu, because Scarlett had
 * already answered and so her parents weren't in that send to be excluded.
 * He forwarded Jacob's live links to another parent.
 */
export function rosterAddresses(roster: RosterAddress[]): string[] {
  return roster.flatMap((p) => [p.email, p.contact2_email]).filter((e): e is string => !!e?.trim());
}

/**
 * Everyone on this team flagged `on_emails`, with an address.
 *
 * `exclude` drops addresses that are already receiving the mail in their own
 * right — a coach who is also a rostered player, or the captain themselves —
 * so nobody gets the same email twice.
 */
export async function teamCcRecipients(
  db: SupabaseClient,
  teamId: string,
  exclude: (string | null | undefined)[] = [],
): Promise<TeamCc[]> {
  const [{ data }, { data: roster }] = await Promise.all([
    db
      .from('captain_team_contacts')
      .select('name, email, role')
      .eq('team_id', teamId)
      .eq('on_emails', true)
      .not('email', 'is', null)
      .order('sort_order')
      .order('name'),
    db.from('captain_players').select('email, contact2_email').eq('team_id', teamId).eq('active', true),
  ]);

  const taken = new Set(
    [...exclude, ...rosterAddresses((roster as RosterAddress[] | null) ?? [])]
      .filter(Boolean)
      .map((e) => (e as string).trim().toLowerCase()),
  );
  const seen = new Set<string>();
  const out: TeamCc[] = [];

  for (const row of (data as TeamCc[] | null) ?? []) {
    const email = (row.email || '').trim();
    if (!email) continue;
    const key = email.toLowerCase();
    // Case-insensitive: a captain who typed DARRINJCO@GMAIL.COM in one place
    // and darrinjco@gmail.com in another is one person, and two copies of the
    // same email is the kind of sloppiness that gets a sender marked as spam.
    if (taken.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...row, email });
  }
  return out;
}

/**
 * The same email, also to the player's second parent.
 *
 * Junior contacts are parents, and there are usually two — Powell Jose never
 * heard about a JTT match because only Kiki's mum was on file. Unlike a coach
 * copy this is the player's OWN email, untouched: the magic link inside is the
 * kid's, so whichever parent taps Yes answers for her.
 *
 * Returns the copy immediately after the original so a caller that lines
 * results up against a parallel names list can keep doing so.
 */
export function withSecondContact<P extends { to: string }>(
  payload: P,
  contact2: string | null | undefined,
): P[] {
  const c = (contact2 || '').trim();
  if (!c || c.toLowerCase() === payload.to.trim().toLowerCase()) return [payload];
  return [payload, { ...payload, to: c }];
}

/** Preview rows matching withSecondContact — one per email that will go out. */
export function recipientRows(p: {
  name: string;
  email: string | null;
  contact2_name?: string | null;
  contact2_email?: string | null;
}): { name: string; email: string | null }[] {
  const rows = [{ name: p.name, email: p.email }];
  const c = (p.contact2_email || '').trim();
  if (c && c.toLowerCase() !== (p.email || '').trim().toLowerCase()) {
    rows.push({ name: `${p.name} · ${p.contact2_name?.trim() || '2nd parent'}`, email: c });
  }
  return rows;
}

/**
 * Copy a team-wide email to the coaches.
 *
 * Takes the payload the players are getting and re-addresses it, with one line
 * at the top saying whose copy this is — otherwise a coach reading "Can you
 * play Sunday?" reasonably thinks they are being asked.
 */
export function ccPayloads(
  sample: { subject: string; html: string },
  ccs: TeamCc[],
  teamName: string,
): { to: string; subject: string; html: string }[] {
  return ccs.map((c) => ({
    to: c.email,
    subject: `[${teamName}] ${sample.subject}`,
    html:
      `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:16px 24px 0">` +
      `<p style="font-size:13px;color:#64748b;margin:0">` +
      `Copy for ${c.name} — this is what went to the team. The buttons below are the players' own links, so there is nothing for you to answer.` +
      `</p></div>` +
      sample.html,
  }));
}

export type MatchCoach = { id: string; name: string; email: string | null; phone: string | null };

/** The coach named for this match (captain_matches.match_coach_id), if any. */
export async function matchCoachOf(db: SupabaseClient, matchId: string): Promise<MatchCoach | null> {
  const { data: m } = await db
    .from('captain_matches')
    .select('match_coach_id')
    .eq('id', matchId)
    .maybeSingle();
  const id = (m as { match_coach_id: string | null } | null)?.match_coach_id;
  if (!id) return null;
  const { data: c } = await db
    .from('captain_team_contacts')
    .select('id, name, email, phone')
    .eq('id', id)
    .maybeSingle();
  const coach = (c as MatchCoach | null) ?? null;
  // Stored E.164; emails and the other club read it as (510) 846-8720.
  return coach ? { ...coach, phone: coach.phone ? formatPhone(coach.phone) : null } : null;
}

/**
 * The team's copy list for ONE match: everyone on team emails, plus the coach
 * going to this match even if they are not on team emails — they are the one
 * standing at the courts, so every email about this match reaches them.
 */
export async function matchCcRecipients(
  db: SupabaseClient,
  teamId: string,
  matchId: string,
  exclude: (string | null | undefined)[] = [],
): Promise<TeamCc[]> {
  const [team, coach] = await Promise.all([
    teamCcRecipients(db, teamId, exclude),
    matchCoachOf(db, matchId),
  ]);
  return withMatchCoach(team, coach, exclude);
}

/** Adds the match coach to a copy list unless they are already on it. */
export function withMatchCoach(
  ccs: TeamCc[],
  coach: MatchCoach | null,
  exclude: (string | null | undefined)[] = [],
): TeamCc[] {
  const email = (coach?.email || '').trim();
  if (!coach || !email) return ccs;
  const key = email.toLowerCase();
  const taken = new Set(
    [...exclude, ...ccs.map((c) => c.email)].filter(Boolean).map((e) => (e as string).trim().toLowerCase()),
  );
  const onTeam = ccs.findIndex((c) => c.email.toLowerCase() === key);
  if (onTeam >= 0) {
    return ccs.map((c, i) => (i === onTeam ? { ...c, role: 'match coach' } : c));
  }
  if (taken.has(key)) return ccs;
  return [...ccs, { name: coach.name, email, role: 'match coach' }];
}
