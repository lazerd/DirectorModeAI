'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Mail, Trash2, Users, X } from 'lucide-react';
import type { PlayEvent } from '@/lib/play/core';
import { C, PlayHeader, api, getClub, getHostId } from './shared';
import { createClient } from '@/lib/supabase/client';

/**
 * Racquets IRL Groups (client). Hosts never need an account to run a game; only saving
 * a group asks for a passwordless email link. Players opt in to email when they join.
 */

export type Member = { id: string; name: string; email: string | null; opted_in: boolean; unsubscribed_at: string | null; emailable: boolean };
export type Group = { id: string; name: string; sport: string | null; level: string | null; members: Member[]; emailable: number };
type Usage = { used: number; limit: number; remaining: number; enforced: boolean };
type GroupsRes = { user: { email: string | null } | null; groups: Group[]; usage?: Usage };

export function useGroups() {
  const [data, setData] = useState<GroupsRes | null>(null);
  const reload = useCallback(async () => {
    try { setData(await api<GroupsRes>('/api/p/groups')); } catch { setData({ user: null, groups: [] }); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { data, reload };
}

/** Passwordless sign-in: one email field, a link comes back to `next`. */
export function SignInBox({ next, why, onCancel }: { next: string; why: string; onCancel?: () => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { await api('/api/p/groups/signin', { email: email.trim(), next }); setSent(true); }
    catch (x) { setErr(x instanceof Error ? x.message : 'Could not send it'); }
    finally { setBusy(false); }
  };
  if (sent) return (
    <div className="rounded-2xl p-4 text-[14px]" style={{ background: C.lime }}>
      <b>Check your email.</b> Tap the link in it and you&apos;ll land back here, signed in. Open it on this phone so your host controls are still here.
    </div>
  );
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[14px]">{why} <span style={{ color: C.muted }}>No password: we email you a link.</span></p>
        {onCancel && <button aria-label="Cancel" onClick={onCancel}><X className="h-4 w-4" /></button>}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(x) => { x.preventDefault(); go(); }}>
        <input type="email" value={email} onChange={(x) => setEmail(x.target.value)} placeholder="you@email.com" aria-label="Your email" autoComplete="email"
          className="min-w-0 flex-1 rounded-xl border bg-white px-3 py-3 text-[16px] outline-none" style={{ borderColor: C.line }} />
        <button disabled={busy || !email.trim()} className="rounded-xl px-4 text-[15px] font-semibold disabled:opacity-50" style={{ background: C.ink, color: '#fff' }}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Email me a link'}
        </button>
      </form>
      {err && <p className="mt-2 text-[13px] text-[#9c3a25]">{err}</p>}
    </div>
  );
}

type SendRes = { sent: number; skipped: number; failed: number; members: number; usage: Usage };

/** The blast button: "Email the link to Saturday 4.0 (12 people)". */
export function EmailGroupButton({ group, code, hostKey }: { group: Group; code: string; hostKey: string }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SendRes | null>(null);
  const [err, setErr] = useState('');
  const [upgrade, setUpgrade] = useState(false);
  const send = async (again = false) => {
    setBusy(true); setErr(''); setUpgrade(false);
    try {
      setRes(await api<SendRes>('/api/p/groups/send', { groupId: group.id, code, hostId: getHostId(), clubCode: getClub() || undefined, again }, hostKey));
    } catch (x) {
      const m = x instanceof Error ? x.message : 'Could not send';
      if (m === 'PASS_NEEDED') setUpgrade(true);
      else if (m === 'ALREADY_SENT') { if (confirm(`You already emailed ${group.name} about this game. Send it again?`)) { setBusy(false); return send(true); } }
      else setErr(m);
    } finally { setBusy(false); }
  };
  if (res) return (
    <div className="rounded-2xl p-3 text-[14px]" style={{ background: '#eef1e8' }}>
      <b>Sent to {res.sent} {res.sent === 1 ? 'person' : 'people'} in {group.name}.</b>
      {res.skipped > 0 && <span style={{ color: C.muted }}> {res.skipped} skipped (no email, didn&apos;t opt in, or unsubscribed).</span>}
      {res.failed > 0 && <span className="text-[#9c3a25]"> {res.failed} didn&apos;t go through.</span>}
      <div className="mt-1 text-[12px]" style={{ color: C.muted }}>{res.usage.used.toLocaleString()} of {res.usage.limit.toLocaleString()} emails used this month.</div>
    </div>
  );
  return (
    <div className="grid gap-2">
      <button onClick={() => send()} disabled={busy || group.emailable === 0}
        className="flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-semibold disabled:opacity-50" style={{ background: C.ink, color: '#fff' }}>
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mail className="h-4 w-4" />}
        {group.emailable === 0 ? `${group.name}: nobody to email yet` : `Email the link to ${group.name} (${group.emailable} ${group.emailable === 1 ? 'person' : 'people'})`}
      </button>
      {group.emailable === 0 && <p className="text-[12px]" style={{ color: C.muted }}>People land on the email list when they tick “Email me” as they join one of your games. Share the link in the chat for now.</p>}
      {upgrade && (
        <div className="rounded-2xl p-3 text-[14px]" style={{ background: C.lime }}>
          <b>Emailing a group comes with a Host Pass</b> ($25/yr, up to 1,000 emails a month). <Link href="/play/pass" className="font-semibold underline">Get a Host Pass ›</Link>
          <div className="mt-1 text-[12px]">Sharing to WhatsApp or a text stays free.</div>
        </div>
      )}
      {err && <p className="text-[13px] text-[#9c3a25]">{err}</p>}
    </div>
  );
}

/** Host-only block on the game page: email the link to a group, save these players as a group. */
export function HostGroups({ e, hostKey }: { e: PlayEvent; hostKey: string | null }) {
  const { data, reload } = useGroups();
  const [want, setWant] = useState<null | 'save' | 'email'>(null);
  const [pick, setPick] = useState<string>('');
  const [saveTo, setSaveTo] = useState<string>('new');
  const [name, setName] = useState(e.title);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const g = q.get('group');
    if (g) setPick(g);
    if (q.get('savegroup') === '1') setWant('save');
  }, []);
  // Arrived from /play/new with a group picked (or back from the sign-in link): bring the button into view.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (scrolled || !data || !(pick || want === 'save')) return;
    setScrolled(true);
    setTimeout(() => document.getElementById('host-groups')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
  }, [data, pick, want, scrolled]);
  if (!hostKey || !data) return null;
  const signedIn = !!data.user;
  const players = e.rsvps.filter((r) => r.status !== 'out' && !r.is_host).length;
  const group = data.groups.find((g) => g.id === pick) ?? null;
  const here = typeof location !== 'undefined' ? location.pathname : `/p/${e.code}`;

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const r = await api<{ groupId: string; added: number; updated: number }>('/api/p/groups', { action: 'save_from_event', code: e.code, ...(saveTo === 'new' ? { name: name.trim() || e.title } : { groupId: saveTo }) }, hostKey);
      await reload();
      setSaved(`Saved. ${r.added} added${r.updated ? `, ${r.updated} emails filled in` : ''}.`);
      setWant(null);
      try { const q = new URLSearchParams(location.search); q.delete('savegroup'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '')); } catch { /* */ }
    } catch (x) { setErr(x instanceof Error ? x.message : 'Could not save'); }
    finally { setSaving(false); }
  };

  return (
    <section id="host-groups" className="rounded-2xl p-3" style={{ background: '#eef1e8' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-semibold"><Users className="h-4 w-4" />Your groups</div>
        {signedIn && <Link href="/play/groups" className="text-[13px] font-semibold underline">Manage</Link>}
      </div>

      {e.status !== 'done' && signedIn && data.groups.length > 0 && (
        <div className="mt-3 grid gap-2">
          <select value={pick} onChange={(x) => setPick(x.target.value)} aria-label="Pick a group" className="rounded-xl border bg-white px-3 py-3 text-[16px]" style={{ borderColor: C.line }}>
            <option value="">Invite a group by email…</option>
            {data.groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.emailable} on the email list)</option>)}
          </select>
          {group && <EmailGroupButton key={group.id} group={group} code={e.code} hostKey={hostKey} />}
        </div>
      )}
      {e.status !== 'done' && !signedIn && want !== 'email' && (
        <button onClick={() => setWant('email')} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3 text-[14px] font-semibold">
          <Mail className="h-4 w-4" />Email the link to a saved group
        </button>
      )}
      {want === 'email' && !signedIn && <div className="mt-3"><SignInBox next={here} why="Sign in to use your saved groups." onCancel={() => setWant(null)} /></div>}

      {players > 0 && want !== 'save' && !saved && (
        <button onClick={() => setWant('save')} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[15px] font-semibold"
          style={{ background: '#fff', color: C.ink }}>
          <Users className="h-4 w-4" />Save these {players} players as a group
        </button>
      )}
      {saved && <p className="mt-3 rounded-2xl bg-white p-3 text-[14px]">{saved} Next time, pick the group when you make a game and email everyone the link.</p>}
      {want === 'save' && !signedIn && <div className="mt-3"><SignInBox next={`/p/${e.code}?savegroup=1`} why="Sign in to save this group for next time." onCancel={() => setWant(null)} /></div>}
      {want === 'save' && signedIn && (
        <div className="mt-3 grid gap-2 rounded-2xl bg-white p-4 shadow-sm">
          <select value={saveTo} onChange={(x) => setSaveTo(x.target.value)} aria-label="Save to" className="rounded-xl border bg-white px-3 py-2.5 text-[15px]" style={{ borderColor: C.line }}>
            <option value="new">A new group</option>
            {data.groups.map((g) => <option key={g.id} value={g.id}>Add to {g.name}</option>)}
          </select>
          {saveTo === 'new' && <input value={name} onChange={(x) => setName(x.target.value)} maxLength={60} placeholder="Group name, e.g. Saturday 4.0 tennis" aria-label="Group name" className="rounded-xl border px-3 py-2.5 text-[16px]" style={{ borderColor: C.line }} />}
          <p className="text-[12px]" style={{ color: C.muted }}>Everyone on this game goes in by name. Only people who ticked “Email me” get emails, and every email has an unsubscribe link.</p>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="flex-1 rounded-xl py-2.5 font-semibold disabled:opacity-50" style={{ background: C.ink, color: '#fff' }}>{saving ? 'Saving…' : 'Save group'}</button>
            <button onClick={() => setWant(null)} className="rounded-xl px-4 py-2.5" style={{ background: '#eef1e8' }}>Cancel</button>
          </div>
        </div>
      )}
      {err && <p className="mt-2 text-[13px] text-[#9c3a25]">{err}</p>}
      {signedIn && <p className="mt-3 text-[12px]" style={{ color: C.muted }}>Signed in as {data.user?.email}.</p>}
    </section>
  );
}

/** /play/new: pick a group to invite once the game is made. Renders nothing for signed-out hosts. */
export function InviteGroupPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { data } = useGroups();
  if (!data?.user || !data.groups.length) return null;
  return (
    <label className="grid gap-1 text-[14px]">
      <span className="flex items-center gap-2 font-semibold"><Users className="h-4 w-4" />Invite a group</span>
      <select value={value} onChange={(x) => onChange(x.target.value)} className="rounded-xl border bg-white px-3 py-2.5 text-[16px]" style={{ borderColor: C.line }}>
        <option value="">No, I&apos;ll share the link myself</option>
        {data.groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.emailable} on the email list)</option>)}
      </select>
      {value && <span className="text-[12px]" style={{ color: C.muted }}>Once the link is made you&apos;ll get a button to email it to them.</span>}
    </label>
  );
}

/** /play/groups: list, rename, add/remove members, see who's emailable. */
export function GroupsManager() {
  const { data, reload } = useGroups();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [newName, setNewName] = useState('');
  const run = async (label: string, body: Record<string, unknown>) => {
    setBusy(label); setErr('');
    try { await api('/api/p/groups', body); await reload(); return true; }
    catch (x) { setErr(x instanceof Error ? x.message : 'Something went wrong'); return false; }
    finally { setBusy(''); }
  };
  return (
    <div className="min-h-screen pb-24" style={{ background: C.paper, color: C.ink }}>
      <PlayHeader right={data?.user ? <button className="text-[13px] underline" onClick={async () => { await createClient().auth.signOut(); reload(); }}>Sign out</button> : null} />
      <main className="mx-auto w-full max-w-xl px-4">
        <h1 className="mt-2 text-[32px] font-medium tracking-tight">Your groups</h1>
        <p className="mt-1 text-[14px]" style={{ color: C.muted }}>Pick a group when you make a game and email everyone the link. Players get on the email list by ticking “Email me” when they join one of your games.</p>
        {!data && <Loader2 className="mt-8 h-6 w-6 animate-spin" />}
        {data && !data.user && <div className="mt-6"><SignInBox next="/play/groups" why="Sign in to see your groups." /></div>}
        {data?.user && (
          <>
            {data.usage && <p className="mt-3 text-[13px]" style={{ color: C.muted }}>Emails this month: {data.usage.used.toLocaleString()} of {data.usage.limit.toLocaleString()}{data.usage.enforced ? '' : ' (not counted against you yet)'}.</p>}
            {err && <p className="mt-3 rounded-xl bg-[#fbe9e5] px-4 py-3 text-[14px] text-[#9c3a25]">{err}</p>}
            {data.groups.map((g) => <GroupCard key={g.id} g={g} busy={busy} run={run} />)}
            <form className="mt-6 flex gap-2" onSubmit={async (x) => { x.preventDefault(); if (await run('create', { action: 'create', name: newName })) setNewName(''); }}>
              <input value={newName} onChange={(x) => setNewName(x.target.value)} maxLength={60} placeholder="New group, e.g. Intermediate pickleball" aria-label="New group name"
                className="min-w-0 flex-1 rounded-xl border bg-white px-3 py-3 text-[16px]" style={{ borderColor: C.line }} />
              <button disabled={!!busy || !newName.trim()} className="rounded-xl px-4 font-semibold disabled:opacity-50" style={{ background: C.lime }}>Add</button>
            </form>
            {!data.groups.length && <p className="mt-4 text-[14px]" style={{ color: C.muted }}>No groups yet. After a game, tap “Save these players as a group” on its page, or start one here.</p>}
            <Link href="/play/new" className="mt-8 inline-block rounded-2xl px-5 py-3 font-semibold" style={{ background: C.ink, color: '#fff' }}>Make a game</Link>
          </>
        )}
      </main>
    </div>
  );
}

function GroupCard({ g, busy, run }: { g: Group; busy: string; run: (label: string, body: Record<string, unknown>) => Promise<boolean> }) {
  const [name, setName] = useState(g.name);
  const [mName, setMName] = useState('');
  const [mEmail, setMEmail] = useState('');
  useEffect(() => setName(g.name), [g.name]);
  const status = (m: Member) => m.emailable ? 'emails on' : m.unsubscribed_at ? 'unsubscribed' : !m.email ? 'no email' : !m.opted_in ? 'not opted in' : 'unsubscribed';
  return (
    <section className="mt-4 rounded-3xl bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <input value={name} onChange={(x) => setName(x.target.value)} onBlur={() => { if (name.trim() && name !== g.name) run('rename', { action: 'rename', groupId: g.id, name }); }}
          aria-label="Group name" maxLength={60} className="min-w-0 flex-1 bg-transparent text-[20px] font-semibold outline-none" />
        <button aria-label={`Delete ${g.name}`} disabled={!!busy} onClick={() => { if (confirm(`Delete ${g.name}? Its member list goes too.`)) run('delete', { action: 'delete', groupId: g.id }); }}><Trash2 className="h-4 w-4" /></button>
      </div>
      <div className="text-[13px]" style={{ color: C.muted }}>{g.members.length} people · {g.emailable} on the email list</div>
      <ul className="mt-3 grid gap-1">
        {g.members.map((m) => (
          <li key={m.id} className="flex items-center justify-between rounded-xl px-3 py-2 text-[14px]" style={{ background: '#f4f5ef' }}>
            <span>{m.name}{m.email ? <span style={{ color: C.muted }}> · {m.email}</span> : null}</span>
            <span className="flex items-center gap-2">
              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={m.emailable ? { background: C.lime } : { background: '#fff', color: C.muted }}>{status(m)}</span>
              <button aria-label={`Remove ${m.name}`} disabled={!!busy} onClick={() => run('remove', { action: 'remove_member', groupId: g.id, memberId: m.id })}><X className="h-4 w-4" /></button>
            </span>
          </li>
        ))}
      </ul>
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={async (x) => { x.preventDefault(); if (await run('add', { action: 'add_member', groupId: g.id, name: mName, email: mEmail })) { setMName(''); setMEmail(''); } }}>
        <input value={mName} onChange={(x) => setMName(x.target.value)} maxLength={40} placeholder="Name" aria-label="Member name" className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-[15px]" style={{ borderColor: C.line }} />
        <input value={mEmail} onChange={(x) => setMEmail(x.target.value)} type="email" placeholder="Email (optional)" aria-label="Member email" className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-[15px]" style={{ borderColor: C.line }} />
        <button disabled={!!busy || !mName.trim()} className="rounded-xl px-4 py-2 font-semibold disabled:opacity-50" style={{ background: '#eef1e8' }}>Add</button>
      </form>
      <p className="mt-2 text-[12px]" style={{ color: C.muted }}>People you add here get emails only after they tick “Email me” when joining one of your games.</p>
    </section>
  );
}
