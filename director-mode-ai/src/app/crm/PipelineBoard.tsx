'use client';

/**
 * The board, and the list that is the same thing on a phone.
 *
 * Eight columns do not fit on a 430px screen, and the reps are usually on one.
 * Rather than build a board that degrades into a column of columns, the list
 * is a first-class view: one row per club, sorted by what is most urgent, with
 * the same facts. It defaults to the list on a narrow screen and remembers
 * whichever the rep picked after that.
 *
 * Read-only on purpose. Dragging cards between columns is the feature every
 * CRM has and nobody uses twice; the stage control lives on the org page, next
 * to the note explaining why it moved.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ageLabel, isOverdue, shortDate, type ISODate } from '@/lib/crm/dates';
import { initialsFor } from '@/lib/crm/access';
import { CLOSED_STAGES, STAGE_LABEL, type Stage } from '@/lib/crm/stages';
import type { OrgCard } from '@/lib/crm/types';

const VIEW_KEY = 'crm:view';

/**
 * Whose deal it is, in two characters.
 *
 * Looked up against the allowlist rather than derived from the address: the
 * fallback turns darrinjco@gmail.com into "DA", which is nobody's initials.
 */
function Initials({ email, reps }: { email: string | null; reps: Rep[] }) {
  if (!email) return null;
  const rep = reps.find((r) => r.email.toLowerCase() === email.toLowerCase()) ?? null;
  return (
    <span
      title={rep?.full_name || email}
      className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] font-semibold text-white/70"
    >
      {initialsFor(rep ? { ...rep, email } : { full_name: null, email })}
    </span>
  );
}

/** Next step + date, red once the date has passed. */
function NextStep({ org, today }: { org: OrgCard; today: ISODate }) {
  if (!org.next_step) {
    return <span className="text-white/30">No next step</span>;
  }
  const late = isOverdue(org.next_step_at, today) && !CLOSED_STAGES.includes(org.stage);
  const when = shortDate(org.next_step_at, today);
  return (
    <span className={late ? 'text-red-300' : 'text-white/60'}>
      {org.next_step}
      {when && <span className={late ? ' font-semibold' : ' text-white/40'}> · {when}</span>}
    </span>
  );
}

function Card({ org, today, reps }: { org: OrgCard; today: ISODate; reps: Rep[] }) {
  const age = ageLabel(org.last_activity_at, today);
  return (
    <Link
      href={`/crm/${org.id}`}
      className="block rounded-xl border border-white/[0.08] bg-[#002838] p-3 hover:border-[#D3FB52]/30"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold leading-tight text-white">{org.name}</span>
        <Initials email={org.owner_email} reps={reps} />
      </div>
      <div className="mt-2 text-xs leading-snug">
        <NextStep org={org} today={today} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/35">
        {org.member_count != null && <span>{org.member_count.toLocaleString('en-US')} members</span>}
        {age && <span>Last touch {age}</span>}
      </div>
    </Link>
  );
}

export type Rep = { email: string; full_name: string | null; initials: string | null };

export default function PipelineBoard({
  orgs,
  reps,
  today,
  byStage,
}: {
  orgs: OrgCard[];
  reps: Rep[];
  today: ISODate;
  byStage: { stage: Stage; count: number }[];
}) {
  // null until mounted, so the server HTML and the first client render agree
  // and React does not warn about a mismatch.
  const [view, setView] = useState<'board' | 'list' | null>(null);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(VIEW_KEY);
    } catch {
      // Private browsing, blocked storage — the width rule below still works.
    }
    if (saved === 'board' || saved === 'list') setView(saved);
    else setView(window.innerWidth < 900 ? 'list' : 'board');
  }, []);

  function pick(next: 'board' | 'list') {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Not remembering the choice is survivable; failing to switch is not.
    }
  }

  /** Most urgent first: overdue, then soonest due, then no plan at all. */
  const sorted = [...orgs].sort((a, b) => {
    const ac = CLOSED_STAGES.includes(a.stage) ? 1 : 0;
    const bc = CLOSED_STAGES.includes(b.stage) ? 1 : 0;
    if (ac !== bc) return ac - bc;
    const ad = a.next_step_at ?? '9999-12-31';
    const bd = b.next_step_at ?? '9999-12-31';
    if (ad !== bd) return ad.localeCompare(bd);
    return a.name.localeCompare(b.name);
  });

  const toggle = (
    <div className="inline-flex rounded-lg border border-white/10 p-1" role="radiogroup" aria-label="View">
      {(['board', 'list'] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={view === v}
          onClick={() => pick(v)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize ${
            view === v ? 'bg-[#D3FB52] text-[#001820]' : 'text-white/60 hover:text-white'
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );

  if (view === null) return <div className="h-40" aria-hidden />;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/35">
          {byStage
            .filter((s) => s.count > 0)
            .map((s) => (
              <span key={s.stage}>
                {STAGE_LABEL[s.stage]} {s.count}
              </span>
            ))}
        </div>
        {toggle}
      </div>

      {view === 'board' ? (
        // One horizontal scroller rather than a wrapping grid: a column that
        // wraps under another column stops being a column.
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
          <div className="flex gap-3">
            {byStage.map(({ stage }) => {
              const list = sorted.filter((o) => o.stage === stage);
              return (
                <section key={stage} className="w-[240px] shrink-0">
                  <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                    {STAGE_LABEL[stage]}
                    <span className="ml-1.5 text-white/25">{list.length}</span>
                  </h2>
                  <div className="space-y-2">
                    {list.map((o) => (
                      <Card key={o.id} org={o} today={today} reps={reps} />
                    ))}
                    {list.length === 0 && (
                      <div className="rounded-xl border border-dashed border-white/[0.06] p-3 text-[11px] text-white/20">
                        —
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.08] bg-[#002838]">
          {sorted.map((o) => {
            const age = ageLabel(o.last_activity_at, today);
            return (
              <li key={o.id}>
                <Link href={`/crm/${o.id}`} className="block px-3 py-3 hover:bg-white/[0.03]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-white">{o.name}</span>
                        <span className="shrink-0 rounded bg-white/[0.07] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/50">
                          {STAGE_LABEL[o.stage]}
                        </span>
                      </div>
                      <div className="mt-1 text-xs leading-snug">
                        <NextStep org={o} today={today} />
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-white/35">
                        {o.member_count != null && <span>{o.member_count.toLocaleString('en-US')} members</span>}
                        {age && <span>Last touch {age}</span>}
                      </div>
                    </div>
                    <Initials email={o.owner_email} reps={reps} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
