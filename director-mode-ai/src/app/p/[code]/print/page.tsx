/**
 * /p/<code>/print — paper for the fence and the front desk, like MixerMode's
 * /event/<code>/print: a check-in sheet (every sign-up, a box to tick), the
 * current round's court sheet with blank score boxes, every past round with its
 * scores, then standings. One page each; the toolbar never prints.
 * `?sheet=checkin|courts|standings` prints just one. Public and read-only.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { courtLabel, standings, teamScore, type GuestMatch, type GuestMixer, type GuestRound } from '@/lib/mixer/guestMixer';
import { FORMAT_NAME, SPORT_LABEL, whenLine } from '@/lib/play/core';
import { loadResults, type ResultsEvent } from '@/lib/play/resultsData';
import { winPct } from '@/lib/play/results';
import PrintButton from './PrintButton';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Print sheets · Racquets IRL', robots: { index: false, follow: false } };

type Sheet = 'all' | 'checkin' | 'courts' | 'standings';

export default async function PlayPrintPage({ params, searchParams }: { params: { code: string }; searchParams: { sheet?: string } }) {
  const e = await loadResults(params.code);
  if (!e) notFound();
  const sheet: Sheet = (['checkin', 'courts', 'standings'] as const).includes(searchParams.sheet as never) ? (searchParams.sheet as Sheet) : 'all';
  const m = e.state.mixer ?? null;
  const rounds = m ? [...m.rounds].sort((a, b) => a.number - b.number) : [];
  const current = rounds[rounds.length - 1] ?? null;
  const past = rounds.slice(0, -1).reverse();
  const st = m ? standings(m) : [];
  const tn = { A: e.state.teamNames?.A || 'Team A', B: e.state.teamNames?.B || 'Team B' };
  const tb = m && m.format === 'team-battle' ? teamScore(m) : null;
  const dateLine = [whenLine(e, 'America/Los_Angeles'), e.location].filter(Boolean).join(' · ');
  const sub = [FORMAT_NAME[m?.format ?? e.format], SPORT_LABEL[e.sport], dateLine].filter(Boolean).join(' · ');
  const base = `/p/${e.code}/print`;
  const show = (s: Exclude<Sheet, 'all'>) => sheet === 'all' || sheet === s;

  return (
    <div id="wc-print">
      <style>{PRINT_CSS}</style>
      <nav className="wc-toolbar">
        <PrintButton />
        <a className={`wc-btn ${sheet === 'all' ? 'wc-on' : ''}`} href={base}>Everything</a>
        <a className={`wc-btn ${sheet === 'checkin' ? 'wc-on' : ''}`} href={`${base}?sheet=checkin`}>Check-in</a>
        <a className={`wc-btn ${sheet === 'courts' ? 'wc-on' : ''}`} href={`${base}?sheet=courts`}>Court sheets</a>
        <a className={`wc-btn ${sheet === 'standings' ? 'wc-on' : ''}`} href={`${base}?sheet=standings`}>Standings</a>
        <a className="wc-btn" href={`/p/${e.code}`}>Back to the game</a>
      </nav>

      {show('checkin') && <CheckIn e={e} sub={sub} tn={tn} />}

      {show('courts') && m && current && (
        <section className="wc-page">
          <Header e={e} title={`Round ${current.number}${past.length ? ' · now playing' : ''}`} sub={sub} />
          <Courts m={m} round={current} blank />
        </section>
      )}
      {show('courts') && (!m || !current) && sheet === 'courts' && (
        <section className="wc-page">
          <Header e={e} title="No rounds yet" sub={sub} />
          <p className="wc-big">The host hasn&apos;t started the courts yet.</p>
        </section>
      )}
      {show('courts') && m && past.length > 0 && (
        <section className="wc-page">
          <Header e={e} title="Earlier rounds" sub={sub} />
          {past.map((r) => (
            <div key={r.number} className="wc-round">
              <h2>Round {r.number}</h2>
              <Courts m={m} round={r} />
            </div>
          ))}
        </section>
      )}

      {show('standings') && (sheet === 'standings' || st.length > 0) && (
        <section className="wc-page">
          <Header e={e} title="Standings" sub={sub} />
          {tb && (
            <div className="wc-teams">
              <span>{tn.A}</span> <b>{tb.A} – {tb.B}</b> <span>{tn.B}</span>
              <div className="wc-note">Courts won (games {tb.gamesA}–{tb.gamesB})</div>
            </div>
          )}
          {!st.length ? (
            <p className="wc-big">No scores entered yet.</p>
          ) : (
            <table className="wc-table wc-standings">
              <thead>
                <tr><th>#</th><th className="wc-left">Player</th><th>Won</th><th>Lost</th><th>Games</th><th>+/−</th><th>Win %</th></tr>
              </thead>
              <tbody>
                {st.map((s) => (
                  <tr key={s.id}>
                    <td>{s.rank}</td>
                    <td className="wc-left wc-name">{s.name}</td>
                    <td className="wc-strong">{s.wins}</td>
                    <td>{s.losses}</td>
                    <td>{s.gamesFor}–{s.gamesAgainst}</td>
                    <td>{s.gamesFor - s.gamesAgainst > 0 ? '+' : ''}{s.gamesFor - s.gamesAgainst}</td>
                    <td>{winPct(s.wins, s.played)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="wc-note">Partners rotate, so players are ranked on their own: win percentage, then game difference, then fewest games lost.</p>
        </section>
      )}
    </div>
  );
}

function Header({ e, title, sub }: { e: ResultsEvent; title: string; sub: string }) {
  return (
    <header className="wc-header">
      <div className="wc-event">{e.title}</div>
      <h1>{title}</h1>
      <div className="wc-sub">{sub}</div>
    </header>
  );
}

function CheckIn({ e, sub, tn }: { e: ResultsEvent; sub: string; tn: { A: string; B: string } }) {
  const people = [...e.rsvps].sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'in' ? -1 : 1));
  const hasTeams = people.some((r) => r.team);
  const blanks = Math.max(4, Math.min(10, 24 - people.length));
  return (
    <section className="wc-page">
      <Header e={e} title="Check-in" sub={sub} />
      <table className="wc-table wc-checkin">
        <thead>
          <tr><th className="wc-box-col">Here</th><th className="wc-left">Name</th><th>Level</th>{hasTeams && <th>Team</th>}<th className="wc-left">Notes</th></tr>
        </thead>
        <tbody>
          {people.map((r) => (
            <tr key={r.id}>
              <td><span className={`wc-box ${r.checked_in_at ? 'wc-box-on' : ''}`}>{r.checked_in_at ? '✓' : ''}</span></td>
              <td className="wc-left wc-name">{r.name}{r.status === 'wait' ? <span className="wc-tag"> (waitlist)</span> : null}{r.is_host ? <span className="wc-tag"> (host)</span> : null}</td>
              <td>{r.level ?? (r.level_num != null ? String(r.level_num) : '')}</td>
              {hasTeams && <td>{r.team ? tn[r.team] : ''}</td>}
              <td />
            </tr>
          ))}
          {Array.from({ length: blanks }, (_, i) => (
            <tr key={`blank-${i}`} className="wc-blank">
              <td><span className="wc-box" /></td><td /><td />{hasTeams && <td />}<td />
            </tr>
          ))}
        </tbody>
      </table>
      <p className="wc-note">{people.length} signed up · walk-ins on the blank lines.</p>
    </section>
  );
}

function Courts({ m, round, blank }: { m: GuestMixer; round: GuestRound; blank?: boolean }) {
  const name = (id: string) => m.players.find((p) => p.id === id)?.name ?? '?';
  const ms = [...round.matches].sort((a, b) => a.court - b.court);
  return (
    <>
      <table className="wc-courts">
        <thead>
          <tr><th className="wc-court-col">Court</th><th>Side A</th><th className="wc-vs-col" /><th>Side B</th><th className="wc-score-col">Score</th></tr>
        </thead>
        <tbody>
          {ms.map((x) => (
            <tr key={x.court}>
              <td className="wc-court">{courtLabel(m, x.court)}</td>
              <td className="wc-team">{x.teamA.map((id) => <div key={id}>{name(id)}</div>)}</td>
              <td className="wc-vs">vs</td>
              <td className="wc-team">{x.teamB.map((id) => <div key={id}>{name(id)}</div>)}</td>
              <td className="wc-score"><Score x={x} blank={blank} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {round.sittingOut.length > 0 && (
        <div className="wc-sitouts"><span className="wc-label">Sitting out:</span> {round.sittingOut.map(name).join(', ')}</div>
      )}
    </>
  );
}

function Score({ x, blank }: { x: GuestMatch; blank?: boolean }) {
  if (x.scoreA == null || x.scoreB == null) {
    return blank ? <span className="wc-boxes"><span className="wc-sbox" /> – <span className="wc-sbox" /></span> : <span>not scored</span>;
  }
  const tb = x.scoreA === x.scoreB && x.tiebreak ? ` (TB ${x.tiebreak})` : '';
  return <span>{x.scoreA} – {x.scoreB}{tb}</span>;
}

const PRINT_CSS = `
#wc-print { background:#fff; color:#000; font-family: Arial, Helvetica, sans-serif; min-height:100vh; padding: 16px; }
#wc-print * { color:#000; }
.wc-toolbar { display:flex; flex-wrap:wrap; gap:8px; max-width: 1000px; margin: 0 auto 16px; }
.wc-btn { display:inline-block; font-size:18px; padding:10px 16px; border:2px solid #000; border-radius:8px; background:#fff; text-decoration:none; cursor:pointer; font-weight:600; }
.wc-btn-primary, .wc-on { background:#000; }
#wc-print .wc-btn-primary, #wc-print .wc-on { color:#fff; }
.wc-page { max-width: 1000px; margin: 0 auto 32px; padding: 24px; border: 1px solid #ccc; }
.wc-header { border-bottom: 3px solid #000; padding-bottom: 10px; margin-bottom: 18px; }
.wc-event { font-size: 22px; font-weight: 700; }
.wc-header h1 { font-size: 44px; line-height: 1.1; margin: 4px 0; font-weight: 900; }
.wc-sub { font-size: 18px; }
.wc-big { font-size: 26px; }
.wc-note { font-size: 16px; margin-top: 14px; }
.wc-round { margin-bottom: 22px; break-inside: avoid; page-break-inside: avoid; }
.wc-round h2 { font-size: 26px; font-weight: 900; margin: 0 0 6px; }
.wc-courts { width:100%; border-collapse: collapse; }
.wc-courts th { font-size: 18px; text-align:left; border-bottom: 2px solid #000; padding: 6px 8px; }
.wc-courts td { border-bottom: 1px solid #000; padding: 10px 8px; vertical-align: middle; }
.wc-court-col { width: 90px; }
.wc-vs-col { width: 50px; }
.wc-score-col { width: 190px; }
.wc-court { font-size: 40px; font-weight: 900; text-align:center; }
.wc-team { font-size: 26px; font-weight: 700; line-height: 1.25; }
.wc-round .wc-court { font-size: 26px; }
.wc-round .wc-team { font-size: 18px; }
.wc-vs { font-size: 20px; text-align:center; font-style: italic; }
.wc-score { font-size: 24px; text-align:center; white-space: nowrap; }
.wc-boxes { display:inline-flex; align-items:center; gap:8px; }
.wc-sbox { display:inline-block; width:56px; height:44px; border:2px solid #000; border-radius:4px; }
.wc-sitouts { font-size: 22px; margin-top: 14px; padding: 10px 12px; border: 2px dashed #000; }
.wc-label { font-weight: 800; }
.wc-table { width:100%; border-collapse: collapse; }
.wc-table th, .wc-table td { border: 1px solid #000; padding: 6px 8px; text-align:center; }
.wc-table th { font-size: 18px; background: #fff; }
.wc-left { text-align:left !important; }
.wc-name { font-weight: 700; white-space: nowrap; }
.wc-tag { font-weight: 400; font-size: 15px; }
.wc-checkin td { font-size: 20px; height: 34px; }
.wc-box-col { width: 70px; }
.wc-box { display:inline-block; width:26px; height:26px; border:2px solid #000; border-radius:3px; line-height:24px; font-weight:900; vertical-align: middle; }
.wc-standings td { font-size: 22px; }
.wc-strong { font-weight: 900; }
.wc-teams { font-size: 30px; font-weight: 700; text-align:center; margin-bottom: 18px; padding: 10px; border: 3px solid #000; }
.wc-teams b { font-size: 40px; margin: 0 18px; }
@media print {
  @page { size: letter portrait; margin: 0.45in; }
  body { background:#fff !important; }
  body > :not(#wc-print) { display:none !important; }
  #wc-print { padding:0; min-height:0; }
  .wc-toolbar { display:none !important; }
  .wc-page { border:none; padding:0; margin:0; max-width:none; break-after: page; page-break-after: always; }
  .wc-page:last-child { break-after: auto; page-break-after: auto; }
  .wc-courts tr, .wc-table tr { break-inside: avoid; page-break-inside: avoid; }
}
`;
