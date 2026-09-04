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

export type TeamCc = { name: string; email: string; role: string };

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
  const { data } = await db
    .from('captain_team_contacts')
    .select('name, email, role')
    .eq('team_id', teamId)
    .eq('on_emails', true)
    .not('email', 'is', null)
    .order('sort_order')
    .order('name');

  const taken = new Set(
    exclude.filter(Boolean).map((e) => (e as string).trim().toLowerCase()),
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
