import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { eventCanUsePremium } from '@/lib/billing';
import { searchPixabayMusic } from '@/lib/pixabay';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const url = new URL(request.url);
    const query = url.searchParams.get('q') || 'walkout';
    const eventId = url.searchParams.get('eventId') || '';
    if (!eventId) return NextResponse.json({ error: 'eventId_required' }, { status: 400 });

    const allowed = await eventCanUsePremium(user.id, eventId, 'dj_console');
    if (!allowed) {
      return NextResponse.json(
        { error: 'feature_locked', feature: 'dj_console', upgradeUrl: '/pricing' },
        { status: 402 }
      );
    }

    const tracks = await searchPixabayMusic(query, { perPage: 24 });
    return NextResponse.json({ tracks });
  } catch (err: any) {
    console.error('[dj/pixabay-search]', err);
    return NextResponse.json({ error: 'search_failed', message: err?.message }, { status: 500 });
  }
}
