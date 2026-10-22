import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const BUCKET = 'resumes';
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

async function callerCandidate() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, cand: null } as const;
  const { data: cand } = await getSupabaseAdmin()
    .from('connect_candidates')
    .select('id, resume_path, resume_filename, resume_uploaded_at')
    .eq('profile_id', user.id)
    .maybeSingle();
  return { user, cand } as const;
}

// POST multipart (field `file`) — upload/replace the caller's résumé.
// Stored privately at <candidate_id>/<timestamp>-<safe name>; never a public URL.
export async function POST(req: Request) {
  const { user, cand } = await callerCandidate();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!cand) return NextResponse.json({ error: 'Save your candidate profile first, then upload your résumé.' }, { status: 400 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'Choose a file to upload.' }, { status: 400 });

  const name = (file as File).name || 'resume';
  const ext = name.toLowerCase().split('.').pop() || '';
  if (!TYPES[ext]) return NextResponse.json({ error: 'Résumé must be a PDF, DOC or DOCX.' }, { status: 400 });
  if (file.size <= 0) return NextResponse.json({ error: 'That file is empty.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Résumé must be 5 MB or smaller.' }, { status: 400 });

  const safe = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(-80) || `resume.${ext}`;
  const path = `${cand.id}/${Date.now()}-${safe}`;
  const svc = getSupabaseAdmin();

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: upErr } = await svc.storage.from(BUCKET).upload(path, bytes, {
    contentType: TYPES[ext],
    upsert: false,
  });
  if (upErr) return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 });

  const uploadedAt = new Date().toISOString();
  const { error: dbErr } = await svc
    .from('connect_candidates')
    .update({ resume_path: path, resume_filename: name.slice(0, 200), resume_uploaded_at: uploadedAt })
    .eq('id', cand.id);
  if (dbErr) {
    await svc.storage.from(BUCKET).remove([path]).catch(() => {});
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 });
  }
  // Old résumé files are kept: past applications snapshot their resume_path.

  return NextResponse.json({ ok: true, resume_filename: name, resume_uploaded_at: uploadedAt });
}

// GET — a 5-minute signed URL for the caller's own résumé.
export async function GET() {
  const { user, cand } = await callerCandidate();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!cand?.resume_path) return NextResponse.json({ error: 'No résumé on file' }, { status: 404 });

  const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).createSignedUrl(cand.resume_path, 300);
  if (error || !data?.signedUrl) return NextResponse.json({ error: 'Could not open résumé' }, { status: 500 });

  return NextResponse.json({
    url: data.signedUrl,
    resume_filename: cand.resume_filename,
    resume_uploaded_at: cand.resume_uploaded_at,
  });
}
