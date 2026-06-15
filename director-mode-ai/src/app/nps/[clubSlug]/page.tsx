import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import SurveyForm from "./SurveyForm";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ clubSlug: string }>;
}

export default async function NpsSurveyPage({ params }: PageProps) {
  const { clubSlug } = await params;
  const db = getSupabaseAdmin();
  const { data: club } = await db
    .from("cc_clubs")
    .select("name, slug")
    .eq("slug", clubSlug)
    .maybeSingle();

  if (!club) notFound();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-md">
        <SurveyForm clubSlug={club.slug} clubName={club.name} />
        <p className="mt-4 text-center text-xs text-gray-400">Powered by ClubMode AI</p>
      </div>
    </div>
  );
}
