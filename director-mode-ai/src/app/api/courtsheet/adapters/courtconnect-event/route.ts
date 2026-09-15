import { NextResponse } from 'next/server';

/*
 * Retired with the old shared CourtConnect games (cc_events): it put one of
 * those events on the court sheet. Existing reservations with source
 * 'courtconnect' are left alone, and lib/courtsheet/adapters/courtconnect.ts
 * is kept so they can still be cancelled by source if ever needed.
 */
const gone = () =>
  NextResponse.json({ error: 'This CourtConnect feature has been retired.' }, { status: 410 });

export const POST = gone;
export const GET = gone;
