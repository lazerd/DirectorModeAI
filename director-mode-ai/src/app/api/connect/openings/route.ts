import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// GET — the club's opening manager + match inbox. Returns each opening this
// user owns along with its matches. Candidate contact info (name/email/phone)
// is attached ONLY for matches in 'revealed' status; 'pending_candidate'
// matches stay blinded until the candidate approves.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Service role: the matcher writes cross-user data and candidate PII lives
  // behind RLS, so we read with the service client and scope to this owner.
  const svc = await createServiceClient();

  const { data: openings } = await svc
    .from('connect_openings')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false });

  const openingIds = (openings || []).map((o) => o.id);
  let matches: any[] = [];

  if (openingIds.length) {
    const { data: rawMatches } = await svc
      .from('connect_matches')
      .select('*')
      .in('opening_id', openingIds)
      .order('score', { ascending: false });

    const candidateIds = Array.from(new Set((rawMatches || []).map((m) => m.candidate_id)));
    const { data: candidates } = await svc
      .from('connect_candidates')
      .select('id, full_name, email, phone, headline, dept, years_experience, current_comp, home_zip, reveal_mode')
      .in('id', candidateIds.length ? candidateIds : ['00000000-0000-0000-0000-000000000000']);

    const byId = new Map((candidates || []).map((c) => [c.id, c]));

    matches = (rawMatches || []).map((m) => {
      const c: any = byId.get(m.candidate_id) || {};
      const revealed = m.status === 'revealed';
      return {
        ...m,
        candidate: {
          // Always-safe summary fields:
          headline: c.headline ?? null,
          dept: c.dept ?? null,
          years_experience: c.years_experience ?? null,
          current_comp: c.current_comp ?? null,
          home_zip: c.home_zip ?? null,
          // Contact released only on reveal:
          full_name: revealed ? c.full_name ?? null : null,
          email: revealed ? c.email ?? null : null,
          phone: revealed ? c.phone ?? null : null,
        },
      };
    });
  }

  return NextResponse.json({ openings: openings || [], matches });
}
