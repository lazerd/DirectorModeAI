/**
 * Instructor side of Open Lesson Time.
 *   GET                      — settings, the address to share with, live counts
 *   PATCH { … }              — save settings (and the club page, for its owner)
 *   POST  { action: 'sync' } — pull the calendar now and say what it found
 *
 * The GET deliberately returns the service account's email address and the
 * exact event title. Those two strings are the entire setup, and an instructor
 * should be able to copy them off the screen rather than be told to read a
 * help page.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  calendarErrorMessage,
  OPEN_LESSON_TITLE,
  serviceAccountEmail,
} from '@/lib/lessons/googleCalendar';
import {
  DEFAULT_DURATIONS,
  durationsFor,
  syncOpenWindows,
  type CoachRow,
} from '@/lib/lessons/openTimes';
import { APP_URL } from '@/lib/appUrl';

export const dynamic = 'force-dynamic';

const COLUMNS =
  'id, club_id, slug, display_name, email, google_calendar_id, open_keyword, open_page_enabled, ' +
  'open_page_note, open_rate_note, open_durations, booking_lead_hours, timezone, open_synced_at';

const ALLOWED_DURATIONS = [30, 60, 90];

async function currentCoach() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Not signed in.' }, { status: 401 }) };

  const db = getSupabaseAdmin();
  const { data } = await db.from('lesson_coaches').select(COLUMNS).eq('profile_id', user.id).maybeSingle();
  if (!data) {
    return { error: NextResponse.json({ error: 'No coach profile yet.' }, { status: 404 }) };
  }
  return { coach: data as unknown as CoachRow & { open_synced_at: string | null }, db, userId: user.id };
}

function slugify(name: string, fallback: string): string {
  const base = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base || fallback;
}

async function ensureSlug(db: ReturnType<typeof getSupabaseAdmin>, coach: CoachRow): Promise<string> {
  if (coach.slug) return coach.slug;
  const base = slugify(coach.display_name || (coach.email || '').split('@')[0], 'coach');
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const { error } = await db.from('lesson_coaches').update({ slug: candidate }).eq('id', coach.id);
    if (!error) return candidate;
  }
  return base;
}

export async function GET() {
  const ctx = await currentCoach();
  if ('error' in ctx) return ctx.error;
  const { coach, db, userId } = ctx;

  const slug = await ensureSlug(db, coach);

  /**
   * Check the calendar every time this page is opened, and KEEP THE ERROR.
   *
   * The client-facing booking page swallows calendar failures on purpose — a
   * booking page that 500s because Google is down helps nobody. But that meant
   * an instructor who had not finished sharing their calendar got a silent
   * nothing: settings saved, page live, zero times, no explanation. The person
   * who can fix it is the one looking at this screen, so this is where the real
   * Google error surfaces.
   */
  let syncError: string | null = null;
  if (coach.google_calendar_id) {
    try {
      await syncOpenWindows(db, coach);
    } catch (e) {
      syncError = calendarErrorMessage(e, coach.google_calendar_id);
    }
  }

  const club = coach.club_id
    ? (
        await db
          .from('cc_clubs')
          .select('id, name, slug, owner_id, open_lessons_enabled, open_lessons_note')
          .eq('id', coach.club_id)
          .maybeSingle()
      ).data
    : null;

  const now = new Date().toISOString();
  const [{ data: windows }, { count: bookedCount }, { data: colleagues }] = await Promise.all([
    db
      .from('lesson_open_windows')
      .select('start_time, end_time')
      .eq('coach_id', coach.id)
      .gte('end_time', now),
    db
      .from('lesson_slots')
      .select('id', { count: 'exact', head: true })
      .eq('coach_id', coach.id)
      .eq('status', 'booked')
      .gte('start_time', now),
    coach.club_id
      ? db
          .from('lesson_coaches')
          .select('display_name, open_page_enabled, google_calendar_id')
          .eq('club_id', coach.club_id)
      : Promise.resolve({ data: [] }),
  ]);

  const rows = (windows as { start_time: string; end_time: string }[]) || [];
  const openHours =
    Math.round(
      (rows.reduce(
        (n, w) => n + (new Date(w.end_time).getTime() - new Date(w.start_time).getTime()),
        0,
      ) /
        3_600_000) *
        10,
    ) / 10;

  return NextResponse.json({
    settings: {
      slug,
      google_calendar_id: coach.google_calendar_id,
      open_page_enabled: coach.open_page_enabled,
      open_page_note: coach.open_page_note,
      open_rate_note: coach.open_rate_note,
      open_durations: durationsFor(coach),
      booking_lead_hours: coach.booking_lead_hours,
      timezone: coach.timezone,
      open_synced_at: coach.open_synced_at,
    },
    /** Everything the instructor has to copy, in one place. */
    setup: {
      share_with: serviceAccountEmail(),
      event_title: coach.open_keyword || OPEN_LESSON_TITLE,
      allowed_durations: ALLOWED_DURATIONS,
    },
    club: club
      ? {
          name: club.name,
          slug: club.slug,
          enabled: club.open_lessons_enabled,
          note: club.open_lessons_note,
          is_owner: club.owner_id === userId,
          url: `${APP_URL}/open/${club.slug}`,
          instructors_ready: ((colleagues as { open_page_enabled: boolean; google_calendar_id: string | null }[]) || [])
            .filter((c) => c.open_page_enabled && c.google_calendar_id).length,
          instructors_total: ((colleagues as unknown[]) || []).length,
        }
      : null,
    my_url: `${APP_URL}/open/${slug}`,
    sync_error: syncError,
    open_windows: rows.length,
    open_hours: openHours,
    booked_count: bookedCount ?? 0,
  });
}

export async function PATCH(req: Request) {
  const ctx = await currentCoach();
  if ('error' in ctx) return ctx.error;
  const { coach, db, userId } = ctx;

  const body = (await req.json().catch(() => ({}))) as {
    google_calendar_id?: string | null;
    open_page_enabled?: boolean;
    open_page_note?: string | null;
    open_rate_note?: string | null;
    open_durations?: number[];
    booking_lead_hours?: number;
    timezone?: string;
    club_enabled?: boolean;
    club_note?: string | null;
  };

  const patch: Record<string, unknown> = {};
  if (body.google_calendar_id !== undefined) {
    patch.google_calendar_id = (body.google_calendar_id || '').trim().toLowerCase() || null;
  }
  if (body.open_page_enabled !== undefined) patch.open_page_enabled = !!body.open_page_enabled;
  if (body.open_page_note !== undefined) patch.open_page_note = (body.open_page_note || '').trim() || null;
  if (body.open_rate_note !== undefined) patch.open_rate_note = (body.open_rate_note || '').trim() || null;
  if (body.open_durations !== undefined) {
    const picked = (body.open_durations || []).map(Number).filter((n) => ALLOWED_DURATIONS.includes(n));
    // Offering no lengths at all would be a page nobody can book from.
    patch.open_durations = picked.length ? picked.sort((a, b) => a - b) : DEFAULT_DURATIONS;
  }
  if (body.booking_lead_hours !== undefined) {
    const n = Number(body.booking_lead_hours);
    if (!Number.isFinite(n) || n < 0 || n > 168) {
      return NextResponse.json({ error: 'Notice must be between 0 and 168 hours.' }, { status: 400 });
    }
    patch.booking_lead_hours = Math.round(n);
  }
  if (body.timezone !== undefined) {
    patch.timezone = (body.timezone || '').trim() || 'America/Los_Angeles';
  }

  if (Object.keys(patch).length) {
    const { error } = await db.from('lesson_coaches').update(patch).eq('id', coach.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  /**
   * The club-wide page is the club's switch, not an instructor's — one coach
   * turning on a page that lists all of their colleagues is not their call.
   */
  if ((body.club_enabled !== undefined || body.club_note !== undefined) && coach.club_id) {
    const { data: club } = await db
      .from('cc_clubs')
      .select('id, owner_id')
      .eq('id', coach.club_id)
      .maybeSingle();
    if (!club || club.owner_id !== userId) {
      return NextResponse.json(
        { error: 'Only the club owner can turn the club booking page on or off.' },
        { status: 403 },
      );
    }
    const clubPatch: Record<string, unknown> = {};
    if (body.club_enabled !== undefined) clubPatch.open_lessons_enabled = !!body.club_enabled;
    if (body.club_note !== undefined) clubPatch.open_lessons_note = (body.club_note || '').trim() || null;
    await db.from('cc_clubs').update(clubPatch).eq('id', club.id);
  }

  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const ctx = await currentCoach();
  if ('error' in ctx) return ctx.error;
  const { coach, db } = ctx;

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== 'sync') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  if (!coach.google_calendar_id) {
    return NextResponse.json(
      { error: 'Add your calendar address first — it is usually the email you use for Google Calendar.' },
      { status: 400 },
    );
  }

  try {
    const result = await syncOpenWindows(db, coach);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: calendarErrorMessage(e, coach.google_calendar_id) },
      { status: 502 },
    );
  }
}
