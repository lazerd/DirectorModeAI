/**
 * Speech, shared by the announcer and the board.
 *
 * Everything is the browser's own speech engine, so the sound comes out of
 * whatever device is being used: the desk laptop drives the PA, and a parent
 * tapping the same button on their phone only ever talks to themselves.
 * That is what makes it safe to put a call button on a public page.
 */

/**
 * Best voices first. The Google entries are network voices and are far
 * clearer over a PA than the bundled Microsoft ones. US English leads
 * because this is a California club.
 */
export const VOICE_PREFERENCE = [
  'Google US English',
  'Google UK English Male',
  'Google UK English Female',
  'Microsoft Mark',
  'Microsoft David',
  'Microsoft Zira',
];

export function englishVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
}

/** The best available voice, or the saved preference if it still exists. */
export function pickVoice(saved?: string | null): string {
  const all = englishVoices();
  if (!all.length) return '';
  if (saved && all.some((v) => v.name === saved)) return saved;
  const preferred = VOICE_PREFERENCE.find((name) => all.some((v) => v.name.startsWith(name)));
  const match = preferred ? all.find((v) => v.name.startsWith(preferred)) : all[0];
  return match?.name ?? '';
}

/**
 * Rate is dialled back on purpose. Outdoors, over a PA, against kids and
 * parents talking, default speed turns names into mush.
 */
export const PA_RATE = 0.85;

/** Gap between the two readings of a call, in ms. */
const REPEAT_GAP_MS = 900;

let queue: Promise<void> = Promise.resolve();

function utter(text: string, voiceName: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      const v = speechSynthesis.getVoices().find((x) => x.name === voiceName);
      if (v) u.voice = v;
      u.rate = PA_RATE;
      u.pitch = 1;
      u.volume = 1;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
    } catch {
      resolve();
    }
  });
}

/**
 * Say something over the PA. Strictly serialised — two overlapping voices
 * are worse than silence — and repeatable, because nobody in a clubhouse
 * catches a name the first time.
 */
export function speak(
  text: string,
  opts: { voice: string; times?: number } = { voice: '' }
): Promise<void> {
  const times = Math.max(1, opts.times ?? 1);
  queue = queue
    .then(async () => {
      for (let i = 0; i < times; i++) {
        await utter(text, opts.voice);
        if (i < times - 1) await new Promise((r) => setTimeout(r, REPEAT_GAP_MS));
      }
    })
    .catch(() => undefined);
  return queue;
}

/** Kill everything queued and shut the PA up immediately. */
export function stopSpeaking(): void {
  try {
    speechSynthesis.cancel();
  } catch {
    /* nothing playing */
  }
  queue = Promise.resolve();
}

/**
 * "Amber Smith and Sue Johnson, please report to the tournament desk."
 *
 * No court number: this is the call that goes out when the desk wants the
 * players to come to it, before a court has been decided. A side that is
 * still TBD is left out rather than announced as "TBD".
 */
export function reportToDeskText(playerA: string, playerB: string): string {
  const names = [playerA, playerB]
    .map((n) => (n ?? '').trim())
    .filter((n) => n && n.toUpperCase() !== 'TBD');

  if (names.length === 0) return 'Players, please report to the tournament desk.';
  const spoken = names.length === 1 ? names[0] : `${names[0]} and ${names[1]}`;
  return `${spoken}, please report to the tournament desk.`;
}
