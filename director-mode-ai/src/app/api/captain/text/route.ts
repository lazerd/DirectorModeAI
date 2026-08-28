/**
 * Text players from CaptainMode.
 *   POST { team_id, match_id?, player_ids[], body, preview? }
 *
 * For the messages email is wrong for: "you're in, court 2, confirm please" to
 * the two people who never tap the button. Preview first, same rule as every
 * other send in CaptainMode — a text costs money and cannot be unsent.
 *
 * Delivery is checked after the fact rather than trusted. Twilio's create call
 * only ever answers "queued"; carrier rejections — an unregistered A2P 10DLC
 * number above all — arrive seconds later, and reporting "sent" for a message
 * no carrier ever accepted is worse than reporting nothing.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';
import { sendSmsBatch, checkSmsDelivery, describeSmsError } from '@/lib/twilio';
import { CreditLimitError } from '@/lib/billing';
import { CLUB_TZ } from '@/lib/captain/clubTime';

export const dynamic = 'force-dynamic';

/** One SMS segment is 160 chars; this keeps a normal message to one or two. */
const MAX_BODY = 320;

/** How long to give the carrier before asking what happened. */
const DELIVERY_CHECK_MS = 4000;

type PlayerRow = { id: string; name: string; phone: string | null };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    match_id?: string;
    player_ids?: string[];
    body?: string;
    preview?: boolean;
  };

  if (!body.team_id) {
    return NextResponse.json({ error: 'team_id is required.' }, { status: 400 });
  }
  const ids = (body.player_ids || []).filter((v): v is string => typeof v === 'string' && !!v);
  if (!ids.length) {
    return NextResponse.json({ error: 'Pick at least one player to text.' }, { status: 400 });
  }

  const text = (body.body || '').trim().slice(0, MAX_BODY);
  if (!text) return NextResponse.json({ error: 'Write the message first.' }, { status: 400 });

  const ctx = await requireTeam(body.team_id);
  if (isError(ctx)) return ctx.error;
  const { db, team, teamId } = ctx;

  const { data, error } = await db
    .from('captain_players')
    .select('id, name, phone')
    .eq('team_id', teamId)
    .eq('active', true)
    .in('id', ids);

  if (error) {
    if (/column .* does not exist/i.test(error.message)) {
      return NextResponse.json(
        { error: 'Texting needs the captain_wtn_and_phone migration to be run first.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const players = (data as PlayerRow[]) || [];
  const withPhone = players.filter((p) => !!p.phone?.trim());
  const noPhone = players.filter((p) => !p.phone?.trim()).map((p) => p.name);

  if (body.preview) {
    return NextResponse.json({
      preview: true,
      body: text,
      count: withPhone.length,
      recipients: withPhone.map((p) => ({ name: p.name, phone: p.phone })),
      noPhone,
      // Two segments cost twice as much and some phones split them visibly.
      segments: Math.max(1, Math.ceil(text.length / 160)),
    });
  }

  if (!withPhone.length) {
    return NextResponse.json(
      {
        error: noPhone.length
          ? `No mobile number on the roster for ${noPhone.join(', ')}. Add one on the roster and try again.`
          : 'Nobody to text.',
      },
      { status: 400 },
    );
  }

  let batch;
  try {
    batch = await sendSmsBatch(
      team.captain_user_id,
      withPhone.map((p) => ({ phone: p.phone as string, body: text })),
    );
  } catch (err) {
    if (err instanceof CreditLimitError) {
      return NextResponse.json(
        {
          error:
            'Out of text credits for this billing period. Upgrade the plan, or email these players instead.',
          code: 'sms_limit',
        },
        { status: 402 },
      );
    }
    const msg = (err as Error)?.message || '';
    // Missing configuration is a fixable setup problem, not a send failure —
    // say which switch is off rather than "could not send".
    if (/not configured|TWILIO_PHONE_NUMBER/i.test(msg)) {
      return NextResponse.json(
        {
          error:
            'Texting is not switched on for this deployment — TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER all have to be set.',
          code: 'twilio_unconfigured',
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: 'Could not send those texts.' }, { status: 502 });
  }

  // Match each result back to the player it was for. sendSmsBatch keeps input
  // order for everything it did not drop as an unusable number.
  const byPhone = new Map(batch.results.map((r) => [r.to, r]));

  // Give the carrier a moment, then ask what really happened.
  await new Promise((r) => setTimeout(r, DELIVERY_CHECK_MS));
  const sids = batch.results.map((r) => r.sid).filter(Boolean) as string[];
  const delivery = new Map((await checkSmsDelivery(sids)).map((d) => [d.sid, d]));

  const report = withPhone.map((p) => {
    const r = [...byPhone.values()].find((x) => x.sid && sameNumber(x.to, p.phone));
    if (!r) return { name: p.name, ok: false, reason: 'That number could not be dialled.' };
    if (r.status === 'failed') return { name: p.name, ok: false, reason: r.reason ?? 'Rejected.' };
    const d = r.sid ? delivery.get(r.sid) : undefined;
    if (d && (d.status === 'failed' || d.status === 'undelivered')) {
      return { name: p.name, ok: false, reason: d.reason ?? describeSmsError(d.errorCode) };
    }
    return { name: p.name, ok: true, reason: null };
  });

  const delivered = report.filter((r) => r.ok);
  const failed = report.filter((r) => !r.ok);

  return NextResponse.json({
    ok: true,
    sent: delivered.length,
    failed: failed.length,
    noPhone,
    report,
    // Every failure sharing one cause is a configuration problem, not 12
    // separate mishaps — surface it once, at the top.
    commonFailure:
      failed.length > 0 && new Set(failed.map((f) => f.reason)).size === 1 ? failed[0].reason : null,
    clubTz: CLUB_TZ,
  });
}

/** Compare two numbers by digits only — one side is E.164, the other whatever was typed. */
function sameNumber(a: string, b: string | null): boolean {
  if (!b) return false;
  const digits = (s: string) => s.replace(/\D/g, '').slice(-10);
  return digits(a) === digits(b);
}
