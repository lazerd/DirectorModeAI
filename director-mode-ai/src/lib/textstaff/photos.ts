import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { MODEL } from '@/lib/assistant/runChat';

/*
 * Photos texted to the staff (11/25/26). A receipt becomes a reimbursement (the club
 * computer fills the form and emails the accountant, after the director's YES); anything
 * else is read and described so the director can say what to do with it.
 */

export interface InMedia { url?: string; telegramFileId?: string; type?: string }
export interface PhotoRead {
  kind: 'receipt' | 'signin' | 'other';
  vendor?: string | null; date?: string | null; amount?: number | null; description?: string | null;
  names?: string[]; title?: string | null; summary: string;
}

/** Download a texted photo as base64 (Twilio media needs the account's basic auth). */
export async function fetchMedia(m: InMedia): Promise<{ mime: string; b64: string } | null> {
  let url = m.url;
  const headers: Record<string, string> = {};
  if (m.telegramFileId) {
    const tok = process.env.TELEGRAM_BOT_TOKEN;
    if (!tok) return null;
    const j = (await (await fetch(`https://api.telegram.org/bot${tok}/getFile?file_id=${encodeURIComponent(m.telegramFileId)}`)).json().catch(() => null)) as { result?: { file_path?: string } } | null;
    if (!j?.result?.file_path) return null;
    url = `https://api.telegram.org/file/bot${tok}/${j.result.file_path}`;
  } else if (url && /twilio\.com/.test(url)) {
    headers.authorization = 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  }
  if (!url) return null;
  const r = await fetch(url, { headers, redirect: 'follow' });
  if (!r.ok) return null;
  const mime = (r.headers.get('content-type') || m.type || 'image/jpeg').split(';')[0];
  if (!/^image\/(jpeg|png|gif|webp)$/.test(mime)) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 4_500_000) return null; // Claude's image limit is ~5 MB
  return { mime, b64: buf.toString('base64') };
}

const TOOL: Anthropic.Messages.Tool = {
  name: 'photo',
  description: 'What this photo is and what it says.',
  input_schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['receipt', 'signin', 'other'], description: 'receipt = a purchase receipt or invoice; signin = a sign-in / attendance sheet; other = anything else.' },
      vendor: { type: ['string', 'null'], description: 'Receipt: the store or vendor.' },
      date: { type: ['string', 'null'], description: 'Receipt: purchase date YYYY-MM-DD, or null if not shown.' },
      amount: { type: ['number', 'null'], description: 'Receipt: the FINAL total paid, including tax and tip. Null if unreadable.' },
      description: { type: ['string', 'null'], description: 'Receipt: 2-4 words for what was bought, e.g. "Court supplies", "Team drinks".' },
      title: { type: ['string', 'null'], description: 'Sign-in sheet: the program or class name and date, if written.' },
      names: { type: 'array', items: { type: 'string' }, description: 'Sign-in sheet: every name, as written.' },
      summary: { type: 'string', description: 'One short sentence describing the photo.' },
    },
    required: ['kind', 'summary'],
  },
};

export async function readPhoto(img: { mime: string; b64: string }, today: string): Promise<PhotoRead | null> {
  const key = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;
  if (!key) return null;
  const client = new Anthropic({ apiKey: key });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'photo' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: img.mime as 'image/jpeg', data: img.b64 } },
        { type: 'text', text: `A tennis club director texted this photo to their staff. Today is ${today}. Read it. Never guess an amount: if the total is unreadable, return null.` },
      ],
    }],
  });
  const out = res.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use')?.input as PhotoRead | undefined;
  return out ?? null;
}

export async function keepMedia(lineId: string, img: { mime: string; b64: string }): Promise<string> {
  const { data, error } = await getSupabaseAdmin().from('text_media').insert({ line_id: lineId, mime: img.mime, data: img.b64 }).select('id').single();
  if (error || !data) throw new Error(error?.message || 'could not keep the photo');
  return (data as { id: string }).id;
}

export const money = (n: number) => `$${n.toFixed(2)}`;
