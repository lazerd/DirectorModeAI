import 'server-only';
import { randomBytes } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

/**
 * CourtConnect paid hosting (Darrin, 11/18/26):
 *   joining any game ............ free, always
 *   your FIRST hosted event ...... free
 *   Host Pass ................... $25/yr  (this host, unlimited events)
 *   Club Pass ................... $100/yr (every member who opens the club link can host)
 *
 * No accounts: a host is the device id their browser keeps (cc_host_id). Passes are
 * written by the LemonSqueezy webhook (price_key cc_host / cc_club).
 */
export const PASS_PRICES = { host: 25, club: 100 } as const;

const ACTIVE = ['active', 'on_trial', 'past_due', 'cancelled'];

export async function freeEventsUsed(hostId: string): Promise<number> {
  const { count } = await getSupabaseAdmin().from('play_events').select('id', { count: 'exact', head: true }).eq('host_id', hostId).is('parent_id', null);
  return count ?? 0;
}

export async function activePass(hostId: string | null, clubCode: string | null) {
  const db = getSupabaseAdmin();
  const now = new Date().toISOString();
  const ok = (p: { status: string; ends_at: string | null } | null) => !!p && ACTIVE.includes(p.status) && (!p.ends_at || p.ends_at > now);
  if (hostId) {
    const safe = /^[A-Za-z0-9_-]{8,64}$/.test(hostId) ? hostId : '-';
    const { data } = await db.from('play_passes').select('kind, status, ends_at, club_code, club_name').or(`host_id.eq.${safe},extra_host_ids.cs.{${safe}}`).order('created_at', { ascending: false });
    const p = (data ?? []).find(ok);
    if (p) return p;
  }
  if (clubCode) {
    const { data } = await db.from('play_passes').select('kind, status, ends_at, club_code, club_name').eq('club_code', clubCode.toLowerCase()).maybeSingle();
    if (ok(data)) return data;
  }
  return null;
}

/** Can this device host one more event? */
export async function hostingAllowed(hostId: string | null, clubCode: string | null, opts: { runback?: boolean } = {}): Promise<{ ok: boolean; reason?: 'paywall' }> {
  if (await activePass(hostId, clubCode)) return { ok: true };
  if (!hostId) return { ok: !opts.runback };
  if (!opts.runback && (await freeEventsUsed(hostId)) < 1) return { ok: true };
  return { ok: false, reason: 'paywall' };
}

const LINKS = {
  host: () => process.env.LEMONSQUEEZY_BUY_LINK_CC_HOST || null,
  club: () => process.env.LEMONSQUEEZY_BUY_LINK_CC_CLUB || null,
};

export function passCheckoutUrl(kind: 'host' | 'club', hostId: string, clubName?: string | null): string | null {
  const base = LINKS[kind]();
  if (!base) return null;
  const u = new URL(base);
  u.searchParams.set('checkout[custom][price_key]', kind === 'host' ? 'cc_host' : 'cc_club');
  u.searchParams.set('checkout[custom][host_id]', hostId);
  if (clubName) u.searchParams.set('checkout[custom][club_name]', clubName.slice(0, 60));
  return u.toString();
}

const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
export const newClubCode = () => [...randomBytes(7)].map((b) => ALPHA[b % ALPHA.length]).join('');

/** Called by the LemonSqueezy webhook for cc_host / cc_club subscriptions. */
export async function recordPassFromWebhook(custom: Record<string, string>, data: { id: string | number }, attrs: Record<string, unknown>) {
  const db = getSupabaseAdmin();
  const kind = custom.price_key === 'cc_club' ? 'club' : 'host';
  const subId = String(data.id);
  const { data: existing } = await db.from('play_passes').select('id, club_code').eq('ls_subscription_id', subId).maybeSingle();
  const row = {
    kind,
    host_id: custom.host_id || null,
    email: (attrs.user_email as string) || null,
    club_name: kind === 'club' ? (custom.club_name || (attrs.user_name as string) || 'Club') : null,
    ls_subscription_id: subId,
    ls_customer_id: attrs.customer_id ? String(attrs.customer_id) : null,
    status: String(attrs.status || 'active'),
    renews_at: (attrs.renews_at as string) || null,
    ends_at: (attrs.ends_at as string) || null,
    updated_at: new Date().toISOString(),
  };
  if (existing) await db.from('play_passes').update(row).eq('id', existing.id);
  else await db.from('play_passes').insert({ ...row, club_code: kind === 'club' ? newClubCode() : null });
}
