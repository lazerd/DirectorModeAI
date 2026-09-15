import { NextResponse } from 'next/server';

/*
 * Retired with the old shared CourtConnect games (cc_events): it turned one of
 * those events into a MixerMode event. CourtConnect is now the per-club partner
 * finder under /api/play. The cc_* tables and their rows are kept.
 */
const gone = () =>
  NextResponse.json({ error: 'This CourtConnect feature has been retired. Use CourtConnect at /courtconnect.' }, { status: 410 });

export const POST = gone;
export const GET = gone;
