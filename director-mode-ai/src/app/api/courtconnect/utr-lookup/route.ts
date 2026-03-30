import { NextRequest, NextResponse } from 'next/server';

// Fetch a single player's profile to get their actual UTR rating
async function fetchUtrProfile(playerId: string): Promise<{ singlesUtr: number | null; doublesUtr: number | null }> {
  const urls = [
    `https://api.utrsports.net/v2/player/${playerId}/profile`,
    `https://app.utrsports.net/api/v1/player/${playerId}`,
    `https://api.utrsports.net/v1/player/${playerId}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        // Try every known field name for UTR ratings
        const singles = data.singlesUtr || data.thpiSinglesRating || data.singlesRating ||
          data.myUtrSingles || data.ratingProgress?.singles?.current ||
          data.playerProfile?.singlesUtr || data.ratings?.singles || null;
        const doubles = data.doublesUtr || data.thpiDoublesRating || data.doublesRating ||
          data.myUtrDoubles || data.ratingProgress?.doubles?.current ||
          data.playerProfile?.doublesUtr || data.ratings?.doubles || null;

        if (singles || doubles) {
          return {
            singlesUtr: singles ? parseFloat(String(singles)) : null,
            doublesUtr: doubles ? parseFloat(String(doubles)) : null,
          };
        }
      }
    } catch {
      // Try next URL
    }
  }

  return { singlesUtr: null, doublesUtr: null };
}

export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json();

    if (!name || name.trim().length < 2) {
      return NextResponse.json({ error: 'Name must be at least 2 characters' }, { status: 400 });
    }

    // Try UTR's search API
    const searchUrls = [
      `https://api.utrsports.net/v2/search/players?query=${encodeURIComponent(name)}&top=10`,
      `https://app.utrsports.net/api/v1/player/search?query=${encodeURIComponent(name)}`,
    ];

    for (const searchUrl of searchUrls) {
      try {
        const res = await fetch(searchUrl, {
          headers: { 'Accept': 'application/json' },
        });

        if (!res.ok) continue;

        const data = await res.json();

        // Normalize the response - different endpoints return different shapes
        let rawPlayers: any[] = [];
        if (data.hits && Array.isArray(data.hits)) {
          rawPlayers = data.hits.map((h: any) => h.source || h);
        } else if (data.players && Array.isArray(data.players)) {
          rawPlayers = data.players;
        } else if (Array.isArray(data)) {
          rawPlayers = data;
        }

        if (rawPlayers.length === 0) continue;

        // Map to our format and fetch profiles for ratings
        const results = await Promise.all(
          rawPlayers.slice(0, 8).map(async (p: any) => {
            const playerId = String(p.id || p.playerId || '');
            const displayName = p.displayName || p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim();
            const location = p.location?.display || p.city || null;

            // First check if search results already include ratings
            let singlesUtr = p.singlesUtr || p.thpiSinglesRating || p.singlesRating || null;
            let doublesUtr = p.doublesUtr || p.thpiDoublesRating || p.doublesRating || null;

            // If no ratings in search results, fetch the player profile
            if (!singlesUtr && !doublesUtr && playerId) {
              const profile = await fetchUtrProfile(playerId);
              singlesUtr = profile.singlesUtr;
              doublesUtr = profile.doublesUtr;
            }

            return {
              displayName,
              singlesUtr: singlesUtr ? parseFloat(String(singlesUtr)) : null,
              doublesUtr: doublesUtr ? parseFloat(String(doublesUtr)) : null,
              location,
              utrId: playerId,
            };
          })
        );

        return NextResponse.json({ results, source: 'utr_api' });

      } catch (err) {
        console.error('UTR search error:', err);
      }
    }

    // If all search attempts fail
    return NextResponse.json({
      results: [],
      source: 'none',
      message: 'UTR search unavailable. Please enter ratings manually.',
    });

  } catch (error) {
    console.error('UTR lookup error:', error);
    return NextResponse.json({ error: 'UTR lookup failed' }, { status: 500 });
  }
}
