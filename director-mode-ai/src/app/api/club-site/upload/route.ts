/**
 * POST /api/club-site/upload?kind=hero|logo|cover|staff|doc
 *
 * Staff-only. Puts a file in the public `club-site` bucket and hands back its
 * URL. Deliberately does NOT write the URL anywhere: a staff photo belongs
 * inside a jsonb list entry and a member packet inside another, so the caller
 * decides where the URL lands and saves it with the rest of its section.
 *
 * The two exceptions are logo and cover, which live on cc_clubs as real
 * columns the rest of the app already reads — those are written here, because
 * that is the only way a director has ever been able to fill them. The club
 * profile form has had the columns and no upload since it shipped.
 */

import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';

export const dynamic = 'force-dynamic';

const KINDS = ['hero', 'logo', 'cover', 'staff', 'doc'] as const;
type Kind = (typeof KINDS)[number];

/** A document may be a PDF; everything else must be an image. */
const ALLOWED: Record<Kind, (type: string) => boolean> = {
  hero: (t) => t.startsWith('image/'),
  logo: (t) => t.startsWith('image/'),
  cover: (t) => t.startsWith('image/'),
  staff: (t) => t.startsWith('image/'),
  doc: (t) => t.startsWith('image/') || t === 'application/pdf',
};

const MAX_BYTES: Record<Kind, number> = {
  hero: 8 * 1024 * 1024,
  logo: 4 * 1024 * 1024,
  cover: 8 * 1024 * 1024,
  staff: 4 * 1024 * 1024,
  doc: 20 * 1024 * 1024,
};

export async function POST(req: Request) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;

  const kindParam = new URL(req.url).searchParams.get('kind') || 'hero';
  if (!KINDS.includes(kindParam as Kind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${KINDS.join(', ')}` },
      { status: 400 },
    );
  }
  const kind = kindParam as Kind;

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
  }
  if (!ALLOWED[kind](file.type)) {
    return NextResponse.json(
      {
        error:
          kind === 'doc'
            ? 'A document must be a PDF or an image.'
            : 'That needs to be an image file.',
      },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES[kind]) {
    return NextResponse.json(
      { error: `Keep it under ${Math.round(MAX_BYTES[kind] / 1024 / 1024)}MB.` },
      { status: 400 },
    );
  }

  const ext =
    (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '') ||
    (file.type === 'application/pdf' ? 'pdf' : 'png');
  // Timestamped rather than a fixed name: a club replacing its hero image
  // should not be fighting a CDN cache of the old one.
  const path = `${ctx.club.id}/${kind}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await ctx.db.storage
    .from('club-site')
    .upload(path, buffer, { contentType: file.type, upsert: true });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data: urlData } = ctx.db.storage.from('club-site').getPublicUrl(path);
  const url = urlData.publicUrl;

  if (kind === 'logo' || kind === 'cover') {
    const column = kind === 'logo' ? 'logo_url' : 'cover_image_url';
    const { error } = await ctx.db
      .from('cc_clubs')
      .update({ [column]: url })
      .eq('id', ctx.club.id);
    // The file uploaded fine. Report the write failure without pretending the
    // whole thing failed and inviting a duplicate upload.
    if (error) return NextResponse.json({ url, warning: error.message });
  }

  return NextResponse.json({ url });
}
