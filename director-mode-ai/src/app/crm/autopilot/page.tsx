/**
 * /crm/autopilot — the cold-email autopilot, on one page.
 *
 * The switch, the A/B score, and every letter that is queued, shown exactly
 * as the club will read it (compose() output, signature and opt-out line
 * included), so nothing goes out that nobody could have looked at first.
 */
import Link from 'next/link';
import { requireCrmForPage } from '@/lib/crm/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { compose, replyToFor } from '@/lib/crm/compose';
import { postalAddress } from '@/lib/crm/send';
import type { Contact, Org } from '@/lib/crm/types';
import { LANE_LABEL, LANES, loadAutopilot, scoreboard, type Lane } from '@/lib/outreach/autopilot';
import { VARIANT_LABEL, type Variant } from '@/lib/outreach/variants';
import Switch from './Switch';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Autopilot', robots: { index: false, follow: false } };

type QueueRow = {
  id: string; org_id: string; contact_id: string | null; subject: string; body: string; status: string;
  kind: string; lane: Lane | null; variant: Variant | null; send_date: string; sent_at: string | null; ref: string | null;
};

export default async function AutopilotPage() {
  await requireCrmForPage('/crm/autopilot');
  const db = getSupabaseAdmin();
  const [ap, score, { data: queued }, { data: recent }] = await Promise.all([
    loadAutopilot(db),
    scoreboard(db),
    db.from('crm_outreach_queue').select('*').in('status', ['planned', 'approved']).not('variant', 'is', null).order('send_date').order('created_at').limit(30),
    db.from('crm_outreach_queue').select('*').eq('status', 'sent').not('variant', 'is', null).order('sent_at', { ascending: false }).limit(30),
  ]);
  const q = (queued as QueueRow[] | null) ?? [];
  const r = (recent as QueueRow[] | null) ?? [];

  const ids = [...new Set([...q, ...r].map((x) => x.org_id))];
  const cids = [...new Set([...q, ...r].map((x) => x.contact_id).filter(Boolean) as string[])];
  const [{ data: orgs }, { data: contacts }, { data: visits }, { data: inbound }] = await Promise.all([
    ids.length ? db.from('crm_orgs').select('*').in('id', ids) : Promise.resolve({ data: [] }),
    cids.length ? db.from('crm_contacts').select('*').in('id', cids) : Promise.resolve({ data: [] }),
    db.from('demo_visits').select('ref').not('ref', 'is', null).limit(10000),
    ids.length ? db.from('crm_inbound_emails').select('org_id').in('org_id', ids) : Promise.resolve({ data: [] }),
  ]);
  const orgBy = new Map(((orgs as Org[] | null) ?? []).map((o) => [o.id, o]));
  const contactBy = new Map(((contacts as Contact[] | null) ?? []).map((c) => [c.id, c]));
  const clicked = new Set(((visits as { ref: string }[] | null) ?? []).map((v) => v.ref));
  const replied = new Set(((inbound as { org_id: string }[] | null) ?? []).map((v) => v.org_id));

  const preview = (row: QueueRow) => {
    const org = orgBy.get(row.org_id);
    const contact = row.contact_id ? contactBy.get(row.contact_id) : undefined;
    if (!org || !contact) return null;
    return compose({
      org, contact, repName: 'ClubMode', replyTo: replyToFor('', ''),
      subject: row.subject, body: row.body, postalAddress: postalAddress(),
    });
  };

  const all = score.filter((s) => s.lane === 'all');

  return (
    <div className="min-h-screen bg-[#001820] px-4 pb-24 pt-20 text-white sm:px-6 md:pt-8">
      <div className="mx-auto max-w-[760px] space-y-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl text-white">Autopilot</h1>
            <p className="mt-1 text-sm text-white/50">
              {ap.dca_per_day} Directors Club + {ap.found_per_day} found clubs a weekday, letters A and B split evenly.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <span className={ap.auto_send ? 'text-sm font-semibold text-[#D3FB52]' : 'text-sm font-semibold text-white/50'}>
              {ap.auto_send ? 'ON' : 'OFF'}
            </span>
            <Switch on={ap.auto_send} queued={q.length} />
            <Link href="/crm" className="text-sm text-white/45 hover:text-white/70">Pipeline</Link>
          </div>
        </header>

        <section className="rounded-2xl border border-white/[0.08] bg-[#002838] p-4">
          <h2 className="font-display text-lg text-white">A vs B</h2>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-white/40">
              <tr><th className="py-1 font-medium">Letter</th><th className="font-medium">Sent</th><th className="font-medium">Opened link</th><th className="font-medium">Replied</th></tr>
            </thead>
            <tbody>
              {all.map((s) => (
                <tr key={s.variant} className="border-t border-white/[0.06]">
                  <td className="py-2 text-white/80">{VARIANT_LABEL[s.variant]}</td>
                  <td>{s.sent}</td>
                  <td>{s.clicked}</td>
                  <td>{s.replied}{s.sent ? ` (${Math.round((100 * s.replied) / s.sent)}%)` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-white/35">
            {LANES.map((l) => {
              const [a, b] = score.filter((s) => s.lane === l);
              return `${LANE_LABEL[l]}: A ${a.replied}/${a.sent}, B ${b.replied}/${b.sent}`;
            }).join(' · ')}
            . Some mail filters open links on their own, so opens can run a little high.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg text-white">
            {ap.auto_send ? 'Going out' : 'Waiting (nothing sends while it is off)'} · {q.length}
          </h2>
          <ol className="mt-3 space-y-4">
            {q.map((row) => {
              const built = preview(row);
              return (
                <li key={row.id} className="rounded-2xl border border-white/[0.08] bg-[#002838] p-4">
                  <div className="flex flex-wrap gap-x-3 text-xs text-white/45">
                    <span className="font-semibold text-[#D3FB52]">{row.kind === 'followup' ? 'Follow-up' : `Letter ${row.variant}`}</span>
                    <span>{LANE_LABEL[row.lane ?? 'dca']}</span>
                    <span>{orgBy.get(row.org_id)?.name}</span>
                    <span>{row.send_date.slice(0, 10)}</span>
                  </div>
                  {built ? (
                    <>
                      <p className="mt-2 text-sm text-white/60">To {built.to}</p>
                      <p className="text-sm font-semibold text-white">{built.subject}</p>
                      <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-white/75">{built.text}</pre>
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-red-300">The club or the person is missing.</p>
                  )}
                </li>
              );
            })}
            {!q.length && <li className="text-sm text-white/35">Nothing queued. The morning plan runs at 6am on weekdays.</li>}
          </ol>
        </section>

        <section>
          <h2 className="font-display text-lg text-white">Sent</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {r.map((row) => (
              <li key={row.id} className="flex flex-wrap gap-x-3 border-b border-white/[0.06] pb-2">
                <Link href={`/crm/${row.org_id}`} className="text-white/85 hover:underline">{orgBy.get(row.org_id)?.name}</Link>
                <span className="text-white/45">{row.kind === 'followup' ? 'follow-up' : `letter ${row.variant}`}</span>
                <span className="text-white/35">{row.sent_at?.slice(0, 10)}</span>
                {row.ref && clicked.has(row.ref) && <span className="text-[#D3FB52]">opened the link</span>}
                {replied.has(row.org_id) && <span className="text-[#D3FB52]">replied</span>}
              </li>
            ))}
            {!r.length && <li className="text-white/35">Nothing sent yet.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
