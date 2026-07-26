type Row = {
  playerAId: string;
  playerBId: string;
  playerAName: string;
  playerBName: string;
  wins: number;
  losses: number;
};

/**
 * What the entered scores say about each partnership. This is also what feeds
 * the lineup generator's chemistry signal, so showing it makes the generator's
 * choices explainable rather than mysterious.
 */
export default function PartnershipsPanel({ partnerships }: { partnerships: Row[] }) {
  if (!partnerships.length) return null;

  const pct = (w: number, l: number) => (w + l ? Math.round((w / (w + l)) * 100) : 0);
  const sorted = [...partnerships].sort(
    (a, b) => pct(b.wins, b.losses) - pct(a.wins, a.losses) || b.wins - a.wins,
  );

  return (
    <section className="mt-10">
      <h2 className="text-xl font-display text-white">Partnerships</h2>
      <p className="text-white/40 text-sm mt-1">
        From entered scores. Winning pairs get favoured when generating lineups; losing pairs get
        split up.
      </p>

      <div className="mt-3 space-y-2">
        {sorted.map((r) => {
          const played = r.wins + r.losses;
          const rate = pct(r.wins, r.losses);
          const tone =
            played < 2
              ? 'text-white/40'
              : rate >= 60
                ? 'text-[#D3FB52]'
                : rate <= 40
                  ? 'text-red-300'
                  : 'text-white/60';
          return (
            <div
              key={`${r.playerAId}-${r.playerBId}`}
              className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-[#002838] px-4 py-3"
            >
              <div className="text-white text-sm">
                {r.playerAName} <span className="text-white/30">/</span> {r.playerBName}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="w-28 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#D3FB52]"
                    style={{ width: `${rate}%` }}
                  />
                </div>
                <div className={`text-sm tabular-nums ${tone}`}>
                  {r.wins}–{r.losses}
                  {played >= 2 && <span className="text-white/30"> · {rate}%</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {sorted.some((r) => r.wins + r.losses < 2) && (
        <p className="text-white/30 text-xs mt-3">
          Pairs with only one match together carry little weight until they play more.
        </p>
      )}
    </section>
  );
}
