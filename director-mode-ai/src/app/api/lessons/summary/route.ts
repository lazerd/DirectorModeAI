/**
 * POST /api/lessons/summary
 *
 * Coach Mode — generate an AI development summary from a coach's raw post-lesson
 * notes, and (best-effort) persist it to lesson_notes. Reuses the app's
 * Anthropic setup + usage metering. Persistence is tolerant of the ws4 tables
 * not existing yet, so the endpoint works before the migration is applied.
 *
 * Body: { coachId?, clientId?, slotId?, clubId?, playerName?, focusArea?,
 *         content, skills?: [{skill, rating}], persist?: boolean }
 * Returns: { summary, noteId? }
 */

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { recordAiUsage } from '@/lib/billing';

export const dynamic = 'force-dynamic';

const MODEL = process.env.AI_MODEL_AGENT ?? 'claude-sonnet-4-6';
const KEY = process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!KEY) return NextResponse.json({ error: 'AI not configured' }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const content: string = (body.content || '').toString().trim();
  if (!content) return NextResponse.json({ error: 'No lesson notes provided' }, { status: 400 });

  const player = body.playerName ? `Player: ${body.playerName}.` : '';
  const focus = body.focusArea ? `Focus area: ${body.focusArea}.` : '';
  const skills = Array.isArray(body.skills) && body.skills.length
    ? `Current skill ratings (1-10): ${body.skills.map((s: any) => `${s.skill} ${s.rating}`).join(', ')}.`
    : '';

  const prompt = `You are helping a racquet-sports coach write a concise post-lesson development summary for the player's record. ${player} ${focus} ${skills}

Coach's raw notes:
"""
${content}
"""

Write a short, encouraging, parent/player-friendly summary with these sections (use plain text, no markdown headers):
- Recap: 2-3 sentences on what the lesson covered.
- Progress: what's improving.
- Next focus: one or two concrete things to work on before next time.
Keep it under 120 words.`;

  let summary = '';
  try {
    const anthropic = new Anthropic({ apiKey: KEY });
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });
    recordAiUsage(user.id, msg.usage?.input_tokens ?? 0, msg.usage?.output_tokens ?? 0).catch(() => {});
    summary = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  } catch (err: any) {
    return NextResponse.json({ error: 'Could not generate summary', message: err?.message }, { status: 502 });
  }

  // Best-effort persistence — silently no-ops if the ws4 tables aren't applied.
  let noteId: string | undefined;
  if (body.persist && body.coachId) {
    try {
      const admin = getSupabaseAdmin();
      const { data } = await admin
        .from('lesson_notes')
        .insert({
          coach_id: body.coachId,
          client_id: body.clientId ?? null,
          slot_id: body.slotId ?? null,
          club_id: body.clubId ?? null,
          focus_area: body.focusArea ?? null,
          content,
          ai_summary: summary,
          created_by: user.id,
        })
        .select('id')
        .single();
      noteId = data?.id;
    } catch {
      /* lesson_notes not migrated yet — return the summary anyway */
    }
  }

  return NextResponse.json({ summary, noteId });
}
