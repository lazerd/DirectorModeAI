import { NextRequest, NextResponse } from 'next/server';

// UTR API lookup
// UTR has a search endpoint at https://api.utrsports.net/v2/search/players
// This requires checking their current API availability

export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json();

    if (!name || name.trim().length < 2) {
      return NextResponse.json({ error: 'Name must be at least 2 characters' }, { status: 400 });
    }

    // Try UTR's public search API
    const utrApiUrl = `https://api.utrsports.net/v2/search/players?query=${encodeURIComponent(name)}&top=10`;

    try {
      const utrRes = await fetch(utrApiUrl, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });

      if (utrRes.ok) {
        const data = await utrRes.json();

        const results = (data.hits || []).map((hit: any) => ({
          displayName: hit.source?.displayName || hit.source?.firstName + ' ' + hit.source?.lastName || name,
          singlesUtr: hit.source?.singlesUtr || hit.source?.thpiSinglesRating || null,
          doublesUtr: hit.source?.doublesUtr || hit.source?.thpiDoublesRating || null,
          location: hit.source?.location?.display || null,
          utrId: hit.source?.id?.toString() || '',
        }));

        return NextResponse.json({ results, source: 'utr_api' });
      }
    } catch (utrError) {
      console.error('UTR API error:', utrError);
    }

    // Fallback: try the alternative UTR endpoint
    try {
      const altUrl = `https://app.utrsports.net/api/v1/player/search?query=${encodeURIComponent(name)}`;
      const altRes = await fetch(altUrl, {
        headers: { 'Accept': 'application/json' },
      });

      if (altRes.ok) {
        const data = await altRes.json();
        const players = data.players || data.hits || data || [];

        const results = (Array.isArray(players) ? players : []).slice(0, 10).map((p: any) => ({
          displayName: p.displayName || p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim(),
          singlesUtr: p.singlesUtr || p.singleRating || p.thpiSinglesRating || null,
          doublesUtr: p.doublesUtr || p.doubleRating || p.thpiDoublesRating || null,
          location: p.location?.display || p.city || null,
          utrId: p.id?.toString() || p.playerId?.toString() || '',
        }));

        if (results.length > 0) {
          return NextResponse.json({ results, source: 'utr_alt_api' });
        }
      }
    } catch (altError) {
      console.error('UTR alt API error:', altError);
    }

    // If both APIs fail, return empty with a message
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
