/**
 * POST /api/coach/drills — AI drill/game recommender.
 *
 * mode 'player': reads a client's recent Coach Mode focus areas + skill ratings
 *   and recommends targeted drills.
 * mode 'clinic': given player count + level (+ optional focus), assembles a
 *   full session plan (warm-up -> drills -> game) from the library.
 *
 * Candidates are pre-filtered from the drills table by structured fields so we
 * only hand the model a relevant shortlist (bounded tokens), then it selects +
 * explains. Reuses the app's Anthropic setup + usage metering.
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
  const mode: 'player' | 'clinic' = body.mode === 'clinic' ? 'clinic' : 'player';
  const admin = getSupabaseAdmin();

  let context = '';
  let level: string = body.level || 'all';
  let playerCount: number = Number(body.playerCount) || 1;

  if (mode === 'player') {
    playerCount = 1;
    if (body.clientId) {
      const { data: notes } = await admin
        .from('lesson_notes')
        .select('lesson_date, focus_area, ai_summary, content')
        .eq('client_id', body.clientId)
        .order('lesson_date', { ascending: false })
        .limit(6);
      const { data: skills } = await admin
        .from('lesson_skill_snapshots')
        .select('skill, rating, recorded_at')
        .eq('client_id', body.clientId)
        .order('recorded_at', { ascending: false })
        .limit(30);
      const latest: Record<string, number> = {};
      for (const s of (skills as any[]) || []) if (!(s.skill in latest)) latest[s.skill] = s.rating;
      const focuses = ((notes as any[]) || []).map((n) => n.focus_area).filter(Boolean);
      context = `Recent lesson focus areas: ${focuses.join(', ') || 'none recorded'}.
Latest skill ratings (1-10): ${Object.entries(latest).map(([k, v]) => `${k} ${v}`).join(', ') || 'none recorded'}.
Recent recap: ${((notes as any[]) || [])[0]?.ai_summary || ((notes as any[]) || [])[0]?.content || 'none'}.`;
    } else {
      context = `Player is working on: ${body.focus || 'general improvement'}.`;
    }
  } else {
    context = `Clinic of ${playerCount} players, level ${level}.${body.focus ? ` Emphasis: ${body.focus}.` : ''}`;
  }

  // Pre-filter candidate drills.
  let q = admin.from('drills').select('name, category, skills, level, min_players, max_players, duration_min, is_game, setup, instructions, coaching_points, progression');
  if (mode === 'clinic') q = q.lte('min_players', playerCount).gte('max_players', playerCount);
  if (level && level !== 'all') q = q.in('level', [level, 'all']);
  const { data: candidates } = await q.limit(60);

  const list = (candidates || []).map((d: any, i: number) =>
    `${i + 1}. ${d.name} [${d.category}/${d.level}/${d.min_players}-${d.max_players}p${d.is_game ? '/game' : ''}] skills:${(d.skills || []).join(',')} — ${d.instructions}`
  ).join('\n');

  const prompt = mode === 'player'
    ? `You are an expert tennis coach. A player's development context:
${context}

From this drill library, pick the 3 BEST drills to work on next for THIS player, in order. For each: name it exactly, say in one sentence why it targets their needs, and give one coaching cue.

DRILL LIBRARY:
${list}

Respond as plain text: a numbered list of 3, each "Name — why — cue".`
    : `You are an expert tennis coach running a clinic. Session context:
${context}

Build a great ~60-minute session plan for this group using ONLY drills from the library below: a warm-up, 2-3 skill drills that flow logically, and a finishing game. Name each drill exactly, give the minutes, and one sentence on how to run it for this group size/level.

DRILL LIBRARY:
${list}

Respond as plain text with clear sections (Warm-up / Drills / Finisher) and a one-line coach tip at the end.`;

  try {
    const anthropic = new Anthropic({ apiKey: KEY });
    const msg = await anthropic.messages.create({ model: MODEL, max_tokens: 900, messages: [{ role: 'user', content: prompt }] });
    recordAiUsage(user.id, msg.usage?.input_tokens ?? 0, msg.usage?.output_tokens ?? 0).catch(() => {});
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
    return NextResponse.json({ result: text, candidates: (candidates || []).length });
  } catch (err: any) {
    return NextResponse.json({ error: 'Could not generate suggestions', message: err?.message }, { status: 502 });
  }
}
