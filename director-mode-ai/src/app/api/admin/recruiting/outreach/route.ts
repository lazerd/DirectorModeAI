import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { requireOwner } from '@/lib/connect/recruiter/adminAuth';
import { sendQueue } from '@/lib/connect/recruiter/send';
import { background } from '@/lib/partnerFinder/background';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST — act on the approval queue.
//   { action: 'approve', id }                 approve one (sends now, in the background)
//   { action: 'approve_all_club_pitches' }    approve every drafted club pitch
//   { action: 'edit', id, subject?, body_html?, to_email? }  edit a draft; adding an email to a needs_email row makes it a draft
//   { action: 'skip', id }
//   { action: 'replied', id }                 mark a sent club pitch as replied: stops that club's follow-ups
export async function POST(req: Request) {
  const gate = await requireOwner();
  if ('response' in gate) return gate.response;
  const db = getSupabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const now = new Date().toISOString();
  const id = typeof body.id === 'string' ? body.id : null;

  switch (body.action) {
    case 'approve': {
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const { data, error } = await db
        .from('connect_outreach')
        .update({ status: 'approved', approved_by: gate.user.id, updated_at: now })
        .eq('id', id)
        .eq('status', 'draft')
        .not('to_email', 'is', null)
        .select('id');
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data?.length) return NextResponse.json({ error: 'Only a draft with an email address can be approved.' }, { status: 400 });
      background('recruiting approved send', () => sendQueue({ ids: [id] }));
      return NextResponse.json({ ok: true, approved: 1 });
    }
    case 'approve_all_club_pitches': {
      const { data, error } = await db
        .from('connect_outreach')
        .update({ status: 'approved', approved_by: gate.user.id, updated_at: now })
        .eq('kind', 'club_pitch')
        .eq('status', 'draft')
        .not('to_email', 'is', null)
        .select('id');
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const ids = (data ?? []).map((r) => r.id as string);
      if (ids.length) background('recruiting approved club pitches', () => sendQueue({ ids, limit: ids.length }));
      return NextResponse.json({ ok: true, approved: ids.length });
    }
    case 'edit': {
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const { data: row } = await db.from('connect_outreach').select('status').eq('id', id).maybeSingle();
      if (!row || !['draft', 'needs_email', 'approved'].includes(row.status)) return NextResponse.json({ error: 'Only unsent drafts can be edited.' }, { status: 400 });
      const patch: Record<string, unknown> = { updated_at: now, status: row.status === 'approved' ? 'draft' : row.status };
      if (typeof body.subject === 'string') patch.subject = body.subject.slice(0, 300);
      if (typeof body.body_html === 'string') patch.body_html = body.body_html.slice(0, 20000);
      if (typeof body.to_email === 'string') {
        const e = body.to_email.trim();
        if (e && !EMAIL_RE.test(e)) return NextResponse.json({ error: 'That email address does not look right.' }, { status: 400 });
        patch.to_email = e || null;
        patch.status = e ? 'draft' : 'needs_email';
      }
      const { error } = await db.from('connect_outreach').update(patch).eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    case 'skip': {
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const { data: row } = await db.from('connect_outreach').update({ status: 'skipped', error: 'skipped by admin', updated_at: now }).eq('id', id).in('status', ['draft', 'approved', 'needs_email']).select('target_id');
      const t = row?.[0]?.target_id;
      if (t) await db.from('connect_prospect_targets').update({ status: 'skipped', updated_at: now }).eq('id', t).in('status', ['new', 'queued']);
      return NextResponse.json({ ok: true });
    }
    case 'replied': {
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      await db.from('connect_outreach').update({ status: 'replied', updated_at: now }).eq('id', id).eq('status', 'sent');
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }
}
