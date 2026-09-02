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
import { looksLikeIcsUrl, normalizeIcsUrl } from '@/lib/lessons/icsCalendar';
import {
  DEFAULT_DURATIONS,
  durationsFor,
  syncOpenWindows,
  type CoachRow,
} from '@/lib/lessons/openTimes';
import { APP_URL } from '@/lib/appUrl';
import { isInstructorRole, ROLE_LABEL } from '@/lib/clubRoles';

export const dynamic = 'force-dynamic';

const COLUMNS =
  'id, club_id, slug, display_name, email, calendar_kind, ics_url, google_calendar_id, open_keyword, ' +
  'open_page_enabled, open_page_note, open_rate_note, open_durations, booking_lead_hours, ' +
  'timezone, open_synced_at';

const ALLOWED_DURATIONS = [30, 60, 90];

async function currentCoach() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Not signed in.' }, { status: 401 }) };

  const db = getSupabaseAdmin();
  let { data } = await db.from('lesson_coaches').select(COLUMNS).eq('profile_id', user.id).maybeSingle();

  /**
   * Make the instructor a coach record on the spot, attached to their club.
   *
   * The older pages created a bare row with nothing but profile_id — no name,
   * no email, and crucially no club — so a coach who followed the setup would
   * do everything right and still never appear on their club's booking page.
   * Whoever is signed in here is an instructor setting up bookings; give them
   * the row they need, filled in.
   */
  if (!data) {
    const { data: profile } = await db
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();
    const { data: owned } = await db
      .from('cc_clubs')
      .select('id')
      .eq('owner_id', user.id)
      .limit(1)
      .maybeSingle();
    const { data: member } = owned
      ? { data: null }
      : await db
          .from('cc_club_members')
          .select('club_id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();

    const inserted = await db
      .from('lesson_coaches')
      .insert({
        profile_id: user.id,
        display_name: (profile?.full_name as string) || user.email?.split('@')[0] || 'Instructor',
        email: user.email,
        club_id: (owned?.id as string) || (member?.club_id as string) || null,
      })
      .select(COLUMNS)
      .maybeSingle();
    data = inserted.data;
  }

  if (!data) {
    return { error: NextResponse.json({ error: 'No coach profile yet.' }, { status: 404 }) };
  }

  /**
   * Backfill a row that an older page created bare. Without an email address
   * the instructor never hears that someone booked them, which is the single
   * most important message this product sends.
   */
  const row = data as unknown as CoachRow & { open_synced_at: string | null; club_id: string | null };
  const patch: Record<string, unknown> = {};
  if (!row.email && user.email) patch.email = user.email;
  if (!row.display_name) patch.display_name = user.email?.split('@')[0] || 'Instructor';
  if (!row.club_id) {
    const { data: owned } = await db
      .from('cc_clubs')
      .select('id')
      .eq('owner_id', user.id)
      .limit(1)
      .maybeSingle();
    const { data: member } = owned
      ? { data: null }
      : await db
          .from('cc_club_members')
          .select('club_id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();
    const clubId = (owned?.id as string) || (member?.club_id as string) || null;
    if (clubId) patch.club_id = clubId;
  }
  if (Object.keys(patch).length) {
    await db.from('lesson_coaches').update(patch).eq('id', row.id);
    Object.assign(row, patch);
  }

  return { coach: row, db, userId: user.id };
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
  if (coach.calendar_kind === 'ics' ? coach.ics_url : coach.google_calendar_id) {
    try {
      await syncOpenWindows(db, coach);
    } catch (e) {
      syncError =
        coach.calendar_kind === 'ics'
          ? (e as Error)?.message || 'That calendar link could not be read.'
          : calendarErrorMessage(e, coach.google_calendar_id as string);
    }
  }

  const club = coach.club_id
    ? (
        await db
          .from('cc_clubs')
          .select('id, name, slug, owner_id, join_code, open_lessons_enabled, open_lessons_note')
          .eq('id', coach.club_id)
          .maybeSingle()
      ).data
    : null;

  /**
   * Attached to a club is not the same as teaching for it. The club page lists
   * staff only, so this screen has to say plainly which side of that line the
   * person reading it is on — otherwise they set everything up correctly and
   * silently never appear.
   */
  const myRole = club
    ? ((
        await db
          .from('cc_club_members')
          .select('role')
          .eq('club_id', club.id)
          .eq('user_id', userId)
          .maybeSingle()
      ).data?.role as string | undefined)
    : undefined;
  const isOwner = !!club && club.owner_id === userId;
  const canListOnClubPage = isOwner || isInstructorRole(myRole);

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

  /**
   * Instructors who have done their half and are waiting on the director.
   *
   * The staff boundary stays where it is — the join code grants Member and
   * nothing more, because `coach` is a staff role that opens member data across
   * the rest of ClubMode. What was wrong was the DIRECTOR's side: a coach set
   * everything up correctly and then waited for someone to notice. These are
   * the people at this club who have started setting up a booking page and
   * cannot appear on it yet, so approving them is one tap from here.
   */
  let pending: { user_id: string; name: string; email: string | null; connected: boolean }[] = [];
  if (isOwner && club) {
    const { data: coachRows } = await db
      .from('lesson_coaches')
      .select('profile_id, display_name, email, calendar_kind, google_calendar_id, ics_url')
      .eq('club_id', club.id)
      .neq('profile_id', userId);

    const candidates = (coachRows as {
      profile_id: string;
      display_name: string | null;
      email: string | null;
      calendar_kind: string | null;
      google_calendar_id: string | null;
      ics_url: string | null;
    }[]) || [];

    if (candidates.length) {
      const { data: roles } = await db
        .from('cc_club_members')
        .select('user_id, role')
        .eq('club_id', club.id)
        .in('user_id', candidates.map((c) => c.profile_id));
      const roleOf = new Map(
        ((roles as { user_id: string; role: string }[]) || []).map((r) => [r.user_id, r.role]),
      );
      pending = candidates
        .filter((c) => !isInstructorRole(roleOf.get(c.profile_id)))
        .map((c) => ({
          user_id: c.profile_id,
          name: c.display_name || c.email || 'Instructor',
          email: c.email,
          connected: c.calendar_kind === 'ics' ? !!c.ics_url : !!c.google_calendar_id,
        }));
    }
  }

  return NextResponse.json({
    pending_instructors: pending,
    settings: {
      slug,
      calendar_kind: coach.calendar_kind || 'google',
      ics_url: coach.ics_url,
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
          is_owner: isOwner,
          my_role: myRole || null,
          my_role_label: myRole ? ROLE_LABEL[myRole] || myRole : null,
          can_list: canListOnClubPage,
          // Owners hand this to instructors; it is the club's own code, so it
          // is not shown to anyone else.
          invite_url: isOwner && club.join_code ? `${APP_URL}/join/${club.join_code}` : null,
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
    calendar_kind?: 'google' | 'ics';
    ics_url?: string | null;
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
  if (body.calendar_kind !== undefined) {
    patch.calendar_kind = body.calendar_kind === 'ics' ? 'ics' : 'google';
  }
  if (body.ics_url !== undefined) {
    const raw = (body.ics_url || '').trim();
    if (raw && !looksLikeIcsUrl(raw)) {
      return NextResponse.json(
        { error: 'That does not look like a calendar link. Paste the whole thing — it starts with webcal:// or https://.' },
        { status: 400 },
      );
    }
    // Stored normalised (webcal:// -> https://) so every reader gets a URL it
    // can actually fetch, not the scheme Apple hands out.
    patch.ics_url = raw ? normalizeIcsUrl(raw) : null;
  }
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

  const body = (await req.json().catch(() => ({}))) as { action?: string; user_id?: string };

  /**
   * Make someone a coach at this club. Owner-only, and deliberately an explicit
   * act rather than something a shared link can do: `coach` is a staff role.
   */
  if (body.action === 'promote') {
    if (!body.user_id) return NextResponse.json({ error: 'Missing user.' }, { status: 400 });
    if (!coach.club_id) return NextResponse.json({ error: 'No club to add them to.' }, { status: 400 });

    const { data: club } = await db
      .from('cc_clubs')
      .select('id, owner_id, name')
      .eq('id', coach.club_id)
      .maybeSingle();
    if (!club || club.owner_id !== ctx.userId) {
      return NextResponse.json(
        { error: 'Only the club owner can add an instructor.' },
        { status: 403 },
      );
    }

    const { data: existing } = await db
      .from('cc_club_members')
      .select('role')
      .eq('club_id', club.id)
      .eq('user_id', body.user_id)
      .maybeSingle();

    const { error } = existing
      ? await db
          .from('cc_club_members')
          .update({ role: 'coach' })
          .eq('club_id', club.id)
          .eq('user_id', body.user_id)
      : await db
          .from('cc_club_members')
          .insert({ club_id: club.id, user_id: body.user_id, role: 'coach' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, promoted: body.user_id });
  }

  if (body.action !== 'sync') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  const isIcs = coach.calendar_kind === 'ics';
  if (isIcs ? !coach.ics_url : !coach.google_calendar_id) {
    return NextResponse.json(
      {
        error: isIcs
          ? 'Paste your published calendar link first.'
          : 'Add your calendar address first — it is usually the email you use for Google Calendar.',
      },
      { status: 400 },
    );
  }

  try {
    const result = await syncOpenWindows(db, coach);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      {
        error: isIcs
          ? (e as Error)?.message || 'That calendar link could not be read.'
          : calendarErrorMessage(e, coach.google_calendar_id as string),
      },
      { status: 502 },
    );
  }
}
