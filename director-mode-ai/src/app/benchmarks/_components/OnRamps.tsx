// The Score / Advisor / Recruiting entry cards. Shared by the signed-in table
// and the public aggregate view; no hooks, so it renders in either tree.
export default function OnRamps() {
  return (
    <>
      {/* Two on-ramps: individuals (Score) + clubs (Advisor) */}
      <div className="mb-4 grid sm:grid-cols-2 gap-4">
        <a href="/benchmarks/score" className="block">
          <div className="h-full rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-5 py-4 transition hover:border-teal-300">
            <div className="font-semibold text-slate-900">💡 Know Your Number</div>
            <div className="text-sm text-slate-600 mt-0.5">Pro? See your exact percentile, what the top 25% earn, and whether you're underpaid.</div>
            <span className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-slate-900">Get my number →</span>
          </div>
        </a>
        <a href="/benchmarks/advisor" className="block">
          <div className="h-full rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white px-5 py-4 transition hover:border-teal-300">
            <div className="font-semibold text-slate-900">🏛️ Comp Advisor for Clubs</div>
            <div className="text-sm text-slate-600 mt-0.5">Hiring? Get a defensible pay band for your club's size & region — then post the opening.</div>
            <span className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-slate-900">Recommend a band →</span>
          </div>
        </a>
      </div>

      {/* ClubMode Connect CTA */}
      <a href="/connect" className="block mb-6">
        <div className="rounded-xl border border-teal-200 bg-gradient-to-r from-teal-50 to-emerald-50 px-5 py-4 flex items-center justify-between gap-4 transition hover:border-teal-300">
          <div>
            <div className="font-semibold text-slate-900">New: ClubMode Recruiting — get matched, not just benchmarked</div>
            <div className="text-sm text-slate-600">Directors open to the right move stay anonymous until a club with a better offer wants to talk. Clubs post an opening and we surface qualified, nearby talent.</div>
          </div>
          <span className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white">Explore →</span>
        </div>
      </a>
    </>
  );
}
