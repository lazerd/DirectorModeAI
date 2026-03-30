import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ADMIN_PASSWORD = 'masterdirector!';

export async function GET(request: NextRequest) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (adminKey !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Top features by usage count
    const { data: featureEvents } = await supabase
      .from('analytics_events')
      .select('event_name, product, created_at')
      .eq('event_type', 'feature_use')
      .order('created_at', { ascending: false });

    const featureCounts: Record<string, { count: number; product: string | null; lastUsed: string }> = {};
    featureEvents?.forEach((e) => {
      if (!featureCounts[e.event_name]) {
        featureCounts[e.event_name] = { count: 0, product: e.product, lastUsed: e.created_at };
      }
      featureCounts[e.event_name].count++;
    });

    const topFeatures = Object.entries(featureCounts)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // Feature usage over time (last 14 days)
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const { data: recentFeatures } = await supabase
      .from('analytics_events')
      .select('event_name, product, created_at')
      .eq('event_type', 'feature_use')
      .gte('created_at', fourteenDaysAgo.toISOString());

    // Build daily feature usage for top 5 features
    const top5Names = topFeatures.slice(0, 5).map((f) => f.name);
    const featuresByDay: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 14; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (13 - i));
      const day = d.toISOString().split('T')[0];
      featuresByDay[day] = {};
      top5Names.forEach((n) => (featuresByDay[day][n] = 0));
    }
    recentFeatures?.forEach((e) => {
      const day = e.created_at.split('T')[0];
      if (featuresByDay[day] && top5Names.includes(e.event_name)) {
        featuresByDay[day][e.event_name]++;
      }
    });

    const featureUsageOverTime = Object.entries(featuresByDay).map(([date, features]) => ({
      date,
      ...features,
    }));

    // Page views ranking
    const { data: pageViews } = await supabase
      .from('analytics_events')
      .select('event_name, created_at')
      .eq('event_type', 'page_view');

    const pageCounts: Record<string, number> = {};
    pageViews?.forEach((e) => {
      pageCounts[e.event_name] = (pageCounts[e.event_name] || 0) + 1;
    });

    const topPages = Object.entries(pageCounts)
      .map(([path, views]) => ({ path, views }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 20);

    return NextResponse.json({
      topFeatures,
      featureUsageOverTime,
      top5Names,
      topPages,
    });
  } catch (error) {
    console.error('Admin features error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
