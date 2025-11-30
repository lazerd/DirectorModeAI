import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { level, play_style, arm_issues, preference, durability_needs } = body;

    // Get available strings from catalog
    const supabase = await createClient();
    const { data: strings } = await supabase
      .from('stringing_catalog')
      .select('*')
      .eq('in_stock', true);

    // Build the prompt
    const systemPrompt = `You are an expert tennis stringer and string advisor. Your job is to recommend the best string setup based on a player's profile.

Available strings in our catalog:
${strings?.map(s => `- ${s.brand} ${s.name} (${s.string_type}, ${s.gauge} gauge, ID: ${s.id})`).join('\n') || 'No catalog strings available'}

Guidelines:
- For recreational players and those with arm issues, prioritize multifilament or synthetic gut strings
- For advanced players without arm issues, polyester is often preferred for control/spin
- Beginners typically need 52-55 lbs tension for comfort
- Advanced players often prefer 50-55 lbs for polyester, 55-60 for multifilament
- If durability is needed, recommend polyester or thicker gauge
- Always explain your reasoning briefly

Return exactly 2-3 recommendations in this JSON format:
{
  "recommendations": [
    {
      "label": "Best for [specific benefit]",
      "string_catalog_id": "uuid or null if not in catalog",
      "string_name": "Brand Name",
      "type": "poly|multi|synthetic_gut|natural_gut|hybrid",
      "gauge": "16|17|etc",
      "main_tension_lbs": number,
      "cross_tension_lbs": number,
      "explanation": "Brief 1-2 sentence explanation",
      "arm_friendly": true|false
    }
  ]
}`;

    const userPrompt = `Player profile:
- Level: ${level}
- Play style: ${play_style || 'Not specified'}
- Arm/shoulder issues: ${arm_issues || 'None'}
- Primary preference: ${preference}
- Needs durability: ${durability_needs ? 'Yes' : 'No'}

Please recommend 2-3 string setups for this player.`;

    // Call AI provider
    const aiProvider = process.env.AI_PROVIDER || 'openai';
    const aiApiKey = process.env.AI_API_KEY;
    const aiModel = process.env.AI_MODEL || 'gpt-4o-mini';

    if (!aiApiKey) {
      // Return mock recommendations if no API key
      return NextResponse.json({
        recommendations: getMockRecommendations(level, arm_issues, preference, durability_needs),
      });
    }

    let recommendations;

    if (aiProvider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
          temperature: 0.7,
          response_format: { type: 'json_object' },
        }),
      });

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (content) {
        recommendations = JSON.parse(content).recommendations;
      }
    } else if (aiProvider === 'anthropic') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': aiApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: aiModel,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [
            { role: 'user', content: userPrompt },
          ],
        }),
      });

      const data = await response.json();
      const content = data.content?.[0]?.text;
      if (content) {
        // Extract JSON from response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          recommendations = JSON.parse(jsonMatch[0]).recommendations;
        }
      }
    }

    if (!recommendations) {
      recommendations = getMockRecommendations(level, arm_issues, preference, durability_needs);
    }

    return NextResponse.json({ recommendations });
  } catch (error) {
    console.error('AI recommendation error:', error);
    return NextResponse.json(
      { error: 'Failed to get recommendations' },
      { status: 500 }
    );
  }
}

// Mock recommendations when no AI API key is configured
function getMockRecommendations(
  level: string,
  arm_issues: string,
  preference: string,
  durability_needs: boolean
) {
  const hasArmIssues = arm_issues && arm_issues.toLowerCase() !== 'none' && arm_issues.trim() !== '';
  const isAdvanced = ['advanced', 'college', 'pro'].includes(level);

  const recommendations = [];

  // Recommendation 1: Based on arm issues or level
  if (hasArmIssues || !isAdvanced) {
    recommendations.push({
      label: 'Comfort & Arm-Friendly',
      string_catalog_id: null,
      string_name: 'Babolat Xcel',
      type: 'multi',
      gauge: '16',
      main_tension_lbs: 54,
      cross_tension_lbs: 52,
      explanation: 'Soft multifilament that provides excellent comfort and power, ideal for players with arm concerns or those seeking a forgiving string.',
      arm_friendly: true,
    });
  } else {
    recommendations.push({
      label: 'Control & Spin',
      string_catalog_id: null,
      string_name: 'Luxilon ALU Power',
      type: 'poly',
      gauge: '16L',
      main_tension_lbs: 50,
      cross_tension_lbs: 48,
      explanation: 'Tour-level polyester that provides excellent control and spin potential for advanced players with sound technique.',
      arm_friendly: false,
    });
  }

  // Recommendation 2: Based on preference
  if (preference === 'power') {
    recommendations.push({
      label: 'Maximum Power',
      string_catalog_id: null,
      string_name: 'Wilson NXT',
      type: 'multi',
      gauge: '17',
      main_tension_lbs: 52,
      cross_tension_lbs: 50,
      explanation: 'Premium multifilament known for its power and comfort. The thinner gauge increases trampoline effect.',
      arm_friendly: true,
    });
  } else if (preference === 'spin') {
    recommendations.push({
      label: 'Spin Monster',
      string_catalog_id: null,
      string_name: 'Babolat RPM Blast',
      type: 'poly',
      gauge: '17',
      main_tension_lbs: 48,
      cross_tension_lbs: 46,
      explanation: 'Octagonal-shaped polyester designed to grip the ball and generate massive spin. Lower tension increases dwell time.',
      arm_friendly: false,
    });
  } else {
    recommendations.push({
      label: 'All-Around Performance',
      string_catalog_id: null,
      string_name: 'Head Velocity MLT',
      type: 'multi',
      gauge: '16',
      main_tension_lbs: 54,
      cross_tension_lbs: 52,
      explanation: 'Balanced multifilament offering good power, comfort, and durability at a reasonable price point.',
      arm_friendly: true,
    });
  }

  // Recommendation 3: Durability option if needed
  if (durability_needs) {
    recommendations.push({
      label: 'Durable & Long-Lasting',
      string_catalog_id: null,
      string_name: 'Solinco Hyper-G',
      type: 'poly',
      gauge: '16',
      main_tension_lbs: 50,
      cross_tension_lbs: 48,
      explanation: 'Firm polyester known for excellent durability while maintaining decent playability. Great for string breakers.',
      arm_friendly: false,
    });
  }

  return recommendations;
}
