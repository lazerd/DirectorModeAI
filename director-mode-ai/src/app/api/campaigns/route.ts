import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveCampaign } from '@/lib/campaigns/sources';
import { runCampaign, type CampaignKind, type SendMode } from '@/lib/campaigns/core';

export const dynamic = 'force-dynamic';

async function requireUser() {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  return user;
}

// GET /api/campaigns?surface=tournament&targetId=<id> — status board (no emails)
export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const surface = req.nextUrl.searchParams.get('surface') || '';
  const targetId = req.nextUrl.searchParams.get('targetId') || '';
  const r = await resolveCampaign(surface, targetId, { id: user.id, email: user.email });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const d = r.data;
  return NextResponse.json({
    title: d.title,
    clubName: d.clubName,
    liveUrl: d.liveUrl,
    stats: d.stats,
    everyoneCount: d.everyone.length,
    nudgeCount: d.nudge.length,
    reminderWhen: d.reminderWhen ?? null,
    reminderCount: d.reminderWhen ? d.everyone.length : 0,
  });
}

// POST /api/campaigns  { surface, targetId, kind, mode }
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    surface?: string;
    targetId?: string;
    kind?: CampaignKind;
    mode?: SendMode;
  };
  const { surface = '', targetId = '', kind, mode } = body;
  if (kind !== 'update' && kind !== 'nudge' && kind !== 'reminder')
    return NextResponse.json({ error: 'bad kind' }, { status: 400 });
  if (mode !== 'preview' && mode !== 'test' && mode !== 'live') return NextResponse.json({ error: 'bad mode' }, { status: 400 });

  const r = await resolveCampaign(surface, targetId, { id: user.id, email: user.email });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  const result = await runCampaign(r.data, kind, mode);
  return NextResponse.json(result);
}
