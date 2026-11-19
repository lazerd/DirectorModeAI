import 'server-only';
import { createHash, randomInt } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendBilledEmail } from '@/lib/email';
import { placeSlug } from './crown';

/**
 * CourtConnect email: crown alerts (opt-in) and pass-restore codes. ClubMode pays
 * (platformPaid); nobody's meter is touched. Plain, short, one link.
 */
const APP = process.env.NEXT_PUBLIC_APP_URL || 'https://clubmode.ai';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const okEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 200;

function shell(title: string, body: string, cta?: { href: string; label: string }) {
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;color:#103c32">
  <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#6a7b71">CourtConnect</div>
  <h1 style="font-size:26px;line-height:1.15;margin:8px 0 12px">${esc(title)}</h1>
  <div style="font-size:16px;line-height:1.5">${body}</div>
  ${cta ? `<p style="margin:22px 0"><a href="${cta.href}" style="background:#d4ff49;color:#103c32;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:12px;display:inline-block">${esc(cta.label)}</a></p>` : ''}
</div>`;
}

export async function watchCrown(location: string | null, name: string, email: string): Promise<boolean> {
  const slug = placeSlug(location);
  const e = email.trim().toLowerCase();
  if (!slug || !name.trim() || !okEmail(e)) return false;
  await getSupabaseAdmin().from('play_crown_watch').upsert({ place_slug: slug, name_key: name.trim().toLowerCase(), email: e }, { onConflict: 'place_slug,name_key,email' });
  return true;
}

/** After a night ends: tell the dethroned king (and the new one) if they opted in. */
export async function crownChanged(place: string, before: string | null, after: string | null) {
  if (!after || !before || before.toLowerCase() === after.toLowerCase()) return;
  const slug = placeSlug(place);
  const db = getSupabaseAdmin();
  const { data } = await db.from('play_crown_watch').select('name_key, email').eq('place_slug', slug).in('name_key', [before.toLowerCase(), after.toLowerCase()]);
  const back = `${APP}/play?q=${encodeURIComponent(`Doubles at ${place}`)}`;
  for (const w of data ?? []) {
    const lost = w.name_key === before.toLowerCase();
    await sendBilledEmail(null, {
      platformPaid: true, fromName: 'CourtConnect', to: w.email,
      subject: lost ? `👑 ${after} just took your ${place} crown` : `👑 You're the King of the Court at ${place}`,
      html: lost
        ? shell(`${after} took your crown at ${place}.`, `<p>You held King of the Court at ${esc(place)}. After tonight's results, ${esc(after)} has more wins there over the last 30 days.</p><p>Get a game together there and take it back.</p>`, { href: back, label: 'Start a game at ' + place })
        : shell(`You took the crown at ${place}.`, `<p>Most wins at ${esc(place)} over the last 30 days. ${esc(before)} held it before tonight, and they've been told.</p>`, { href: `${APP}/court/${slug}`, label: 'See the ladder' }),
    } as Parameters<typeof sendBilledEmail>[1]);
  }
}

/* ---------- restore a pass on another phone ---------- */
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export async function sendRestoreCode(email: string, hostId: string): Promise<'sent' | 'none'> {
  const e = email.trim().toLowerCase();
  if (!okEmail(e)) return 'none';
  const db = getSupabaseAdmin();
  const { data: passes } = await db.from('play_passes').select('id, kind, status, club_name').ilike('email', e).order('created_at', { ascending: false });
  const pass = (passes ?? []).find((p) => ['active', 'on_trial', 'past_due', 'cancelled'].includes(p.status));
  if (!pass) return 'none';
  const code = String(randomInt(100000, 1000000));
  await db.from('play_pass_codes').insert({ pass_id: pass.id, host_id: hostId, code_hash: hash(code + hostId), expires_at: new Date(Date.now() + 15 * 60e3).toISOString() });
  await sendBilledEmail(null, {
    platformPaid: true, operational: true, fromName: 'CourtConnect', to: e,
    subject: `Your CourtConnect code: ${code}`,
    html: shell(`Your code is ${code}`, `<p>Enter it on the phone you want to host from to move your ${pass.kind === 'club' ? `${esc(pass.club_name ?? 'Club')} Club Pass` : 'Host Pass'} there. It works for 15 minutes.</p><p style="color:#6a7b71;font-size:14px">Didn't ask for this? Ignore it; nothing changes.</p>`),
  } as Parameters<typeof sendBilledEmail>[1]);
  return 'sent';
}

export async function confirmRestoreCode(email: string, hostId: string, code: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  const db = getSupabaseAdmin();
  const { data: passes } = await db.from('play_passes').select('id, extra_host_ids').ilike('email', e);
  const ids = (passes ?? []).map((p) => p.id);
  if (!ids.length) return false;
  const { data: codes } = await db.from('play_pass_codes').select('id, pass_id, code_hash, tries, expires_at').in('pass_id', ids).eq('host_id', hostId).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1);
  const c = codes?.[0];
  if (!c || c.tries >= 5) return false;
  if (c.code_hash !== hash(code.trim() + hostId)) { await db.from('play_pass_codes').update({ tries: c.tries + 1 }).eq('id', c.id); return false; }
  const pass = passes!.find((p) => p.id === c.pass_id)!;
  const extra = Array.from(new Set([...(pass.extra_host_ids ?? []), hostId])).slice(-10);
  await db.from('play_passes').update({ extra_host_ids: extra }).eq('id', pass.id);
  await db.from('play_pass_codes').delete().eq('id', c.id);
  return true;
}
