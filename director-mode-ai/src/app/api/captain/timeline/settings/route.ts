/**
 * Team-level automation rules.
 *   PATCH { team_id, kind, enabled?, lead_days?, subject_override?, intro_override? }
 *
 * Upserts because a team starts with no rows at all — the built-in defaults in
 * KIND_META stand in until the captain changes something.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';
import { EMAIL_KINDS, KIND_META, type EmailKind } from '@/lib/captain/timeline';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    kind?: EmailKind;
    enabled?: boolean;
    lead_days?: number;
    subject_override?: string | null;
    intro_override?: string | null;
  };

  if (!body.team_id || !body.kind || !EMAIL_KINDS.includes(body.kind)) {
    return NextResponse.json({ error: 'team_id and a valid kind are required.' }, { status: 400 });
  }
  if (body.lead_days != null && (!Number.isFinite(body.lead_days) || body.lead_days < 0 || body.lead_days > 120)) {
    return NextResponse.json({ error: 'Lead time must be between 0 and 120 days.' }, { status: 400 });
  }

  const ctx = await requireTeam(body.team_id);
  if (isError(ctx)) return ctx.error;
  const { db, teamId } = ctx;

  const { data: existing } = await db
    .from('captain_email_settings')
    .select('enabled, lead_days, subject_override, intro_override')
    .eq('team_id', teamId)
    .eq('kind', body.kind)
    .maybeSingle();

  const current = (existing as {
    enabled: boolean;
    lead_days: number;
    subject_override: string | null;
    intro_override: string | null;
  } | null) || {
    enabled: KIND_META[body.kind].defaultEnabled,
    lead_days: KIND_META[body.kind].defaultLeadDays,
    subject_override: null,
    intro_override: null,
  };

  const row = {
    team_id: teamId,
    kind: body.kind,
    enabled: body.enabled ?? current.enabled,
    lead_days: body.lead_days ?? current.lead_days,
    subject_override: body.subject_override === undefined ? current.subject_override : trimOrNull(body.subject_override),
    intro_override: body.intro_override === undefined ? current.intro_override : trimOrNull(body.intro_override),
    updated_at: new Date().toISOString(),
  };

  const { error } = await db
    .from('captain_email_settings')
    .upsert(row, { onConflict: 'team_id,kind' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, setting: row });
}

function trimOrNull(v: string | null): string | null {
  const t = (v || '').trim();
  return t ? t : null;
}
