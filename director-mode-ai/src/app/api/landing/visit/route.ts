import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { LANDING_EVENTS, LANDING_PAGES } from '@/lib/landing';

/**
 * One step on a campaign landing page (/mixermode, /pulse): viewed, clicked
 * the CTA, actually used it. `ref` is the outreach letter's ?r= code, which is
 * how /crm/autopilot ties the step back to a letter. Logging only: always 204,
 * never an error a visitor could see.
 */
export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as { page?: string; event?: string; ref?: string | null };
    const page = LANDING_PAGES.find((p) => p === b.page);
    const event = LANDING_EVENTS.find((e) => e === b.event);
    if (page && event) {
      const ref = typeof b.ref === 'string' && /^[a-z0-9]{4,32}$/i.test(b.ref) ? b.ref : null;
      await getSupabaseAdmin()
        .from('landing_visits')
        .insert({ page, event, ref, user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null });
    }
  } catch {
    // Logging only.
  }
  return new NextResponse(null, { status: 204 });
}
