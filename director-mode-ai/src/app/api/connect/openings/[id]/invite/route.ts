import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { rankCandidatesForOpening } from '@/lib/connect/aiFit';
import { sendBilledEmails } from '@/lib/email';
import { background } from '@/lib/partnerFinder/background';
import { APP_URL } from '@/lib/appUrl';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// POST — "Invite top matches". Ranks open-to-work candidates for this opening
// and invites each one to apply. The club only ever gets counts back: an
// invited candidate has not consented to being shown to the club.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = getSupabaseAdmin();
  const { data: opening } = await db
    .from('connect_openings')
    .select('id, owner_id, club_name, title, dept, status, terms_accepted_at')
    .eq('id', id)
    .maybeSingle();
  if (!opening || opening.owner_id !== user.id) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (!opening.terms_accepted_at) {
    return NextResponse.json({ error: 'Accept the placement terms on this opening before inviting candidates.' }, { status: 400 });
  }
  if (opening.status !== 'open') {
    return NextResponse.json({ error: 'This opening is not open.' }, { status: 400 });
  }

  const ranked = await rankCandidatesForOpening(id, 15);
  if (!ranked.length) return NextResponse.json({ invited: 0, alreadyInPipeline: 0 });

  const { data: existing } = await db
    .from('connect_applications')
    .select('candidate_id')
    .eq('opening_id', id)
    .in('candidate_id', ranked.map((r) => r.candidate_id));
  const have = new Set((existing || []).map((r) => r.candidate_id));
  const fresh = ranked.filter((r) => !have.has(r.candidate_id));
  if (!fresh.length) return NextResponse.json({ invited: 0, alreadyInPipeline: have.size });

  const now = new Date().toISOString();
  const { data: inserted, error } = await db
    .from('connect_applications')
    .upsert(
      fresh.map((r) => ({
        opening_id: id,
        candidate_id: r.candidate_id,
        stage: 'invited',
        source: 'ai_invite',
        invited_at: now,
      })),
      { onConflict: 'opening_id,candidate_id', ignoreDuplicates: true },
    )
    .select('candidate_id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const insertedIds = new Set((inserted || []).map((r) => r.candidate_id));
  const toEmail = fresh.filter((r) => insertedIds.has(r.candidate_id) && r.email);

  const club = opening.club_name || 'A private club';
  const role = opening.title || (opening.dept === 'Tennis/Racquets' ? 'Director of Racquets' : opening.dept === 'Golf' ? 'Director of Golf' : 'General Manager');
  const link = `${APP_URL}/connect/jobs/${id}`;
  background('recruiting invite emails', () =>
    sendBilledEmails(
      null,
      toEmail.map((r) => {
        const first = (r.full_name || '').trim().split(/\s+/)[0];
        return {
          to: r.email as string,
          subject: `${club} is hiring a ${role} — apply in one click`,
          html: `
<p>${first ? `Hi ${esc(first)},` : 'Hi,'}</p>
<p><strong>${esc(club)}</strong> is hiring a <strong>${esc(role)}</strong>, and your ClubMode profile is a strong match on role, location and pay.</p>
<p>The club hasn't seen your profile. Nothing is shared until you apply — and applying takes one click with the résumé on your profile.</p>
<p><a href="${link}" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">See the opening and apply</a></p>
<p style="color:#64748b;font-size:13px">You're getting this because you marked yourself open to work on ClubMode Recruiting. Turn that off on your candidate profile any time.</p>`,
        };
      }),
    ),
  );

  return NextResponse.json({ invited: insertedIds.size, alreadyInPipeline: have.size });
}
