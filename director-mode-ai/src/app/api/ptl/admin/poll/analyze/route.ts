import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';
import { PILOT_POLL, PILOT_POLL_SLUG } from '@/lib/ptl/pilotPoll';

// POST /api/ptl/admin/poll/analyze — Claude reads every pilot-poll response
// and drafts one pilot plan. Platform owner only. Each run is saved, so the
// plan can be re-run as late answers arrive and earlier versions stay.
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MODEL = process.env.PTL_POLL_MODEL ?? 'claude-opus-5-5';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;

const CONTEXT = `
You are helping Darrin Cohen (Director of Tennis, Sleepy Hollow Swim & Tennis Club, Orinda) and the
USTA NorCal 5.0+ task force plan a pilot of the Premier Tennis League (PTL), a format Darrin proposed.

What PTL is (as proposed and built): players enroll individually; captains build rosters at a live
snake draft so no one assembles a super-team; teams meet with singles and doubles lines played side by
side; Fast4 best-of-3, no-ad; a division of 4 teams plays a full round robin in one ~3-hour session on
4-8 courts; the whole schedule is published up front; live standings. Darrin has built working software
for enrollment, the draft, match-night scoring and standings at ptl.clubmode.ai.

NorCal's 5.0+ survey: PTL rated 78% likely to play, beat three other concepts; $50 sits mid-range of
the $26-75 comfort band; 90% prefer one-day events with weekend slots strongest; travel/location is the
top barrier; "not enough high-level opponents" is a major complaint.

OPEN decisions (never present as settled): USTA sanctioned + rating-counted vs unsanctioned; a prize pool
funded by entry fees; promotion/relegation; who collects money.

The task force: Damon Levy (USTA NorCal, organizing), Molly Neal (USTA NorCal staff), Valerie Thong
(Bay Club), Mylene Martin, and Darrin.
`.trim();

const PLAN_TOOL = {
  name: 'pilot_plan',
  description: 'The synthesized pilot plan built from every poll response.',
  input_schema: {
    type: 'object' as const,
    properties: {
      headline: { type: 'string', description: 'One sentence: what the group is converging on.' },
      by_question: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            leaning: { type: 'string', description: 'What most people chose, with counts.' },
            agreement: { type: 'string', enum: ['strong', 'split', 'too few answers'] },
            notable: { type: 'string', description: 'Disagreements or a note worth reading, attributed by name.' },
          },
          required: ['question', 'leaning', 'agreement'],
        },
      },
      plan: {
        type: 'object',
        description: 'The recommended pilot. Each value is a concrete recommendation plus a short why.',
        properties: {
          when: { type: 'string' },
          day_and_time: { type: 'string' },
          shape: { type: 'string' },
          host: { type: 'string' },
          size: { type: 'string' },
          registration_and_payment: { type: 'string' },
          format: { type: 'string' },
          incentives: { type: 'string' },
        },
        required: ['when', 'day_and_time', 'shape', 'host', 'size', 'registration_and_payment', 'format', 'incentives'],
      },
      owners: {
        type: 'array',
        description: 'Who does what. Staff jobs and volunteer jobs, assigned to the people who offered.',
        items: {
          type: 'object',
          properties: {
            task: { type: 'string' },
            owner: { type: 'string', description: 'A person by name, "NorCal staff", "Host club", or "Needs an owner".' },
          },
          required: ['task', 'owner'],
        },
      },
      decisions_needed: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            decision: { type: 'string' },
            options: { type: 'string' },
            recommendation: { type: 'string' },
          },
          required: ['decision', 'options'],
        },
      },
      risks: { type: 'array', items: { type: 'string' } },
      next_steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            step: { type: 'string' },
            owner: { type: 'string' },
            by_when: { type: 'string' },
          },
          required: ['step', 'owner'],
        },
      },
    },
    required: ['headline', 'by_question', 'plan', 'owners', 'decisions_needed', 'risks', 'next_steps'],
  },
};

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isPlatformOwnerEmail(user.email)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
  if (!ANTHROPIC_KEY) return NextResponse.json({ error: 'No Anthropic key configured.' }, { status: 500 });

  const db = getSupabaseAdmin();
  const { data: rows, error } = await db
    .from('ptl_poll_responses')
    .select('name, answers, updated_at')
    .eq('poll_slug', PILOT_POLL_SLUG)
    .order('created_at');
  if (error) return NextResponse.json({ error: 'Could not read responses.' }, { status: 500 });
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'No responses yet.' }, { status: 409 });
  }

  const pollText = PILOT_POLL.map(
    (q, i) => `${i + 1}. [${q.id}] ${q.title}${q.options.length ? `\n   Options: ${q.options.join(' | ')}` : ''}`,
  ).join('\n');

  const responsesText = rows
    .map((r: any) => {
      const lines = PILOT_POLL.map((q) => {
        const a = r.answers?.[q.id];
        if (!a) return `  ${q.id}: (no answer)`;
        const picks = a.picks?.length ? a.picks.join('; ') : '(no picks)';
        return `  ${q.id}: ${picks}${a.note ? `\n    note: ${a.note}` : ''}`;
      }).join('\n');
      return `### ${r.name}\n${lines}`;
    })
    .join('\n\n');

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 6000,
      system: CONTEXT,
      tools: [PLAN_TOOL as any],
      tool_choice: { type: 'auto' } as any,
      messages: [
        {
          role: 'user',
          content:
            `Here is the poll the task force answered:\n\n${pollText}\n\n` +
            `Here are all ${rows.length} responses:\n\n${responsesText}\n\n` +
            'Read every response, including the notes. Build one concrete pilot plan the group can say yes to. ' +
            'Follow the majority where there is one, say plainly where people disagree, and use the notes to break ties. ' +
            'Assign tasks to the people who volunteered for them; mark anything nobody took as "Needs an owner". ' +
            'Keep the open decisions open: recommend, but do not state them as decided. Write plainly, no hype. ' +
            'Return the result by calling the pilot_plan tool exactly once.',
        },
      ],
    });
    const block = msg.content.find((b: any) => b.type === 'tool_use') as any;
    if (!block) return NextResponse.json({ error: 'Claude did not return a plan. Try again.' }, { status: 502 });

    const { data: saved, error: saveErr } = await db
      .from('ptl_poll_analyses')
      .insert({ poll_slug: PILOT_POLL_SLUG, response_count: rows.length, analysis: block.input, model: MODEL })
      .select('id, created_at')
      .single();
    if (saveErr) console.error('ptl poll analysis save failed', saveErr);
    return NextResponse.json({ ok: true, analysis: block.input, id: saved?.id });
  } catch (e: any) {
    console.error('ptl poll analyze failed', e);
    return NextResponse.json({ error: e?.message || 'Analysis failed.' }, { status: 500 });
  }
}
