/**
 * Season Builder — server side. Recipient selection, matching a public sign-up
 * back to the PlayerVault person, saving an answer, and the confirmation email.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { APP_URL } from '@/lib/appUrl';
import { sendBilledEmail } from '@/lib/email';
import { confirmHtml, confirmSubject } from './emails';
import { type Answer, type Campaign, monthEnd, needsRenewal } from './shared';

type DB = SupabaseClient<any, 'public', any>;

export const CAMPAIGN_COLS =
  'id, club_id, title, intro, sign_off, registration_opens, reply_by, season_start, season_end, leagues, public_token, status, sent_at';

export const personalLink = (token: string) => `${APP_URL}/season/${token}`;
export const publicLink = (publicToken: string) => `${APP_URL}/season/join/${publicToken}`;

const normName = (s: string | null | undefined) =>
  (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
const normEmail = (s: string | null | undefined) => (s || '').trim().toLowerCase();
export const firstName = (full: string | null | undefined) => (full || '').trim().split(/\s+/)[0] || 'there';

export type Recipient = { vault_player_id: string; name: string; email: string };

/**
 * Every adult active PlayerVault person with an email. A shared household inbox
 * gets one email PER PERSON, each with its own link: the husband and the wife
 * each answer for themselves (see feedback_household_email_collisions).
 * Age is unknown for most rows, so unknown counts as adult; a known under-18 is out.
 */
export async function recipients(db: DB, clubId: string): Promise<Recipient[]> {
  const { data } = await db
    .from('cc_vault_players')
    .select('id, full_name, email, date_of_birth, age, membership_status')
    .eq('club_id', clubId)
    .eq('membership_status', 'active')
    .not('email', 'is', null)
    .order('full_name');
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 18);
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const r of (data || []) as { id: string; full_name: string | null; email: string | null; date_of_birth: string | null; age: number | null }[]) {
    const email = normEmail(r.email);
    if (!email || !email.includes('@') || !r.full_name) continue;
    if (r.date_of_birth && new Date(r.date_of_birth) > cutoff) continue;
    if (!r.date_of_birth && r.age != null && r.age < 18) continue;
    const key = `${normName(r.full_name)}|${email}`; // same person twice on the roster
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ vault_player_id: r.id, name: r.full_name.trim(), email });
  }
  return out;
}

/**
 * Match a public sign-up (name + email typed by the person) to a vault row.
 * Name decides; email only breaks a tie or confirms a nickname with the same
 * surname ("Bill Peter" typed, "William Peter" on file). Email alone never
 * decides — households share inboxes.
 */
export async function matchVault(db: DB, clubId: string, name: string, email: string) {
  const { data } = await db
    .from('cc_vault_players')
    .select('id, full_name, email')
    .eq('club_id', clubId);
  const rows = (data || []) as { id: string; full_name: string | null; email: string | null }[];
  const n = normName(name), e = normEmail(email);
  const byName = rows.filter((r) => normName(r.full_name) === n);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) return byName.find((r) => normEmail(r.email) === e) || null;
  const last = n.split(' ').pop();
  const nick = rows.filter((r) => normEmail(r.email) === e && normName(r.full_name).split(' ').pop() === last);
  return nick.length === 1 ? nick[0] : null;
}

export function parseAnswer(body: any): Answer {
  const choices = Array.isArray(body?.choices)
    ? body.choices
        .filter((c: any) => c && typeof c.league === 'string' && (c.slot === 'day' || c.slot === 'nights_weekends'))
        .map((c: any) => ({ league: c.league, slot: c.slot }))
    : [];
  return {
    interested: body?.interested !== false,
    gender: body?.gender === 'female' || body?.gender === 'male' ? body.gender : null,
    ntrp: typeof body?.ntrp === 'string' ? body.ntrp : null,
    choices,
    role: body?.role === 'captain' || body?.role === 'play' ? body.role : null,
    age_ok: typeof body?.age_ok === 'boolean' ? body.age_ok : null,
    usta_expires: typeof body?.usta_expires === 'string' && body.usta_expires ? body.usta_expires : null,
    usta_unknown: body?.usta_unknown === true,
    notes: typeof body?.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 1000) : null,
  };
}

/** DB row -> Answer (for prefilling the form). */
export function rowToAnswer(r: any): Answer {
  return {
    interested: r.interested,
    gender: r.gender,
    ntrp: r.ntrp,
    choices: r.choices || [],
    role: r.role,
    age_ok: r.age_ok,
    usta_expires: r.usta_expires ? String(r.usta_expires).slice(0, 7) : null,
    usta_unknown: !!r.usta_unknown,
    notes: r.notes,
  };
}

/**
 * Upsert the answer and send the confirmation. The confirmation goes the first
 * time someone answers, and again only if a change newly means they must renew
 * USTA — re-saving the form never spams them.
 */
export async function saveResponse(
  db: DB,
  c: Campaign,
  who: { invite_id: string | null; vault_player_id: string | null; name: string; email: string | null; link: string; source: 'invite' | 'public' },
  a: Answer,
) {
  const renew = needsRenewal(c, a);
  const fields = {
    campaign_id: c.id,
    invite_id: who.invite_id,
    vault_player_id: who.vault_player_id,
    name: who.name,
    email: who.email,
    interested: a.interested,
    gender: a.interested ? a.gender : null,
    ntrp: a.interested ? a.ntrp : null,
    choices: a.interested ? a.choices : [],
    role: a.interested ? a.role : null,
    age_ok: a.interested ? a.age_ok : null,
    usta_expires: a.interested && !a.usta_unknown && a.usta_expires ? monthEnd(a.usta_expires) : null,
    usta_unknown: a.interested ? a.usta_unknown : false,
    needs_renewal: renew,
    notes: a.notes,
    source: who.source,
    updated_at: new Date().toISOString(),
  };

  // Find the existing answer: by invite, else by vault person, else (unmatched
  // public) by the same name + email.
  let existing: any = null;
  if (who.invite_id) {
    ({ data: existing } = await db.from('sb_responses').select('*').eq('invite_id', who.invite_id).maybeSingle());
  }
  if (!existing && who.vault_player_id) {
    ({ data: existing } = await db.from('sb_responses').select('*').eq('campaign_id', c.id).eq('vault_player_id', who.vault_player_id).maybeSingle());
  }
  if (!existing && !who.vault_player_id && who.email) {
    const { data } = await db.from('sb_responses').select('*').eq('campaign_id', c.id).is('vault_player_id', null).ilike('email', who.email);
    existing = (data || []).find((r: any) => normName(r.name) === normName(who.name)) || null;
  }

  let row: any;
  if (existing) {
    // A public re-submit must not detach an answer that came in by invite.
    const patch = { ...fields, invite_id: existing.invite_id || fields.invite_id, source: existing.source };
    const { data, error } = await db.from('sb_responses').update(patch).eq('id', existing.id).select('*').single();
    if (error) throw error;
    row = data;
  } else {
    const { data, error } = await db.from('sb_responses').insert(fields).select('*').single();
    if (error) throw error;
    row = data;
  }

  const firstTime = !row.confirmation_sent_at;
  const renewalNews = renew && !row.renewal_notice_sent_at;
  if (who.email && (firstTime || renewalNews)) {
    const { data: club } = await db.from('cc_clubs').select('name, slug, email, owner_id').eq('id', c.club_id).maybeSingle();
    const r = await sendBilledEmail((club as any)?.owner_id ?? null, {
      to: who.email,
      subject: confirmSubject(a, renew),
      html: confirmHtml(c, (club as any)?.name || 'Your club', firstName(who.name), a, renew, who.link),
      fromName: (club as any)?.name,
      replyTo: (club as any)?.email || undefined,
      clubId: c.club_id,
      clubSlug: (club as any)?.slug,
      operational: true,
    }).catch(() => ({ sent: false as const }));
    if (r.sent) {
      const now = new Date().toISOString();
      await db
        .from('sb_responses')
        .update({ confirmation_sent_at: row.confirmation_sent_at || now, ...(renew ? { renewal_notice_sent_at: now } : {}) })
        .eq('id', row.id);
    }
  }
  return { row, needs_renewal: renew };
}
