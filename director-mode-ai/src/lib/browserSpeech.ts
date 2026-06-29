/**
 * Browser speech helper — uses the FREE built-in Web Speech API
 * (window.speechSynthesis) for DJ Console announcements. No paid TTS.
 *
 * This is a stripped-down replacement for the old ElevenLabs integration:
 * a single default voice, spoken aloud through the device's speakers.
 */

let cachedVoices: SpeechSynthesisVoice[] = [];
let currentUtterance: SpeechSynthesisUtterance | null = null;

/** Detach handlers from the in-flight utterance so a stop/replace can't
 *  trigger its onend (which would otherwise double-fire walkout + advance). */
function detachCurrent(): void {
  if (currentUtterance) {
    currentUtterance.onend = null;
    currentUtterance.onerror = null;
    currentUtterance = null;
  }
}

function loadVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || typeof window.speechSynthesis === 'undefined') {
    return [];
  }
  const list = window.speechSynthesis.getVoices();
  if (list.length > 0) cachedVoices = list;
  return cachedVoices;
}

// Warm the voice cache as soon as this module loads in the browser. Voices can
// arrive asynchronously, so we also listen for the onvoiceschanged event.
if (typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined') {
  loadVoices();
  try {
    window.speechSynthesis.onvoiceschanged = () => loadVoices();
  } catch {
    // ignore — some browsers don't support the event setter
  }
}

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
}

function pickDefaultVoice(): SpeechSynthesisVoice | null {
  const voices = loadVoices();
  if (voices.length === 0) return null;
  return voices.find((v) => v.lang.startsWith('en')) || voices[0] || null;
}

export interface SpeakOptions {
  onend?: () => void;
  onerror?: () => void;
  rate?: number;
  pitch?: number;
  volume?: number;
}

/**
 * Speak `text` aloud using the browser's default voice. Handlers in `opts`
 * fire when speech ends or errors. Safe to call on the server (no-op).
 *
 * Handles the voices-not-loaded-yet race: if getVoices() is still empty we
 * speak anyway (the engine falls back to its system default voice), so the
 * announcement is never silently dropped.
 */
export function speakText(text: string, opts: SpeakOptions = {}): void {
  if (!isSpeechSupported() || !text.trim()) {
    // Still fire onend so callers that chain (e.g. walkout song) don't stall.
    opts.onend?.();
    return;
  }

  const utter = new SpeechSynthesisUtterance(text);
  const voice = pickDefaultVoice();
  if (voice) utter.voice = voice;
  utter.rate = opts.rate ?? 0.95;
  utter.pitch = opts.pitch ?? 1.0;
  utter.volume = opts.volume ?? 1.0;
  utter.onend = () => {
    if (currentUtterance === utter) currentUtterance = null;
    opts.onend?.();
  };
  utter.onerror = () => {
    if (currentUtterance === utter) currentUtterance = null;
    opts.onerror?.();
  };

  // Drop any prior utterance's handlers and clear the queue so cues don't overlap.
  detachCurrent();
  window.speechSynthesis.cancel();
  currentUtterance = utter;
  window.speechSynthesis.speak(utter);
}

export function cancelSpeech(): void {
  if (!isSpeechSupported()) return;
  detachCurrent();
  window.speechSynthesis.cancel();
}
