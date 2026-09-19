/**
 * Reading a TopDog tournament's public match schedule (courtschedule.asp).
 *
 * The page needs no login and shows one day at a time: a header row of court
 * names ("Unknown Court" until courts are assigned), then one row per start
 * time with a cell per court. Each cell lists that slot's matches, one per
 * <br>, as "Boys' 10 Singles Round 16 Ann B vs. Cat D". A played match bolds
 * the winner and ends with its score or "(default)". A side still waiting on
 * an earlier result is simply blank.
 *
 * Nothing here writes to TopDog. See the /api/topdog/schedule route.
 */

export type TopDogMatch = {
  /** Stable within a day: time + court + ordinal in that cell. */
  key: string;
  time: string;
  /** Minutes after midnight, for sorting and "is it time yet". */
  minutes: number;
  court: string | null;
  event: string;
  round: string;
  playerA: string;
  playerB: string;
  /** Winner's side once the match is played. */
  winner: 'A' | 'B' | null;
  /** "6-2,6-3", "default", "retired"… — whatever TopDog put in brackets. */
  result: string | null;
};

export type TopDogSchedule = {
  name: string;
  dates: { value: string; label: string; selected: boolean }[];
  date: string | null;
  matches: TopDogMatch[];
};

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&nbsp;': ' ',
  '&#39;': "'",
  '&quot;': '"',
  '&lt;': '<',
  '&gt;': '>',
};

function decode(s: string): string {
  return s
    .replace(/&(amp|nbsp|#39|quot|lt|gt);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function text(html: string): string {
  return decode(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

export function parseTimeToMinutes(t: string): number {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*([ap])m$/i);
  if (!m) return 24 * 60;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'p') h += 12;
  return h * 60 + Number(m[2]);
}

// "Round 16", "Quarters", "Semis", "Finals", "Consol 1", "Consol Quarters"…
const ROUND = /^((?:Consol(?:ation)?\s+)?(?:Round\s+\d+|Quarters|Semis|Finals?|\d+)|Consol(?:ation)?\s+\w+)\s+/i;

/** One "<event> <round> A vs. B (result)" line from a schedule cell. */
export function parseMatchLine(raw: string): Omit<TopDogMatch, 'key' | 'time' | 'minutes' | 'court'> | null {
  const bolded = /<b>/i.test(raw);
  const clean = text(raw);
  const vs = clean.indexOf(' vs.');
  if (vs < 0) return null;

  // Event names end at "Singles" or "Doubles"; the round follows.
  const ev = clean.match(/^(.*?\b(?:Singles|Doubles|Mixed))\s*/i);
  if (!ev) return null;
  const event = ev[1].trim();
  let rest = clean.slice(ev[0].length);
  let round = '';
  const r = rest.match(ROUND);
  if (r && rest.indexOf(' vs.') > -1 && r[0].length <= rest.indexOf(' vs.') + 1) {
    round = r[1].trim();
    rest = rest.slice(r[0].length);
  }

  const [left, right = ''] = rest.split(/\s*vs\.\s*/);
  let playerB = right.trim();
  let result: string | null = null;
  const res = playerB.match(/\s*\(([^)]*)\)\s*$/);
  if (res) {
    result = res[1].trim();
    playerB = playerB.slice(0, res.index).trim();
  }

  // Which side was bolded? Compare against the raw halves.
  let winner: 'A' | 'B' | null = null;
  if (bolded) {
    const vsRaw = raw.indexOf(' vs.');
    const b = raw.search(/<b>/i);
    winner = vsRaw > -1 && b > vsRaw ? 'B' : 'A';
  }

  return { event, round, playerA: left.trim(), playerB, winner, result };
}

export function parseCourtSchedule(html: string): TopDogSchedule {
  const title = html.match(/<title>([^<]*)<\/title>/i);
  const name = title
    ? text(title[1]).replace(/\s*\|\s*TopDog Sports\s*$/i, '').replace(/\s*Match Schedule\s*$/i, '').trim()
    : 'TopDog tournament';

  const dates: TopDogSchedule['dates'] = [];
  const sel = html.match(/<select[^>]*name="currentdate"[^>]*>([^]*?)<\/select>/i);
  if (sel) {
    for (const o of sel[1].matchAll(/<option\s+value="([^"]*)"([^>]*)>([^<]*)<\/option>/gi)) {
      dates.push({ value: o[1], label: text(o[3]), selected: /selected/i.test(o[2]) });
    }
  }
  const date = dates.find((d) => d.selected)?.value ?? null;

  const matches: TopDogMatch[] = [];
  const table = html.match(/<table class="table table-striped">([^]*?)<\/table>/i);
  if (table) {
    const rows = [...table[1].matchAll(/<tr[^>]*>([^]*?)<\/tr>/gi)].map((r) =>
      [...r[1].matchAll(/<td([^>]*)>([^]*?)<\/td>/gi)].map((c) => ({ attrs: c[1], html: c[2] })),
    );
    const header = rows[0] ?? [];
    const courts = header.slice(1).map((c) => {
      const t = text(c.html);
      return /^unknown court$/i.test(t) || !t ? null : t;
    });
    for (const row of rows.slice(1)) {
      if (row.length < 2) continue;
      const time = text(row[0].html);
      const minutes = parseTimeToMinutes(time);
      row.slice(1).forEach((cell, ci) => {
        const court = courts[ci] ?? null;
        cell.html
          .split(/<br\s*\/?>/i)
          .map((l) => l.trim())
          .filter((l) => text(l))
          .forEach((line, i) => {
            const m = parseMatchLine(line);
            if (!m) return;
            matches.push({ ...m, key: `${time}|${court ?? '-'}|${i}`, time, minutes, court });
          });
      });
    }
  }
  matches.sort((a, b) => a.minutes - b.minutes);
  return { name, dates, date, matches };
}
