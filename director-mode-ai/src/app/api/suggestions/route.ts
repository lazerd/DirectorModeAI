/**
 * POST /api/suggestions — directors submit feature requests / feedback.
 * Stores in feature_requests. Works logged-in (captures who) or anonymous.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 4000) : '';
    const page = typeof body.page === 'string' ? body.page.slice(0, 200) : null;
    if (message.length < 3) {
      return NextResponse.json({ error: 'Please add a bit more detail.' }, { status: 400 });
    }

    // Capture who's submitting, if signed in (optional).
    let userId: string | null = null;
    let email: string | null = null;
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        userId = user.id;
        email = user.email ?? null;
      }
    } catch {
      /* anonymous is fine */
    }

    const service = await createServiceClient();
    const { error } = await service
      .from('feature_requests')
      .insert({ user_id: userId, email, message, page });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
  }
}
