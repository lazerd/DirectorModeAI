import { NextResponse } from 'next/server';

/*
 * Retired with the old shared CourtConnect games: it copied PlayerVault rows
 * into cc_players so they could RSVP to cc_events. CourtConnect is now the
 * per-club partner finder and reads PlayerVault ratings directly, so there is
 * nothing to copy. Existing cc_players rows are kept.
 */
const gone = () =>
  NextResponse.json({ error: 'Import to Racquets IRL has been retired. Racquets IRL reads PlayerVault directly.' }, { status: 410 });

export const POST = gone;
export const GET = gone;
