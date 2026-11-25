/**
 * POST { code } — the members-only door on clubmode.ai. A valid, active code sets the
 * signed pass cookie and counts one use. Wrong codes get the same short answer every
 * time, and a browser gets 8 tries a minute.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { PASS_COOKIE, PASS_DAYS, normalizeCode, signPass } from '@/lib/members/pass';

export const dynamic = 'force-dynamic';

const tries = new Map<string, { n: number; reset: number }>();
function allowed(key: string) {
  const now = Date.now();
  const t = tries.get(key);
  if (!t || t.reset < now) { tries.set(key, { n: 1, reset: now + 60_000 }); return true; }
  t.n++;
  return t.n <= 8;
}

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (!allowed(ip)) return NextResponse.json({ ok: false, error: 'Too many tries. Wait a minute.' }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const code = normalizeCode(body?.code);
  const no = NextResponse.json({ ok: false, error: 'That code is not recognized.' }, { status: 403 });
  if (code.length < 3) return no;
  const db = getSupabaseAdmin();
  const { data } = await db.from('member_codes').select('code, active, max_uses, uses').eq('code', code).maybeSingle();
  const row = data as { code: string; active: boolean; max_uses: number | null; uses: number } | null;
  if (!row || !row.active || (row.max_uses != null && row.uses >= row.max_uses)) return no;
  await db.from('member_codes').update({ uses: row.uses + 1, last_used_at: new Date().toISOString() }).eq('code', code);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PASS_COOKIE, signPass(code), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: PASS_DAYS * 86_400,
  });
  return res;
}
