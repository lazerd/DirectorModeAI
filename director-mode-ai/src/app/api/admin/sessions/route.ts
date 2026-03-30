import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminAuth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // All session events for the last 30 days
    const { data: sessionEvents } = await supabase
      .from('analytics_events')
      .select('event_type, session_id, user_id, metadata, created_at')
      .in('event_type', ['session_start', 'session_end'])
      .gte('created_at', thirtyDaysAgo.toISOString());

    // Sessions per day
    const sessionsPerDay: Record<string, number> = {};
    const visitorsPerDay: Record<string, Set<string>> = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (29 - i));
      const day = d.toISOString().split('T')[0];
      sessionsPerDay[day] = 0;
      visitorsPerDay[day] = new Set();
    }

    const sessionStarts = sessionEvents?.filter((e) => e.event_type === 'session_start') || [];
    const sessionEnds = sessionEvents?.filter((e) => e.event_type === 'session_end') || [];

    sessionStarts.forEach((e) => {
      const day = e.created_at.split('T')[0];
      if (sessionsPerDay[day] !== undefined) {
        sessionsPerDay[day]++;
      }
      if (e.user_id && visitorsPerDay[day]) {
        visitorsPerDay[day].add(e.user_id);
      }
    });

    // Average session duration from session_end metadata
    const durations: number[] = [];
    sessionEnds.forEach((e) => {
      const durationMs = e.metadata?.duration_ms;
      if (typeof durationMs === 'number' && durationMs > 0 && durationMs < 24 * 60 * 60 * 1000) {
        durations.push(durationMs);
      }
    });

    const avgDurationMs = durations.length > 0
      ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
      : 0;

    // Total sessions (all time)
    const { count: totalSessions } = await supabase
      .from('analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'session_start');

    // Sessions today
    const today = new Date().toISOString().split('T')[0];
    const sessionsToday = sessionsPerDay[today] || 0;

    const sessionsOverTime = Object.entries(sessionsPerDay).map(([date, count]) => ({
      date,
      sessions: count,
    }));

    const uniqueVisitorsOverTime = Object.entries(visitorsPerDay).map(([date, visitors]) => ({
      date,
      visitors: visitors.size,
    }));

    return NextResponse.json({
      totalSessions: totalSessions || 0,
      sessionsToday,
      avgDurationMs,
      sessionsOverTime,
      uniqueVisitorsOverTime,
    });
  } catch (error) {
    console.error('Admin sessions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
