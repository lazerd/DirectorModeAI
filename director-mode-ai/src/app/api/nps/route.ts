import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// Records a member NPS survey response submitted from the public survey page.
// Insert goes through the service-role admin client so unauthenticated members
// can respond without an RLS policy opening the table to the public.
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { clubSlug, score, comment, name, email } = body ?? {};

  const numScore = Number(score);
  if (!Number.isInteger(numScore) || numScore < 0 || numScore > 10) {
    return NextResponse.json({ error: "Score must be a whole number from 0 to 10." }, { status: 400 });
  }

  const db = getSupabaseAdmin();

  let clubId: string | null = null;
  if (clubSlug) {
    const { data: club } = await db
      .from("cc_clubs")
      .select("id")
      .eq("slug", clubSlug)
      .maybeSingle();
    if (!club) {
      return NextResponse.json({ error: "Club not found" }, { status: 404 });
    }
    clubId = club.id;
  }

  const { error } = await db.from("nps_responses").insert({
    club_id: clubId,
    score: numScore,
    comment: typeof comment === "string" ? comment.trim().slice(0, 2000) || null : null,
    respondent_name: typeof name === "string" ? name.trim().slice(0, 200) || null : null,
    respondent_email: typeof email === "string" ? email.trim().slice(0, 200) || null : null,
    source: "link",
  });

  if (error) {
    return NextResponse.json({ error: "Could not save your response." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
