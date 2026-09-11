/**
 * Sends the morning digest to each club's maintenance crew.
 *
 * Called by the daily cron (/api/cron/maintenance-digest, 13:00 UTC = 6 AM
 * Pacific). "Today" is worked out per club in its own time zone.
 *
 * Safety: a row in maint_digest_sends is claimed per (club, date, person)
 * BEFORE the email goes out, and the UNIQUE constraint makes a second send on
 * the same day impossible even if the cron fires twice. Billed to the club
 * owner like every other ClubMode email; unsubscribes are honoured by the
 * shared sender.
 */
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendBilledEmails } from '@/lib/email';
import { CreditLimitError } from '@/lib/billing';
import { normalizeTimeZone } from '@/lib/captain/clubTime';
import { APP_URL } from '@/lib/appUrl';
import { clubNowHHMM, clubToday } from './dates';
import { buildDigest, type Digest } from './digest';
import { crewOf, loadBoardData } from './load';

type ClubRow = { id: string; name: string; timezone: string | null; owner_id: string };

export type DigestRunResult = {
  club: string;
  date: string;
  recipients: number;
  sent: number;
  skipped?: string;
  subject?: string;
  error?: string;
};

/** Build (but do not send) one club's digest for its current local date. */
export async function buildClubDigest(
  db: ReturnType<typeof getSupabaseAdmin>,
  club: ClubRow,
  now: Date,
): Promise<{ date: string; digest: Digest }> {
  const tz = normalizeTimeZone(club.timezone);
  const date = clubToday(now, tz);
  const data = await loadBoardData(db, club.id, date, clubNowHHMM(now, tz));
  const digest = buildDigest({
    clubName: club.name,
    date,
    appUrl: APP_URL,
    routineToday: data.checklist,
    missedYesterday: data.missedYesterday,
    tasks: data.tasks,
    projects: data.projects
      .filter((p) => p.status === 'active' || p.status === 'planned')
      .map((p) => ({ title: p.title, pct: p.pct, target_date: p.target_date })),
  });
  return { date, digest };
}

export async function runMaintenanceDigests(opts: { now?: Date; dryRun?: boolean } = {}): Promise<DigestRunResult[]> {
  const db = getSupabaseAdmin();
  const now = opts.now ?? new Date();

  // Only clubs that actually have a crew to mail.
  const { data: crewRows } = await db.from('cc_club_members').select('club_id').eq('role', 'maintenance');
  const clubIds = [...new Set(((crewRows as { club_id: string }[]) || []).map((r) => r.club_id))];
  if (!clubIds.length) return [];

  const [{ data: clubs }, { data: settings }] = await Promise.all([
    db.from('cc_clubs').select('id, name, timezone, owner_id').in('id', clubIds),
    db.from('maint_settings').select('club_id, digest_enabled').in('club_id', clubIds),
  ]);
  const off = new Set(
    ((settings as { club_id: string; digest_enabled: boolean }[]) || [])
      .filter((s) => s.digest_enabled === false)
      .map((s) => s.club_id),
  );

  const results: DigestRunResult[] = [];
  for (const club of (clubs as ClubRow[]) || []) {
    try {
      if (off.has(club.id)) {
        results.push({ club: club.name, date: '', recipients: 0, sent: 0, skipped: 'digest turned off' });
        continue;
      }
      const { date, digest } = await buildClubDigest(db, club, now);
      const crew = await crewOf(db, club.id);
      if (digest.isEmpty) {
        results.push({ club: club.name, date, recipients: crew.length, sent: 0, skipped: 'nothing to report' });
        continue;
      }
      if (opts.dryRun) {
        results.push({ club: club.name, date, recipients: crew.length, sent: 0, skipped: 'dry run', subject: digest.subject });
        continue;
      }

      const payloads: { to: string; subject: string; html: string }[] = [];
      for (const userId of crew) {
        // Claim first. A conflict means this person already got today's digest.
        const { error: claimErr } = await db
          .from('maint_digest_sends')
          .insert({ club_id: club.id, local_date: date, user_id: userId, status: 'claimed' });
        if (claimErr) continue;
        const { data: u } = await db.auth.admin.getUserById(userId);
        const email = u?.user?.email;
        if (!email) {
          await db
            .from('maint_digest_sends')
            .update({ status: 'no_email' })
            .eq('club_id', club.id)
            .eq('local_date', date)
            .eq('user_id', userId);
          continue;
        }
        payloads.push({ to: email, subject: digest.subject, html: digest.html });
      }

      const sent = payloads.length
        ? (await sendBilledEmails(club.owner_id, payloads)).filter((r) => r.sent).length
        : 0;
      results.push({ club: club.name, date, recipients: crew.length, sent, subject: digest.subject });
    } catch (err) {
      results.push({
        club: club.name,
        date: '',
        recipients: 0,
        sent: 0,
        error: err instanceof CreditLimitError ? 'email credit limit reached' : (err as Error).message,
      });
    }
  }
  return results;
}
