/**
 * POST /api/leagues/[id]/jtt/tournament-email
 *
 * Director-only. Builds the season-end tournament sign-up email (per-division
 * public registration links) and either previews it or sends it to the
 * league's coaches. Mirrors the results-email route and reuses the same saved
 * recipient list (leagues.jtt_email_recipients) — the coaches are the same.
 *
 * Body:
 *   { mode: 'preview' | 'send' | 'saveRecipients', recipients?: string[], note?: string }
 *
 * preview → { subject, html, defaultRecipients: {email,name}[] }
 * send    → { sent, skipped, failed, total }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  buildJTTTournamentEmail,
  SEASON_END_DIVISIONS,
  type TournamentDivision,
} from '@/lib/jttTournamentEmail';
import { sendBilledEmail, creditLimitResponse, CreditLimitError } from '@/lib/email';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ENTRY_FEE_LABEL = '$20';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params;
    const body = await request.json().catch(() => ({}));
    const mode: 'preview' | 'send' | 'saveRecipients' =
      body.mode === 'send' ? 'send' : body.mode === 'saveRecipients' ? 'saveRecipients' : 'preview';
    const note: string | null = typeof body.note === 'string' ? body.note.slice(0, 1000) : null;

    // --- Auth: must be the league director ---
    const userClient = await createClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = getSupabaseAdmin();
    const { data: league } = await admin
      .from('leagues')
      .select('id, name, director_id, format')
      .eq('id', leagueId)
      .maybeSingle();
    if (!league || (league as any).director_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
    if ((league as any).format !== 'team') {
      return NextResponse.json({ error: 'Not a JTT (team-format) league.' }, { status: 400 });
    }

    const cleanEmails = (list: unknown): string[] =>
      (Array.isArray(list) ? list : [])
        .map(e => String(e).trim().toLowerCase())
        .filter((e, i, arr) => EMAIL_RE.test(e) && arr.indexOf(e) === i);

    const persistRecipients = async (list: string[]) => {
      const { error } = await admin
        .from('leagues')
        .update({ jtt_email_recipients: list })
        .eq('id', leagueId);
      return !error;
    };

    if (mode === 'saveRecipients') {
      const list = cleanEmails(body.recipients);
      const ok = await persistRecipients(list);
      if (!ok) {
        return NextResponse.json(
          { error: 'Could not save — the saved-recipients column may not be set up yet.' },
          { status: 500 }
        );
      }
      return NextResponse.json({ saved: list.length });
    }

    // Read previously-saved recipients (shared with the results email).
    let savedRecipients: string[] = [];
    {
      const { data: lr, error: lrErr } = await admin
        .from('leagues')
        .select('jtt_email_recipients')
        .eq('id', leagueId)
        .maybeSingle();
      if (!lrErr && lr && Array.isArray((lr as any).jtt_email_recipients)) {
        savedRecipients = (lr as any).jtt_email_recipients as string[];
      }
    }

    // Build the email from the fixed division config + this deployment's base URL.
    const base = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '');
    const divisions: TournamentDivision[] = SEASON_END_DIVISIONS.map(d => ({
      label: d.label,
      when: d.when,
      location: d.location,
      url: `${base}/tournaments/${d.slug}`,
    }));

    const email = buildJTTTournamentEmail({
      leagueName: (league as any).name,
      divisions,
      entryFeeLabel: ENTRY_FEE_LABEL,
      note,
    });

    // Prefer the saved list; fall back to each club's contact email.
    let defaultRecipients: { email: string; name: string }[];
    if (savedRecipients.length) {
      defaultRecipients = savedRecipients.map(e => ({ email: e, name: e }));
    } else {
      const { data: clubsRaw } = await admin
        .from('league_clubs')
        .select('name, contact_name, contact_email')
        .eq('league_id', leagueId)
        .order('sort_order');
      defaultRecipients = (clubsRaw || [])
        .filter((c: any) => c.contact_email && EMAIL_RE.test(c.contact_email))
        .map((c: any) => ({ email: c.contact_email as string, name: c.contact_name || c.name }));
    }

    if (mode === 'preview') {
      return NextResponse.json({
        subject: email.subject,
        html: email.html,
        defaultRecipients,
      });
    }

    // --- Send ---
    const requested: string[] = Array.isArray(body.recipients) ? body.recipients : [];
    const recipients = requested.length
      ? cleanEmails(requested)
      : cleanEmails(defaultRecipients.map(r => r.email));

    if (recipients.length === 0) {
      return NextResponse.json(
        { error: 'No valid recipient emails. Enter coach emails or save a default list.' },
        { status: 400 }
      );
    }

    // NOTE: unlike the results email, a send here does NOT overwrite the saved
    // coach list — so the director can send a preview to a single coach (e.g.
    // Thomas at Moraga) without losing the full 7-coach default. Use the
    // explicit "Save as default" button to change the saved list.

    const replyTo = user.email || undefined;
    let sent = 0, skipped = 0, failed = 0;
    for (const to of recipients) {
      try {
        const r = await sendBilledEmail((league as any).director_id, {
          to,
          subject: email.subject,
          html: email.html,
          replyTo,
        });
        if (r.sent) sent++; else skipped++;
      } catch (err) {
        if (err instanceof CreditLimitError) return creditLimitResponse(err);
        failed++;
      }
    }

    return NextResponse.json({ sent, skipped, failed, total: recipients.length });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}
