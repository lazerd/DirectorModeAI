import { NextResponse } from 'next/server';

type RequestBody = {
  player_count?: number;
  court_count?: number;
  duration_minutes?: number;
  vibe?: 'social' | 'competitive' | 'tournament' | string;
};

const FORMAT_OPTIONS = [
  { id: 'doubles', name: 'Doubles', good_for: 'social mixers, 8+ players' },
  { id: 'singles', name: 'Singles', good_for: 'small groups, fast play' },
  { id: 'mixed-doubles', name: 'Mixed Doubles', good_for: 'social/coed groups' },
  { id: 'king-of-court', name: 'King of the Court', good_for: 'small groups, continuous play' },
  { id: 'round-robin', name: 'Team Round Robin', good_for: 'fixed teams, league night' },
  { id: 'maximize-courts', name: 'Maximize Courts', good_for: 'awkward player counts' },
  { id: 'single-elimination-singles', name: 'Singles Tournament', good_for: 'competitive 1v1 brackets' },
  { id: 'single-elimination-doubles', name: 'Doubles Tournament', good_for: 'competitive 2v2 brackets' },
  { id: 'team-battle', name: 'Team Battle', good_for: 'two named teams competing' },
];

function heuristicRecommendation(body: RequestBody) {
  const players = body.player_count ?? 0;
  const courts = body.court_count ?? 0;
  const vibe = (body.vibe ?? 'social').toLowerCase();

  if (vibe.includes('tournament')) {
    return {
      format: 'single-elimination-doubles',
      reason: 'A bracket tournament is the cleanest way to crown a winner with this group.',
    };
  }

  if (vibe.includes('competitive') && players >= 4) {
    return {
      format: 'round-robin',
      reason: 'Round robin gives every team multiple competitive matches without elimination.',
    };
  }

  if (players > 0 && courts > 0 && players / Math.max(courts, 1) >= 5) {
    return {
      format: 'maximize-courts',
      reason: 'You have more players than courts can comfortably hold — Maximize Courts mixes singles and doubles to keep everyone moving.',
    };
  }

  if (players >= 8) {
    return {
      format: 'doubles',
      reason: 'A standard doubles mixer balances social play and rotation for groups of 8 or more.',
    };
  }

  if (players > 0 && players < 6) {
    return {
      format: 'king-of-court',
      reason: 'Small group — King of the Court keeps continuous play with minimal idle time.',
    };
  }

  return {
    format: 'doubles',
    reason: 'Doubles is the most popular format for casual mixers.',
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;

    const aiApiKey = process.env.AI_API_KEY;
    const aiProvider = process.env.AI_PROVIDER || 'openai';
    const aiModel = process.env.AI_MODEL || 'gpt-4o-mini';

    // No key? Fall back to a deterministic heuristic so the button still works.
    if (!aiApiKey) {
      return NextResponse.json(heuristicRecommendation(body));
    }

    const systemPrompt = `You help tennis club organizers pick the best event format.
Available formats:
${FORMAT_OPTIONS.map(f => `- ${f.id}: ${f.name} (${f.good_for})`).join('\n')}

Reply with strict JSON: {"format": "<format id>", "reason": "<one short sentence>"}.`;

    const userPrompt = `Players: ${body.player_count ?? 'unknown'}
Courts: ${body.court_count ?? 'unknown'}
Duration (min): ${body.duration_minutes ?? 'unknown'}
Vibe: ${body.vibe ?? 'unknown'}`;

    let parsed: { format?: string; reason?: string } | null = null;

    if (aiProvider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiApiKey}`,
        },
        body: JSON.stringify({
          model: aiModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.4,
        }),
      });
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (content) parsed = JSON.parse(content);
    } else if (aiProvider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': aiApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: aiModel,
          max_tokens: 256,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });
      const data = await res.json();
      const content = data.content?.[0]?.text;
      const match = content?.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    }

    if (!parsed?.format || !FORMAT_OPTIONS.some(f => f.id === parsed!.format)) {
      return NextResponse.json(heuristicRecommendation(body));
    }

    return NextResponse.json({
      format: parsed.format,
      reason: parsed.reason ?? 'Recommended based on your event details.',
    });
  } catch (err) {
    console.error('Mixer recommend error:', err);
    return NextResponse.json(
      { error: 'Failed to generate recommendation' },
      { status: 500 }
    );
  }
}
