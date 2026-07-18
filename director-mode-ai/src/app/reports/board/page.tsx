import { redirect } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import BoardReport from "@/components/boardReport/BoardReport";
import {
  getBoardReportData,
  previousMonthRange,
  type BoardReportContext,
} from "@/lib/boardReport/data";

export const dynamic = "force-dynamic";

export default async function BoardReportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/reports/board");

  const db = getSupabaseAdmin();

  const { data: club } = await db
    .from("cc_clubs")
    .select("id, slug, name, timezone, logo_url, owner_id")
    .eq("owner_id", user.id)
    .order("name", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!club) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-bold text-white">No club found</h1>
        <p className="mt-2 text-slate-300">
          Set up your club in CourtSheet first, then your Board Report will populate here.
        </p>
        <Link href="/reports/board/demo" className="mt-6 inline-block text-teal-400 underline">
          See a sample report
        </Link>
      </div>
    );
  }

  const now = new Date();
  const { start, end, label } = previousMonthRange(now);

  // Build an absolute survey URL from the incoming request host.
  const h = await headers();
  const host = h.get("host") ?? "club.coachmode.ai";
  const proto = host.includes("localhost") ? "http" : "https";
  const surveyUrl = `${proto}://${host}/nps/${club.slug}`;

  const ctx: BoardReportContext = {
    clubId: club.id,
    directorId: user.id,
    clubName: club.name,
    logoUrl: club.logo_url ?? null,
    timezone: club.timezone ?? "America/Los_Angeles",
    surveyUrl,
    periodStart: start,
    periodEnd: end,
    periodLabel: label,
    generatedAtLabel: now.toLocaleString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
  };

  const data = await getBoardReportData(db, ctx);

  return (
    <div className="min-h-screen bg-gray-100 py-8 print:bg-white print:py-0">
      <BoardReport data={data} />
    </div>
  );
}
