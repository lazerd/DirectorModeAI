/**
 * Adults attached to the team who are not on the roster.
 *   GET    ?team_id=…                     -> the list
 *   POST   { team_id, name, role, … }     -> add
 *   PATCH  { team_id, id, … }             -> edit
 *   DELETE { team_id, id }                -> remove
 *
 * A coach, a co-captain, a second parent who does the driving. They want every
 * match email and they will never be players — putting them on the roster to
 * achieve that would corrupt the lineup and every fairness count that reads it.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';
import { normalizePhone } from '@/lib/captain/phone';

export const dynamic = 'force-dynamic';

const ROLES = new Set(['coach', 'captain', 'co_captain', 'team_parent', 'other']);

type Body = {
  team_id?: string;
  id?: string;
  name?: string;
  role?: string;
  email?: string | null;
  phone?: string | null;
  on_emails?: boolean;
  notes?: string | null;
};

/** Shared field validation for POST and PATCH. */
function fieldsFrom(body: Body): { patch: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = (body.name || '').trim();
    if (!name) return { error: 'A name is required.' };
    patch.name = name;
  }
  if (body.role !== undefined) {
    if (!ROLES.has(body.role)) return { error: 'Unknown role.' };
    patch.role = body.role;
  }
  if (body.email !== undefined) patch.email = (body.email || '').trim() || null;
  if (body.phone !== undefined) {
    const raw = (body.phone || '').trim();
    if (!raw) {
      patch.phone = null;
    } else {
      // Same normalisation as the roster: a number that only fails at send
      // time fails silently, hours later, when it matters.
      const e164 = normalizePhone(raw);
      if (!e164) return { error: `Could not read “${raw}” — use 10 digits, or +1 and the number.` };
      patch.phone = e164;
    }
  }
  if (body.on_emails !== undefined) patch.on_emails = !!body.on_emails;
  if (body.notes !== undefined) patch.notes = (body.notes || '').trim() || null;

  return { patch };
}

export async function GET(req: Request) {
  const teamId = new URL(req.url).searchParams.get('team_id') || '';
  const ctx = await requireTeam(teamId);
  if (isError(ctx)) return ctx.error;

  const { data, error } = await ctx.db
    .from('captain_team_contacts')
    .select('*')
    .eq('team_id', ctx.teamId)
    .order('sort_order')
    .order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contacts: data ?? [] });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const ctx = await requireTeam(body.team_id || '');
  if (isError(ctx)) return ctx.error;

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'A name is required.' }, { status: 400 });
  }
  const built = fieldsFrom(body);
  if ('error' in built) return NextResponse.json({ error: built.error }, { status: 400 });

  const { data, error } = await ctx.db
    .from('captain_team_contacts')
    .insert({ team_id: ctx.teamId, role: 'other', ...built.patch })
    .select('*')
    .single();

  if (error) {
    // The unique key is (team_id, name, role) — say so rather than surfacing
    // a raw constraint name.
    if (/duplicate key/i.test(error.message)) {
      return NextResponse.json(
        { error: 'That person is already on the list in that role.' },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, contact: data });
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const ctx = await requireTeam(body.team_id || '');
  if (isError(ctx)) return ctx.error;
  if (!body.id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });

  const built = fieldsFrom(body);
  if ('error' in built) return NextResponse.json({ error: built.error }, { status: 400 });

  const { error } = await ctx.db
    .from('captain_team_contacts')
    .update({ ...built.patch, updated_at: new Date().toISOString() })
    // Scoped to the team as well as the id: an id alone would let one team
    // edit another team's contact.
    .eq('id', body.id)
    .eq('team_id', ctx.teamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const ctx = await requireTeam(body.team_id || '');
  if (isError(ctx)) return ctx.error;
  if (!body.id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });

  const { error } = await ctx.db
    .from('captain_team_contacts')
    .delete()
    .eq('id', body.id)
    .eq('team_id', ctx.teamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
