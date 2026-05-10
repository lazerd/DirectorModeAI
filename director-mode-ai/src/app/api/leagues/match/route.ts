/**
 * Magic-link score reporting endpoints, all keyed off the player's unique
 * captain_token or partner_token.
 *
 *   GET  /api/leagues/match?token=XXX        — returns the current open match
 *                                              for the player owning this token
 *   POST /api/leagues/match/report           — body { token, score, winner }
 *                                              reports a score. Match goes into
 *                                              'reported' state. All players get
 *                                              a confirmation email with a
 *                                              dispute link.
 *   POST /api/leagues/match/dispute          — body { token, matchId }
 *                                              marks a match as disputed. Director
 *                                              is notified; match does NOT progress.
 */

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { safeResendSend } from '@/lib/emailUnsubscribe';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM_EMAIL || 'CoachMode Leagues <noreply@mail.coachmode.ai>';

// Resolve a token to { entry, owner } where owner is 'captain' | 'partner'.
async function resolveToken(token: string) {
  const admin = getSupabaseAdmin();
  const { data: asCaptain } = await admin
    .from('league_entries')
    .select('*')
    .eq('captain_token', token)
    .maybeSingle();
  if (asCaptain) return { entry: asCaptain as any, owner: 'captain' as const };

  const { data: asPartner } = await admin
    .from('league_entries')
    .select('*')
    .eq('partner_token', token)
    .maybeSingle();
  if (asPartner) return { entry: asPartner as any, owner: 'partner' as const };

  return null;
}

// Find the player's active match: any match where their entry is A or B
// and the match hasn't been confirmed/cancelled yet.
async function findActiveMatch(entryId: string) {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('league_matches')
    .select('*')
    .or(`entry_a_id.eq.${entryId},entry_b_id.eq.${entryId}`)
    .in('status', ['pending', 'reported'])
    .order('round', { ascending: false })
    .limit(1);
  return (data as any[])?.[0] || null;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

    const resolved = await resolveToken(token);
    if (!resolved) return NextResponse.json({ error: 'Invalid link' }, { status: 404 });

    const admin = getSupabaseAdmin();
    const match = await findActiveMatch(resolved.entry.id);
    if (!match) {
      return NextResponse.json({
        resolved: true,
        player: {
          name: resolved.owner === 'captain' ? resolved.entry.captain_name : resolved.entry.partner_name,
        },
        match: null,
      });
    }

    const { data: opponent } = await admin
      .from('league_entries')
      .select('id, captain_name, captain_email, captain_phone, partner_name, partner_email, partner_phone')
      .eq('id', match.entry_a_id === resolved.entry.id ? match.entry_b_id : match.entry_a_id)
      .maybeSingle();

    const { data: league } = await admin
      .from('leagues')
      .select('name')
      .eq('id', (await admin.from('league_flights').select('league_id').eq('id', match.flight_id).maybeSingle()).data?.league_id || '')
      .maybeSingle();

    return NextResponse.json({
      resolved: true,
      match: {
        id: match.id,
        round: match.round,
        bracket_position: match.bracket_position,
        deadline: match.deadline,
        score: match.score,
        status: match.status,
        reported_at: match.reported_at,
      },
      league: { name: (league as any)?.name || 'League' },
      me: {
        entryId: resolved.entry.id,
        captainName: resolved.entry.captain_name,
        partnerName: resolved.entry.partner_name,
      },
      opponent: opponent ? {
        entryId: (opponent as any).id,
        captainName: (opponent as any).captain_name,
        captainEmail: (opponent as any).captain_email,
        captainPhone: (opponent as any).captain_phone,
        partnerName: (opponent as any).partner_name,
        partnerEmail: (opponent as any).partner_email,
        partnerPhone: (opponent as any).partner_phone,
      } : null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}

// POST — report a score (token + score string + winnerEntryId)
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    const scoreText = typeof body?.score === 'string' ? body.score.trim().slice(0, 64) : '';
    const winnerEntryId = typeof body?.winnerEntryId === 'string' ? body.winnerEntryId : '';
    const matchId = typeof body?.matchId === 'string' ? body.matchId : '';
    const action = typeof body?.action === 'string' ? body.action : 'report';

    if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

    const resolved = await resolveToken(token);
    if (!resolved) return NextResponse.json({ error: 'Invalid link' }, { status: 404 });

    const admin = getSupabaseAdmin();

    // Dispute path
    if (action === 'dispute') {
      if (!matchId) return NextResponse.json({ error: 'Missing matchId' }, { status: 400 });
      const { data: match } = await admin
        .from('league_matches')
        .select('*')
        .eq('id', matchId)
        .maybeSingle();
      if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
      const m = match as any;
      // Must be a player in the match
      if (m.entry_a_id !== resolved.entry.id && m.entry_b_id !== resolved.entry.id) {
        return NextResponse.json({ error: 'Not a player in this match' }, { status: 403 });
      }
      if (m.status !== 'reported') {
        return NextResponse.json({ error: 'Can only dispute reported scores' }, { status: 400 });
      }
      await admin
        .from('league_matches')
        .update({
          status: 'disputed',
          disputed_at: new Date().toISOString(),
          disputed_by_token: token,
        })
        .eq('id', matchId);

      // Notify director via email (fire-and-forget)
      const { data: flight } = await admin
        .from('league_flights')
        .select('league_id')
        .eq('id', m.flight_id)
        .maybeSingle();
      const { data: league } = await admin
        .from('leagues')
        .select('name, director_id')
        .eq('id', (flight as any)?.league_id || '')
        .maybeSingle();
      if (league) {
        // Get director's email from auth.users
        const { data: director } = await admin
          .from('profiles')
          .select('email')
          .eq('id', (league as any).director_id)
          .maybeSingle();
        if (director && (director as any).email) {
          await safeResendSend(resend, {
            from: FROM,
            to: (director as any).email,
            subject: `[${(league as any).name}] Score dispute — ${m.bracket_position}`,
            html: `
              <div style="font-family: -apple-system, sans-serif; max-width: 600px;">
                <h2 style="color: #dc2626;">A score is being disputed</h2>
                <p>A player in ${m.bracket_position} (${(league as any).name}) has clicked dispute on a reported score.</p>
                <p>Reported score: <strong>${m.score || 'unknown'}</strong></p>
                <p>Log into your league dashboard to resolve.</p>
              </div>
            `,
          });
        }
      }

      return NextResponse.json({ success: true, disputed: true });
    }

    // Report path
    if (!scoreText) return NextResponse.json({ error: 'Score is required' }, { status: 400 });
    if (!winnerEntryId) return NextResponse.json({ error: 'Winner is required' }, { status: 400 });
    if (!matchId) return NextResponse.json({ error: 'Missing matchId' }, { status: 400 });

    const { data: match } = await admin
      .from('league_matches')
      .select('*')
      .eq('id', matchId)
      .maybeSingle();
    if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    const m = match as any;
    if (m.entry_a_id !== resolved.entry.id && m.entry_b_id !== resolved.entry.id) {
      return NextResponse.json({ error: 'Not a player in this match' }, { status: 403 });
    }
    if (winnerEntryId !== m.entry_a_id && winnerEntryId !== m.entry_b_id) {
      return NextResponse.json({ error: 'Winner must be one of the two teams' }, { status: 400 });
    }
    if (m.status !== 'pending' && m.status !== 'reported') {
      return NextResponse.json({ error: 'Match already finalized' }, { status: 400 });
    }

    await admin
      .from('league_matches')
      .update({
        score: scoreText,
        winner_entry_id: winnerEntryId,
        reported_at: new Date().toISOString(),
        reported_by_token: token,
        status: 'reported',
      })
      .eq('id', matchId);

    // Send dispute-button email to all 2 or 4 players in the match
    const entryIds = [m.entry_a_id, m.entry_b_id].filter(Boolean);
    const { data: entries } = await admin
      .from('league_entries')
      .select('id, captain_name, captain_email, captain_token, partner_name, partner_email, partner_token')
      .in('id', entryIds);

    const { data: flight } = await admin
      .from('league_flights')
      .select('league_id')
      .eq('id', m.flight_id)
      .maybeSingle();
    const { data: league } = await admin
      .from('leagues')
      .select('name, slug')
      .eq('id', (flight as any)?.league_id || '')
      .maybeSingle();
    const origin = new URL(request.url).origin;
    const publicBracketUrl = (league as any)?.slug
      ? `${origin}/leagues/${(league as any).slug}/bracket`
      : null;

    const sendOne = async (email: string | null, tokenOut: string | null, name: string) => {
      if (!email || !tokenOut) return;
      const disputeUrl = `${origin}/leagues/match/${tokenOut}`;
      await safeResendSend(resend, {
        from: FROM,
        to: email,
        subject: `Score reported: ${scoreText} — ${(league as any)?.name || 'League'}`,
        html: `
            <div style="font-family: -apple-system, sans-serif; max-width: 600px; padding: 20px;">
              <h2 style="color: #ea580c; margin-top: 0;">A score was reported</h2>
              <p>Hi ${name},</p>
              <p>A score was just reported for your Round ${m.round} match:</p>
              <div style="background: #fff7ed; border-left: 4px solid #ea580c; padding: 14px 18px; border-radius: 6px; margin: 16px 0;">
                <div style="font-size: 22px; font-weight: 600;">${scoreText}</div>
              </div>
              <p>If this is correct, do nothing — it'll lock in automatically in 24 hours and the bracket will advance.</p>
              <p>If it's wrong, click here to dispute:</p>
              <p style="margin: 24px 0 12px;">
                <a href="${disputeUrl}" style="display: inline-block; background: #dc2626; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">Review / dispute</a>
              </p>
              ${publicBracketUrl ? `
                <p style="margin: 0 0 24px;">
                  <a href="${publicBracketUrl}" style="display: inline-block; background: transparent; color: #ea580c; border: 1.5px solid #ea580c; padding: 10px 22px; border-radius: 8px; text-decoration: none; font-weight: 500;">View live bracket</a>
                </p>
                <p style="color: #6b7280; font-size: 12px; margin: 0;">
                  The bracket page is public — share it with anyone.
                </p>
              ` : ''}
            </div>
          `,
      });
    };

    for (const ent of (entries as any[]) || []) {
      await sendOne(ent.captain_email, ent.captain_token, ent.captain_name);
      if (ent.partner_email) await sendOne(ent.partner_email, ent.partner_token, ent.partner_name);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}
