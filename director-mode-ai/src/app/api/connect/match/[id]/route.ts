import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { sendBilledEmail } from '@/lib/email';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai';
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

// POST /api/connect/match/[id] — status transitions on a match.
// Body: { action: 'approve' | 'decline' | 'dismiss' }
//   approve  — candidate releases contact (reveal_mode='approve' flow) -> 'revealed', club gets contact email
//   decline  — candidate passes -> 'candidate_declined'
//   dismiss  — club removes from inbox -> 'club_dismissed'
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { action } = await req.json().catch(() => ({}));
  const svc = await createServiceClient();

  const { data: match } = await svc
    .from('connect_matches')
    .select('*, opening:connect_openings(id, owner_id, club_name, title, dept, comp_max), candidate:connect_candidates(id, profile_id, full_name, email, phone)')
    .eq('id', id)
    .maybeSingle();

  if (!match) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const opening: any = match.opening;
  const candidate: any = match.candidate;
  const isClub = opening?.owner_id === user.id;
  const isCandidate = candidate?.profile_id === user.id;

  if (action === 'dismiss') {
    if (!isClub) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    await svc.from('connect_matches').update({ status: 'club_dismissed' }).eq('id', id);
    return NextResponse.json({ ok: true, status: 'club_dismissed' });
  }

  if (action === 'decline') {
    if (!isCandidate) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    await svc.from('connect_matches').update({ status: 'candidate_declined' }).eq('id', id);
    return NextResponse.json({ ok: true, status: 'candidate_declined' });
  }

  if (action === 'approve') {
    if (!isCandidate) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    await svc.from('connect_matches').update({ status: 'revealed' }).eq('id', id);

    // Now release the candidate's contact to the club.
    const { data: clubProfile } = await svc
      .from('profiles')
      .select('email')
      .eq('id', opening.owner_id)
      .maybeSingle();

    if (clubProfile?.email) {
      const dist = match.distance_miles != null ? Math.round(match.distance_miles) : null;
      await sendBilledEmail(opening.owner_id, {
        to: clubProfile.email,
        subject: `Candidate approved — here's their contact`,
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
            <h2 style="margin:0 0 8px">They said yes ✅</h2>
            <p style="margin:0 0 16px;color:#475569">
              The candidate for your ${opening.title ? `<strong>${opening.title}</strong>` : opening.dept}
              opening (up to ${usd(opening.comp_max)}${dist != null ? `, ${dist} mi away` : ''}) approved contact.
            </p>
            <div style="margin:16px 0;padding:12px 16px;background:#ecfdf5;border-radius:8px">
              <strong>${candidate.full_name || 'Candidate'}</strong><br/>
              ${candidate.email || ''}${candidate.phone ? `<br/>${candidate.phone}` : ''}
            </div>
            <p style="margin:24px 0 0">
              <a href="${BASE}/connect/clubs" style="background:#0f766e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open your match inbox</a>
            </p>
          </div>`,
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true, status: 'revealed' });
  }

  return NextResponse.json({ error: 'invalid action' }, { status: 400 });
}
