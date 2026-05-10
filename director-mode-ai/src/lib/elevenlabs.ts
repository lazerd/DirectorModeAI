const API_KEY = process.env.ELEVENLABS_API_KEY;
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'nPczCjzI2devNBz1zQrb';
const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5';

export interface TtsOptions {
  voiceId?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  styleExaggeration?: number;
}

/**
 * Curated voice presets for the DJ Console announcer. Each is tuned with
 * stability + style values that match its delivery style.
 */
export interface VoicePreset {
  id: string;
  label: string;
  description: string;
  voiceId: string;
  stability: number;
  similarityBoost: number;
  styleExaggeration: number;
}

export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: 'hype',
    label: 'Hype Announcer',
    description: 'Boxing-ring, "let\'s get ready to rumble" energy',
    voiceId: 'ErXwobaYiN019PkySvjV', // Antoni — warm American, pushed to max style
    stability: 0.25,
    similarityBoost: 0.85,
    styleExaggeration: 0.95,
  },
  {
    id: 'stadium',
    label: 'Stadium Pro',
    description: 'Deep, broadcast-booth authority',
    voiceId: 'pNInz6obpgDQGcFmaJgB', // Adam — deep American narrator
    stability: 0.4,
    similarityBoost: 0.8,
    styleExaggeration: 0.7,
  },
  {
    id: 'smooth',
    label: 'Smooth Host',
    description: 'Modern, casual, friendly emcee (default)',
    voiceId: 'nPczCjzI2devNBz1zQrb', // Brian — young narrator
    stability: 0.4,
    similarityBoost: 0.75,
    styleExaggeration: 0.65,
  },
  {
    id: 'british',
    label: 'British Class',
    description: 'Wimbledon-style commentary',
    voiceId: 'onwK4e9ZLuTAKqWW03F9', // Daniel — British authoritative
    stability: 0.5,
    similarityBoost: 0.75,
    styleExaggeration: 0.55,
  },
];

export const DEFAULT_VOICE_PRESET_ID = 'hype';

export function getVoicePreset(id: string | undefined | null): VoicePreset {
  return VOICE_PRESETS.find((v) => v.id === id) ?? VOICE_PRESETS.find((v) => v.id === DEFAULT_VOICE_PRESET_ID)!;
}

export async function generateAnnouncerMp3(text: string, opts: TtsOptions = {}): Promise<Buffer> {
  if (!API_KEY) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }
  const voice = opts.voiceId || DEFAULT_VOICE_ID;
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
        style: opts.styleExaggeration ?? 0.65,
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
