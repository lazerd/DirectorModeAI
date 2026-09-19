import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseSchedule, parseMatchLine, slotTo24, spokenName, spokenRound,
  spokenEvent, announcementText, diffForAnnouncement, scheduleUrl,
  type TopDogMatch,
} from './topdog';

/**
 * The real page, saved on tournament morning. Parsing is regex over
 * machine-generated ASP, so the only test worth having is the one that runs
 * against the actual bytes TopDog serves.
 */
const HTML = readFileSync(join(__dirname, '__fixtures__/topdog-schedule.html'), 'utf8');

const parsed = parseSchedule(HTML, '1715');

function match(over: Partial<TopDogMatch> = {}): TopDogMatch {
  return {
    id: 'm1', slot: '8:00am', slot24: '08:00', court: null,
    event: "Boys' 10 Singles", round: 'Round 16',
    playerA: 'Bennett J Stocker', playerB: 'Niam R Pathare',
    winner: null, defaulted: false, completed: false, ready: true,
    ...over,
  };
}

describe('parseSchedule', () => {
  it('reads the tournament name and the selected day', () => {
    expect(parsed.tournamentName).toBe('#2 RSPA/USPTA Jr Circuit Sleepy Hollow T&S');
    expect(parsed.date).toBe('9/19/2026');
  });

  it('offers every day of the tournament', () => {
    expect(parsed.dates.map((d) => d.value)).toEqual(['9/18/2026', '9/19/2026', '9/20/2026']);
    expect(parsed.dates.find((d) => d.selected)?.label).toBe('Saturday, September 19, 2026');
  });

  it('treats "Unknown Court" as no court at all', () => {
    expect(parsed.courts).toEqual([]);
    expect(parsed.matches.every((m) => m.court === null)).toBe(true);
  });

  it('finds every match on the sheet', () => {
    // Nine time slots on the page; the 8am wave has nine matches.
    const slots = [...new Set(parsed.matches.map((m) => m.slot))];
    expect(slots).toEqual([
      '8:00am', '9:30am', '11:00am', '12:00pm', '12:30pm', '1:30pm', '2:00pm',
    ]);
    expect(parsed.matches.filter((m) => m.slot === '8:00am')).toHaveLength(9);
  });

  it('splits event, round and both players', () => {
    const first = parsed.matches[0];
    expect(first.event).toBe("Boys' 10 Singles");
    expect(first.round).toBe('Round 16');
    expect(first.playerA).toBe('Bennett J Stocker');
    expect(first.playerB).toBe('Niam R Pathare');
    expect(first.ready).toBe(true);
  });

  it('marks a defaulted match as done, not callable', () => {
    const d = parsed.matches.find((m) => m.defaulted);
    expect(d?.winner).toBe('Massimo Cardenas');
    expect(d?.playerB).toBe('Rory Frase');
    expect(d?.completed).toBe(true);
    expect(d?.ready).toBe(false);
  });

  it('keeps matches whose players are still to be decided', () => {
    const tbd = parsed.matches.find(
      (m) => m.slot === '12:30pm' && m.event === "Boys' 14 Singles" && m.round === 'Semis'
    );
    expect(tbd).toBeTruthy();
    expect(tbd?.playerA).toBe('');
    expect(tbd?.playerB).toBe('');
    expect(tbd?.ready).toBe(false);
  });

  it('handles a half-decided match', () => {
    const half = parsed.matches.find(
      (m) => m.slot === '2:00pm' && m.playerA === 'Kylie Friedli'
    );
    expect(half?.round).toBe('Semis');
    expect(half?.playerB).toBe('');
    expect(half?.ready).toBe(false);
  });

  it('reads a consolation round without eating the player name', () => {
    const consol = parsed.matches.find(
      (m) => m.round === 'Consol Quarters' && m.playerA === 'Rory Frase'
    );
    expect(consol).toBeTruthy();
    expect(consol?.event).toBe("Boys' 10 Singles");
  });

  it('gives every match a distinct id', () => {
    const ids = parsed.matches.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('parseMatchLine', () => {
  it('ignores the trailing &nbsp; padding TopDog adds to a cell', () => {
    expect(parseMatchLine('&nbsp;')).toBeNull();
    expect(parseMatchLine('   ')).toBeNull();
  });

  it('handles "Consol 1", where the round is a bare number', () => {
    const m = parseMatchLine("Boys' 10 Singles Consol 1  vs. ");
    expect(m?.round).toBe('Consol 1');
    expect(m?.playerA).toBe('');
  });

  it('does not mistake a first name for a round', () => {
    const m = parseMatchLine("Girls' 12 Singles Quarters Emily Hull vs. Brooklyn Wilson");
    expect(m?.round).toBe('Quarters');
    expect(m?.playerA).toBe('Emily Hull');
  });
});

describe('slotTo24', () => {
  it('converts the clock TopDog prints', () => {
    expect(slotTo24('8:00am')).toBe('08:00');
    expect(slotTo24('12:00pm')).toBe('12:00');
    expect(slotTo24('12:30pm')).toBe('12:30');
    expect(slotTo24('1:30pm')).toBe('13:30');
  });

  it('rejects anything that is not a time', () => {
    expect(slotTo24('Unknown Court')).toBe('');
    expect(slotTo24('')).toBe('');
  });
});

describe('speech', () => {
  it('drops middle initials', () => {
    expect(spokenName('Bennett J Stocker')).toBe('Bennett Stocker');
    expect(spokenName('Sahej Preet S Batra')).toBe('Sahej Preet Batra');
    expect(spokenName('Emily Hull')).toBe('Emily Hull');
  });

  it('spells rounds out the way a person says them', () => {
    expect(spokenRound('Round 16')).toBe('round of sixteen');
    expect(spokenRound('Quarters')).toBe('quarterfinal');
    expect(spokenRound('Consol Quarters')).toBe('consolation quarterfinal');
    expect(spokenRound('Consol 1')).toBe('consolation round one');
    expect(spokenRound('Semis')).toBe('semifinal');
  });

  it('says the age group rather than the digits', () => {
    expect(spokenEvent("Boys' 10 Singles")).toBe('boys ten singles');
    expect(spokenEvent("Girls' 14 Singles")).toBe('girls fourteen singles');
  });

  it('puts the court at both ends of the call', () => {
    const text = announcementText(match(), '5');
    expect(text).toBe(
      'Attention please. On court 5, boys ten singles, round of sixteen. ' +
      'Bennett Stocker versus Niam Pathare. Players report to court 5.'
    );
  });

  it('sends players to the desk when no court has been chosen', () => {
    const text = announcementText(match());
    expect(text).toContain('report to the tournament desk');
    expect(text).not.toContain('court');
  });
});

describe('diffForAnnouncement', () => {
  const tbd = match({ id: 'a', playerA: '', playerB: '', ready: false });
  const filled = match({ id: 'a' });

  it('calls a match the moment both names appear', () => {
    expect(diffForAnnouncement([tbd], [filled], new Set()).map((m) => m.id)).toEqual(['a']);
  });

  it('does not replay the sheet on the first poll of the day', () => {
    expect(diffForAnnouncement([], [filled], new Set())).toEqual([]);
  });

  it('never calls the same match twice', () => {
    expect(diffForAnnouncement([tbd], [filled], new Set(['a']))).toEqual([]);
  });

  it('ignores a match that finished before we noticed it', () => {
    const done = match({ id: 'a', completed: true, ready: false });
    expect(diffForAnnouncement([tbd], [done], new Set())).toEqual([]);
  });
});

describe('scheduleUrl', () => {
  it('asks TopDog for a specific day', () => {
    expect(scheduleUrl('1715', '9/19/2026')).toBe(
      'https://sleepyhollowswimtennis.topdoglive.com/pages/tournaments/courtschedule.asp' +
      '?tournamentid=1715&currentdate=9%2F19%2F2026'
    );
  });
});

describe('match identity', () => {
  /** A one-slot sheet whose 8:00 cell holds `lines`, in that order. */
  function sheet(lines: string[]): string {
    return `<h2>T</h2><select><option value="9/19/2026" selected>Sat</option></select>
      <table class="table table-striped">
        <tr><td></td><td>Unknown Court</td></tr>
        <tr><td>8:00am</td><td class="matches">${lines.join('<br>')}&nbsp;</td></tr>
      </table>`;
  }
  const collins = "Boys' 10 Singles Round 16 Declan Collins vs. Owen Choi";
  const stocker = "Boys' 10 Singles Round 16 Bennett J Stocker vs. Niam R Pathare";
  const dflt = "Boys' 10 Singles Round 16 <b>Massimo Cardenas</b> vs. Rory Frase (default)";

  it('survives TopDog reordering the cell as results come in', () => {
    // This reorder is what moved a court onto the neighbouring match.
    const before = parseSchedule(sheet([stocker, collins, dflt]), '1715').matches;
    const after = parseSchedule(sheet([dflt, stocker, collins]), '1715').matches;
    const idOf = (ms: typeof before, name: string) => ms.find((x) => x.playerA === name)!.id;
    expect(idOf(after, 'Declan Collins')).toBe(idOf(before, 'Declan Collins'));
    expect(idOf(after, 'Bennett J Stocker')).toBe(idOf(before, 'Bennett J Stocker'));
  });

  it('keeps the old positional id so a saved desk can be carried over', () => {
    const [first] = parseSchedule(sheet([stocker]), '1715').matches;
    expect(first.legacyId).toBe("9/19/2026|08:00|0|0|Boys' 10 Singles|Round 16");
  });

  it('pulls a finished score off the end of the second name', () => {
    const line = parseMatchLine("Boys' 14 Singles Round 16 Sahej Preet S Batra vs. Jason Lee (6-2,6-1)");
    expect(line?.playerB).toBe('Jason Lee');
    expect(line?.score).toBe('6-2,6-1');
  });

  it('treats a match with a score on the sheet as finished', () => {
    const [m] = parseSchedule(
      sheet(["Boys' 14 Singles Round 16 Sahej Preet S Batra vs. Jason Lee (6-2,6-1)"]), '1715'
    ).matches;
    expect(m.completed).toBe(true);
    expect(m.ready).toBe(false);
    expect(m.score).toBe('6-2,6-1');
  });
});
