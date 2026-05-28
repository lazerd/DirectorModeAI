import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';

export const dynamic = 'force-dynamic';

// GET — list courts for the authenticated user's club.
export async function GET() {
  const ctx = await requireStaffForClub();
  if ('error' in ctx) return ctx.error;
  const { data } = await ctx.db
    .from('courts')
    .select('*')
    .eq('club_id', ctx.club.id)
    .neq('status', 'hidden')
    .order('display_order', { ascending: true });
  return NextResponse.json({
    club: ctx.club,
    courts: data ?? [],
    role: ctx.role,
  });
}

// POST — add a court. Staff only.
export async function POST(req: Request) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;
  const body = await req.json().catch(() => ({}));
  const { number, name, sports, surface, indoor } = body as {
    number?: number;
    name?: string;
    sports?: string[];
    surface?: string;
    indoor?: boolean;
  };
  if (typeof number !== 'number' || number < 1) {
    return NextResponse.json({ error: 'Invalid court number' }, { status: 400 });
  }
  const { data, error } = await ctx.db
    .from('courts')
    .insert({
      club_id: ctx.club.id,
      number,
      name: name ?? null,
      sports: sports && sports.length > 0 ? sports : ['tennis'],
      surface: surface ?? null,
      indoor: indoor ?? false,
      display_order: number,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ court: data });
}

// PATCH — update a court (status, name, sports). Staff only.
export async function PATCH(req: Request) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;
  const body = await req.json().catch(() => ({}));
  const { id, ...changes } = body as { id?: string } & Record<string, unknown>;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const { data, error } = await ctx.db
    .from('courts')
    .update(changes)
    .eq('id', id)
    .eq('club_id', ctx.club.id)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ court: data });
}
