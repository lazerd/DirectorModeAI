const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'nPczCjzI2devNBz1zQrb'; // Brian — hype announcer
const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5';

export interface TtsOptions {
  voiceId?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  styleExaggeration?: number;
}

export async function generateAnnouncerMp3(text: string, opts: TtsOptions = {}): Promise<Buffer> {
  if (!API_KEY) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }
  const voice = opts.voiceId || VOICE_ID;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: opts.modelId || MODEL,
      voice_settings: {
        stability: opts.stability ?? 0.4,
        similarity_boost: opts.similarityBoost ?? 0.75,
        style: opts.styleExaggeration ?? 0.65, // hype-leaning
        use_speaker_boost: true,
      },
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${errBody.slice(0, 300)}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

export function buildAnnouncementText(playerName: string, courtNumber?: number | null): string {
  if (courtNumber != null) {
    return `Now arriving on Court ${courtNumber}… ${playerName}!`;
  }
  return `Coming to the court… ${playerName}!`;
}
