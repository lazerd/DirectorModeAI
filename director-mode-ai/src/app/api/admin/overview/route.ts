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
    // Total users
    const { count: totalUsers } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    // Signups by day (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: allProfiles } = await supabase
      .from('profiles')
      .select('created_at')
      .gte('created_at', thirtyDaysAgo.toISOString());

    const signupsByDay: Record<string, number> = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (29 - i));
      signupsByDay[d.toISOString().split('T')[0]] = 0;
    }
    allProfiles?.forEach((p) => {
      const day = p.created_at.split('T')[0];
      if (signupsByDay[day] !== undefined) signupsByDay[day]++;
    });

    const signupsOverTime = Object.entries(signupsByDay).map(([date, count]) => ({
      date,
      count,
    }));

    // New signups this week
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const { count: newThisWeek } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', weekAgo.toISOString());

    // Active users: distinct user_ids across product tables in last 7 days
    const activeUserIds = new Set<string>();

    const { data: mixerActive } = await supabase
      .from('mixer_events')
      .select('user_id')
      .gte('created_at', weekAgo.toISOString());
    mixerActive?.forEach((r) => r.user_id && activeUserIds.add(r.user_id));

    const { data: lessonActive } = await supabase
      .from('lesson_slots')
      .select('coach_id')
      .gte('created_at', weekAgo.toISOString());
    lessonActive?.forEach((r) => r.coach_id && activeUserIds.add(r.coach_id));

    const { data: stringingActive } = await supabase
      .from('stringing_jobs')
      .select('user_id')
      .gte('created_at', weekAgo.toISOString());
    stringingActive?.forEach((r) => r.user_id && activeUserIds.add(r.user_id));

    const { data: ccActive } = await supabase
      .from('cc_events')
      .select('created_by')
      .gte('created_at', weekAgo.toISOString());
    ccActive?.forEach((r) => r.created_by && activeUserIds.add(r.created_by));

    // Also check analytics for logged-in page views
    const { data: analyticsActive } = await supabase
      .from('analytics_events')
      .select('user_id')
      .not('user_id', 'is', null)
      .gte('created_at', weekAgo.toISOString());
    analyticsActive?.forEach((r) => r.user_id && activeUserIds.add(r.user_id));

    const activeUsers = activeUserIds.size;
    const dormantUsers = Math.max(0, (totalUsers || 0) - activeUsers);

    // User roles breakdown
    const { data: rolesData } = await supabase
      .from('profiles')
      .select('role');

    const roleBreakdown: Record<string, number> = {};
    rolesData?.forEach((r) => {
      const role = r.role || 'user';
      roleBreakdown[role] = (roleBreakdown[role] || 0) + 1;
    });

    return NextResponse.json({
      totalUsers: totalUsers || 0,
      newThisWeek: newThisWeek || 0,
      activeUsers,
      dormantUsers,
      signupsOverTime,
      roleBreakdown,
    });
  } catch (error) {
    console.error('Admin overview error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
