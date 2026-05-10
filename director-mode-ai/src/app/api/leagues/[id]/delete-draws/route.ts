/**
 * POST /api/leagues/[id]/delete-draws
 *
 * Director-only. Deletes every flight and match for a specific category
 * so the director can regenerate draws (or after a mistake).
 *
 * Safety: blocks if any match in the category already has a confirmed
 * score — you can't destroy actual match results. If you need to
 * manually reset a confirmed match, do it in Supabase directly.
 *
 * Body: { categoryKey: CategoryKey }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import type { CategoryKey } from '@/lib/leagueUtils';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params;

    const userClient = await createClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = getSupabaseAdmin();
    const { data: league } = await admin
      .from('leagues')
      .select('id, director_id')
      .eq('id', leagueId)
      .maybeSingle();
    if (!league || (league as any).director_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const categoryKey = typeof body?.categoryKey === 'string' ? (body.categoryKey as CategoryKey) : null;
    if (!categoryKey) {
      return NextResponse.json({ error: 'categoryKey required' }, { status: 400 });
    }

    const { data: category } = await admin
      .from('league_categories')
      .select('id')
      .eq('league_id', leagueId)
      .eq('category_key', categoryKey)
      .maybeSingle();
    if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 });

    const categoryId = (category as any).id;

    // Find all flights for this category
    const { data: flights } = await admin
      .from('league_flights')
      .select('id')
      .eq('category_id', categoryId);
    const flightIds = ((flights as any[]) || []).map(f => f.id);

    if (flightIds.length === 0) {
      return NextResponse.json({ success: true, flightsDeleted: 0, matchesDeleted: 0 });
    }

    // Safety: refuse if any matches have been confirmed
    const { data: confirmedMatches } = await admin
      .from('league_matches')
      .select('id')
      .in('flight_id', flightIds)
      .eq('status', 'confirmed');
    if (confirmedMatches && (confirmedMatches as any[]).length > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete — ${(confirmedMatches as any[]).length} match(es) already confirmed. If you really need to reset, clear them manually first.`,
        },
        { status: 400 }
      );
    }

    // Delete matches first (cascades would work, but we count for the response)
    const { data: deletedMatches } = await admin
      .from('league_matches')
      .delete()
      .in('flight_id', flightIds)
      .select('id');

    // Delete flights (cascade clears entries' flight_id references)
    const { data: deletedFlights } = await admin
      .from('league_flights')
      .delete()
      .in('id', flightIds)
      .select('id');

    // Reset entries back to 'active' so they can be re-seeded
    await admin
      .from('league_entries')
      .update({ flight_id: null, seed_in_flight: null, entry_status: 'active' })
      .eq('league_id', leagueId)
      .eq('category_id', categoryId)
      .in('entry_status', ['waitlisted']);

    return NextResponse.json({
      success: true,
      flightsDeleted: (deletedFlights as any[])?.length ?? 0,
      matchesDeleted: (deletedMatches as any[])?.length ?? 0,
    });
  } catch (err: any) {
    console.error('Delete draws error:', err);
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}
