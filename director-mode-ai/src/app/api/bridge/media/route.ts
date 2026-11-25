/** GET ?id= — a texted photo, for the club-computer worker (Bearer BRIDGE_SECRET). */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const key = process.env.BRIDGE_SECRET;
  if (!key || req.headers.get('authorization') !== `Bearer ${key}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id' }, { status: 400 });
  const { data } = await getSupabaseAdmin().from('text_media').select('mime, data').eq('id', id).maybeSingle();
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return new NextResponse(Buffer.from((data as any).data, 'base64'), { headers: { 'content-type': (data as any).mime } });
}
