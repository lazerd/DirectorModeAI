/**
 * POST /api/maintenance/upload — one photo (multipart `file`, already shrunk
 * on the phone). Returns { path, url }; the caller then attaches `path` to a
 * task, check, step note or update, and every attaching route re-checks that
 * the path lives under this club's folder.
 */
import { NextResponse } from 'next/server';
import { requireMaintenanceContext, isAuthError, bad, PHOTO_BUCKET } from '@/lib/maintenance/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const ctx = await requireMaintenanceContext();
  if (isAuthError(ctx)) return ctx.error;

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return bad('No photo attached.');
  if (!file.type.startsWith('image/')) return bad('That file is not a photo.');
  if (file.size > 8 * 1024 * 1024) return bad('That photo is too large.', 413);

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${ctx.club.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await ctx.db.storage
    .from(PHOTO_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) return bad(error.message, 500);
  const { data } = ctx.db.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  return NextResponse.json({ path, url: data.publicUrl });
}
