/**
 * Daily (~8am Pacific): automatic clinic emails for clinics with auto_reminders on.
 * For each clinic meeting TOMORROW in the club's time zone:
 *   1. a reminder to everyone signed up (if anyone is), and
 *   2. if spots are still open, a "spots left" note to the regulars who haven't answered.
 * Each kind is sent at most once per clinic date (club_program_meeting_sends), so a
 * manual send earlier counts and a re-run of the cron is harmless. Billed to the club
 * owner like any send, and held (not lost) if the club has no card or hit its limit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { CLINIC_PROGRAM_COLS, alreadySent, meetsOn, sendClinic, type ClinicProgram } from '@/lib/programs/clinicSignups';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const tomorrowIn = (tz: string) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  const { data: progs } = await db.from('club_programs').select(CLINIC_PROGRAM_COLS).eq('auto_reminders', true).eq('status', 'published').limit(500);
  const programs = (progs as unknown as ClinicProgram[] | null) ?? [];
  if (!programs.length) return NextResponse.json({ checked: 0, results: [] });

  const clubIds = [...new Set(programs.map((p) => p.club_id))];
  const { data: clubs } = await db.from('cc_clubs').select('id, name, slug, timezone, owner_id').in('id', clubIds);
  const clubById = new Map(((clubs as any[] | null) ?? []).map((c) => [c.id, c]));
  const results: Record<string, unknown>[] = [];

  for (const p of programs) {
    const c = clubById.get(p.club_id);
    if (!c?.owner_id) continue;
    const tz = c.timezone || 'America/Los_Angeles';
    const date = tomorrowIn(tz);
    if (!meetsOn(p, date, tz)) continue;
    const { data: owner } = await db.auth.admin.getUserById(c.owner_id);
    const replyTo = owner?.user?.email;
    if (!replyTo) continue;
    const senderName = String((owner?.user?.user_metadata as any)?.full_name || c.name);
    const base = { program: p, club: { id: c.id, name: c.name, slug: c.slug, timeZone: tz }, date, ownerId: c.owner_id, replyTo, senderName, auto: true };
    try {
      for (const kind of ['reminder', 'spots_left'] as const) {
        if (await alreadySent(db, p.id, date, kind)) continue;
        const preview = await sendClinic(db, { ...base, kind, mode: 'preview' });
        if (preview.mode !== 'preview' || !preview.count) continue;
        if (kind === 'spots_left' && preview.spotsLeft === 0) continue;
        const live = await sendClinic(db, { ...base, kind, mode: 'live' });
        results.push({ program: p.title, date, kind, sent: live.mode === 'live' ? live.sent : 0 });
      }
    } catch (e) {
      console.error('clinic auto reminder failed', p.id, e);
      results.push({ program: p.title, date, error: (e as Error).message });
    }
  }
  return NextResponse.json({ checked: programs.length, results });
}
