/**
 * Public clinic signup for ONE clinic date (no login).
 *
 * GET  ?t=<signed link from an email>   or  ?p=<programId>&d=<YYYY-MM-DD>
 *      → the clinic, the date, spots left, and (from a signed link) who this is.
 * POST { t, status } or { p, d, name, email, status }  status: 'in' | 'out'
 *      → saves the answer. A signed link is the person; a plain form needs name+email.
 *
 * Nothing is saved by a GET: mail scanners prefetch links, and they must never sign
 * anyone up. The page shows one confirm button instead.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  clinicWhen, loadClinic, meetsOn, personKey, rsvp, signupsFor, spotsLeft, spotsPerMeeting, verifyClinicToken,
} from '@/lib/programs/clinicSignups';

export const dynamic = 'force-dynamic';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

async function resolve(params: { t?: string | null; p?: string | null; d?: string | null }) {
  const tok = params.t ? verifyClinicToken(params.t) : null;
  if (params.t && !tok) return { error: 'That link has expired or is broken. Ask the club for a new one.', status: 400 } as const;
  const programId = tok?.p ?? params.p ?? '';
  const date = tok?.d ?? params.d ?? '';
  if (!UUID.test(programId) || !YMD.test(date)) return { error: 'Missing clinic or date.', status: 400 } as const;
  const db = getSupabaseAdmin();
  const found = await loadClinic(db, programId);
  if (!found || found.program.status === 'archived' || found.program.status === 'draft') return { error: "We couldn't find that clinic.", status: 404 } as const;
  if (!meetsOn(found.program, date, found.club.timeZone)) return { error: "That clinic doesn't meet on that date.", status: 404 } as const;
  return { db, tok, date, ...found } as const;
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const r = await resolve({ t: u.searchParams.get('t'), p: u.searchParams.get('p'), d: u.searchParams.get('d') });
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const signups = await signupsFor(r.db, r.program.id, r.date);
  const mine = r.tok ? signups.find((s) => personKey(s.email) === personKey(r.tok!.e)) : null;
  const when = clinicWhen(r.program, r.date, r.club.timeZone);
  return NextResponse.json({
    club: r.club.name,
    title: r.program.title,
    coach: r.program.coach_name,
    day: when.day,
    time: when.time,
    spots: spotsPerMeeting(r.program),
    spotsLeft: spotsLeft(r.program, signups),
    inCount: signups.filter((s) => s.status === 'in').length,
    me: r.tok ? { name: r.tok.n, email: r.tok.e, status: mine?.status ?? null } : null,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const status = body?.status === 'out' ? 'out' : body?.status === 'in' ? 'in' : null;
  if (!status) return NextResponse.json({ error: 'In or out?' }, { status: 400 });
  const r = await resolve({ t: body?.t ?? null, p: body?.p ?? null, d: body?.d ?? null });
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const name = String(r.tok?.n || body?.name || '').trim();
  const email = String(r.tok?.e || body?.email || '').trim();
  try {
    const out = await rsvp(r.db, { program: r.program, date: r.date, name, email, status, source: r.tok ? 'email' : 'web' });
    if (!out.ok) {
      const msg = out.reason === 'full' ? 'Sorry, this one just filled up.' : out.reason === 'bad_input' ? 'Add your name and email.' : "That clinic doesn't meet then.";
      return NextResponse.json({ error: msg, reason: out.reason }, { status: out.reason === 'full' ? 409 : 400 });
    }
    return NextResponse.json({ ok: true, status: out.status, spotsLeft: out.spotsLeft });
  } catch (e) {
    console.error('clinic rsvp failed', e);
    return NextResponse.json({ error: "Couldn't save that. Try again." }, { status: 500 });
  }
}
