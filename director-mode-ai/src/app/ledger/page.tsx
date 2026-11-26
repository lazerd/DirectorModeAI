'use client';

/**
 * clubmode.ai/ledger: the Ledger for Clubessential clubs.
 * Set up once (member list, each pro's sheet, item names), then each week: pick dates,
 * Build, fix anything that "needs you", download the file, and in Clubessential Office
 * import it and tap Post Batch. Nothing posts to Clubessential from here.
 */
import { useEffect, useMemo, useState } from 'react';

type Pro = { name: string; sheet: string; employee: string };
type Setup = { area: string; items: Record<string, string>; taxExempt: boolean; prices: string };
type Charge = { memberNumber: string; memberName: string; item: string; description: string; qty: number; price: number; employee: string; student: string; source?: string };
type Need = { reason: string; candidates: { memberNumber: string; name: string }[]; line: { date: string; student: string; pro: string; kind: string; minutes: number | null; price: number; source?: string } };
type Result = { from: string; to: string; charges: Charge[]; needsYou: Need[]; skipped: { row: string; reason: string }[]; problems: string[]; pros: { pro: string; lessons: number; hours: number; billed: number }[]; totalCents: number; csv: string };

const C = { bg: '#F4EEE2', card: '#FFFDF8', ink: '#17301F', mute: '#5A6657', line: '#E2D8C4', green: '#1F4D3A', ball: '#D7F25A' };
const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 18, padding: 20, marginBottom: 16 };
const btn: React.CSSProperties = { background: C.green, color: '#fff', border: 0, borderRadius: 999, padding: '10px 18px', fontWeight: 800, cursor: 'pointer' };
const ghost: React.CSSProperties = { background: 'none', border: `1px solid ${C.line}`, borderRadius: 999, padding: '8px 14px', cursor: 'pointer', color: C.ink };
const input: React.CSSProperties = { border: `1.5px solid ${C.line}`, borderRadius: 10, padding: '9px 12px', fontSize: 15, background: '#fff', color: C.ink, minWidth: 0 };
const KIND_LABELS: [string, string][] = [['private', 'Private lessons'], ['semi', 'Semi-private'], ['group', 'Group lessons'], ['clinic', 'Clinics'], ['other', 'Anything else']];

const cell = (v: string | number) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const md = (d: string) => { const [, m, dd] = d.split('-'); return `${Number(m)}/${Number(dd)}`; };
function lastWeek(): [string, string] {
  const now = new Date(); const day = (now.getDay() + 6) % 7; // Mon=0
  const mon = new Date(now); mon.setDate(now.getDate() - day - 7);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return [f(mon), f(sun)];
}

export default function LedgerPage() {
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [noClub, setNoClub] = useState(false);
  const [rosterCount, setRosterCount] = useState(0);
  const [rosterAt, setRosterAt] = useState<string | null>(null);
  const [pros, setPros] = useState<Pro[]>([]);
  const [setup, setSetup] = useState<Setup>({ area: 'Tennis', items: {}, taxExempt: true, prices: '' });
  const [sa, setSa] = useState<string | null>(null);
  const [[from, to], setRange] = useState<[string, string]>(lastWeek());
  const [uploads, setUploads] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [fixed, setFixed] = useState<Charge[]>([]);
  const [picks, setPicks] = useState<Record<number, string>>({});

  const load = () => fetch('/api/ledger/setup').then(async (r) => {
    const j = await r.json();
    if (!r.ok) { setErr(j.error || 'Sign in to ClubMode first.'); setNoClub(r.status === 403); setLoaded(true); return; }
    setRosterCount(j.rosterCount); setRosterAt(j.rosterUpdatedAt); setPros(j.pros?.length ? j.pros : [{ name: '', sheet: '', employee: '' }]);
    setSetup(j.setup); setSa(j.serviceAccount); setLoaded(true);
  });
  useEffect(() => { load(); }, []);

  async function save(body: unknown, ok: string) {
    setMsg(''); setErr('');
    const r = await fetch('/api/ledger/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error || "Couldn't save."); return; }
    setMsg(ok); load();
  }
  async function onRoster(f: File | undefined) { if (f) save({ rosterCsv: await f.text() }, 'Member list saved.'); }

  async function build() {
    setBusy(true); setErr(''); setRes(null); setFixed([]); setPicks({});
    const r = await fetch('/api/ledger/build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from, to, uploads: Object.entries(uploads).map(([pro, csv]) => ({ pro, csv })) }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error || 'Build failed.'); return; }
    setRes(j);
  }

  function useMember(i: number) {
    if (!res) return;
    const n = res.needsYou[i]; const num = (picks[i] || '').trim(); if (!num) return;
    const name = n.candidates.find((c) => c.memberNumber === num)?.name || num;
    const item = setup.items[n.line.kind] || setup.items.other || '';
    const pro = pros.find((p) => p.name === n.line.pro);
    const kindLabel: Record<string, string> = { private: 'Private lesson', semi: 'Semi-private lesson', group: 'Group lesson', clinic: 'Clinic', other: 'Lesson' };
    setFixed((f) => [...f, {
      memberNumber: num, memberName: name, item, qty: 1, price: n.line.price, employee: pro?.employee || n.line.pro, student: n.line.student, source: n.line.source,
      description: `${kindLabel[n.line.kind] || 'Lesson'} w/ ${n.line.pro.split(/\s+/)[0]} ${md(n.line.date)}${n.line.minutes ? ` (${n.line.minutes} min)` : ''}`.slice(0, 80),
    }]);
    setPicks((p) => ({ ...p, [i]: '' }));
  }

  const all = useMemo(() => (res ? [...res.charges, ...fixed] : []), [res, fixed]);
  const total = all.reduce((a, c) => a + c.price * c.qty, 0);
  const fixedKeys = new Set(fixed.map((f) => `${f.student}|${f.source}`));
  function download() {
    const head = 'Member Number,Area,Item Name,Description,QTY,Price,Employee Name,Tax Exempt';
    const rows = all.map((c) => [c.memberNumber, setup.area, c.item, c.description, c.qty, c.price.toFixed(2), c.employee, setup.taxExempt ? 1 : 0].map(cell).join(','));
    const blob = new Blob([[head, ...rows].join('\r\n') + '\r\n'], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `clubessential-charges-${from}-to-${to}.csv`; a.click();
  }

  if (!loaded) return <main style={{ padding: 40, fontFamily: 'system-ui' }}>Loading…</main>;
  if (err && !pros.length) return <main style={{ padding: 40, fontFamily: 'system-ui' }}><p>{err}</p>{noClub ? <a href="/start?next=/ledger">Set up my club</a> : <a href="/login?next=/ledger">Sign in to ClubMode</a>}</main>;

  return (
    <main style={{ background: C.bg, minHeight: '100vh', padding: '24px 14px', fontFamily: 'system-ui, sans-serif', color: C.ink }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 28 }}>Ledger: lesson charges for Clubessential</h1>
        <p style={{ margin: '0 0 18px', color: C.mute }}>Your pros keep their sheets. Ledger turns them into one file you import in Clubessential. Nothing posts until you tap Post Batch there.</p>
        {err && <p style={{ color: '#9a3412', fontWeight: 700 }}>{err}</p>}
        {msg && <p style={{ color: '#1E7A3C', fontWeight: 700 }}>{msg}</p>}

        <section style={card}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>1. Your member list</h2>
          <p style={{ color: C.mute, marginTop: 0 }}>{rosterCount ? `${rosterCount} members${rosterAt ? `, updated ${new Date(rosterAt).toLocaleDateString()}` : ''}.` : 'Not uploaded yet.'} In Clubessential Office, export your members (Member Number, First and Last name) to Excel and save it as CSV. Re-upload when members change.</p>
          <input type="file" accept=".csv,text/csv" onChange={(e) => onRoster(e.target.files?.[0])} />
        </section>

        <section style={card}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>2. Your pros and their sheets</h2>
          {sa
            ? <p style={{ color: C.mute, marginTop: 0 }}>Each pro shares their sheet (view only) with <b style={{ color: C.ink }}>{sa}</b>. Or upload it as a CSV when you build.</p>
            : <p style={{ color: C.mute, marginTop: 0 }}>Add each pro by name. Reading Google Sheet links isn&apos;t switched on here yet, so when you build, upload each pro&apos;s sheet as a CSV (in Google Sheets: File → Download → CSV).</p>}
          {pros.map((p, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1.3fr auto', gap: 8, marginBottom: 8 }}>
              <input style={input} placeholder="Pro (as on the sheet)" value={p.name} onChange={(e) => setPros(pros.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
              <input style={input} placeholder="Google Sheet link" value={p.sheet} onChange={(e) => setPros(pros.map((x, j) => j === i ? { ...x, sheet: e.target.value } : x))} />
              <input style={input} placeholder='In Clubessential: "Last, First"' value={p.employee} onChange={(e) => setPros(pros.map((x, j) => j === i ? { ...x, employee: e.target.value } : x))} />
              <button style={ghost} onClick={() => setPros(pros.filter((_, j) => j !== i))} aria-label="Remove">×</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={ghost} onClick={() => setPros([...pros, { name: '', sheet: '', employee: '' }])}>Add a pro</button>
            <button style={btn} onClick={() => save({ pros }, 'Pros saved.')}>Save pros</button>
          </div>
        </section>

        <section style={card}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>3. Your Clubessential items</h2>
          <p style={{ color: C.mute, marginTop: 0 }}>The item names exactly as in Manage Items.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
            <label>Area<br /><input style={{ ...input, width: '100%' }} value={setup.area} onChange={(e) => setSetup({ ...setup, area: e.target.value })} /></label>
            {KIND_LABELS.map(([k, l]) => (
              <label key={k}>{l}<br /><input style={{ ...input, width: '100%' }} value={setup.items[k] || ''} onChange={(e) => setSetup({ ...setup, items: { ...setup.items, [k]: e.target.value } })} /></label>
            ))}
          </div>
          <label style={{ display: 'block', marginTop: 10 }}>Standard prices (helps read rows without a price)<br /><input style={{ ...input, width: '100%' }} placeholder="e.g. private 60 min $110, semi $60 each, clinic $30" value={setup.prices} onChange={(e) => setSetup({ ...setup, prices: e.target.value })} /></label>
          <label style={{ display: 'block', margin: '10px 0' }}><input type="checkbox" checked={setup.taxExempt} onChange={(e) => setSetup({ ...setup, taxExempt: e.target.checked })} /> Lessons are tax exempt</label>
          <button style={btn} onClick={() => save({ setup }, 'Items saved.')}>Save items</button>
        </section>

        <section style={{ ...card, border: `2px solid ${C.ball}` }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Build this week's charges</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
            <label>From<br /><input type="date" style={input} value={from} onChange={(e) => setRange([e.target.value, to])} /></label>
            <label>To<br /><input type="date" style={input} value={to} onChange={(e) => setRange([from, e.target.value])} /></label>
            <button style={btn} disabled={busy} onClick={build}>{busy ? 'Reading the sheets…' : 'Build charges'}</button>
          </div>
          <details style={{ marginTop: 10 }}><summary style={{ cursor: 'pointer', color: C.mute }}>Upload a pro's sheet as CSV instead</summary>
            {pros.filter((p) => p.name).map((p) => (
              <div key={p.name} style={{ marginTop: 6 }}>{p.name}: <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setUploads({ ...uploads, [p.name]: await f.text() }); }} /></div>
            ))}
          </details>
        </section>

        {res && (
          <>
            <section style={card}>
              <h2 style={{ marginTop: 0, fontSize: 18 }}>{all.length} charges, ${total.toFixed(2)}{res.needsYou.length - fixed.length > 0 ? `, ${res.needsYou.length - fixed.length} need you` : ''}</h2>
              {res.problems.map((p) => <p key={p} style={{ color: '#9a3412', margin: '4px 0' }}>{p}</p>)}
              <button style={{ ...btn, background: C.ball, color: C.ink }} onClick={download} disabled={!all.length}>Download the file for Clubessential</button>
              <p style={{ color: C.mute, fontSize: 14 }}>In Clubessential Office: Membership → Member Charges → Member Charge Wizard → Import from CSV. The first time, map the columns and save the mapping. Check the preview, then Post Batch.</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead><tr style={{ textAlign: 'left', color: C.mute }}><th>Member #</th><th>Member</th><th>Description</th><th>Item</th><th style={{ textAlign: 'right' }}>Price</th></tr></thead>
                  <tbody>{all.map((c, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${C.line}` }} title={c.source}><td>{c.memberNumber}</td><td>{c.memberName}</td><td>{c.description}</td><td>{c.item}</td><td style={{ textAlign: 'right' }}>${c.price.toFixed(2)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </section>

            {res.needsYou.length > 0 && (
              <section style={card}>
                <h2 style={{ marginTop: 0, fontSize: 18 }}>Needs you</h2>
                <p style={{ color: C.mute, marginTop: 0 }}>Ledger never guesses a member. Pick the right one, or leave it off.</p>
                {res.needsYou.map((n, i) => {
                  const done = fixedKeys.has(`${n.line.student}|${n.line.source}`);
                  return (
                    <div key={i} style={{ borderTop: `1px solid ${C.line}`, padding: '10px 0', opacity: done ? 0.5 : 1 }}>
                      <b>{n.line.student}</b> · {md(n.line.date)} · {n.line.pro} · ${n.line.price.toFixed(2)} <span style={{ color: C.mute }}>({n.reason})</span>
                      {!done && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                          {n.candidates.length > 0 && (
                            <select style={input} value={picks[i] || ''} onChange={(e) => setPicks({ ...picks, [i]: e.target.value })}>
                              <option value="">Pick a member…</option>
                              {n.candidates.map((c) => <option key={c.memberNumber} value={c.memberNumber}>{c.name} ({c.memberNumber})</option>)}
                            </select>
                          )}
                          <input style={input} placeholder="or member number" value={picks[i] || ''} onChange={(e) => setPicks({ ...picks, [i]: e.target.value })} />
                          <button style={ghost} onClick={() => useMember(i)}>Add to the file</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            )}

            <section style={card}>
              <h2 style={{ marginTop: 0, fontSize: 18 }}>By pro (for payroll)</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead><tr style={{ textAlign: 'left', color: C.mute }}><th>Pro</th><th>Lessons</th><th>Hours</th><th style={{ textAlign: 'right' }}>Billed</th></tr></thead>
                <tbody>{res.pros.map((p) => <tr key={p.pro} style={{ borderTop: `1px solid ${C.line}` }}><td>{p.pro}</td><td>{p.lessons}</td><td>{p.hours}</td><td style={{ textAlign: 'right' }}>${p.billed.toFixed(2)}</td></tr>)}</tbody>
              </table>
              {res.skipped.length > 0 && (
                <details style={{ marginTop: 10 }}><summary style={{ cursor: 'pointer', color: C.mute }}>{res.skipped.length} rows left off (paid, cancelled, no price…)</summary>
                  {res.skipped.map((s, i) => <div key={i} style={{ fontSize: 13, color: C.mute }}>{s.row}: {s.reason}</div>)}
                </details>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
