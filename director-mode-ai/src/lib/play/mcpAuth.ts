import 'server-only';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendBilledEmail } from '@/lib/email';

/**
 * Sign-in for the Racquets IRL AI connector (Claude / ChatGPT at /api/mcp) — and nothing else.
 *
 * Kevin's rule stands: the game pages never ask anyone to log in. Only an organizer who
 * connects the AI signs in, once, with a 6-digit code emailed to them. That is OAuth 2.1 with
 * PKCE and dynamic client registration, which both Claude and ChatGPT speak:
 *   /.well-known/oauth-protected-resource   → which server issues tokens
 *   /.well-known/oauth-authorization-server → its endpoints
 *   /api/oauth/register  (DCR)   /oauth/authorize (the email-code page)   /api/oauth/token
 * Only hashes of codes and tokens are stored.
 */

export const SCOPE = 'games';
const CODE_TTL_MIN = 10;          // emailed sign-in code
const AUTH_CODE_TTL_MIN = 5;      // OAuth authorization code
const ACCESS_TTL_H = 24;
const REFRESH_TTL_D = 180;

export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

const sha = (s: string) => createHash('sha256').update(s).digest('base64url');
const token = (bytes = 32) => randomBytes(bytes).toString('base64url');
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
export const normEmail = (e: string) => e.trim().toLowerCase();
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 200;

/** Where the server lives, as the client reached it (clubmode.ai in production, localhost in dev). */
export function originOf(req: Request): string {
  const u = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') ?? u.host;
  const proto = req.headers.get('x-forwarded-proto') ?? u.protocol.replace(':', '');
  return `${proto}://${host}`;
}

export function authServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
    service_documentation: `${origin}/play/ai`,
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Racquets IRL',
    resource_documentation: `${origin}/play/ai`,
  };
}

/* ---------------- clients (dynamic registration) ---------------- */

/** https anywhere; http only on this machine (desktop clients and local testing). */
export function okRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch { return false; }
}

export async function registerClient(body: { redirect_uris?: unknown; client_name?: unknown }) {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((x): x is string => typeof x === 'string') : [];
  if (!uris.length || uris.length > 10 || !uris.every(okRedirect)) throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be 1-10 https URLs.');
  const name = typeof body.client_name === 'string' ? body.client_name.slice(0, 100) : null;
  const client_id = 'rirl_' + token(18);
  const { error } = await getSupabaseAdmin().from('mcp_oauth_clients').insert({ client_id, client_name: name, redirect_uris: uris });
  if (error) throw error;
  return {
    client_id, client_name: name ?? undefined, redirect_uris: uris, client_id_issued_at: Math.floor(Date.now() / 1000),
    token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
  };
}

export async function getClient(clientId: string): Promise<{ client_id: string; client_name: string | null; redirect_uris: string[] } | null> {
  if (!clientId || clientId.length > 80) return null;
  const { data } = await getSupabaseAdmin().from('mcp_oauth_clients').select('client_id, client_name, redirect_uris').eq('client_id', clientId).maybeSingle();
  return data ?? null;
}

export type AuthorizeParams = {
  response_type: string; client_id: string; redirect_uri: string; code_challenge: string;
  code_challenge_method: string; state?: string | null; scope?: string | null;
};

/** Checks every authorize parameter. Returns the client's display name. */
export async function checkAuthorize(p: AuthorizeParams): Promise<{ clientName: string }> {
  const c = await getClient(p.client_id);
  if (!c) throw new OAuthError('invalid_client', 'This connection link has expired. Remove the connector and add it again.');
  if (!c.redirect_uris.includes(p.redirect_uri)) throw new OAuthError('invalid_request', 'Unknown redirect_uri for this client.');
  if (p.response_type !== 'code') throw new OAuthError('unsupported_response_type', 'Only response_type=code is supported.');
  if (p.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(p.code_challenge ?? '')) throw new OAuthError('invalid_request', 'PKCE (S256) is required.');
  return { clientName: friendlyClient(c.client_name, p.redirect_uri) };
}

export function friendlyClient(name: string | null, redirect: string): string {
  const s = `${name ?? ''} ${redirect}`.toLowerCase();
  if (s.includes('chatgpt') || s.includes('openai')) return 'ChatGPT';
  if (s.includes('claude') || s.includes('anthropic')) return 'Claude';
  return name?.trim() || 'your AI assistant';
}

/* ---------------- the emailed code ---------------- */

export async function sendLoginCode(emailRaw: string, ip: string | null, clientName: string): Promise<void> {
  const email = normEmail(emailRaw);
  if (!validEmail(email)) throw new OAuthError('invalid_email', 'That email doesn’t look right.');
  const db = getSupabaseAdmin();
  const since15 = new Date(Date.now() - 15 * 60_000).toISOString();
  const since60 = new Date(Date.now() - 60 * 60_000).toISOString();
  const [{ count: perEmail }, { count: perIp }] = await Promise.all([
    db.from('mcp_login_codes').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', since15),
    ip ? db.from('mcp_login_codes').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', since60) : Promise.resolve({ count: 0 }),
  ]);
  if ((perEmail ?? 0) >= 3 || (perIp ?? 0) >= 12) throw new OAuthError('slow_down', 'Too many codes. Wait a few minutes and try again.', 429);

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const { error } = await db.from('mcp_login_codes').insert({ email, code_hash: sha(`${email}:${code}`), ip, expires_at: minutes(CODE_TTL_MIN) });
  if (error) throw error;
  const r = await sendBilledEmail(null, {
    to: email, platformPaid: true, operational: true, fromName: 'Racquets IRL',
    subject: `${code} is your Racquets IRL code`,
    html: `<div style="font-family:system-ui,sans-serif;font-size:16px;color:#111">
      <p>Your code to connect Racquets IRL to ${clientName}:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>
      <p style="color:#555">It expires in ${CODE_TTL_MIN} minutes. If you didn’t ask for it, ignore this email.</p></div>`,
    text: `Your code to connect Racquets IRL to ${clientName}: ${code}\nIt expires in ${CODE_TTL_MIN} minutes. If you didn't ask for it, ignore this email.`,
  });
  if (!r.sent) throw new OAuthError('send_failed', 'We couldn’t send the email. Check the address and try again.', 502);
}

/** The organizer for a correct, unexpired code (created on first sign-in). */
export async function verifyLoginCode(emailRaw: string, codeRaw: string): Promise<{ id: string; email: string }> {
  const email = normEmail(emailRaw);
  const code = codeRaw.replace(/\D/g, '');
  const db = getSupabaseAdmin();
  const { data: row } = await db.from('mcp_login_codes').select('id, code_hash, attempts, expires_at, used_at')
    .eq('email', email).is('used_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!row || new Date(row.expires_at) < new Date()) throw new OAuthError('expired', 'That code has expired. Send a new one.');
  if (row.attempts >= 5) throw new OAuthError('locked', 'Too many tries. Send a new code.');
  const want = Buffer.from(row.code_hash), got = Buffer.from(sha(`${email}:${code}`));
  if (code.length !== 6 || want.length !== got.length || !timingSafeEqual(want, got)) {
    await db.from('mcp_login_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id);
    throw new OAuthError('wrong_code', 'That code isn’t right. Check the email and try again.');
  }
  await db.from('mcp_login_codes').update({ used_at: new Date().toISOString() }).eq('id', row.id);
  const { data: org, error } = await db.from('play_organizers').upsert({ email, last_seen_at: new Date().toISOString() }, { onConflict: 'email' }).select('id, email').single();
  if (error || !org) throw error ?? new Error('organizer upsert failed');
  return org;
}

/* ---------------- codes and tokens ---------------- */

export async function issueAuthCode(p: AuthorizeParams, organizerId: string): Promise<string> {
  const code = token();
  const { error } = await getSupabaseAdmin().from('mcp_oauth_grants').insert({
    hash: sha(code), kind: 'code', client_id: p.client_id, organizer_id: organizerId, redirect_uri: p.redirect_uri,
    code_challenge: p.code_challenge, scope: SCOPE, expires_at: minutes(AUTH_CODE_TTL_MIN),
  });
  if (error) throw error;
  return code;
}

async function issueTokens(clientId: string, organizerId: string) {
  const access = token(), refresh = token();
  const { error } = await getSupabaseAdmin().from('mcp_oauth_grants').insert([
    { hash: sha(access), kind: 'access', client_id: clientId, organizer_id: organizerId, scope: SCOPE, expires_at: minutes(ACCESS_TTL_H * 60) },
    { hash: sha(refresh), kind: 'refresh', client_id: clientId, organizer_id: organizerId, scope: SCOPE, expires_at: minutes(REFRESH_TTL_D * 24 * 60) },
  ]);
  if (error) throw error;
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_H * 3600, refresh_token: refresh, scope: SCOPE };
}

/** Marks a one-time grant used; false if someone else used it first. */
async function consume(hash: string): Promise<boolean> {
  const { data } = await getSupabaseAdmin().from('mcp_oauth_grants').update({ used_at: new Date().toISOString() })
    .eq('hash', hash).is('used_at', null).select('hash');
  return !!data?.length;
}

export async function exchangeCode(f: { code?: string; client_id?: string; redirect_uri?: string; code_verifier?: string }) {
  if (!f.code || !f.client_id || !f.code_verifier) throw new OAuthError('invalid_request', 'code, client_id and code_verifier are required.');
  const db = getSupabaseAdmin();
  const { data: g } = await db.from('mcp_oauth_grants').select('*').eq('hash', sha(f.code)).eq('kind', 'code').maybeSingle();
  if (!g || g.used_at || new Date(g.expires_at) < new Date() || g.client_id !== f.client_id) throw new OAuthError('invalid_grant', 'The authorization code is invalid or expired.');
  if (f.redirect_uri && f.redirect_uri !== g.redirect_uri) throw new OAuthError('invalid_grant', 'redirect_uri mismatch.');
  if (sha(f.code_verifier) !== g.code_challenge) throw new OAuthError('invalid_grant', 'PKCE verification failed.');
  if (!(await consume(g.hash))) throw new OAuthError('invalid_grant', 'The authorization code was already used.');
  return issueTokens(g.client_id, g.organizer_id);
}

export async function refreshTokens(f: { refresh_token?: string; client_id?: string }) {
  if (!f.refresh_token) throw new OAuthError('invalid_request', 'refresh_token is required.');
  const { data: g } = await getSupabaseAdmin().from('mcp_oauth_grants').select('*').eq('hash', sha(f.refresh_token)).eq('kind', 'refresh').maybeSingle();
  if (!g || g.used_at || new Date(g.expires_at) < new Date() || (f.client_id && f.client_id !== g.client_id)) throw new OAuthError('invalid_grant', 'The refresh token is invalid or expired.');
  if (!(await consume(g.hash))) throw new OAuthError('invalid_grant', 'The refresh token was already used.');
  return issueTokens(g.client_id, g.organizer_id);
}

export type Organizer = { id: string; email: string };

/** The organizer behind a bearer token, or null. */
export async function organizerFor(req: Request): Promise<Organizer | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  if (!m) return null;
  const db = getSupabaseAdmin();
  const { data: g } = await db.from('mcp_oauth_grants').select('organizer_id, expires_at, used_at').eq('hash', sha(m[1])).eq('kind', 'access').maybeSingle();
  if (!g || g.used_at || new Date(g.expires_at) < new Date()) return null;
  const { data: org } = await db.from('play_organizers').select('id, email').eq('id', g.organizer_id).maybeSingle();
  return org ?? null;
}
