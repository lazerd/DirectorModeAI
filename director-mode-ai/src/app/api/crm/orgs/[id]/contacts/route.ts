/**
 * POST /api/crm/orgs/[id]/contacts
 *
 *   { full_name, title?, email?, ... }  — add one
 *   { paste: "<blob>" }                 — add a whole board at once
 *
 * The paste branch is why this route exists in this shape. The reps work from
 * a club's published board page: they select it, copy, and paste. Parsing
 * lives in lib/crm/pasteContacts.ts (pure, tested); this only writes the rows
 * and reports what already existed, so pasting the same page twice after the
 * board adds a member adds exactly the new member.
 */
import { NextResponse } from 'next/server';
import { bad, isCrmAuthError, requireCrm, text } from '@/lib/crm/server';
import { parsePastedContacts } from '@/lib/crm/pasteContacts';
import { CONTACT_COLS, type Contact } from '@/lib/crm/types';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;

  const { data: org } = await ctx.db.from('crm_orgs').select('id').eq('id', params.id).maybeSingle();
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // ------------------------------------------------------------ bulk paste
  if (typeof body.paste === 'string') {
    const { contacts, skipped } = parsePastedContacts(body.paste.slice(0, 20_000));
    if (!contacts.length) {
      return bad('Nothing in that looked like a name and an email.');
    }
    /*
     * Existing names are filtered out here rather than left to the unique
     * index: PostgREST's on_conflict takes column names, and ours is an
     * expression index (lower(btrim(full_name))), so an upsert cannot name it.
     * Skipping rather than updating is also the behaviour we want — a re-paste
     * must not wipe the title or role a rep typed by hand over what the board
     * page said. The index stays as the backstop for a race.
     */
    const { data: existing } = await ctx.db.from('crm_contacts').select('full_name').eq('org_id', params.id);
    const have = new Set(
      ((existing as { full_name: string }[] | null) || []).map((c) => c.full_name.trim().toLowerCase()),
    );
    const fresh = contacts.filter((c) => !have.has(c.full_name.trim().toLowerCase()));

    if (fresh.length) {
      const { error } = await ctx.db.from('crm_contacts').insert(
        fresh.map((c) => ({
          org_id: params.id,
          full_name: c.full_name,
          title: c.title,
          email: c.email,
          phone: c.phone,
        })),
      );
      if (error) return bad(error.message, 500);
    }

    const { data: after } = await ctx.db
      .from('crm_contacts')
      .select(CONTACT_COLS)
      .eq('org_id', params.id)
      .order('is_primary', { ascending: false })
      .order('full_name');
    return NextResponse.json({
      contacts: (after as Contact[] | null) || [],
      added: fresh.length,
      alreadyHad: contacts.length - fresh.length,
      skipped,
    });
  }

  // -------------------------------------------------------------- just one
  const fullName = text(body.full_name, 160);
  if (!fullName) return bad('Who is it?');
  const { data, error } = await ctx.db
    .from('crm_contacts')
    .insert({
      org_id: params.id,
      full_name: fullName,
      title: text(body.title, 160),
      email: text(body.email, 200)?.toLowerCase() ?? null,
      phone: text(body.phone, 60),
      role: text(body.role, 120),
      is_primary: body.is_primary === true,
      notes: text(body.notes, 4000),
    })
    .select(CONTACT_COLS)
    .single();
  if (error) {
    return bad(
      error.code === '23505' ? `${fullName} is already on this club.` : error.message,
      error.code === '23505' ? 409 : 500,
    );
  }
  return NextResponse.json({ contact: data as Contact });
}
