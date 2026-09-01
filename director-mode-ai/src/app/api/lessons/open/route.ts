/**
 * The public side of Open Lesson Time — one page for the whole club.
 *   GET  ?slug=<club or instructor>            — who is open, when, for how long
 *   POST { slug, coach_id, start, duration_minutes, name, email, … } — book it
 *
 * No login. A client who has to make an account to take a Tuesday 4pm does not
 * take the Tuesday 4pm, and these are people the club already teaches. Every
 * booking emails the instructor within seconds and lands on their calendar
 * under the client's name, so anything odd is visible immediately.
 *
 * GET re-syncs any instructor whose calendar copy is stale, so the page never
 * offers time that was taken back an hour ago. If Google is unreachable the
 * stored windows are still served — a booking page that 500s because a third
 * party is down is worse than one a few minutes behind.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendBilledEmails, resolveCoachUserId, creditLimitResponse } from '@/lib/email';
import { CreditLimitError } from '@/lib/billing';
import { APP_URL } from '@/lib/appUrl';
import {
  createEvent,
  deleteEvent,
  setEventTimes,
  OPEN_LESSON_TITLE,
} from '@/lib/lessons/googleCalendar';
import {
  bookingFits,
  durationsFor,
  earliestBookable,
  freeSegments,
  OPEN_WINDOW_DAYS,
  remainingAfterBooking,
  syncOpenWindows,
  type CoachRow,
  type Range,
} from '@/lib/lessons/openTimes';

export const dynamic = 'force-dynamic';

const COACH_COLUMNS =
  'id, club_id, slug, display_name, email, google_calendar_id, open_keyword, open_page_enabled, ' +
  'open_page_note, open_rate_note, open_durations, booking_lead_hours, timezone, open_synced_at';

/** Long enough that a refresh is cheap, short enough to feel live. */
const SYNC_STALE_MS = 90_000;

type Coach = CoachRow & { open_synced_at: string | null };

/**
 * A slug is a club or a single instructor. Clubs first: the club page is the
 * one people bookmark, and an instructor's own link is the fallback for a coach
 * with no club behind them.
 */
async function resolvePage(slug: string): Promise<{
  title: string;
  note: string | null;
  coaches: Coach[];
} | null> {
  const db = getSupabaseAdmin();

  const { data: club } = await db
    .from('cc_clubs')
    .select('id, name, slug, open_lessons_enabled, open_lessons_note')
    .eq('slug', slug)
    .maybeSingle();

  if (club?.open_lessons_enabled) {
    const { data: coaches } = await db
      .from('lesson_coaches')
      .select(COACH_COLUMNS)
      .eq('club_id', club.id)
      .eq('open_page_enabled', true)
      .order('display_name');
    return {
      title: club.name as string,
      note: (club.open_lessons_note as string) || null,
      coaches: ((coaches as unknown as Coach[]) || []).filter((c) => !!c.google_calendar_id),
    };
  }

  const { data: coach } = await db
    .from('lesson_coaches')
    .select(COACH_COLUMNS)
    .eq('slug', slug)
    .maybeSingle();
  if (coach && (coach as unknown as Coach).open_page_enabled) {
    const c = coach as unknown as Coach;
    return {
      title: c.display_name || 'Lessons',
      note: c.open_page_note,
      coaches: c.google_calendar_id ? [c] : [],
    };
  }
  return null;
}

function fmt(isoStr: string, tz: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz }).format(new Date(isoStr));
}

export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get('slug') || '';
  if (!slug) return NextResponse.json({ error: 'Missing slug.' }, { status: 400 });

  const page = await resolvePage(slug);
  if (!page) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const db = getSupabaseAdmin();
  const now = new Date();
  const until = new Date(now.getTime() + OPEN_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Refresh whoever is stale. One calendar call each, in parallel, best effort.
  await Promise.all(
    page.coaches
      .filter(
        (c) =>
          !c.open_synced_at || now.getTime() - new Date(c.open_synced_at).getTime() > SYNC_STALE_MS,
      )
      .map((c) => syncOpenWindows(db, c).catch(() => null)),
  );

  const coachIds = page.coaches.map((c) => c.id);
  const [{ data: windows }, { data: booked }] = coachIds.length
    ? await Promise.all([
        db
          .from('lesson_open_windows')
          .select('coach_id, start_time, end_time, location')
          .in('coach_id', coachIds)
          .gte('end_time', now.toISOString())
          .lte('start_time', until)
          .order('start_time'),
        db
          .from('lesson_slots')
          .select('coach_id, start_time, end_time')
          .in('coach_id', coachIds)
          .eq('status', 'booked')
          .gte('end_time', now.toISOString()),
      ])
    : [{ data: [] }, { data: [] }];

  return NextResponse.json({
    title: page.title,
    note: page.note,
    open_title: OPEN_LESSON_TITLE,
    coaches: page.coaches.map((c) => ({
      id: c.id,
      name: c.display_name || 'Instructor',
      rate_note: c.open_rate_note,
      durations: durationsFor(c),
      earliest: earliestBookable(c, now),
      timezone: c.timezone,
    })),
    windows: windows || [],
    busy: booked || [],
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    slug?: string;
    coach_id?: string;
    start?: string;
    duration_minutes?: number;
    name?: string;
    email?: string;
    phone?: string;
    note?: string;
  };

  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const duration = Number(body.duration_minutes);

  if (!body.slug || !body.coach_id || !body.start || !Number.isFinite(duration)) {
    return NextResponse.json({ error: 'Missing booking details.' }, { status: 400 });
  }
  if (name.length < 2) return NextResponse.json({ error: 'Add your name.' }, { status: 400 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'Add a valid email so we can confirm it.' }, { status: 400 });
  }

  const page = await resolvePage(body.slug);
  const coach = page?.coaches.find((c) => c.id === body.coach_id);
  if (!page || !coach) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (!durationsFor(coach).includes(duration)) {
    return NextResponse.json({ error: 'That lesson length is not offered.' }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const start = new Date(body.start).toISOString();
  const end = new Date(new Date(start).getTime() + duration * 60_000).toISOString();
  const booking: Range = { start, end };

  if (start < earliestBookable(coach)) {
    return NextResponse.json(
      { error: `${coach.display_name || 'This instructor'} needs at least ${coach.booking_lead_hours} hours' notice.` },
      { status: 400 },
    );
  }

  /**
   * Re-derive availability on the server. The page's copy is a few seconds old
   * at best, and "it looked free in my browser" is not a reason to put two
   * people on the same court.
   */
  const [{ data: windowRows }, { data: busyRows }] = await Promise.all([
    db
      .from('lesson_open_windows')
      .select('id, google_event_id, google_calendar_id, start_time, end_time, location')
      .eq('coach_id', coach.id)
      .lte('start_time', start)
      .gte('end_time', end),
    db
      .from('lesson_slots')
      .select('start_time, end_time')
      .eq('coach_id', coach.id)
      .eq('status', 'booked')
      .gte('end_time', start),
  ]);

  const window = ((windowRows as {
    id: string;
    google_event_id: string;
    google_calendar_id: string;
    start_time: string;
    end_time: string;
    location: string | null;
  }[]) || [])[0];
  if (!window) {
    return NextResponse.json(
      { error: 'That time is no longer open — pick another one.', code: 'taken' },
      { status: 409 },
    );
  }

  const busy = ((busyRows as { start_time: string; end_time: string }[]) || []).map((b) => ({
    start: b.start_time,
    end: b.end_time,
  }));
  const free = freeSegments({ start: window.start_time, end: window.end_time }, busy);
  if (!bookingFits(free, booking)) {
    return NextResponse.json(
      { error: 'That time was just taken — pick another one.', code: 'taken' },
      { status: 409 },
    );
  }

  /**
   * The last word belongs to Postgres: an exclusion constraint rejects any
   * booked open-lesson slot that overlaps another for the same instructor, so
   * two simultaneous requests cannot both win.
   */
  const { data: slot, error: insertError } = await db
    .from('lesson_slots')
    .insert({
      coach_id: coach.id,
      start_time: start,
      end_time: end,
      status: 'booked',
      source: 'google_open',
      booked_at: new Date().toISOString(),
      google_calendar_id: window.google_calendar_id,
      window_event_id: window.google_event_id,
      location: window.location,
      guest_name: name,
      guest_email: email,
      guest_phone: (body.phone || '').trim() || null,
      guest_note: (body.note || '').trim().slice(0, 500) || null,
    })
    .select('id')
    .maybeSingle();

  if (insertError || !slot) {
    const conflict = (insertError?.message || '').includes('lesson_slots_open_no_double_book');
    return NextResponse.json(
      {
        error: conflict
          ? 'Someone booked that exact time a second before you — pick another one.'
          : 'That booking did not go through. Try again.',
        code: conflict ? 'taken' : undefined,
      },
      { status: conflict ? 409 : 500 },
    );
  }

  /**
   * Rewrite the calendar so it reads the way the day actually looks: the lesson
   * appears under the client's name, and whatever is left of the opening stays
   * bookable (an opening booked end to end simply disappears).
   */
  let calendarWritten = false;
  const calId = window.google_calendar_id || coach.google_calendar_id;
  if (calId) {
    try {
      const remaining = remainingAfterBooking(
        { start: window.start_time, end: window.end_time },
        booking,
      );
      await createEvent(calId, {
        summary: `Lesson — ${name}`,
        description: [
          `Booked through ClubMode (${duration} min)`,
          email,
          (body.phone || '').trim() || null,
          body.note ? `Note: ${body.note}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        start,
        end,
        location: window.location,
      });

      if (!remaining.length) {
        await deleteEvent(calId, window.google_event_id);
        await db.from('lesson_open_windows').delete().eq('id', window.id);
      } else {
        await setEventTimes(calId, window.google_event_id, remaining[0].start, remaining[0].end);
        await db
          .from('lesson_open_windows')
          .update({ start_time: remaining[0].start, end_time: remaining[0].end })
          .eq('id', window.id);
        // A lesson taken out of the middle leaves a second opening behind.
        for (const extra of remaining.slice(1)) {
          const newId = await createEvent(calId, {
            summary: coach.open_keyword || OPEN_LESSON_TITLE,
            start: extra.start,
            end: extra.end,
            location: window.location,
          });
          if (newId) {
            await db.from('lesson_open_windows').insert({
              coach_id: coach.id,
              club_id: coach.club_id,
              google_calendar_id: calId,
              google_event_id: newId,
              start_time: extra.start,
              end_time: extra.end,
              location: window.location,
            });
          }
        }
      }
      calendarWritten = true;
    } catch {
      // The booking stands. The instructor is emailed either way, and the
      // settings page reports when calendar writes are failing.
    }
  }

  // Fold the booking into the instructor's client list when the email is known.
  const { data: existingClient } = await db
    .from('lesson_clients')
    .select('id')
    .ilike('email', email)
    .maybeSingle();
  if (existingClient?.id) {
    await db.from('lesson_slots').update({ booked_by_client_id: existingClient.id }).eq('id', slot.id);
  }

  const tz = coach.timezone || 'America/Los_Angeles';
  const when = `${fmt(start, tz, { weekday: 'long', month: 'long', day: 'numeric' })} · ${fmt(start, tz, {
    hour: 'numeric',
    minute: '2-digit',
  })}–${fmt(end, tz, { hour: 'numeric', minute: '2-digit' })}`;

  const shell = (title: string, inner: string) =>
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
       <h1 style="font-size:20px;margin:0 0 14px">${title}</h1>${inner}</div>`;
  const where = window.location
    ? `<p style="margin:0 0 8px;color:#475569">📍 ${window.location}</p>`
    : '';

  const payloads = [
    {
      to: email,
      subject: `Booked: ${duration} min with ${coach.display_name || 'your coach'} — ${when}`,
      html: shell(
        `You're on court, ${name.split(/\s+/)[0]}`,
        `<p style="font-size:17px;margin:0 0 8px"><strong>${when}</strong></p>
         <p style="margin:0 0 8px;color:#475569">${duration} minutes with ${coach.display_name || 'your coach'}</p>${where}
         ${coach.open_rate_note ? `<p style="margin:0 0 8px;color:#475569">${coach.open_rate_note}</p>` : ''}
         <p style="font-size:15px;color:#475569;margin:14px 0 0">
           It's on their calendar already. Need to change it? Just reply to this email.
         </p>`,
      ),
    },
    {
      to: coach.email || '',
      subject: `${name} booked ${duration} min — ${when}`,
      html: shell(
        `${name} booked an open lesson time`,
        `<p style="font-size:17px;margin:0 0 8px"><strong>${when}</strong> · ${duration} min</p>${where}
         <p style="margin:0 0 4px;color:#475569">${email}${body.phone ? ` · ${body.phone}` : ''}</p>
         ${body.note ? `<p style="margin:8px 0 0;padding:10px 12px;background:#f8fafc;border-left:3px solid #D3FB52;border-radius:4px">${body.note}</p>` : ''}
         <p style="font-size:14px;color:#64748b;margin:16px 0 0">
           ${
             calendarWritten
               ? 'Your calendar is updated — the lesson is in under their name and any time left over is still open.'
               : '⚠️ We could not update your calendar. Check the sharing setup in Lesson Mode → Open Lesson Time.'
           }
         </p>
         <p style="font-size:14px;margin:12px 0 0"><a href="${APP_URL}/lessons/dashboard" style="color:#0369a1">Open Lesson Mode</a></p>`,
      ),
    },
  ].filter((p) => !!p.to);

  try {
    await sendBilledEmails(await resolveCoachUserId(coach.id, coach.email), payloads);
  } catch (e) {
    if (e instanceof CreditLimitError) return creditLimitResponse(e);
    // The court time is booked; a failed confirmation email must not undo it.
  }

  return NextResponse.json({ ok: true, when, duration, calendar_updated: calendarWritten });
}
