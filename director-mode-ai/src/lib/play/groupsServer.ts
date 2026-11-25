import 'server-only';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { sendBilledEmail, sendBilledEmails } from '@/lib/email';
import { APP_URL, RIRL_URL } from '@/lib/appUrl';
import { safeNext } from '@/lib/postLogin';
import { activePass, passCheckoutUrl } from './passes';
import { SPORT_LABEL, whenLine } from './core';
import { PlayError, loadRow } from './server';
import {
  MONTHLY_EMAIL_LIMIT, checkQuota, cleanEmail, emailableMembers, monthStartUtc, planGroupFromRsvps, signUnsub, verifyUnsub,
  type GroupMember, type OptOut, type QuotaResult,
} from './groups';

/**
 * Racquets IRL Groups, server side. Hosts stay login-free until they save a group;
 * then a passwordless email link makes them an auth user who owns their groups.
 * Blasts are paid by ClubMode (platformPaid) and metered per host in play_email_sends:
 * Host Pass = 1,000 a month, enforced only once the paywall is live.
 */

export type GroupUser = { id: string; email: string | null };

export async function currentUser(): Promise<GroupUser | null> {
  try {
    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();
    return user ? { id: user.id, email: user.email ?? null } : null;
  } catch { return null; }
}

export function unsubSecret(): string {
  return process.env.UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-unsubscribe-secret-do-not-use-in-prod';
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const name40 = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 40) : '');
const name60 = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 60) : '');

function shell(title: string, body: string, cta?: { href: string; label: string }) {
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;color:#103c32">
  <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#6a7b71">Racquets IRL</div>
  <h1 style="font-size:26px;line-height:1.15;margin:8px 0 12px">${esc(title)}</h1>
  <div style="font-size:16px;line-height:1.5">${body}</div>
  ${cta ? `<p style="margin:22px 0"><a href="${cta.href}" style="background:#d4ff49;color:#103c32;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:12px;display:inline-block">${esc(cta.label)}</a></p>` : ''}
</div>`;
}

/* ---------- passwordless sign-in ---------- */

/** Best-effort, per server instance: one link per address per 45s, five per IP per 10 minutes. */
const recent = new Map<string, number[]>();
function throttled(k: string, max: number, windowMs: number) {
  const now = Date.now();
  if (recent.size > 5000) recent.clear();
  const hits = (recent.get(k) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) { recent.set(k, hits); return true; }
  recent.set(k, [...hits, now]);
  return false;
}

/** Only bring people back to Racquets IRL pages. */
export function signInNext(raw: unknown): string {
  const n = safeNext(typeof raw === 'string' ? raw.slice(0, 300) : null);
  return n && (/^\/p\/[a-z0-9]{4,12}(\?|$)/.test(n) || /^\/play(\/|\?|$)/.test(n)) ? n : '/play/groups';
}

/**
 * Email a one-tap sign-in link. Built from the admin API's hashed token and verified by
 * /auth/confirm, so it works on any device (Supabase's PKCE links only work in the browser
 * that asked). New emails get an account made on the spot; existing ones just sign in,
 * so the "signUp says success with zero identities" trap never applies here.
 */
export async function sendSignInLink(rawEmail: unknown, rawNext: unknown, ip: string | null): Promise<'sent'> {
  const email = cleanEmail(rawEmail);
  if (!email) throw new PlayError('That email doesn’t look right.');
  if (throttled('e:' + email, 1, 45e3) || (ip && throttled('ip:' + ip, 5, 10 * 60e3))) {
    throw new PlayError('Link already sent. Give it a minute, then check your spam folder.', 429);
  }
  const next = signInNext(rawNext);
  // Local testing: no auth user is made and nothing is sent.
  if (process.env.PLAY_EMAIL_DRY_RUN === '1') { console.log('[play groups] dry-run sign-in link for', email, '->', next); return 'sent'; }
  const admin = getSupabaseAdmin();
  // Make sure the account exists FIRST. For an unknown email, generateLink('magiclink') quietly
  // creates the user and returns a SIGNUP token, which then fails verifyOtp(type 'magiclink')
  // at /auth/confirm (tested 11/21/26). createUser on an existing email just errors; ignore it.
  await admin.auth.admin.createUser({ email, email_confirm: true }).catch(() => null);
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const hashed = data?.properties?.hashed_token;
  if (error || !hashed) throw new PlayError('Could not make a sign-in link. Try again.', 500);
  const link = `${APP_URL}/auth/confirm?token_hash=${encodeURIComponent(hashed)}&type=magiclink&next=${encodeURIComponent(next)}`;
  await sendBilledEmail(null, {
    platformPaid: true, operational: true, fromName: 'Racquets IRL', to: email,
    subject: 'Your Racquets IRL sign-in link',
    html: shell('Tap to sign in', `<p>This saves your groups so you can invite them to your next game in a couple of taps. No password.</p><p style="color:#6a7b71;font-size:14px">Didn’t ask for this? Ignore it; nothing happens.</p>`, { href: link, label: 'Sign in to Racquets IRL' }),
  } as Parameters<typeof sendBilledEmail>[1]);
  return 'sent';
}

/* ---------- groups ---------- */

type MemberRow = GroupMember & { id: string; group_id: string; created_at: string };
type GroupRow = { id: string; owner_user_id: string; name: string; sport: string | null; level: string | null; created_at: string };

export async function monthlyUsed(userId: string, now = new Date()): Promise<number> {
  const { data } = await getSupabaseAdmin().from('play_email_sends').select('to_count').eq('owner_user_id', userId).gte('created_at', monthStartUtc(now).toISOString());
  return (data ?? []).reduce((n, r) => n + (Number(r.to_count) || 0), 0);
}

async function optoutsFor(userId: string, emails: string[]): Promise<OptOut[]> {
  if (!emails.length) return [];
  const { data } = await getSupabaseAdmin().from('play_email_optouts').select('email, owner_user_id, group_id').in('email', emails.slice(0, 1000))
    .or(`owner_user_id.is.null,owner_user_id.eq.${userId}`);
  return (data ?? []) as OptOut[];
}

async function ownGroup(userId: string, groupId: unknown): Promise<GroupRow> {
  const id = typeof groupId === 'string' ? groupId : '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new PlayError('Group not found', 404);
  const { data } = await getSupabaseAdmin().from('play_groups').select('*').eq('id', id).eq('owner_user_id', userId).maybeSingle();
  if (!data) throw new PlayError('Group not found', 404);
  return data as GroupRow;
}

export type GroupView = GroupRow & { members: (Omit<MemberRow, 'group_id'> & { emailable: boolean })[]; emailable: number };

export async function listGroups(user: GroupUser): Promise<{ groups: GroupView[]; usage: QuotaResult }> {
  const db = getSupabaseAdmin();
  const { data: gs } = await db.from('play_groups').select('*').eq('owner_user_id', user.id).order('created_at');
  const groups = (gs ?? []) as GroupRow[];
  const { data: ms } = groups.length ? await db.from('play_group_members').select('*').in('group_id', groups.map((g) => g.id)).order('created_at') : { data: [] };
  const members = (ms ?? []) as MemberRow[];
  const optouts = await optoutsFor(user.id, [...new Set(members.map((m) => cleanEmail(m.email)).filter((e): e is string => !!e))]);
  const out = groups.map((g) => {
    const mine = members.filter((m) => m.group_id === g.id);
    const ok = new Set(emailableMembers(mine, optouts, user.id, g.id).map((m) => m.id));
    return { ...g, members: mine.map(({ group_id: _g, ...m }) => ({ ...m, emailable: ok.has(m.id) })), emailable: ok.size };
  });
  const used = await monthlyUsed(user.id);
  return { groups: out, usage: checkQuota(used, 0, { enforce: paywallLive() }) };
}

export async function groupAction(user: GroupUser, b: Record<string, unknown>, hostKey: string | null): Promise<{ groupId?: string; added?: number; updated?: number }> {
  const db = getSupabaseAdmin();
  switch (String(b.action || '')) {
    case 'create': {
      const name = name60(b.name);
      if (!name) throw new PlayError('Name the group.');
      const { count } = await db.from('play_groups').select('id', { count: 'exact', head: true }).eq('owner_user_id', user.id);
      if ((count ?? 0) >= 50) throw new PlayError('That’s 50 groups. Delete one first.');
      const { data, error } = await db.from('play_groups').insert({ owner_user_id: user.id, name, sport: name40(b.sport) || null, level: name40(b.level) || null }).select('id').single();
      if (error) throw new PlayError(error.message, 500);
      return { groupId: data.id };
    }
    case 'rename': {
      const g = await ownGroup(user.id, b.groupId);
      const name = name60(b.name);
      if (!name) throw new PlayError('Name the group.');
      await db.from('play_groups').update({ name, ...(b.level !== undefined ? { level: name40(b.level) || null } : {}) }).eq('id', g.id);
      return { groupId: g.id };
    }
    case 'delete': {
      const g = await ownGroup(user.id, b.groupId);
      await db.from('play_groups').delete().eq('id', g.id);
      return {};
    }
    case 'add_member': {
      const g = await ownGroup(user.id, b.groupId);
      const name = name40(b.name);
      if (!name) throw new PlayError('Add a name.');
      const { count } = await db.from('play_group_members').select('id', { count: 'exact', head: true }).eq('group_id', g.id);
      if ((count ?? 0) >= 300) throw new PlayError('A group holds up to 300 people.');
      // A host typing someone's address is not that person opting in: they stay un-emailable
      // until they tick "Email me" when joining one of this host's games.
      const email = cleanEmail(b.email);
      const { error } = await db.from('play_group_members').insert({ group_id: g.id, name, email, opted_in: false });
      if (error?.code === '23505') throw new PlayError(`${name} is already in this group.`);
      if (error) throw new PlayError(error.message, 500);
      return { groupId: g.id };
    }
    case 'remove_member': {
      const g = await ownGroup(user.id, b.groupId);
      await db.from('play_group_members').delete().eq('id', String(b.memberId ?? '')).eq('group_id', g.id);
      return { groupId: g.id };
    }
    case 'save_from_event': {
      const row = await loadRow(String(b.code ?? ''));
      if (!row) throw new PlayError('Game not found', 404);
      if (!hostKey || hostKey !== row.host_key) throw new PlayError('Only the host can save these players.', 403);
      const g = b.groupId
        ? await ownGroup(user.id, b.groupId)
        : await (async () => {
          const r = await groupAction(user, { action: 'create', name: b.name || row.title, sport: row.sport, level: row.level }, null);
          return ownGroup(user.id, r.groupId);
        })();
      const { data: rs } = await db.from('play_rsvps').select('id, name, status, is_host, email, email_opt_in').eq('event_id', row.id).order('created_at');
      const { data: ms } = await db.from('play_group_members').select('*').eq('group_id', g.id);
      const plan = planGroupFromRsvps((ms ?? []) as MemberRow[], (rs ?? []) as never[]);
      const room = Math.max(0, 300 - (ms?.length ?? 0));
      const inserts = plan.inserts.slice(0, room).map((m) => ({ ...m, group_id: g.id }));
      if (inserts.length) {
        const { error } = await db.from('play_group_members').insert(inserts);
        if (error) throw new PlayError(error.message, 500);
      }
      for (const u of plan.updates) await db.from('play_group_members').update({ email: u.email, opted_in: true }).eq('id', u.id).eq('group_id', g.id);
      return { groupId: g.id, added: inserts.length, updated: plan.updates.length };
    }
    default:
      throw new PlayError('Unknown action');
  }
}

/* ---------- the blast ---------- */

/** The paywall is live once the LemonSqueezy Host Pass link is configured. */
export const paywallLive = () => !!passCheckoutUrl('host', 'x');

async function hasPass(user: GroupUser, hostId: string | null, clubCode: string | null): Promise<boolean> {
  if (await activePass(hostId, clubCode)) return true;
  if (!user.email) return false;
  const now = new Date().toISOString();
  const { data } = await getSupabaseAdmin().from('play_passes').select('status, ends_at').ilike('email', user.email);
  return (data ?? []).some((p) => ['active', 'on_trial', 'past_due', 'cancelled'].includes(p.status) && (!p.ends_at || p.ends_at > now));
}

type Payload = Parameters<typeof sendBilledEmail>[1];
export type Sender = (payloads: Payload[]) => Promise<{ sent: boolean; demo?: unknown }[]>;
const realSender: Sender = async (payloads) => {
  if (process.env.PLAY_EMAIL_DRY_RUN === '1') { console.log('[play groups] dry-run blast', payloads.map((p) => p.to)); return payloads.map(() => ({ sent: true })); }
  return sendBilledEmails(null, payloads);
};

export type BlastResult = { sent: number; skipped: number; failed: number; members: number; usage: QuotaResult };

/**
 * Email a game's link to a group. Only the game's host (host key) who owns the group
 * (signed in) can send. Skips anyone without an opted-in email or who unsubscribed.
 */
export async function blastGroup(user: GroupUser, o: { groupId: unknown; code: unknown; hostKey: string | null; hostId: string | null; clubCode: string | null; again?: boolean }, send: Sender = realSender): Promise<BlastResult> {
  const db = getSupabaseAdmin();
  const row = await loadRow(String(o.code ?? ''));
  if (!row) throw new PlayError('Game not found', 404);
  if (!o.hostKey || o.hostKey !== row.host_key) throw new PlayError('Only the host can email this game.', 403);
  if (row.status === 'done') throw new PlayError('This game is over. Make the next one, then invite the group.');
  const g = await ownGroup(user.id, o.groupId);

  const live = paywallLive();
  if (live && !(await hasPass(user, o.hostId, o.clubCode))) throw new PlayError('PASS_NEEDED', 402);

  if (!o.again) {
    const { data: prior } = await db.from('play_email_sends').select('id').eq('group_id', g.id).eq('event_code', row.code).limit(1);
    if (prior?.length) throw new PlayError('ALREADY_SENT', 409);
  }

  const { data: ms } = await db.from('play_group_members').select('*').eq('group_id', g.id);
  const members = (ms ?? []) as MemberRow[];
  const optouts = await optoutsFor(user.id, [...new Set(members.map((m) => cleanEmail(m.email)).filter((e): e is string => !!e))]);
  const to = emailableMembers(members, optouts, user.id, g.id);
  const used = await monthlyUsed(user.id);
  const q = checkQuota(used, to.length, { enforce: live });
  if (!q.ok) throw new PlayError(`That’s ${to.length} emails and you have ${q.remaining} left this month (${MONTHLY_EMAIL_LIMIT.toLocaleString()} a month with a Host Pass). It resets on the 1st.`, 429);
  if (!to.length) return { sent: 0, skipped: members.length, failed: 0, members: members.length, usage: q };

  const host = row.host_name || 'Your host';
  const when = whenLine(row as never, 'America/Los_Angeles') ?? '';
  const sport = SPORT_LABEL[row.sport as keyof typeof SPORT_LABEL] ?? 'Tennis';
  const link = `${RIRL_URL}/p/${row.code}`;
  const payloads: Payload[] = to.map((m) => {
    const email = cleanEmail(m.email)!;
    const offGroup = `${RIRL_URL}/play/unsubscribe?t=${signUnsub({ email, ownerId: user.id, groupId: g.id }, unsubSecret())}`;
    const offHost = `${RIRL_URL}/play/unsubscribe?t=${signUnsub({ email, ownerId: user.id, groupId: null }, unsubSecret())}`;
    return {
      platformPaid: true, fromName: 'Racquets IRL', to: email,
      ...(user.email ? { replyTo: user.email } : {}),
      subject: `${host}: ${row.title}${when ? ` · ${when}` : ''}`.slice(0, 120),
      html: shell(`${host} posted a game.`,
        `<p><b>${esc(row.title)}</b><br>${esc(sport)}${when ? ` · ${esc(when)}` : ''}${row.location ? `<br>${esc(row.location)}` : ''}${row.level ? `<br><span style="color:#6a7b71">${esc(row.level)}</span>` : ''}</p><p>Tap to say you’re in. No app, no account.</p>
        <p style="color:#6a7b71;font-size:13px;margin-top:28px">You’re getting this because you asked to hear when ${esc(host)} posts a game (${esc(g.name)}). Reply to reach ${esc(host)}.<br><a href="${offGroup}" style="color:#6a7b71">Unsubscribe from ${esc(g.name)}</a> · <a href="${offHost}" style="color:#6a7b71">Stop all games from ${esc(host)}</a></p>`,
        { href: link, label: "I'm in" }),
    } as Payload;
  });
  const results = await send(payloads);
  const sent = results.filter((r) => r?.sent && !r.demo).length;
  const failed = results.length - results.filter((r) => r?.sent).length;
  await db.from('play_email_sends').insert({ owner_user_id: user.id, group_id: g.id, event_code: row.code, to_count: sent });
  return { sent, skipped: members.length - to.length, failed, members: members.length, usage: checkQuota(used + sent, 0, { enforce: live }) };
}

/* ---------- unsubscribe ---------- */

export async function unsubscribe(token: string | null | undefined, scope: 'token' | 'host' | 'all' = 'token'): Promise<{ email: string; groupName: string | null; hostScope: boolean } | null> {
  const t = verifyUnsub(token, unsubSecret());
  if (!t) return null;
  const db = getSupabaseAdmin();
  const groupId = scope === 'token' ? t.groupId : null;
  const owner = scope === 'all' ? null : t.ownerId;
  let q = db.from('play_email_optouts').select('id').eq('email', t.email).limit(1);
  q = owner ? q.eq('owner_user_id', owner) : q.is('owner_user_id', null);
  q = groupId ? q.eq('group_id', groupId) : q.is('group_id', null);
  const { data: have } = await q;
  if (!have?.length) await db.from('play_email_optouts').insert({ email: t.email, owner_user_id: owner, group_id: groupId });
  let groupName: string | null = null;
  if (t.groupId) {
    const { data: g } = await db.from('play_groups').select('name').eq('id', t.groupId).maybeSingle();
    groupName = g?.name ?? null;
    if (groupId) await db.from('play_group_members').update({ unsubscribed_at: new Date().toISOString() }).eq('group_id', groupId).eq('email', t.email).is('unsubscribed_at', null);
  }
  return { email: t.email, groupName, hostScope: !groupId };
}
