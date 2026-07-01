import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { sendBilledEmail } from '@/lib/email';

// POST /api/connect/request-intro — a club flags interest in a named prospect
// from the benchmark list. Prospects come from public 990 data (no contact), so
// v1 is concierge: we email the ClubMode team the lead + confirm to the club,
// and broker the intro by hand. No new table needed to validate demand.
const LEADS_EMAIL = process.env.RECRUITING_LEADS_EMAIL || 'darrinjco@gmail.com';
const usd = (n: number) => (Number.isFinite(n) ? `$${Math.round(n).toLocaleString()}` : '—');
const esc = (s: unknown) =>
  String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] || c));

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const p = body.prospect || {};
  const o = body.opening || {};
  if (!p.name || !p.club) return NextResponse.json({ error: 'prospect required' }, { status: 400 });

  const svc = await createServiceClient();
  const { data: profile } = await svc.from('profiles').select('email').eq('id', user.id).maybeSingle();
  const clubEmail: string | null = profile?.email ?? null;
  const clubName = o.club_name || 'A ClubMode club';

  // Persist the interest so it can surface for the director if they later opt in
  // and claim this 990 record. Best-effort: if the table isn't there yet, we
  // still send the concierge emails below.
  if (p.ein) {
    try {
      await svc.from('connect_prospect_interests').upsert({
        owner_id: user.id,
        opening_id: o.opening_id || null,
        club_name: o.club_name || null,
        role: o.title || o.dept || null,
        comp_min: Number.isFinite(Number(o.comp_min)) ? Number(o.comp_min) : null,
        comp_max: Number.isFinite(Number(o.comp_max)) ? Number(o.comp_max) : null,
        prospect_ein: String(p.ein),
        prospect_name: String(p.name),
        prospect_name_norm: String(p.name).toLowerCase().replace(/\s+/g, ' ').trim(),
        prospect_club: p.club || null,
        prospect_title: p.title || null,
        prospect_comp: Number.isFinite(Number(p.comp)) ? Number(p.comp) : null,
        prospect_year: p.year || null,
        prospect_url: p.url || null,
        status: 'open',
      }, { onConflict: 'owner_id,prospect_ein,prospect_name_norm', ignoreDuplicates: false });
    } catch { /* table not applied yet — emails below still fire */ }
  }
  const role = o.title || o.dept || 'a leadership role';
  const band = o.comp_max
    ? (o.comp_min ? `${usd(Number(o.comp_min))}–${usd(Number(o.comp_max))}` : `up to ${usd(Number(o.comp_max))}`)
    : '(band not set)';

  // --- Notify the ClubMode team (the concierge broker) ---
  await sendBilledEmail(null, {
    to: LEADS_EMAIL,
    replyTo: clubEmail || undefined,
    subject: `Intro request: ${clubName} → ${p.name}`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
        <h2 style="margin:0 0 8px">New intro request</h2>
        <p style="margin:0 0 16px;color:#475569"><strong>${esc(clubName)}</strong> wants an intro to a benchmark prospect for <strong>${esc(role)}</strong> (${esc(band)}).</p>
        <table style="font-size:14px;color:#334155;border-collapse:collapse">
          <tr><td style="padding:2px 12px 2px 0;color:#64748b">Prospect</td><td><strong>${esc(p.name)}</strong></td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#64748b">Currently</td><td>${esc(p.title || '')} · ${esc(p.club)} (${esc(p.state || '')})</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#64748b">990 comp</td><td>${usd(Number(p.comp))} (${esc(p.year || '')})</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#64748b">Club contact</td><td>${esc(clubEmail || 'unknown')}</td></tr>
          ${p.url ? `<tr><td style="padding:2px 12px 2px 0;color:#64748b">990</td><td><a href="${esc(p.url)}">${esc(p.url)}</a></td></tr>` : ''}
        </table>
        <p style="margin:16px 0 0;color:#475569">Reach out to broker the connection.</p>
      </div>`,
  }).catch(() => {});

  // --- Confirm to the club ---
  if (clubEmail) {
    await sendBilledEmail(null, {
      to: clubEmail,
      subject: `We're on it — intro to ${p.name}`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
          <h2 style="margin:0 0 8px">Request received 🤝</h2>
          <p style="margin:0 0 16px;color:#475569">
            We got your request to connect with <strong>${esc(p.name)}</strong> (${esc(p.title || '')}, ${esc(p.club)}) for your ${esc(role)} opening.
            ClubMode will reach out to broker a warm intro and follow up with you directly.
          </p>
          <p style="margin:0;color:#475569">In the meantime, keep your opening saved so we can also alert you if ${esc(p.name.split(' ')[0])} or another fit opts in.</p>
        </div>`,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
