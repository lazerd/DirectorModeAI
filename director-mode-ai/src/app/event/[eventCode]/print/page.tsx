/**
 * /event/[eventCode]/print — Wild Card court sheets for the club board.
 *
 * Built for the people reading it: large type, black on white, one page per
 * round (Court → Team vs Team, who's sitting out, a blank for the score), then
 * a master sheet where each player finds their own name and reads across
 * every round. `?sheet=rounds|master|standings` prints just one of them.
 *
 * Public like the event page itself (the code is what players are given).
 * Server-rendered so the director can print straight from any browser.
 */

import { notFound } from 'next/navigation';
import { format } from 'date-fns';
import { loadWildCardBoard, type BoardCourt, type BoardPerson, type WildCardBoard } from '@/lib/wildCardBoard';
import { formatTimeDisplay } from '@/lib/quads';
import { WILD_CARD_LABEL } from '@/lib/wildCard';
import PrintButton from './PrintButton';

export const dynamic = 'force-dynamic';

type Sheet = 'all' | 'rounds' | 'master' | 'standings';

const names = (team: BoardPerson[]) => team.map((p) => p.name).join(' & ');

export default async function WildCardPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventCode: string }>;
  searchParams: Promise<{ sheet?: string }>;
}) {
  const { eventCode } = await params;
  const { sheet: sheetParam } = await searchParams;
  const board = await loadWildCardBoard(eventCode);
  if (!board) return notFound();

  const sheet: Sheet = (['rounds', 'master', 'standings'] as const).includes(sheetParam as any)
    ? (sheetParam as Sheet)
    : 'all';
  const showRounds = sheet === 'all' || sheet === 'rounds';
  const showMaster = sheet === 'all' || sheet === 'master';
  const showStandings = sheet === 'standings' || (sheet === 'all' && board.anyScores);

  const { event } = board;
  const dateLine = [
    event.event_date ? format(new Date(event.event_date + 'T00:00:00'), 'EEEE, MMMM d, yyyy') : null,
    formatTimeDisplay(event.start_time),
    event.venue,
  ]
    .filter(Boolean)
    .join(' · ');
  const base = `/event/${event.event_code}/print`;

  return (
    <div id="wc-print">
      <style>{PRINT_CSS}</style>

      <nav className="wc-toolbar">
        <PrintButton />
        <a className={`wc-btn ${sheet === 'all' ? 'wc-on' : ''}`} href={base}>Everything</a>
        <a className={`wc-btn ${sheet === 'rounds' ? 'wc-on' : ''}`} href={`${base}?sheet=rounds`}>Round sheets</a>
        <a className={`wc-btn ${sheet === 'master' ? 'wc-on' : ''}`} href={`${base}?sheet=master`}>Master sheet</a>
        <a className={`wc-btn ${sheet === 'standings' ? 'wc-on' : ''}`} href={`${base}?sheet=standings`}>Standings</a>
        <a className="wc-btn" href={`/event/${event.event_code}`}>Phone view</a>
      </nav>

      {board.rounds.length === 0 && (
        <section className="wc-page">
          <Header board={board} title="No rounds yet" dateLine={dateLine} />
          <p className="wc-big">The director hasn&apos;t built the schedule yet.</p>
        </section>
      )}

      {showRounds &&
        board.rounds.map((round) => (
          <section key={round.round_number} className="wc-page">
            <Header board={board} title={`Round ${round.round_number}`} dateLine={dateLine} />
            <table className="wc-courts">
              <thead>
                <tr>
                  <th className="wc-court-col">Court</th>
                  <th>Team</th>
                  <th className="wc-vs-col" />
                  <th>Team</th>
                  <th className="wc-score-col">Score</th>
                </tr>
              </thead>
              <tbody>
                {round.courts.map((c) => (
                  <CourtRow key={c.court_number} court={c} />
                ))}
              </tbody>
            </table>
            {round.sitOuts.length > 0 && (
              <div className="wc-sitouts">
                <span className="wc-label">Sitting out:</span> {round.sitOuts.map((p) => p.name).join(', ')}
              </div>
            )}
          </section>
        ))}

      {showMaster && board.rounds.length > 0 && <MasterSheet board={board} dateLine={dateLine} />}

      {showStandings && (
        <section className="wc-page">
          <Header board={board} title="Standings" dateLine={dateLine} />
          {!board.anyScores ? (
            <p className="wc-big">No scores entered yet.</p>
          ) : (
            <table className="wc-table wc-standings">
              <thead>
                <tr>
                  <th>#</th>
                  <th className="wc-left">Player</th>
                  <th>Games won</th>
                  <th>Rounds won</th>
                  <th>Played</th>
                </tr>
              </thead>
              <tbody>
                {board.standings.map((s) => (
                  <tr key={s.id}>
                    <td>{s.rank}</td>
                    <td className="wc-left wc-name">{s.name}</td>
                    <td className="wc-strong">{s.gamesWon}</td>
                    <td>{s.wins}</td>
                    <td>{s.played}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="wc-note">Partners rotate, so the Wild Card crowns an individual: most games won, then most rounds won.</p>
        </section>
      )}
    </div>
  );
}

function Header({ board, title, dateLine }: { board: WildCardBoard; title: string; dateLine: string }) {
  return (
    <header className="wc-header">
      <div className="wc-event">{board.event.name}</div>
      <h1>{title}</h1>
      <div className="wc-sub">
        {WILD_CARD_LABEL}
        {board.event.mode === 'mixed' ? ' · mixed' : ''}
        {dateLine ? ` · ${dateLine}` : ''}
      </div>
    </header>
  );
}

function CourtRow({ court }: { court: BoardCourt }) {
  return (
    <tr>
      <td className="wc-court">{court.court_number}</td>
      <td className="wc-team">
        {court.teamA.map((p) => (
          <div key={p.id}>{p.name}</div>
        ))}
      </td>
      <td className="wc-vs">vs</td>
      <td className="wc-team">
        {court.teamB.map((p) => (
          <div key={p.id}>{p.name}</div>
        ))}
      </td>
      <td className="wc-score">{court.scored ? `${court.scoreA} – ${court.scoreB}` : '____ – ____'}</td>
    </tr>
  );
}

/** Every player down the side, every round across: "Ct 4 · with Carol · vs Bill & Ann". */
function MasterSheet({ board, dateLine }: { board: WildCardBoard; dateLine: string }) {
  type Cell = { court?: number; partner?: string; opponents?: string; sitting?: boolean };
  const grid = new Map<string, Cell[]>(board.players.map((p) => [p.id, []]));
  board.rounds.forEach((round, r) => {
    for (const c of round.courts) {
      const sides = [
        [c.teamA, c.teamB],
        [c.teamB, c.teamA],
      ] as const;
      for (const [mine, theirs] of sides) {
        for (const p of mine) {
          const row = grid.get(p.id);
          if (!row) continue;
          row[r] = {
            court: c.court_number,
            partner: mine.filter((x) => x.id !== p.id).map((x) => x.name).join(' & '),
            opponents: names(theirs),
          };
        }
      }
    }
    for (const p of round.sitOuts) {
      const row = grid.get(p.id);
      if (row) row[r] = { sitting: true };
    }
  });
  const wide = board.rounds.length > 3;

  return (
    <section className={`wc-page ${wide ? 'wc-landscape' : ''}`}>
      <Header board={board} title="Master sheet — find your name" dateLine={dateLine} />
      <table className="wc-table wc-master">
        <thead>
          <tr>
            <th className="wc-left">Player</th>
            {board.rounds.map((r) => (
              <th key={r.round_number}>Round {r.round_number}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {board.players
            .filter((p) => (grid.get(p.id) || []).some(Boolean))
            .map((p) => (
              <tr key={p.id}>
                <td className="wc-left wc-name">{p.name}</td>
                {board.rounds.map((r, i) => {
                  const cell = grid.get(p.id)![i];
                  if (!cell) return <td key={r.round_number}>—</td>;
                  if (cell.sitting) return <td key={r.round_number} className="wc-sit">Sitting out</td>;
                  return (
                    <td key={r.round_number} className="wc-left">
                      <div className="wc-cell-court">Court {cell.court}</div>
                      <div>with {cell.partner}</div>
                      <div className="wc-cell-vs">vs {cell.opponents}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  );
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
.wc-courts { width:100%; border-collapse: collapse; }
.wc-courts th { font-size: 18px; text-align:left; border-bottom: 2px solid #000; padding: 6px 8px; }
.wc-courts td { border-bottom: 1px solid #000; padding: 10px 8px; vertical-align: middle; }
.wc-court-col { width: 90px; }
.wc-vs-col { width: 50px; }
.wc-score-col { width: 170px; }
.wc-court { font-size: 44px; font-weight: 900; text-align:center; }
.wc-team { font-size: 28px; font-weight: 700; line-height: 1.25; }
.wc-vs { font-size: 20px; text-align:center; font-style: italic; }
.wc-score { font-size: 24px; text-align:center; white-space: nowrap; }
.wc-sitouts { font-size: 26px; margin-top: 18px; padding: 10px 12px; border: 2px dashed #000; }
.wc-label { font-weight: 800; }
.wc-table { width:100%; border-collapse: collapse; }
.wc-table th, .wc-table td { border: 1px solid #000; padding: 6px 8px; text-align:center; }
.wc-table th { font-size: 18px; background: #fff; }
.wc-left { text-align:left !important; }
.wc-name { font-weight: 700; white-space: nowrap; }
.wc-standings td { font-size: 24px; }
.wc-strong { font-weight: 900; }
.wc-master td { font-size: 16px; line-height: 1.25; vertical-align: top; }
.wc-master .wc-name { font-size: 18px; }
.wc-cell-court { font-weight: 900; font-size: 18px; }
.wc-cell-vs { font-size: 14px; }
.wc-sit { font-style: italic; font-weight: 700; }
@media print {
  @page { size: letter portrait; margin: 0.45in; }
  body { background:#fff !important; }
  body > :not(#wc-print) { display:none !important; }
  #wc-print { padding:0; min-height:0; }
  .wc-toolbar { display:none !important; }
  .wc-page { border:none; padding:0; margin:0; max-width:none; break-after: page; page-break-after: always; }
  .wc-page:last-child { break-after: auto; page-break-after: auto; }
  .wc-courts tr, .wc-table tr { break-inside: avoid; page-break-inside: avoid; }
  .wc-landscape .wc-master td { font-size: 13px; }
  .wc-landscape .wc-cell-court { font-size: 15px; }
  .wc-landscape .wc-cell-vs { font-size: 12px; }
}
`;
