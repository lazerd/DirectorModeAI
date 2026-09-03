'use client';

/**
 * /club/people — everyone at the club, in one place.
 *
 * Replaces "invite them with the shared code, then go find them somewhere else
 * and promote them". A director invites a person by email AS the role they
 * actually are, sees who has accepted, and sees which pros are stuck partway
 * through setting up their booking page.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Loader2, Mail, ShieldCheck, UserPlus, X } from 'lucide-react';

const INPUT: React.CSSProperties = { color: '#0f172a', backgroundColor: '#ffffff' };

type Person = {
  user_id: string;
  name: string;
  role: string;
  role_label: string;
  joined_at: string;
  booking_page: { connected: boolean; live: boolean } | null;
  captainmode: 'none' | 'comped' | 'paying' | 'active';
};
type Invite = {
  id: string;
  email: string;
  role: string;
  invited_name: string | null;
  created_at: string;
  expires_at: string;
};
type Captain = {
  user_id: string;
  name: string;
  captain_role: string;
  teams: string[];
  in_club: boolean;
  captainmode: 'none' | 'comped' | 'paying' | 'active';
};
type Payload = {
  captains: Captain[];
  club: { id: string; name: string };
  invitable_roles: string[];
  people: Person[];
  invites: Invite[];
};

const ROLE_HELP: Record<string, string> = {
  director: 'Runs the club with you — every tool, and can invite people.',
  coach: 'Teaches. Gets a lesson booking page members can book.',
  front_desk: 'Staff access to courts and bookings, no teaching page.',
  member: 'Books courts, signs up for events. No staff access.',
};

export default function ClubPeoplePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('coach');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/clubs/invites', { cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(j.error || 'Could not load your club.');
      setLoading(false);
      return;
    }
    setData(j as Payload);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const invite = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const res = await fetch('/api/clubs/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, role, note }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(j.error || 'Could not send that invitation.');
      return;
    }
    setMsg(
      j.emailed
        ? `Invitation emailed to ${email}.`
        : `Invitation created — email didn't send, so copy the link below and send it yourself.`,
    );
    setEmail('');
    setName('');
    setNote('');
    await load();
  };

  const setRoleFor = async (userId: string, newRole: string, who: string) => {
    setBusy(true);
    setErr(null);
    const res = await fetch('/api/clubs/invites', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, role: newRole }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr((await res.json().catch(() => ({}))).error || 'Could not change that role.');
      return;
    }
    setMsg(`${who} is now ${newRole === 'front_desk' ? 'front desk' : newRole}.`);
    await load();
  };

  /**
   * Give a captain the product for nothing. Their own club paying for them is
   * the normal case at a club that runs its own leagues.
   */
  const comp = async (userId: string, on: boolean, who: string) => {
    setBusy(true);
    setErr(null);
    const res = await fetch('/api/captain/comp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, on }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(j.error || 'Could not change that.');
      return;
    }
    setMsg(on ? `${who} has CaptainMode, on the club.` : `${who}'s comp removed.`);
    await load();
  };

  /** Fold a captain into the club's member list properly. */
  const addToClub = async (userId: string, who: string) => {
    setBusy(true);
    setErr(null);
    const res = await fetch('/api/clubs/invites', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, role: 'member', add: true }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr((await res.json().catch(() => ({}))).error || 'Could not add them.');
      return;
    }
    setMsg(`${who} added to the club.`);
    await load();
  };

  const revoke = async (id: string, who: string) => {
    setBusy(true);
    const res = await fetch(`/api/clubs/invites?invite_id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    setBusy(false);
    if (res.ok) {
      setMsg(`Invitation to ${who} withdrawn.`);
      await load();
    }
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <p className="flex items-center gap-2 text-white/50">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </p>
      </div>
    );
  }
  if (!data) return <div className="p-6 text-red-300 lg:p-8">{err}</div>;

  const staff = data.people.filter((p) => p.role !== 'member');
  const members = data.people.filter((p) => p.role === 'member');

  return (
    <div className="p-5 lg:p-8">
      <div className="max-w-3xl">
        <h1 className="font-display text-3xl text-white">People at {data.club.name}</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-white/50">
          Invite someone as what they actually are. A pro invited as a coach arrives set up to take
          bookings — no shared code, no promoting them afterwards.
        </p>

        {/* ------------------------------------------------------------ invite */}
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-[#002838] p-5">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold text-white">
            <UserPlus size={17} /> Invite someone
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Their name (optional)"
              style={INPUT}
              className="rounded-lg border border-white/10 px-3 py-2.5 text-[15px] outline-none focus:border-[#D3FB52]/50"
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="their@email.com"
              type="email"
              style={INPUT}
              className="rounded-lg border border-white/10 px-3 py-2.5 text-[15px] outline-none focus:border-[#D3FB52]/50"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.invitable_roles.map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={`rounded-xl border px-3.5 py-2 text-[14px] font-semibold transition-colors ${
                  role === r
                    ? 'border-[#D3FB52] bg-[#D3FB52] text-[#001820]'
                    : 'border-white/15 text-white/70 hover:border-white/40'
                }`}
              >
                {r === 'front_desk' ? 'Front desk' : r.charAt(0).toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[12.5px] text-white/40">{ROLE_HELP[role]}</p>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="A line for the email (optional) — e.g. “Great to have you on the team”"
            style={INPUT}
            className="mt-2 w-full rounded-lg border border-white/10 px-3 py-2.5 text-[15px] outline-none focus:border-[#D3FB52]/50"
          />
          <button
            onClick={invite}
            disabled={busy || !email.trim()}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#D3FB52] px-5 py-2.5 text-[14.5px] font-semibold text-[#001820] disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Mail size={15} />}
            Send invitation
          </button>
        </div>

        {/* ---------------------------------------------------------- pending */}
        {data.invites.length > 0 && (
          <div className="mt-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-white/30">
              Invited, not yet accepted
            </h2>
            <div className="mt-2 space-y-2">
              {data.invites.map((i) => (
                <div
                  key={i.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.07] bg-[#002838] px-4 py-3"
                >
                  <span className="text-[14.5px] text-white">{i.invited_name || i.email}</span>
                  {i.invited_name && <span className="text-[12.5px] text-white/40">{i.email}</span>}
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[12px] text-white/60">
                    {i.role === 'front_desk' ? 'front desk' : i.role}
                  </span>
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(`${window.location.origin}/invite/`);
                      setCopied(i.id);
                      setTimeout(() => setCopied(null), 1500);
                    }}
                    className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] text-white/40 hover:text-white"
                    title="The invitation link was emailed to them"
                  >
                    {copied === i.id ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                  <button
                    onClick={() => revoke(i.id, i.invited_name || i.email)}
                    className="inline-flex items-center gap-1 text-[12.5px] text-white/40 hover:text-red-300"
                  >
                    <X size={13} /> Withdraw
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- staff */}
        <PeopleList
          title="Staff"
          people={staff}
          roles={data.invitable_roles}
          onRole={setRoleFor}
          onComp={comp}
          busy={busy}
          emptyNote="Nobody but you yet — invite your pros above."
        />

        <PeopleList
          title={`Members (${members.length})`}
          people={members}
          roles={data.invitable_roles}
          onRole={setRoleFor}
          onComp={comp}
          busy={busy}
          emptyNote="No members yet. Share your club join link and they'll appear here."
        />

        {/* --------------------------------------------------------- captains */}
        {data.captains?.length > 0 && (
          <div className="mt-7">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-white/30">
              Captains (CaptainMode)
            </h2>
            <p className="mt-1 text-[13px] text-white/40">
              People running your club&apos;s league teams. CaptainMode has its own roster, so they
              can be here without being in your member list.
            </p>
            <div className="mt-2 space-y-2">
              {data.captains.map((c) => (
                <div
                  key={c.user_id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.07] bg-[#002838] px-4 py-3"
                >
                  <span className="text-[15px] font-medium text-white">{c.name}</span>
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[12px] text-white/60">
                    {c.captain_role}
                  </span>
                  {c.teams.length > 0 && (
                    <span className="text-[12.5px] text-white/40">{c.teams.join(', ')}</span>
                  )}
                  {!c.in_club && (
                    <button
                      onClick={() => addToClub(c.user_id, c.name)}
                      disabled={busy}
                      className="rounded-lg border border-white/15 px-2.5 py-1 text-[12.5px] text-white/60 hover:border-[#D3FB52]/50 hover:text-white disabled:opacity-50"
                    >
                      Add to club
                    </button>
                  )}
                  {c.captainmode === 'paying' ? (
                    <span className="ml-auto text-[12.5px] text-white/40">CaptainMode · paying</span>
                  ) : c.captainmode === 'comped' ? (
                    <button
                      onClick={() => comp(c.user_id, false, c.name)}
                      disabled={busy}
                      className="ml-auto text-[12.5px] text-[#D3FB52] hover:underline disabled:opacity-50"
                    >
                      CaptainMode · comped ✕
                    </button>
                  ) : (
                    <button
                      onClick={() => comp(c.user_id, true, c.name)}
                      disabled={busy}
                      className="ml-auto rounded-lg border border-white/15 px-2.5 py-1 text-[12.5px] text-white/50 hover:border-[#D3FB52]/50 hover:text-white disabled:opacity-50"
                    >
                      Comp CaptainMode
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {msg && <p className="mt-4 rounded-xl bg-[#D3FB52]/10 p-3 text-[14px] text-[#D3FB52]">{msg}</p>}
        {err && <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-[14px] text-red-200">{err}</p>}
      </div>
    </div>
  );
}

function PeopleList({
  title,
  people,
  roles,
  onRole,
  onComp,
  busy,
  emptyNote,
}: {
  title: string;
  people: Person[];
  roles: string[];
  onRole: (userId: string, role: string, who: string) => void;
  onComp: (userId: string, on: boolean, who: string) => void;
  busy: boolean;
  emptyNote: string;
}) {
  return (
    <div className="mt-7">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-white/30">{title}</h2>
      {!people.length ? (
        <p className="mt-2 text-[14px] text-white/40">{emptyNote}</p>
      ) : (
        <div className="mt-2 space-y-2">
          {people.map((p) => (
            <div
              key={p.user_id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.07] bg-[#002838] px-4 py-3"
            >
              <span className="text-[15px] font-medium text-white">{p.name}</span>
              {p.role === 'owner' ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-[#D3FB52]/40 px-2 py-0.5 text-[12px] text-[#D3FB52]">
                  <ShieldCheck size={12} /> Owner
                </span>
              ) : (
                <select
                  value={p.role}
                  onChange={(e) => onRole(p.user_id, e.target.value, p.name)}
                  disabled={busy}
                  style={{ color: '#fff', backgroundColor: '#001820' }}
                  className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[13px] focus:border-[#D3FB52]/50 focus:outline-none"
                >
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {r === 'front_desk' ? 'Front desk' : r.charAt(0).toUpperCase() + r.slice(1)}
                    </option>
                  ))}
                </select>
              )}

              {/* CaptainMode is billed per captain, so it is given here. */}
              {p.captainmode === 'paying' ? (
                <span className="text-[12.5px] text-white/40">CaptainMode · paying</span>
              ) : p.captainmode === 'comped' ? (
                <button
                  onClick={() => onComp(p.user_id, false, p.name)}
                  disabled={busy}
                  className="text-[12.5px] text-[#D3FB52] hover:underline disabled:opacity-50"
                  title="Remove the comp"
                >
                  CaptainMode · comped ✕
                </button>
              ) : (
                <button
                  onClick={() => onComp(p.user_id, true, p.name)}
                  disabled={busy}
                  className="rounded-lg border border-white/15 px-2.5 py-1 text-[12.5px] text-white/50 hover:border-[#D3FB52]/50 hover:text-white disabled:opacity-50"
                >
                  Comp CaptainMode
                </button>
              )}

              {/* How far a pro has actually got. */}
              {p.booking_page && (
                <span
                  className={`text-[12.5px] ${
                    p.booking_page.live
                      ? 'text-emerald-300'
                      : p.booking_page.connected
                        ? 'text-amber-300'
                        : 'text-white/35'
                  }`}
                >
                  {p.booking_page.live
                    ? 'booking page live'
                    : p.booking_page.connected
                      ? 'calendar connected, page off'
                      : 'no calendar yet'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
