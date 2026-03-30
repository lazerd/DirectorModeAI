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
    // MixerMode
    const { data: mixerEvents } = await supabase.from('mixer_events').select('id, user_id');
    const mixerUsers = new Set(mixerEvents?.map((e) => e.user_id).filter(Boolean));
    const { count: mixerPlayers } = await supabase.from('mixer_players').select('*', { count: 'exact', head: true });
    const { count: mixerRounds } = await supabase.from('mixer_rounds').select('*', { count: 'exact', head: true });
    const { count: mixerMatches } = await supabase.from('mixer_matches').select('*', { count: 'exact', head: true });

    // LastMinuteLesson
    const { count: lessonCoaches } = await supabase.from('lesson_coaches').select('*', { count: 'exact', head: true });
    const { count: lessonClients } = await supabase.from('lesson_clients').select('*', { count: 'exact', head: true });
    const { count: totalSlots } = await supabase.from('lesson_slots').select('*', { count: 'exact', head: true });
    const { count: claimedSlots } = await supabase.from('lesson_slots').select('*', { count: 'exact', head: true }).eq('status', 'claimed');
    const { count: blastsSent } = await supabase.from('lesson_email_blasts').select('*', { count: 'exact', head: true });
    const { data: lessonCoachIds } = await supabase.from('lesson_coaches').select('profile_id');
    const lessonUsers = new Set(lessonCoachIds?.map((c) => c.profile_id).filter(Boolean));

    // StringingMode
    const { data: stringingJobsData } = await supabase.from('stringing_jobs').select('id, user_id, status');
    const stringingUsers = new Set(stringingJobsData?.map((j) => j.user_id).filter(Boolean));
    const { count: stringingCustomers } = await supabase.from('stringing_customers').select('*', { count: 'exact', head: true });
    const jobsByStatus: Record<string, number> = {};
    stringingJobsData?.forEach((j) => {
      jobsByStatus[j.status] = (jobsByStatus[j.status] || 0) + 1;
    });

    // CourtConnect
    const { data: ccEventsData } = await supabase.from('cc_events').select('id, created_by');
    const ccEventUsers = new Set(ccEventsData?.map((e) => e.created_by).filter(Boolean));
    const { count: ccPlayers } = await supabase.from('cc_players').select('*', { count: 'exact', head: true });
    const { count: ccRsvps } = await supabase.from('cc_event_players').select('*', { count: 'exact', head: true });
    const { count: ccInvitations } = await supabase.from('cc_invitations').select('*', { count: 'exact', head: true });

    // PlayerVault
    const { data: vaultData } = await supabase.from('cc_vault_players').select('id, user_id');
    const vaultUsers = new Set(vaultData?.map((v) => v.user_id).filter(Boolean));

    const products = [
      {
        name: 'MixerMode',
        color: '#fb923c',
        icon: 'Trophy',
        userCount: mixerUsers.size,
        totalRecords: mixerEvents?.length || 0,
        details: {
          events: mixerEvents?.length || 0,
          players: mixerPlayers || 0,
          rounds: mixerRounds || 0,
          matches: mixerMatches || 0,
        },
      },
      {
        name: 'LastMinuteLesson',
        color: '#60a5fa',
        icon: 'GraduationCap',
        userCount: lessonUsers.size,
        totalRecords: (lessonCoaches || 0) + (lessonClients || 0),
        details: {
          coaches: lessonCoaches || 0,
          clients: lessonClients || 0,
          totalSlots: totalSlots || 0,
          claimedSlots: claimedSlots || 0,
          blastsSent: blastsSent || 0,
        },
      },
      {
        name: 'StringingMode',
        color: '#c084fc',
        icon: 'Wrench',
        userCount: stringingUsers.size,
        totalRecords: stringingJobsData?.length || 0,
        details: {
          totalJobs: stringingJobsData?.length || 0,
          customers: stringingCustomers || 0,
          jobsByStatus,
        },
      },
      {
        name: 'CourtConnect',
        color: '#34d399',
        icon: 'Users',
        userCount: ccEventUsers.size,
        totalRecords: ccEventsData?.length || 0,
        details: {
          events: ccEventsData?.length || 0,
          players: ccPlayers || 0,
          rsvps: ccRsvps || 0,
          invitations: ccInvitations || 0,
        },
      },
      {
        name: 'PlayerVault',
        color: '#2dd4bf',
        icon: 'Database',
        userCount: vaultUsers.size,
        totalRecords: vaultData?.length || 0,
        details: {
          totalEntries: vaultData?.length || 0,
        },
      },
    ];

    return NextResponse.json({ products });
  } catch (error) {
    console.error('Admin products error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
