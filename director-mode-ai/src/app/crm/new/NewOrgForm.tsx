'use client';

/**
 * Add a club, then land on it.
 *
 * The paste box is here as well as on the org page: the way a rep actually
 * works is to find a club's board page, copy it, and want both the club and
 * fifteen people in one go. Pasting happens after the org exists, so a failure
 * to parse never costs them the club they just typed.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ORG_TYPES, STAGES, STAGE_LABEL } from '@/lib/crm/stages';
import type { ISODate } from '@/lib/crm/dates';
import type { Org } from '@/lib/crm/types';

const FIELD =
  'w-full rounded-lg border border-white/10 bg-[#001820] px-3 py-2 text-sm text-white focus:border-[#D3FB52]/50 focus:outline-none';
const LABEL = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/40';

export default function NewOrgForm({ repEmail, today }: { repEmail: string; today: ISODate }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    website: '',
    city: '',
    state: 'CA',
    type: 'club',
    member_count: '',
    stage: 'researching',
    source: '',
    next_step: '',
    next_step_at: '',
    demo_url: '',
    notes: '',
  });
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/crm/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          owner_email: repEmail,
          member_count: form.member_count ? Number(form.member_count) : null,
          next_step_at: form.next_step_at || null,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { org?: Org; error?: string };
      if (!res.ok || !j.org) {
        setError(j.error || 'Could not add it.');
        return;
      }
      // Contacts second, and a failure here is survivable: the club is saved,
      // and the same box is on the page we are about to land on.
      if (paste.trim()) {
        await fetch(`/api/crm/orgs/${j.org.id}/contacts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paste }),
        }).catch(() => {});
      }
      router.push(`/crm/${j.org.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <div>
        <label className={LABEL} htmlFor="name">
          Club name
        </label>
        <input id="name" value={form.name} onChange={set('name')} placeholder="Rossmoor Tennis Club" className={FIELD} autoFocus />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="website">
            Website
          </label>
          <input id="website" value={form.website} onChange={set('website')} placeholder="https://…" className={FIELD} />
        </div>
        <div>
          <label className={LABEL} htmlFor="source">
            How we found them
          </label>
          <input id="source" value={form.source} onChange={set('source')} className={FIELD} />
        </div>
        <div>
          <label className={LABEL} htmlFor="city">
            City
          </label>
          <input id="city" value={form.city} onChange={set('city')} className={FIELD} />
        </div>
        <div>
          <label className={LABEL} htmlFor="state">
            State
          </label>
          <input id="state" value={form.state} onChange={set('state')} className={FIELD} />
        </div>
        <div>
          <label className={LABEL} htmlFor="members">
            Members
          </label>
          <input id="members" inputMode="numeric" value={form.member_count} onChange={set('member_count')} className={FIELD} />
        </div>
        <div>
          <label className={LABEL} htmlFor="type">
            Type
          </label>
          <select id="type" value={form.type} onChange={set('type')} className={FIELD}>
            {ORG_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="stage">
            Stage
          </label>
          <select id="stage" value={form.stage} onChange={set('stage')} className={FIELD}>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="next_at">
            Next step by
          </label>
          <input id="next_at" type="date" min={today} value={form.next_step_at} onChange={set('next_step_at')} className={FIELD} />
        </div>
      </div>

      <div>
        <label className={LABEL} htmlFor="next">
          Next step
        </label>
        <input id="next" value={form.next_step} onChange={set('next_step')} placeholder="Who does what, next" className={FIELD} />
      </div>

      <div>
        <label className={LABEL} htmlFor="notes">
          Notes
        </label>
        <textarea id="notes" rows={5} value={form.notes} onChange={set('notes')} className={FIELD} />
      </div>

      <div>
        <label className={LABEL} htmlFor="paste">
          Paste their board (optional)
        </label>
        <p className="mb-2 text-xs text-white/40">
          One person per line: name, then email, separated by a tab or two spaces. A title in between
          is kept.
        </p>
        <textarea
          id="paste"
          rows={6}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={'Mary Benin\tPresident\tmary.benin@gmail.com'}
          className={`${FIELD} font-mono text-xs`}
        />
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      <button
        type="button"
        disabled={busy || !form.name.trim()}
        onClick={submit}
        className="rounded-lg bg-[#D3FB52] px-5 py-2.5 text-sm font-semibold text-[#001820] disabled:opacity-40"
      >
        {busy ? 'Adding…' : 'Add it'}
      </button>
    </div>
  );
}
