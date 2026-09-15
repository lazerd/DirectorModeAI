/**
 * /api/checkin/board/[clubSlug] — the kiosk / TV board.
 *
 * Public for a public club with check-in turned on. First names and last
 * initials only; no emails, phones or ids.
 */

import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/checkin/http';
import { getClubBySlug, getSettings, reconcileClub } from '@/lib/checkin/server';
import { boardView } from '@/lib/checkin/views';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request, { params }: { params: Promise<{ clubSlug: string }> }) {
  const limited = rateLimit(req, 'read');
  if (limited) return limited;
  const { clubSlug } = await params;
  const club = await getClubBySlug(clubSlug);
  if (!club || !club.is_public) return NextResponse.json({ error: 'Club not found.' }, { status: 404 });
  const settings = await getSettings(club.id);
  if (!settings.enabled) return NextResponse.json({ error: 'Check-in is not on at this club.' }, { status: 404 });
  const state = await reconcileClub(club);
  return NextResponse.json(boardView(state), { headers: { 'Cache-Control': 'no-store' } });
}
