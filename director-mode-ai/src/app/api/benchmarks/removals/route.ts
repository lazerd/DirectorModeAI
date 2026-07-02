import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

// Owner-only curation of the /benchmarks 990 dataset: hide a bogus person-row
// or an entire club. Everyone can GET the removal list (it's just "what's
// hidden"); only Darrin's logins can add/undo.
export const dynamic = 'force-dynamic';

const ADMIN_EMAILS = new Set([
  'darrinjco@gmail.com',
  'darrincohentennis@gmail.com',
  'darrin@sleepyhollowclub.com',
]);

async function callerIsAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return !!(user?.email && ADMIN_EMAILS.has(user.email.toLowerCase()));
}

export async function GET() {
  const isAdmin = await callerIsAdmin();
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from('benchmark_removals')
    .select('key, scope, ein, person, year');
  // Until the migration runs the table won't exist — behave as "nothing hidden".
  return NextResponse.json({ removals: error ? [] : data ?? [], isAdmin });
}

export async function POST(req: Request) {
  if (!(await callerIsAdmin())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const b = await req.json().catch(() => ({}));
  const ein = String(b.ein || '').trim();
  const scope = b.scope === 'club' ? 'club' : 'row';
  if (!/^\d{2}-\d{7}$/.test(ein)) {
    return NextResponse.json({ error: 'invalid ein' }, { status: 400 });
  }
  const person = scope === 'row' ? String(b.person || '').trim() : null;
  const year = scope === 'row' ? String(b.year || '').trim() : null;
  if (scope === 'row' && (!person || !year)) {
    return NextResponse.json({ error: 'person and year required' }, { status: 400 });
  }
  const key = scope === 'club' ? `${ein}|*` : `${ein}|${person}|${year}`;
  const db = getSupabaseAdmin();
  const { error } = await db
    .from('benchmark_removals')
    .upsert({ key, ein, person, year, scope });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, key });
}

// Undo a removal.
export async function DELETE(req: Request) {
  if (!(await callerIsAdmin())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const b = await req.json().catch(() => ({}));
  const key = String(b.key || '');
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });
  const db = getSupabaseAdmin();
  const { error } = await db.from('benchmark_removals').delete().eq('key', key);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
