import { NextResponse } from 'next/server';
import rawData from '@/app/benchmarks/_data/benchmarks.json';
import { createClient } from '@/lib/supabase/server';

// GET ?q=name — server-side search of the 990 dataset so a director can
// "claim" their public record and prefill their candidate profile. Kept on the
// server so the 1.1MB benchmarks.json never re-ships in the client bundle.
// Signed-in only: it returns named rows, and both callers (/connect/candidate,
// /benchmarks/profile) are already behind login.
type Row = {
  club: string; ein: string; state: string; region: string; dept: string;
  title: string; name: string; total: number; year: string; zip?: string | null;
  recent?: boolean;
};
const DATA = rawData as Row[];

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim().toLowerCase();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const results = DATA.filter((r) => r.name && r.name.toLowerCase().includes(q))
    .sort((a, b) => Number(b.recent) - Number(a.recent) || b.total - a.total)
    .slice(0, 12)
    .map((r) => ({
      name: r.name,
      club: r.club,
      ein: r.ein,
      state: r.state,
      dept: r.dept,
      title: r.title,
      total: r.total,
      year: r.year,
      zip: r.zip ?? null,
    }));

  return NextResponse.json({ results });
}
