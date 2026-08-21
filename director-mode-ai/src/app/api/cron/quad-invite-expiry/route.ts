/**
 * GET /api/cron/quad-invite-expiry — daily backstop sweep.
 *
 * Releases quad spots whose payment window lapsed, across every event. Runs
 * daily because Vercel Hobby rejects sub-daily cron schedules (a finer one
 * silently breaks the whole production deploy). Daily is a backstop, not the
 * primary mechanism — the director's Entries tab shows overdue holds in real
 * time and releases them on a click.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { expireOverdueQuadInvites } from '@/lib/quadInviteExpiry';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const origin =
    process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const result = await expireOverdueQuadInvites(admin, { origin, notify: true });
  return NextResponse.json({ ok: true, ...result });
}
