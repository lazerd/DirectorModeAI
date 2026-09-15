import { NextResponse } from 'next/server';

/*
 * Retired with the old shared CourtConnect games (cc_events), and taken out of
 * vercel.json. The JTT match-RSVP confirmations that used to piggyback on this
 * cron now run from the same slot on their own route,
 * /api/leagues/rsvp-confirmations.
 */
const gone = () =>
  NextResponse.json({ error: 'CourtConnect event reminders have been retired.' }, { status: 410 });

export const GET = gone;
export const POST = gone;
