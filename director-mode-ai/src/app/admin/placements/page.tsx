/**
 * Recruiting placements — every "pay only when you hire" fee event, for the
 * platform owner to invoice. Read-only.
 */

import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';

export const dynamic = 'force-dynamic';

const usd = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const fmt = (ymd: string | null) =>
  ymd
    ? new Date(`${ymd.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : '—';

export default async function PlacementsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/admin/placements');
  if (!isPlatformOwnerEmail(user.email)) notFound();

  const db = getSupabaseAdmin();
  const { data: placements } = await db
    .from('connect_placements')
    .select('id, opening_id, candidate_id, club_owner_id, fee_cents, terms_version, start_date, status, guarantee_until, invoice_ref, created_at')
    .order('created_at', { ascending: false });
  const rows = placements || [];

  const openingIds = Array.from(new Set(rows.map((p) => p.opening_id)));
  const candIds = Array.from(new Set(rows.map((p) => p.candidate_id)));
  const [{ data: openings }, { data: cands }] = await Promise.all([
    openingIds.length
      ? db.from('connect_openings').select('id, club_name, title, dept').in('id', openingIds)
      : Promise.resolve({ data: [] as any[] }),
    candIds.length
      ? db.from('connect_candidates').select('id, full_name, email').in('id', candIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const oById = new Map((openings || []).map((o: any) => [o.id, o]));
  const cById = new Map((cands || []).map((c: any) => [c.id, c]));
  const ownerEmails = new Map<string, string>();
  await Promise.all(
    Array.from(new Set(rows.map((p) => p.club_owner_id))).map(async (uid) => {
      const { data } = await db.auth.admin.getUserById(uid);
      if (data?.user?.email) ownerEmails.set(uid, data.user.email);
    }),
  );

  const outstanding = rows.filter((p) => p.status === 'pending_start' || p.status === 'due').reduce((s, p) => s + (p.fee_cents || 0), 0);

  return (
    <div className="min-h-screen bg-[#001820] p-6 md:p-10 text-white">
      <h1 className="text-3xl font-display">Recruiting placements</h1>
      <p className="mt-2 text-white/60">
        {rows.length} placement{rows.length === 1 ? '' : 's'} · {usd(outstanding)} not yet paid
      </p>

      {rows.length === 0 ? (
        <p className="mt-8 text-white/60">No placements yet.</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-white/10">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-left text-white/60">
              <tr>
                <th className="px-3 py-2 font-medium">Club</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Candidate</th>
                <th className="px-3 py-2 font-medium text-right">Fee</th>
                <th className="px-3 py-2 font-medium">Start (due)</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Guarantee until</th>
                <th className="px-3 py-2 font-medium">Invoice</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const o: any = oById.get(p.opening_id) || {};
                const c: any = cById.get(p.candidate_id) || {};
                return (
                  <tr key={p.id} className="border-t border-white/10">
                    <td className="px-3 py-2">
                      <div>{o.club_name || '—'}</div>
                      <div className="text-xs text-white/50">{ownerEmails.get(p.club_owner_id) || p.club_owner_id}</div>
                    </td>
                    <td className="px-3 py-2">{o.title || o.dept || '—'}</td>
                    <td className="px-3 py-2">
                      <div>{c.full_name || '—'}</div>
                      <div className="text-xs text-white/50">{c.email || ''}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{usd(p.fee_cents)}</td>
                    <td className="px-3 py-2">{fmt(p.start_date)}</td>
                    <td className="px-3 py-2">{p.status}</td>
                    <td className="px-3 py-2">{fmt(p.guarantee_until)}</td>
                    <td className="px-3 py-2 text-white/70">{p.invoice_ref || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
