import { getSupabaseAdmin } from '@/lib/supabase/admin';
import JoinForm from './JoinForm';

export const dynamic = 'force-dynamic';

export default async function JoinPage({ params }: { params: { token: string } }) {
  const admin = getSupabaseAdmin();
  const { data: dc } = await admin
    .from('league_division_clubs')
    .select('division_id, club_id')
    .eq('signup_token', params.token)
    .maybeSingle();

  let division: { name: string; short_code: string; league_id: string } | null = null;
  let club: { name: string } | null = null;
  let league: { name: string } | null = null;
  if (dc) {
    const d = dc as { division_id: string; club_id: string };
    const { data: dv } = await admin.from('league_divisions').select('name, short_code, league_id').eq('id', d.division_id).maybeSingle();
    division = (dv as { name: string; short_code: string; league_id: string } | null) ?? null;
    const { data: cl } = await admin.from('league_clubs').select('name').eq('id', d.club_id).maybeSingle();
    club = (cl as { name: string } | null) ?? null;
    if (division) {
      const { data: lg } = await admin.from('leagues').select('name').eq('id', division.league_id).maybeSingle();
      league = (lg as { name: string } | null) ?? null;
    }
  }

  if (!dc || !division || !club) {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 520, margin: '0 auto', padding: 40, color: '#1f2937' }}>
        <h1 style={{ fontSize: 22 }}>Signup link not found</h1>
        <p style={{ color: '#6b7280' }}>Double-check the link, or ask your director for a new one.</p>
      </main>
    );
  }

  return (
    <JoinForm
      token={params.token}
      leagueName={league?.name || 'JTT League'}
      clubName={club.name}
      divisionName={division.name}
    />
  );
}
