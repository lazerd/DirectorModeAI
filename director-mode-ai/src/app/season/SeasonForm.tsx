'use client';

/**
 * The one-screen Season Builder form. Used by both the personal emailed link
 * (/season/[token]) and the public newsletter link (/season/join/[token]); the
 * public one also asks for name + email.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  type Answer, type Campaign, type Choice, type Slot, NTRP_LEVELS, NTRP_UNRATED, SLOT_LABEL,
  ageCutoffYear, fmtDate, leaguesFor, validate,
} from '@/lib/seasonBuilder/shared';

type Props = {
  campaign: Pick<Campaign, 'title' | 'leagues' | 'reply_by' | 'registration_opens' | 'season_start' | 'season_end'> & { id?: string };
  clubName: string;
  postUrl: string;
  /** Personal link: who they are. Public link: null, so we ask. */
  person: { name: string } | null;
  initial: Answer | null;
  initialGender: Answer['gender'];
};

const C = {
  ink: '#0f172a', mute: '#64748b', line: '#e2e8f0', brand: '#002838', accent: '#0e7490', bg: '#f1f5f9', card: '#ffffff',
};

const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, marginBottom: 14 };
const h2: React.CSSProperties = { fontSize: 17, fontWeight: 700, margin: '0 0 10px', color: C.ink };
const hint: React.CSSProperties = { fontSize: 14, color: C.mute, margin: '0 0 12px' };

function Pill({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '10px 14px', borderRadius: 10, fontSize: 15, cursor: 'pointer', textAlign: 'left',
        border: `2px solid ${on ? C.accent : C.line}`, background: on ? '#ecfeff' : '#fff', color: C.ink,
        fontWeight: on ? 700 : 500,
      }}
    >
      {children}
    </button>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function SeasonForm({ campaign, clubName, postUrl, person, initial, initialGender }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [interested, setInterested] = useState<boolean | null>(initial ? initial.interested : null);
  const [gender, setGender] = useState<Answer['gender']>(initial?.gender ?? initialGender ?? null);
  const [ntrp, setNtrp] = useState<string | null>(initial?.ntrp ?? null);
  const [choices, setChoices] = useState<Choice[]>(initial?.choices ?? []);
  const [role, setRole] = useState<Answer['role']>(initial?.role ?? null);
  const [ageOk, setAgeOk] = useState<boolean>(initial?.age_ok === true);
  const [expYear, setExpYear] = useState<string>(initial?.usta_expires?.slice(0, 4) ?? '');
  const [expMonth, setExpMonth] = useState<string>(initial?.usta_expires?.slice(5, 7) ?? '');
  const [ustaUnknown, setUstaUnknown] = useState<boolean>(!!initial?.usta_unknown);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ summary: string[]; needs_renewal: boolean } | null>(null);

  // Any change clears a stale error ("confirm your age" after they tick the box).
  useEffect(() => { setErr(null); }, [interested, gender, ntrp, choices, role, ageOk, expYear, expMonth, ustaUnknown, name, email]);

  const open = leaguesFor(campaign.leagues, gender);
  const has = (league: string, slot: Slot) => choices.some((c) => c.league === league && c.slot === slot);
  const toggle = (league: string, slot: Slot) =>
    setChoices((cs) => (has(league, slot) ? cs.filter((c) => !(c.league === league && c.slot === slot)) : [...cs, { league, slot }]));
  const ageLeagues = campaign.leagues.filter((l) => l.min_age >= 40 && choices.some((c) => c.league === l.key));
  const cutoff = ageLeagues.length ? ageCutoffYear(ageLeagues[0], campaign.season_start) : null;

  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return [y, y + 1, y + 2, y + 3];
  }, []);

  function pickGender(g: 'female' | 'male') {
    setGender(g);
    // Drop picks that no longer apply (e.g. Women's 40+ after switching to men's).
    setChoices((cs) => cs.filter((c) => leaguesFor(campaign.leagues, g).some((l) => l.key === c.league)));
  }

  async function submit(asInterested: boolean) {
    setErr(null);
    const answer: Answer = {
      interested: asInterested,
      gender, ntrp, choices, role,
      age_ok: ageLeagues.length ? ageOk : null,
      usta_expires: ustaUnknown || !expYear || !expMonth ? null : `${expYear}-${expMonth}`,
      usta_unknown: ustaUnknown,
      notes: notes.trim() || null,
    };
    if (!person) {
      if (name.trim().split(/\s+/).length < 2) return setErr('Please enter your first and last name.');
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr('Please enter a valid email.');
    }
    const v = validate({ leagues: campaign.leagues, season_start: campaign.season_start } as Campaign, answer);
    if (v) return setErr(v);
    setBusy(true);
    try {
      const res = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...answer, ...(person ? {} : { name: name.trim(), email: email.trim() }) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
      setDone({ summary: j.summary || [], needs_renewal: !!j.needs_renewal });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const page: React.CSSProperties = { background: C.bg, minHeight: '100vh', padding: '20px 16px 60px', color: C.ink, fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif' };
  const wrap: React.CSSProperties = { maxWidth: 560, margin: '0 auto' };
  const header = (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, letterSpacing: '.06em', textTransform: 'uppercase', color: C.mute }}>{clubName}</div>
      <h1 style={{ fontSize: 24, margin: '6px 0 6px', color: C.brand }}>{campaign.title}</h1>
      {campaign.reply_by && <div style={{ fontSize: 15, color: C.mute }}>Please answer by {fmtDate(campaign.reply_by, { weekday: 'long', month: 'long', day: 'numeric' })}</div>}
    </div>
  );

  if (done) {
    return (
      <main style={page}>
        <div style={wrap}>
          {header}
          <div style={card}>
            <h2 style={h2}>{interested === false ? 'Got it — thanks for letting us know.' : 'You’re on the list!'}</h2>
            <ul style={{ margin: '0 0 6px', paddingLeft: 20, fontSize: 15, lineHeight: 1.6 }}>
              {done.summary.map((l) => <li key={l}>{l}</li>)}
            </ul>
            {done.needs_renewal && (
              <div style={{ border: '2px solid #f59e0b', background: '#fffbeb', borderRadius: 10, padding: 14, marginTop: 14, fontSize: 15 }}>
                <b>Please renew your USTA membership</b> so it&rsquo;s current through the end of the season. We&rsquo;ve emailed you the link.
              </div>
            )}
            <p style={{ ...hint, marginTop: 14 }}>We&rsquo;ve emailed you a copy. You can come back to this link to change your answers.</p>
            <button type="button" onClick={() => setDone(null)} style={{ background: 'none', border: 'none', color: C.accent, fontWeight: 700, fontSize: 15, padding: 0, cursor: 'pointer' }}>
              Change my answers
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main style={page}>
      <div style={wrap}>
        {header}

        <div style={card}>
          <p style={{ fontSize: 16, lineHeight: 1.55, margin: 0 }}>
            {person ? <>Hi {person.name.split(' ')[0]} &mdash; w</> : 'W'}e&rsquo;re putting together our USTA teams
            {campaign.registration_opens ? <> (registration opens {fmtDate(campaign.registration_opens, { month: 'long', day: 'numeric' })})</> : null}
            {campaign.season_start && campaign.season_end ? <>. The season runs about {fmtDate(campaign.season_start, { month: 'short', day: 'numeric' })} &ndash; {fmtDate(campaign.season_end, { month: 'short', day: 'numeric' })}</> : null}.
            Tell us if you&rsquo;d like to play.
          </p>
        </div>

        {!person && (
          <div style={card}>
            <h2 style={h2}>Your name and email</h2>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name" autoComplete="name"
              style={{ width: '100%', boxSizing: 'border-box', padding: 12, fontSize: 16, borderRadius: 10, border: `1px solid ${C.line}`, marginBottom: 10, color: C.ink, background: '#fff' }} />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" autoComplete="email"
              style={{ width: '100%', boxSizing: 'border-box', padding: 12, fontSize: 16, borderRadius: 10, border: `1px solid ${C.line}`, color: C.ink, background: '#fff' }} />
          </div>
        )}

        <div style={card}>
          <h2 style={h2}>Do you want to play USTA this season?</h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Pill on={interested === true} onClick={() => setInterested(true)}>Yes, I&rsquo;m interested</Pill>
            <Pill on={interested === false} onClick={() => setInterested(false)}>Not this season</Pill>
          </div>
        </div>

        {interested === true && (
          <>
            <div style={card}>
              <h2 style={h2}>Which teams?</h2>
              <p style={hint}>USTA leagues are by gender, so we need to know which you&rsquo;d play.</p>
              <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                <Pill on={gender === 'female'} onClick={() => pickGender('female')}>Women&rsquo;s</Pill>
                <Pill on={gender === 'male'} onClick={() => pickGender('male')}>Men&rsquo;s</Pill>
              </div>
              {open.map((l) => (
                <div key={l.key} style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12, marginTop: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>{l.label}</div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {l.slots.map((s) => (
                      <Pill key={s} on={has(l.key, s)} onClick={() => toggle(l.key, s)}>
                        {has(l.key, s) ? '✓ ' : ''}{SLOT_LABEL[s]}
                      </Pill>
                    ))}
                  </div>
                </div>
              ))}
              {gender && <p style={{ ...hint, marginTop: 12, marginBottom: 0 }}>Pick as many as you&rsquo;d play.</p>}
            </div>

            {ageLeagues.length > 0 && cutoff && (
              <div style={card}>
                <h2 style={h2}>40 &amp; Over age check</h2>
                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 15, cursor: 'pointer' }}>
                  <input type="checkbox" checked={ageOk} onChange={(e) => setAgeOk(e.target.checked)} style={{ width: 22, height: 22, marginTop: 1 }} />
                  <span>I was born in <b>{cutoff} or earlier</b> (I turn 40 in {cutoff + 40} or I&rsquo;m older).</span>
                </label>
              </div>
            )}

            <div style={card}>
              <h2 style={h2}>Your NTRP level</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {NTRP_LEVELS.map((n) => <Pill key={n} on={ntrp === n} onClick={() => setNtrp(n)}>{n}</Pill>)}
                <Pill on={ntrp === NTRP_UNRATED} onClick={() => setNtrp(NTRP_UNRATED)}>Not rated yet</Pill>
              </div>
            </div>

            <div style={card}>
              <h2 style={h2}>Would you like to captain?</h2>
              <div style={{ display: 'grid', gap: 8 }}>
                <Pill on={role === 'captain'} onClick={() => setRole('captain')}>Yes &mdash; I&rsquo;d captain a team (and play)</Pill>
                <Pill on={role === 'play'} onClick={() => setRole('play')}>No, I&rsquo;ll just play</Pill>
              </div>
            </div>

            <div style={card}>
              <h2 style={h2}>When does your USTA membership expire?</h2>
              <p style={hint}>It&rsquo;s on your USTA account. It needs to last through the season.</p>
              <div style={{ display: 'flex', gap: 10, marginBottom: 12, opacity: ustaUnknown ? 0.4 : 1 }}>
                <select value={expMonth} disabled={ustaUnknown} onChange={(e) => setExpMonth(e.target.value)}
                  style={{ flex: 1, padding: 12, fontSize: 16, borderRadius: 10, border: `1px solid ${C.line}`, background: '#fff', color: C.ink }}>
                  <option value="">Month</option>
                  {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
                </select>
                <select value={expYear} disabled={ustaUnknown} onChange={(e) => setExpYear(e.target.value)}
                  style={{ flex: 1, padding: 12, fontSize: 16, borderRadius: 10, border: `1px solid ${C.line}`, background: '#fff', color: C.ink }}>
                  <option value="">Year</option>
                  {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
                </select>
              </div>
              <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 15, cursor: 'pointer' }}>
                <input type="checkbox" checked={ustaUnknown} onChange={(e) => setUstaUnknown(e.target.checked)} style={{ width: 22, height: 22 }} />
                Not sure / I don&rsquo;t have one yet
              </label>
            </div>

            <div style={card}>
              <h2 style={h2}>Anything else? <span style={{ fontWeight: 400, color: C.mute }}>(optional)</span></h2>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="e.g. who you'd like to play with, dates you're away"
                style={{ width: '100%', boxSizing: 'border-box', padding: 12, fontSize: 16, borderRadius: 10, border: `1px solid ${C.line}`, fontFamily: 'inherit', color: C.ink, background: '#fff' }} />
            </div>
          </>
        )}

        {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 15 }}>{err}</div>}

        {interested !== null && (
          <button type="button" disabled={busy} onClick={() => submit(interested)}
            style={{ width: '100%', padding: 16, fontSize: 18, fontWeight: 700, borderRadius: 12, border: 'none', background: C.brand, color: '#fff', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Saving…' : interested ? 'Count me in' : 'Send'}
          </button>
        )}
      </div>
    </main>
  );
}
