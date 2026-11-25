import { randomBytes, randomInt } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolveClubCtx, MANAGER_ROLES, type ClubCtx } from '@/lib/assistant/clubContext';
import { withActiveClub } from '@/lib/clubs/activeClub';
import { runChat, type ChatTurn } from '@/lib/assistant/runChat';
import { loadClinic, sendClinic, clinicWhen } from '@/lib/programs/clinicSignups';
import { APP_URL } from '@/lib/appUrl';
import { staffById } from '@/lib/proshop/staff';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';
import { sendTo, showTyping, type Channel } from './channels';
import { buildHuddle, buildRecap, type MenuItem } from './huddle';
import { fetchMedia, keepMedia, money, readPhoto, type InMedia } from './photos';
import { queueJob } from '@/lib/bridge/jobs';

/*
 * One message in from a director's phone → what their staff does and says back.
 *
 * Cheap, certain things are handled here without the AI: STOP/START/HELP, linking a
 * phone, "menu", a bare number from the huddle, and YES/SKIP on that item. Everything
 * else goes to the same staff (Ask Claude + the Pro Shop pack) the web page talks to,
 * with the last few turns of the thread so "yes" answers its own question.
 *
 * Money is never approved by a text alone: an item with money in it sends a link.
 */

export interface Line {
  id: string; user_id: string; club_id: string; channel: Channel; address: string | null;
  status: 'pending' | 'active' | 'stopped'; link_code: string | null; link_expires_at: string | null;
  morning: boolean; evening: boolean; menu: MenuItem[]; awaiting: Awaiting | null; history: ChatTurn[]; sent_alerts?: string[];
  last_morning: string | null; last_evening: string | null; verified_at: string | null;
}

/** A receipt waiting for the director's YES to go to the accountant. */
type ReceiptItem = { n: 0; kind: 'receipt'; ref: { vendor: string; date: string; amount: number; description: string; mediaId: string }; label: string };
type Awaiting = MenuItem | ReceiptItem;

const db = () => getSupabaseAdmin();
const HELP = (ch: Channel) =>
  `This is your ClubMode staff line. Text me anything ("remind everyone for Friday's clinic", "what's on today?"). ` +
  `MENU shows what needs you. ${ch === 'sms' ? 'STOP ends texts, START turns them back on. ' : ''}Settings: ${APP_URL}/text`;

const STOP = /^(stop|stopall|unsubscribe|cancel|end|quit|revoke|optout)$/i;
const START = /^(start|unstop|resume)$/i;
const YES = /^(y|yes|yep|yeah|ok|okay|send|send it|do it|go|approve|confirm|sure)[.!]*$/i;
const SKIP = /^(n|no|nope|skip|pass|not now|decline|cancel that)[.!]*$/i;

export const newSmsCode = () => String(randomInt(100000, 1000000));
export const newTelegramCode = () => randomBytes(9).toString('base64url');

async function updateLine(id: string, patch: Record<string, unknown>) {
  await db().from('text_lines').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
}

/** Who sent this, if anyone we know. */
async function lineFor(channel: Channel, address: string): Promise<Line | null> {
  const { data } = await db()
    .from('text_lines')
    .select('*')
    .eq('channel', channel)
    .eq('address', address)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Line | null) ?? null;
}

/** The club this line runs, as the director. */
async function ctxFor(line: Line): Promise<ClubCtx | null> {
  return withActiveClub(line.club_id, () => resolveClubCtx(line.user_id));
}

/** Text the director on their line (and log it). */
export async function say(line: Line, body: string, kind = 'reply') {
  if (!line.address) return;
  return sendTo(line.channel, line.address, body, { userId: line.user_id, lineId: line.id, kind });
}

function remember(line: Line, user: string, assistant: string): ChatTurn[] {
  return [...(line.history ?? []), { role: 'user' as const, content: user.slice(0, 1500) }, { role: 'assistant' as const, content: assistant.slice(0, 1500) }].slice(-12);
}

/**
 * Handle one inbound message. `providerId` (Twilio MessageSid / Telegram update id)
 * makes a retried webhook harmless.
 */
export async function handleInbound(msg: { channel: Channel; address: string; body: string; providerId?: string; hasMedia?: boolean; media?: InMedia[] }): Promise<void> {
  const body = (msg.body || '').trim();
  if (msg.providerId) {
    const { count } = await db().from('text_messages').select('id', { count: 'exact', head: true })
      .eq('channel', msg.channel).eq('direction', 'in').eq('provider_id', msg.providerId);
    if ((count ?? 0) > 0) return;
  }
  let line = await lineFor(msg.channel, msg.address);
  await db().from('text_messages').insert({
    line_id: line?.id ?? null, channel: msg.channel, address: msg.address, direction: 'in',
    body: body.slice(0, 4000), provider_id: msg.providerId ?? null, kind: 'in',
  });

  // ---- linking a new phone / chat
  const join = body.match(/^(?:\/start\s+|join\s+)([A-Za-z0-9_-]{6,24})$/i);
  if (join) {
    const linked = await linkWithCode(msg.channel, msg.address, join[1]);
    if (linked) return;
    await sendTo(msg.channel, msg.address, `That code didn't work or has expired. Get a new one at ${APP_URL}/text`, { kind: 'system' });
    return;
  }
  if (!line || line.status === 'pending') {
    if (STOP.test(body)) return;
    await sendTo(msg.channel, msg.address, `This is ClubMode's staff line for club directors. To connect your phone, open ${APP_URL}/text`, { kind: 'system' });
    return;
  }

  // ---- STOP / START / HELP (carriers require these to work, always)
  if (STOP.test(body)) {
    await updateLine(line.id, { status: 'stopped', stopped_at: new Date().toISOString() });
    if (msg.channel === 'telegram') await say(line, `Stopped. Your staff won't message you here. Text START to turn it back on.`, 'system');
    return; // SMS: the carrier/Twilio sends the opt-out confirmation itself
  }
  if (line.status === 'stopped') {
    if (START.test(body)) {
      await updateLine(line.id, { status: 'active', stopped_at: null });
      await say(line, `You're back on. Your staff will text you the morning huddle. Text MENU any time.`, 'system');
    }
    return;
  }
  if (/^(help|info|\?)$/i.test(body)) { await say(line, HELP(line.channel), 'system'); return; }

  const ctx = await ctxFor(line);
  if (!ctx) { await say(line, `I can't find the club this line runs. Reconnect at ${APP_URL}/text`, 'system'); return; }

  // ---- the huddle on demand
  if (/^(menu|huddle|today|list|what needs me\??)$/i.test(body)) {
    const h = await buildHuddle(ctx);
    await updateLine(line.id, { menu: h.menu, awaiting: null });
    await say(line, h.text, 'huddle');
    return;
  }
  if (/^(quiet|pause)$/i.test(body)) {
    await updateLine(line.id, { morning: false, evening: false });
    await say(line, 'Quiet: no morning or evening texts. You can still text me. Text LOUD to turn them back on.', 'system');
    return;
  }
  if (/^(loud|unpause)$/i.test(body)) {
    await updateLine(line.id, { morning: true, evening: true });
    await say(line, 'On: morning huddle and evening recap.', 'system');
    return;
  }

  // ---- a number from the huddle
  const num = body.match(/^#?(\d{1,2})[.)]?$/);
  if (num && line.menu?.length) {
    const item = line.menu.find((m) => m.n === Number(num[1]));
    if (item) { await openItem(line, ctx, item); return; }
  }

  // ---- YES / SKIP on the item they opened
  if (line.awaiting && (YES.test(body) || SKIP.test(body))) {
    await decideItem(line, ctx, line.awaiting, YES.test(body));
    return;
  }

  // ---- a photo: a receipt to reimburse, or something to read
  if (msg.media?.length) {
    await handlePhoto(line, ctx, msg.media[0], body);
    return;
  }
  if (msg.hasMedia && !body) {
    await say(line, "I couldn't open that photo. Try sending it again as a photo (not a file).", 'system');
    return;
  }

  // ---- everything else: the staff
  await showTyping(line.channel, line.address!);
  const { data: who } = await db().auth.admin.getUserById(line.user_id);
  const r = await withActiveClub(line.club_id, () =>
    runChat({ user: { id: line!.user_id, email: who?.user?.email ?? null }, message: body, history: line!.history ?? [], page: '/proshop', channel: 'text' }),
  );
  const reply = r.ok ? r.text : r.message;
  await updateLine(line.id, { history: remember(line, body, reply), awaiting: null });
  await say(line, reply);
}

/** A photo texted in. Receipts go to the accountant after a YES; anything else is read back. */
async function handlePhoto(line: Line, ctx: ClubCtx, media: InMedia, caption: string) {
  await showTyping(line.channel, line.address!);
  const img = await fetchMedia(media).catch(() => null);
  if (!img) { await say(line, "I couldn't open that photo. Send it as a regular photo (JPG or PNG).", 'system'); return; }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: ctx.timeZone }).format(new Date());
  const read = await readPhoto(img, today).catch((e) => { console.error('photo read failed', e); return null; });
  if (!read) { await say(line, "I couldn't read that one. Try a sharper photo, or tell me what it is.", 'system'); return; }
  if (read.kind === 'receipt') {
    if (read.amount == null || !(read.amount > 0)) {
      await say(line, `That looks like a receipt from ${read.vendor || 'a store'}, but I can't read the total. What was the total?`);
      await updateLine(line.id, { history: remember(line, caption || '[photo of a receipt]', `Receipt from ${read.vendor || 'unknown vendor'}, total unreadable. Asked for the total.`) });
      return;
    }
    const mediaId = await keepMedia(line.id, img);
    const ref = { vendor: read.vendor || 'Unknown vendor', date: read.date && /^\d{4}-\d{2}-\d{2}$/.test(read.date) ? read.date : today, amount: Math.round(read.amount * 100) / 100, description: (caption || read.description || 'Supplies').slice(0, 60), mediaId };
    const label = `${ref.vendor}, ${ref.date}, ${money(ref.amount)}, ${ref.description}`;
    await updateLine(line.id, { awaiting: { n: 0, kind: 'receipt', ref, label } });
    await say(line, `Receipt: ${label} (Tennis).\nReply YES and I'll send it to Edi for reimbursement, or SKIP.`);
    return;
  }
  if (read.kind === 'signin') {
    const names = (read.names ?? []).slice(0, 40);
    const msg = `${read.title ? read.title + ': ' : ''}I read ${names.length} name${names.length === 1 ? '' : 's'}: ${names.join(', ')}.\nWhich class and date is this for? I'll put the attendance on the board.`;
    await updateLine(line.id, { history: remember(line, caption || '[photo of a sign-in sheet]', msg) });
    await say(line, msg);
    return;
  }
  const msg = `${read.summary} What should I do with it?`;
  await updateLine(line.id, { history: remember(line, caption || '[photo]', msg) });
  await say(line, msg);
}

/** Show one huddle item and what YES would do. */
async function openItem(line: Line, ctx: ClubCtx, item: MenuItem) {
  if (item.kind === 'task') {
    const { data: t } = await ctx.db.from('proshop_tasks').select('*').eq('id', item.ref.id).eq('club_id', ctx.clubId).maybeSingle();
    if (!t || t.status !== 'proposed') { await say(line, 'That one was already decided. Text MENU for the latest.', 'system'); return; }
    const who = staffById(t.agent)?.name ?? 'Your staff';
    const head = `${who}: ${t.text}${t.money ? ` (${t.money})` : ''}`;
    if (t.money) {
      await updateLine(line.id, { awaiting: null });
      await say(line, `${head}\n${t.detail ?? ''}\nThis one has money in it, so it gets your yes on the page: ${APP_URL}/proshop`.trim());
      return;
    }
    await updateLine(line.id, { awaiting: item });
    await say(line, `${head}\n${t.detail ?? ''}\nReply YES to approve or SKIP.`.replace(/\n\n/g, '\n'));
    return;
  }
  const kind = item.kind === 'clinic_reminder' ? 'reminder' : 'spots_left';
  const c = await loadClinic(ctx.db, item.ref.program);
  if (!c || c.club.id !== ctx.clubId) { await say(line, "I can't find that clinic any more. Text MENU.", 'system'); return; }
  const s = await senderFor(ctx);
  const prev = await sendClinic(ctx.db, { program: c.program, club: c.club, date: item.ref.date, kind, mode: 'preview', ownerId: ctx.userId, ...s });
  const when = clinicWhen(c.program, item.ref.date, c.club.timeZone);
  if (prev.mode !== 'preview' || !prev.count) { await say(line, `Nobody to email for ${c.program.title} ${when.day} any more.`, 'system'); return; }
  await updateLine(line.id, { awaiting: item });
  const who = kind === 'reminder' ? `the ${prev.count} signed up` : `${prev.count} regulars who haven't signed up`;
  await say(line, `${c.program.title}, ${when.day} ${when.time}. ${kind === 'spots_left' ? `${prev.spotsLeft} spot${prev.spotsLeft === 1 ? '' : 's'} open. ` : ''}One email each to ${who}: "${prev.subject}".\nReply YES to send or SKIP.`);
}

async function decideItem(line: Line, ctx: ClubCtx, item: Awaiting, yes: boolean) {
  await updateLine(line.id, { awaiting: null });
  if (item.kind === 'receipt') {
    if (!yes) { await say(line, 'Skipped. Nothing sent.'); return; }
    await queueJob({ kind: 'reimburse', input: { ...item.ref, notify: true }, clubId: ctx.clubId, userId: line.user_id, lineId: line.id });
    await say(line, `Filing it: ${item.label}. The club computer fills the form and emails Edi, CC you. I'll text you when it's sent.`);
    return;
  }
  if (!MANAGER_ROLES.has(ctx.role)) { await say(line, 'Only the club owner or director can say yes to that.', 'system'); return; }
  if (item.kind === 'task') {
    const status = yes ? 'approved' : 'declined';
    const { data } = await ctx.db.from('proshop_tasks')
      .update({ status, decided_at: new Date().toISOString(), decided_by: ctx.userId, updated_at: new Date().toISOString() })
      .eq('id', item.ref.id).eq('club_id', ctx.clubId).eq('status', 'proposed').is('money', null)
      .select('id').maybeSingle();
    await say(line, data ? (yes ? 'Approved. Your staff is on it.' : 'Skipped.') : 'That one was already decided.');
    return;
  }
  if (!yes) { await say(line, 'Skipped. Nothing sent.'); return; }
  const kind = item.kind === 'clinic_reminder' ? 'reminder' : 'spots_left';
  const c = await loadClinic(ctx.db, item.ref.program);
  if (!c || c.club.id !== ctx.clubId) { await say(line, "I can't find that clinic any more.", 'system'); return; }
  const s = await senderFor(ctx);
  const res = await sendClinic(ctx.db, { program: c.program, club: c.club, date: item.ref.date, kind, mode: 'live', ownerId: ctx.userId, ...s, sentBy: ctx.userId });
  if (res.mode !== 'live') { await say(line, 'That did not send. Try it on the Pro Shop page.'); return; }
  const held = res.creditLimited ? ' Some were held: your club hit its limit or has no card.' : '';
  await say(line, `Sent ${res.sent} email${res.sent === 1 ? '' : 's'}, one each.${res.failures.length ? ` ${res.failures.length} failed.` : ''}${held}`);
}

async function senderFor(ctx: ClubCtx) {
  const { data } = await ctx.db.auth.admin.getUserById(ctx.userId);
  const u = data?.user;
  const name = (u?.user_metadata as any)?.full_name || (u?.user_metadata as any)?.name || ctx.clubName;
  return { replyTo: u?.email || '', senderName: String(name) };
}

/** A code from /text, sent in from the phone or chat that should be linked. */
async function linkWithCode(channel: Channel, address: string, code: string): Promise<boolean> {
  const { data } = await db()
    .from('text_lines')
    .select('*')
    .eq('channel', channel)
    .eq('link_code', code)
    .gt('link_expires_at', new Date().toISOString())
    .maybeSingle();
  const line = data as Line | null;
  if (!line) return false;
  // One phone runs one director's line: free it from any older line first.
  await db().from('text_lines').update({ status: 'stopped', address: null, updated_at: new Date().toISOString() })
    .eq('channel', channel).eq('address', address).neq('id', line.id);
  await updateLine(line.id, { address, status: 'active', link_code: null, link_expires_at: null, verified_at: new Date().toISOString(), stopped_at: null });
  const fresh = { ...line, address, status: 'active' as const };
  const ctx = await ctxFor(fresh);
  await say(fresh, `Connected. This is your ${ctx?.clubName ?? 'club'} staff. I'll text you a huddle each morning and a recap each evening. Text me anything, any time. Text HELP for help${channel === 'sms' ? ', STOP to opt out' : ''}.`, 'system');
  if (ctx) {
    const h = await buildHuddle(ctx);
    await updateLine(line.id, { menu: h.menu });
    await say(fresh, h.text, 'huddle');
  }
  return true;
}

/** Heads-ups from Secretary (rain on a match day, unbooked courts, junior billing), each texted once. */
async function sendAlerts(line: Line) {
  const base = process.env.SECRETARY_TEXT_URL, key = process.env.SECRETARY_TEXT_SECRET;
  if (!base || !key) return;
  const { data } = await db().auth.admin.getUserById(line.user_id);
  if (!isPlatformOwnerEmail(data?.user?.email)) return;
  let alerts: { id: string; text: string }[] = [];
  try {
    const r = await fetch(base.replace(/\/text$/, '/alerts'), { headers: { authorization: `Bearer ${key}` }, cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    alerts = ((await r.json().catch(() => null)) as { alerts?: typeof alerts } | null)?.alerts ?? [];
  } catch { return; }
  const sent = new Set(line.sent_alerts ?? []);
  const fresh = alerts.filter((a) => a?.id && !sent.has(a.id));
  if (!fresh.length) return;
  for (const a of fresh) await say(line, a.text, 'alert');
  await updateLine(line.id, { sent_alerts: [...sent, ...fresh.map((a) => a.id)].slice(-300) });
}

/** The platform owner's morning briefing from Secretary (secretary-dc.vercel.app), or null. */
async function secretaryBriefing(userId: string): Promise<string | null> {
  const url = process.env.SECRETARY_TEXT_URL, key = process.env.SECRETARY_TEXT_SECRET;
  if (!url || !key) return null;
  const { data } = await db().auth.admin.getUserById(userId);
  if (!isPlatformOwnerEmail(data?.user?.email)) return null;
  try {
    const r = await fetch(url, { headers: { authorization: `Bearer ${key}` }, cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    const j = (await r.json().catch(() => null)) as { text?: string } | null;
    return r.ok && j?.text ? j.text : null;
  } catch {
    return null;
  }
}

/** The scheduled texts. Called every hour; sends each line's huddle at 7am and recap at 6pm, its club's time. */
export async function tick(now = new Date()): Promise<{ morning: number; evening: number; errors: string[] }> {
  const { data } = await db().from('text_lines').select('*').eq('status', 'active').not('address', 'is', null).limit(1000);
  const out = { morning: 0, evening: 0, errors: [] as string[] };
  for (const line of (data as Line[] | null) ?? []) {
    try {
      const ctx = await ctxFor(line);
      if (!ctx) continue;
      const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: ctx.timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now));
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: ctx.timeZone }).format(now);
      if (line.morning && hour >= 7 && hour < 11 && line.last_morning !== today) {
        // Darrin's own line: his Secretary briefing comes first ("Good morning, league
        // match today on courts 5, 6, 8, 9...", 11/25/26), then the staff huddle.
        const brief = await secretaryBriefing(line.user_id);
        if (brief) await say(line, brief, 'secretary');
        const h = await buildHuddle(ctx);
        await updateLine(line.id, { menu: h.menu, awaiting: null, last_morning: today });
        await say(line, h.text, 'huddle');
        out.morning++;
      }
      if (hour >= 7 && hour <= 20) await sendAlerts(line);
      if (line.evening && hour >= 18 && hour < 22 && line.last_evening !== today) {
        await updateLine(line.id, { last_evening: today });
        const since = new Date(now.getTime() - 14 * 3600_000).toISOString();
        const recap = await buildRecap(ctx, since);
        if (recap) { await say(line, recap, 'recap'); out.evening++; }
      }
    } catch (e) {
      out.errors.push(`${line.id}: ${(e as Error).message}`);
    }
  }
  return out;
}
