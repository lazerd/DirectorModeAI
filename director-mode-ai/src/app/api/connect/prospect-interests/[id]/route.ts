import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { sendBilledEmail } from '@/lib/email';

// POST /api/connect/prospect-interests/[id] — the director acts on a club's
// interest. { action: 'accept' } shares their contact with the club (and marks
// it connected); { action: 'dismiss' } hides it. Verified against the caller's
// own claimed 990 record so nobody can act on someone else's interest.
const esc = (s: unknown) =>
  String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] || c));

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { action } = await req.json().catch(() => ({}));
  if (action !== 'accept' && action !== 'dismiss') {
    return NextResponse.json({ error: 'invalid action' }, { status: 400 });
  }

  const svc = await createServiceClient();
  const { data: cand } = await svc
    .from('connect_candidates')
    .select('claimed_ein, full_name, email, phone, headline')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (!cand?.claimed_ein || !cand.full_name) {
    return NextResponse.json({ error: 'no claimed record' }, { status: 404 });
  }
  const norm = String(cand.full_name).toLowerCase().replace(/\s+/g, ' ').trim();

  const { data: interest } = await svc
    .from('connect_prospect_interests')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();
  // Only the director this interest is about can act on it.
  if (!interest || interest.prospect_ein !== cand.claimed_ein || interest.prospect_name_norm !== norm) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  if (action === 'dismiss') {
    await svc.from('connect_prospect_interests').update({ status: 'dismissed' }).eq('id', interest.id);
    return NextResponse.json({ ok: true });
  }

  // accept → connected + hand the club the director's contact
  await svc.from('connect_prospect_interests').update({ status: 'connected' }).eq('id', interest.id);

  const { data: clubProfile } = await svc.from('profiles').select('email').eq('id', interest.owner_id).maybeSingle();
  if (clubProfile?.email) {
    await sendBilledEmail(interest.owner_id, {
      to: clubProfile.email,
      replyTo: cand.email || undefined,
      subject: `${cand.full_name} is open to talking`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
          <h2 style="margin:0 0 8px">Good news — they’re interested 🤝</h2>
          <p style="margin:0 0 16px;color:#475569">
            You asked for an intro to <strong>${esc(cand.full_name)}</strong>${interest.prospect_club ? ` (${esc(interest.prospect_club)})` : ''}
            for your ${esc(interest.role || 'opening')}. They’ve opted into ClubMode and are open to talking — here’s how to reach them:
          </p>
          <div style="margin:0 0 16px;padding:12px 16px;background:#ecfdf5;border-radius:8px">
            <strong>${esc(cand.full_name)}</strong><br/>
            ${cand.email ? `<a href="mailto:${esc(cand.email)}">${esc(cand.email)}</a>` : ''}${cand.phone ? `<br/>${esc(cand.phone)}` : ''}
          </div>
          <p style="margin:0;color:#475569">Reach out directly — they’re expecting to hear from you.</p>
        </div>`,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
