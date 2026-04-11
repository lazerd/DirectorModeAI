/**
 * POST /api/leagues/seed-test-league
 *
 * Creates a fully-populated fake league under the currently-authenticated
 * Supabase user, so the director can QA the compass / single-elim / round
 * robin flows without having to invent 8–16 people or risk real emails
 * going out.
 *
 * The league name is prefixed with [TEST] so generate-draws knows to skip
 * Resend email delivery even though it runs its normal code path. All
 * generated entries use @example.com addresses.
 *
 * Body: {
 *   size:        8 | 16,                          // default 16
 *   leagueType:  'compass' | 'round_robin' | 'single_elimination',
 *                                                 // default 'compass'
 *   categoryKey: 'men_singles' | 'men_doubles' | 'women_singles' | 'women_doubles',
 *                                                 // default 'men_singles'
 *   generateDraws: boolean,                       // default true
 * }
 *
 * Returns: { success, leagueId, leagueName, url, entriesCreated, drawsGenerated }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { slugify, generateToken, type CategoryKey } from '@/lib/leagueUtils';

type LeagueType = 'compass' | 'round_robin' | 'single_elimination';

const VALID_CATEGORIES: CategoryKey[] = [
  'men_singles',
  'men_doubles',
  'women_singles',
  'women_doubles',
];

const VALID_TYPES: LeagueType[] = ['compass', 'round_robin', 'single_elimination'];

export async function POST(request: Request) {
  try {
    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) {
      return NextResponse.json(
        {
          error:
            'You must be signed in as a director to seed a test league. Open /login in another tab and sign in, then retry.',
        },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));

    const size: 8 | 16 = body?.size === 8 ? 8 : 16;
    const leagueType: LeagueType = VALID_TYPES.includes(body?.leagueType)
      ? body.leagueType
      : 'compass';
    const categoryKey: CategoryKey = VALID_CATEGORIES.includes(body?.categoryKey)
      ? body.categoryKey
      : 'men_singles';
    const generateDraws: boolean = body?.generateDraws !== false;
    const isDoubles = categoryKey.endsWith('_doubles');

    const admin = getSupabaseAdmin();

    // 1. Create the league row. [TEST] prefix → generate-draws will skip
    //    email delivery. Registration dates are set wide open so we can
    //    immediately mark entries as paid + active.
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate()
    ).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(
      now.getMinutes()
    ).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const name = `[TEST] ${leagueType} ${size}p ${timestamp}`;
    const baseSlug = slugify(`test-${leagueType}-${size}p-${timestamp}`);
    const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
    const startDate = now.toISOString().split('T')[0];
    const end = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const endDate = end.toISOString().split('T')[0];

    const { data: league, error: leagueErr } = await admin
      .from('leagues')
      .insert({
        director_id: user.id,
        name,
        slug,
        description:
          'Auto-generated test league. Safe to delete. All entries use @example.com addresses and no emails will be sent.',
        start_date: startDate,
        end_date: endDate,
        registration_opens_at: now.toISOString(),
        registration_closes_at: now.toISOString(),
        status: 'open',
        league_type: leagueType,
      })
      .select('id, name, slug')
      .single();
    if (leagueErr || !league) {
      return NextResponse.json(
        { error: `Failed to create test league: ${leagueErr?.message || 'unknown error'}` },
        { status: 500 }
      );
    }
    const leagueRow = league as any;

    // 2. Single enabled category so the seed entries land somewhere.
    const { data: category, error: catErr } = await admin
      .from('league_categories')
      .insert({
        league_id: leagueRow.id,
        category_key: categoryKey,
        entry_fee_cents: 0,
        is_enabled: true,
      })
      .select('id')
      .single();
    if (catErr || !category) {
      return NextResponse.json(
        { error: `Failed to create category: ${catErr?.message || 'unknown error'}` },
        { status: 500 }
      );
    }
    const categoryRow = category as any;

    // 3. Fake entries. Random composite scores in the 6–12 UTR band so the
    //    seeder produces varied but realistic-looking seeding order. Doubles
    //    categories get a partner per entry, pre-confirmed so the entry is
    //    active immediately.
    const entries: any[] = [];
    for (let i = 1; i <= size; i++) {
      const composite = 6 + Math.random() * 6;
      const ntrp = 3.0 + Math.random() * 2;
      const entry: any = {
        league_id: leagueRow.id,
        category_id: categoryRow.id,
        captain_name: `Test Player ${i}`,
        captain_email: `testplayer${i}@example.com`,
        captain_phone: `555-555-${String(1000 + i).slice(-4)}`,
        captain_ntrp: Number(ntrp.toFixed(1)),
        captain_token: generateToken(),
        composite_score: Number(composite.toFixed(2)),
        rating_source: 'ntrp',
        rating_confidence: 'low',
        payment_status: 'paid',
        entry_status: 'active',
      };
      if (isDoubles) {
        const pntrp = 3.0 + Math.random() * 2;
        entry.partner_name = `Test Partner ${i}`;
        entry.partner_email = `testpartner${i}@example.com`;
        entry.partner_phone = `555-555-${String(2000 + i).slice(-4)}`;
        entry.partner_ntrp = Number(pntrp.toFixed(1));
        entry.partner_token = generateToken();
        entry.partner_confirmed_at = now.toISOString();
      }
      entries.push(entry);
    }

    const { error: entriesErr } = await admin.from('league_entries').insert(entries);
    if (entriesErr) {
      return NextResponse.json(
        { error: `Failed to insert test entries: ${entriesErr.message}` },
        { status: 500 }
      );
    }

    // 4. Optionally trigger draw generation immediately via an internal
    //    fetch to /api/leagues/[id]/generate-draws. We forward the caller's
    //    cookie so the endpoint's director auth check passes. The endpoint
    //    sees the [TEST] prefix and skips email delivery.
    let drawsGenerated = false;
    let drawsError: string | null = null;
    if (generateDraws) {
      try {
        const origin = new URL(request.url).origin;
        const cookie = request.headers.get('cookie') || '';
        const res = await fetch(`${origin}/api/leagues/${leagueRow.id}/generate-draws`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie,
          },
          body: JSON.stringify({ categoryKey }),
        });
        if (res.ok) {
          drawsGenerated = true;
        } else {
          const data = await res.json().catch(() => ({}));
          drawsError = data?.error || `HTTP ${res.status}`;
        }
      } catch (e: any) {
        drawsError = e?.message || 'fetch failed';
      }
    }

    return NextResponse.json({
      success: true,
      leagueId: leagueRow.id,
      leagueName: leagueRow.name,
      leagueSlug: leagueRow.slug,
      entriesCreated: entries.length,
      drawsGenerated,
      drawsError,
      url: `/mixer/leagues/${leagueRow.id}`,
    });
  } catch (err: any) {
    console.error('seed-test-league error:', err);
    return NextResponse.json(
      { error: err?.message || 'Internal error' },
      { status: 500 }
    );
  }
}
