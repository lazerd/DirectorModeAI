/**
 * DB constraint integration test.
 *
 * Proves the migration-005 EXCLUDE constraint actually rejects two
 * overlapping active reservations on the same court. This is the
 * promise the rest of the engine rides on.
 *
 * Skips when COURTSHEET_TEST_DB_URL isn't set (no Postgres available).
 * To run locally:
 *   COURTSHEET_TEST_DB_URL=postgres://...  npm test src/lib/courtsheet/constraint.test.ts
 *
 * The test creates a throwaway club + court, attempts two overlapping
 * inserts, asserts the second one fails with the EXCLUDE-constraint
 * error, then cleans up.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENABLED = process.env.COURTSHEET_TEST_DB_URL === 'use_supabase' && SUPA_URL && SUPA_KEY;

const describeMaybe = ENABLED ? describe : describe.skip;

describeMaybe('no_double_booking EXCLUDE constraint', () => {
  let db: SupabaseClient<any, 'public', any>;
  let club_id: string;
  let owner_id: string;
  let court_id: string;
  const created: string[] = [];

  beforeAll(async () => {
    db = createClient<any, 'public', any>(SUPA_URL!, SUPA_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Pick an existing auth user as owner — service role won't create new
    // auth.users for us. We expect the dev DB to have at least one user.
    const { data: anyUser } = await db.from('profiles').select('id').limit(1).single();
    owner_id = (anyUser as { id: string }).id;

    const slug = `cs-test-${Date.now()}`;
    const { data: club } = await db
      .from('cc_clubs')
      .insert({
        owner_id,
        name: 'CourtSheet test club',
        slug,
        timezone: 'UTC',
        operating_hours: {},
      })
      .select('id')
      .single();
    club_id = (club as { id: string }).id;

    const { data: court } = await db
      .from('courts')
      .insert({ club_id, number: 1, sports: ['tennis'] })
      .select('id')
      .single();
    court_id = (court as { id: string }).id;
  });

  afterAll(async () => {
    if (created.length > 0) {
      await db.from('reservations').delete().in('id', created);
    }
    if (court_id) await db.from('courts').delete().eq('id', court_id);
    if (club_id) await db.from('cc_clubs').delete().eq('id', club_id);
  });

  it('rejects two overlapping active reservations on the same court', async () => {
    const base = {
      club_id,
      court_id,
      type: 'lesson',
      source: 'manual',
      title: 'A',
      created_by: owner_id,
    };

    // First insert succeeds.
    const { data: first, error: e1 } = await db
      .from('reservations')
      .insert({
        ...base,
        starts_at: '2026-06-15T16:00:00Z',
        ends_at: '2026-06-15T17:00:00Z',
      })
      .select('id')
      .single();
    expect(e1).toBeNull();
    created.push((first as { id: string }).id);

    // Overlapping second insert must fail.
    const { error: e2 } = await db
      .from('reservations')
      .insert({
        ...base,
        title: 'B',
        starts_at: '2026-06-15T16:30:00Z',
        ends_at: '2026-06-15T17:30:00Z',
      });
    expect(e2).toBeTruthy();
    expect(String(e2?.message ?? '')).toMatch(/no_double_booking|exclusion|conflict|exclude/i);
  });

  it('allows two touching non-overlapping reservations (half-open)', async () => {
    const base = {
      club_id,
      court_id,
      type: 'lesson',
      source: 'manual',
      title: 'TouchA',
      created_by: owner_id,
    };

    const { data: a } = await db
      .from('reservations')
      .insert({
        ...base,
        starts_at: '2026-06-16T16:00:00Z',
        ends_at: '2026-06-16T17:00:00Z',
      })
      .select('id')
      .single();
    if (a) created.push((a as { id: string }).id);

    const { data: b, error } = await db
      .from('reservations')
      .insert({
        ...base,
        title: 'TouchB',
        starts_at: '2026-06-16T17:00:00Z',
        ends_at: '2026-06-16T18:00:00Z',
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    if (b) created.push((b as { id: string }).id);
  });

  it('allows re-using a slot once the prior reservation is cancelled', async () => {
    const base = {
      club_id,
      court_id,
      type: 'lesson',
      source: 'manual',
      title: 'Recycle',
      created_by: owner_id,
    };

    const { data: a } = await db
      .from('reservations')
      .insert({
        ...base,
        starts_at: '2026-06-17T10:00:00Z',
        ends_at: '2026-06-17T11:00:00Z',
      })
      .select('id')
      .single();
    const aId = (a as { id: string }).id;
    created.push(aId);

    await db.from('reservations').update({ status: 'cancelled' }).eq('id', aId);

    const { error } = await db.from('reservations').insert({
      ...base,
      title: 'Recycle 2',
      starts_at: '2026-06-17T10:00:00Z',
      ends_at: '2026-06-17T11:00:00Z',
    });
    expect(error).toBeNull();
  });
});
