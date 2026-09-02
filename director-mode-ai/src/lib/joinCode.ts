/**
 * Club join codes.
 *
 * The code in `/join/<code>` is a PASSWORD, not a name. Redeeming it makes the
 * caller a member of the club, and `is_club_member()` gates the club roster,
 * courts, reservations and season planning in RLS. A code anyone could guess
 * from the club's name — `SleepyHollow` — is an open door to member data.
 *
 * So: a director may brand the code, but not make it derivable from the club's
 * own name. `SHTENNIS26` is fine. `SLEEPYHOLLOW` is not, and the rejection says
 * why rather than just failing validation.
 */

const ALLOWED = /^[A-Z0-9][A-Z0-9-]{4,23}$/;

/** Codes are stored and compared in upper case. */
export function normalizeJoinCode(raw: string): string {
  return (raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

/** Letters only, for comparing a code against a club's name. */
function lettersOf(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z]/g, '');
}

export type JoinCodeCheck = { ok: true; code: string } | { ok: false; error: string };

export function validateJoinCode(raw: string, clubName: string, clubSlug?: string | null): JoinCodeCheck {
  const code = normalizeJoinCode(raw);

  if (!code) return { ok: false, error: 'Enter a code.' };
  if (code.length < 5) return { ok: false, error: 'Make it at least 5 characters.' };
  if (code.length > 24) return { ok: false, error: 'Keep it under 24 characters.' };
  if (!ALLOWED.test(code)) {
    return { ok: false, error: 'Letters, numbers and dashes only — no spaces or punctuation.' };
  }

  /**
   * The whole point of the check: a code that is nothing but the club's name is
   * guessable by anyone who knows where you work.
   *
   * Name PLUS a couple of digits is allowed, deliberately. "SLEEPYHOLLOW26" is
   * what a director actually wants to put on a poster, and the guess space is
   * no longer "the club name" — it is the club name times every number someone
   * might have picked. The line is drawn at two digits because one ("SLEEPY7")
   * is a coin toss to guess.
   */
  const codeLetters = lettersOf(code);
  const nameLetters = lettersOf(clubName);
  const slugLetters = lettersOf(clubSlug || '');
  const digits = (code.match(/\d/g) || []).length;
  const isNameDerived =
    codeLetters.length >= 5 &&
    ((nameLetters && nameLetters.includes(codeLetters)) ||
      (slugLetters && slugLetters.includes(codeLetters)));
  const guessable = isNameDerived && digits < 2;

  if (guessable) {
    return {
      ok: false,
      error:
        'That is your club name, so anyone could guess it — and this code lets whoever has it join and see your roster. Add something only your people would know, like a couple of numbers: ' +
        `${codeLetters.slice(0, 8).toUpperCase()}${new Date().getFullYear() % 100}.`,
    };
  }

  return { ok: true, code };
}

/** A fresh random code, for the rotate button. Unambiguous characters only. */
export function randomJoinCode(length = 6): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
