'use client';

/**
 * Editing the format.
 *
 * Built on the assumption that none of the proposal's numbers are settled.
 * Twelve teams, three divisions, nine a roster, a 5.0 floor, one singles and
 * one doubles — every one of those is a thing a section committee will want to
 * change, and none of them should require a developer.
 *
 * The one place this screen says no is draft order. Once picks exist, adding or
 * removing a team renumbers the snake and hands picks to the wrong people, so
 * those controls disable themselves and explain why rather than failing on save.
 */

import { useState } from 'react';
import { toast } from 'sonner';

export type SeasonSettings = {
  id: string;
  name: string;
  status: string;
  category: string;
  rosterSize: number;
  pickSeconds: number;
  courtsPerDivision: number;
  entryDollars: number;
  ratingFloor: number | null;
  defaultSiteName: string | null;
  blurb: string | null;
};

export type DivisionRow = {
  id: string;
  name: string;
  shortCode: string;
  tier: number;
  nightlyDollars: number;
  finalsDollars: number;
  dayOfWeek: number | null;
  startTime: string | null;
  endTime: string | null;
  singlesLines: number;
  doublesLines: number;
  nightCount: number;
};

export type TeamRow = {
  id: string;
  name: string;
  shortCode: string;
  color: string | null;
  draftSlot: number | null;
  captainName: string | null;
  captainEmail: string | null;
  captainIsPlaying: boolean;
  rosterCount: number;
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CATEGORIES: Array<[string, string]> = [
  ['open', 'Open'],
  ['mens', "Men's"],
  ['womens', "Women's"],
  ['mixed', 'Mixed'],
];

const INPUT =
  'w-full rounded-sm border border-white/15 bg-white/[0.04] px-3 py-2.5 text-white placeholder:text-white/30 focus:border-teal-400/70 focus:outline-none';

export default function SettingsEditor({
  season,
  divisions,
  teams,
  draftStarted,
}: {
  season: SeasonSettings;
  divisions: DivisionRow[];
  teams: TeamRow[];
  draftStarted: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function send(payload: Record<string, unknown>, key: string, okMsg: string) {
    setBusy(key);
    try {
      const res = await fetch('/api/ptl/admin/season', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seasonId: season.id, ...payload }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || 'That did not save.');
        return false;
      }
      toast.success(okMsg);
      window.location.reload();
      return true;
    } catch {
      toast.error('Lost the connection.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-14">
      {/* ================= format ================= */}
      <section>
        <h2 className="text-xl font-black tracking-tight">Format</h2>
        <p className="mt-1 text-sm text-white/50">
          Nothing here is fixed. Change it as the pilot takes shape.
        </p>

        <form
          className="mt-6 grid gap-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const floorRaw = String(f.get('ratingFloor') || '').trim();
            send(
              {
                action: 'season',
                name: f.get('name'),
                category: f.get('category'),
                status: f.get('status'),
                rosterSize: f.get('rosterSize'),
                pickSeconds: f.get('pickSeconds'),
                courtsPerDivision: f.get('courts'),
                entryDollars: f.get('entry'),
                ratingFloor: floorRaw === '' ? null : floorRaw,
                defaultSiteName: f.get('site'),
              },
              'season',
              'Format saved.',
            );
          }}
        >
          <Field id="s-name" label="Season name">
            <input id="s-name" name="name" defaultValue={season.name} className={INPUT} />
          </Field>

          <Field id="s-cat" label="Category" hint="Men's, women's, mixed, or open to all.">
            <select id="s-cat" name="category" defaultValue={season.category} className={INPUT}>
              {CATEGORIES.map(([v, label]) => (
                <option key={v} value={v} className="bg-[#0B0F14]">
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field id="s-roster" label="Players per team" hint="Also the number of draft rounds.">
            <input
              id="s-roster"
              name="rosterSize"
              type="number"
              min={2}
              max={30}
              defaultValue={season.rosterSize}
              className={INPUT}
            />
          </Field>

          <Field id="s-floor" label="Rating floor (NTRP)" hint="Leave blank for no floor at all.">
            <input
              id="s-floor"
              name="ratingFloor"
              type="number"
              step="0.5"
              min={1}
              max={7}
              defaultValue={season.ratingFloor ?? ''}
              className={INPUT}
            />
          </Field>

          <Field id="s-courts" label="Courts per division">
            <input
              id="s-courts"
              name="courts"
              type="number"
              min={1}
              max={20}
              defaultValue={season.courtsPerDivision}
              className={INPUT}
            />
          </Field>

          <Field id="s-entry" label="Entry fee ($)">
            <input
              id="s-entry"
              name="entry"
              type="number"
              min={0}
              max={1000}
              defaultValue={season.entryDollars}
              className={INPUT}
            />
          </Field>

          <Field id="s-clock" label="Pick clock (seconds)" hint="How long a captain has on the clock.">
            <input
              id="s-clock"
              name="pickSeconds"
              type="number"
              min={15}
              max={3600}
              defaultValue={season.pickSeconds}
              className={INPUT}
            />
          </Field>

          <Field id="s-status" label="Status" hint="Enrolment only opens on 'enrolling'.">
            <select id="s-status" name="status" defaultValue={season.status} className={INPUT}>
              {['draft', 'enrolling', 'drafting', 'running', 'complete', 'archived'].map((v) => (
                <option key={v} value={v} className="bg-[#0B0F14]">
                  {v}
                </option>
              ))}
            </select>
          </Field>

          <div className="sm:col-span-2">
            <Field id="s-site" label="Default venue" hint="Used when a new night is created.">
              <input
                id="s-site"
                name="site"
                defaultValue={season.defaultSiteName ?? ''}
                placeholder="Sleepy Hollow Swim & Tennis Club"
                className={INPUT}
              />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={busy === 'season'}
              className="rounded-sm bg-teal-400 px-6 py-3 font-bold text-[#06231F] transition-colors hover:bg-teal-300 disabled:bg-white/10 disabled:text-white/35"
            >
              {busy === 'season' ? 'Saving…' : 'Save format'}
            </button>
          </div>
        </form>
      </section>

      {/* ================= divisions ================= */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-xl font-black tracking-tight">
            Divisions <span className="text-white/40">({divisions.length})</span>
          </h2>
          <p className="text-sm text-white/50">Tier 1 is the top. Add or remove as many as you like.</p>
        </div>

        <div className="mt-6 space-y-4">
          {divisions.map((d) => (
            <DivisionForm key={d.id} division={d} busy={busy} send={send} />
          ))}
          <DivisionForm
            key="new"
            division={{
              id: '',
              name: '',
              shortCode: '',
              tier: divisions.length + 1,
              nightlyDollars: 0,
              finalsDollars: 0,
              dayOfWeek: null,
              startTime: '18:00',
              endTime: '21:00',
              singlesLines: 1,
              doublesLines: 1,
              nightCount: 0,
            }}
            busy={busy}
            send={send}
          />
        </div>
      </section>

      {/* ================= teams ================= */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-xl font-black tracking-tight">
            Teams <span className="text-white/40">({teams.length})</span>
          </h2>
          <p className="text-sm text-white/50">
            {teams.length} teams &times; {season.rosterSize} = {teams.length * season.rosterSize}{' '}
            players needed
          </p>
        </div>

        {draftStarted && (
          <p className="mt-4 rounded-sm border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            The draft has started, so the team list and draft order are locked — changing either
            would renumber every pick. Undo the picks first if you need to.
          </p>
        )}

        <div className="mt-6 space-y-3">
          {teams.map((t) => (
            <TeamForm key={t.id} team={t} busy={busy} send={send} locked={draftStarted} />
          ))}
          {!draftStarted && (
            <TeamForm
              key="new"
              team={{
                id: '',
                name: '',
                shortCode: '',
                color: '#0f766e',
                draftSlot: teams.length + 1,
                captainName: '',
                captainEmail: '',
                captainIsPlaying: true,
                rosterCount: 0,
              }}
              busy={busy}
              send={send}
              locked={false}
            />
          )}
        </div>
      </section>
    </div>
  );
}

type Send = (p: Record<string, unknown>, key: string, ok: string) => Promise<boolean>;

function DivisionForm({
  division: d,
  busy,
  send,
}: {
  division: DivisionRow;
  busy: string | null;
  send: Send;
}) {
  const isNew = !d.id;
  const key = `div:${d.id || 'new'}`;
  return (
    <form
      className={`rounded-sm border p-4 ${isNew ? 'border-dashed border-white/20' : 'border-white/10 bg-white/[0.02]'}`}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        send(
          {
            action: 'division-save',
            id: d.id || null,
            name: f.get('name'),
            shortCode: f.get('code'),
            tier: f.get('tier'),
            nightlyDollars: f.get('nightly'),
            finalsDollars: f.get('finals'),
            dayOfWeek: f.get('day'),
            startTime: f.get('start'),
            endTime: f.get('end'),
            singlesLines: f.get('singles'),
            doublesLines: f.get('doubles'),
          },
          key,
          isNew ? 'Division added.' : 'Division saved.',
        );
      }}
    >
      {isNew && (
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
          Add a division
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input name="name" defaultValue={d.name} placeholder="Premier" required className={INPUT} aria-label="Division name" />
        <input name="code" defaultValue={d.shortCode} placeholder="PREM" required className={INPUT} aria-label="Short code" />
        <input name="tier" type="number" min={1} defaultValue={d.tier} required className={INPUT} aria-label="Tier" />
        <select name="day" defaultValue={d.dayOfWeek ?? ''} className={INPUT} aria-label="Day of week">
          <option value="" className="bg-[#0B0F14]">Day TBD</option>
          {DAYS.map((label, i) => (
            <option key={i} value={i} className="bg-[#0B0F14]">{label}</option>
          ))}
        </select>
        <input name="start" type="time" defaultValue={d.startTime?.slice(0, 5) ?? ''} className={INPUT} aria-label="Start time" />
        <input name="end" type="time" defaultValue={d.endTime?.slice(0, 5) ?? ''} className={INPUT} aria-label="End time" />
        <input name="nightly" type="number" min={0} defaultValue={d.nightlyDollars} className={INPUT} aria-label="Nightly prize, dollars" />
        <input name="finals" type="number" min={0} defaultValue={d.finalsDollars} className={INPUT} aria-label="Finals prize, dollars" />
        <input name="singles" type="number" min={0} max={6} defaultValue={d.singlesLines} className={INPUT} aria-label="Singles lines per meeting" />
        <input name="doubles" type="number" min={0} max={6} defaultValue={d.doublesLines} className={INPUT} aria-label="Doubles lines per meeting" />
      </div>
      <p className="mt-2 text-[11px] text-white/35">
        name · code · tier · day · start · end · nightly $ · finals $ · singles lines · doubles lines
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={busy === key}
          className="rounded-sm bg-teal-400 px-4 py-2 text-sm font-bold text-[#06231F] hover:bg-teal-300 disabled:bg-white/10 disabled:text-white/35"
        >
          {busy === key ? '…' : isNew ? 'Add division' : 'Save'}
        </button>
        {!isNew && (
          <button
            type="button"
            onClick={() => {
              if (confirm(`Delete ${d.name}?`)) send({ action: 'division-delete', id: d.id }, key, 'Division deleted.');
            }}
            className="rounded-sm border border-white/20 px-4 py-2 text-sm text-white/60 hover:border-red-400/60 hover:text-red-300"
          >
            Delete
          </button>
        )}
        {!isNew && d.nightCount > 0 && (
          <span className="self-center text-xs text-white/35">{d.nightCount} nights scheduled</span>
        )}
      </div>
    </form>
  );
}

function TeamForm({
  team: t,
  busy,
  send,
  locked,
}: {
  team: TeamRow;
  busy: string | null;
  send: Send;
  locked: boolean;
}) {
  const isNew = !t.id;
  const key = `team:${t.id || 'new'}`;
  return (
    <form
      className={`rounded-sm border p-4 ${isNew ? 'border-dashed border-white/20' : 'border-white/10 bg-white/[0.02]'}`}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        send(
          {
            action: 'team-save',
            id: t.id || null,
            name: f.get('name'),
            shortCode: f.get('code'),
            color: f.get('color'),
            draftSlot: f.get('slot'),
            captainName: f.get('captain'),
            captainEmail: f.get('email'),
            captainIsPlaying: f.get('playing') === 'on',
          },
          key,
          isNew ? 'Team added.' : 'Team saved.',
        );
      }}
    >
      {isNew && (
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-white/40">Add a team</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input name="name" defaultValue={t.name} placeholder="Ironwood" required className={INPUT} aria-label="Team name" />
        <input name="code" defaultValue={t.shortCode} placeholder="IRN" required className={INPUT} aria-label="Short code" />
        <input name="slot" type="number" min={1} defaultValue={t.draftSlot ?? ''} disabled={locked} className={INPUT} aria-label="Draft slot" />
        <input name="color" type="color" defaultValue={t.color || '#0f766e'} className="h-[46px] w-full rounded-sm border border-white/15 bg-white/[0.04] px-2" aria-label="Team colour" />
        <input name="captain" defaultValue={t.captainName ?? ''} placeholder="Captain name" className={INPUT} aria-label="Captain name" />
        <input name="email" type="email" defaultValue={t.captainEmail ?? ''} placeholder="captain@club.com" className={INPUT} aria-label="Captain email" />
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input name="playing" type="checkbox" defaultChecked={t.captainIsPlaying} className="h-4 w-4" />
          Playing captain
          <span className="text-xs text-white/35">(protects 1, not 2)</span>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={busy === key}
          className="rounded-sm bg-teal-400 px-4 py-2 text-sm font-bold text-[#06231F] hover:bg-teal-300 disabled:bg-white/10 disabled:text-white/35"
        >
          {busy === key ? '…' : isNew ? 'Add team' : 'Save'}
        </button>
        {!isNew && !locked && (
          <button
            type="button"
            onClick={() => {
              if (confirm(`Delete ${t.name}?`)) send({ action: 'team-delete', id: t.id }, key, 'Team deleted.');
            }}
            className="rounded-sm border border-white/20 px-4 py-2 text-sm text-white/60 hover:border-red-400/60 hover:text-red-300"
          >
            Delete
          </button>
        )}
        {!isNew && t.rosterCount > 0 && (
          <span className="self-center text-xs text-white/35">{t.rosterCount} drafted</span>
        )}
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {/* text-white is required: globals.css sets a dark `label` colour for the
          app's light surfaces, which is invisible on this ground. */}
      <label htmlFor={id} className="block text-sm font-semibold text-white">
        {label}
      </label>
      {hint && <p className="mb-2 mt-0.5 text-xs text-white/40">{hint}</p>}
      <div className={hint ? '' : 'mt-2'}>{children}</div>
    </div>
  );
}
