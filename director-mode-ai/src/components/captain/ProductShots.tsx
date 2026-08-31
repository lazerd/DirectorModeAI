/**
 * "Show, don't tell" for /captainmode.
 *
 * These are recreations of three real surfaces, built from the product's own
 * markup rather than captured as images: the availability email a player
 * receives, the availability board a captain reads, and a sent lineup with
 * confirmations. Rendering them rather than shipping PNGs keeps them crisp on
 * retina, responsive on a phone, and — the part that matters — impossible to
 * go stale when the UI moves.
 *
 * HARD RULE: mirror what the product actually renders, but NEVER with real
 * member data. This page is public; the names here are examples. Real
 * rosters do not belong on a marketing page. The
 * moment a panel shows something CaptainMode cannot do, this stops being a demo
 * and becomes a lie a captain discovers on day one. If you change the real
 * screen, change it here.
 */

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#002838]">
      {/* Window chrome, so it reads as a screen rather than a diagram. */}
      <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/50" />
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/50" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-400/50" />
        <figcaption className="ml-3 text-[11.5px] text-white/35">{label}</figcaption>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </figure>
  );
}

export default function ProductShots() {
  return (
    <section className="border-t border-white/[0.06] px-5 py-16 sm:px-8 sm:py-20">
      <div className="mx-auto max-w-4xl">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">What it actually looks like</h2>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-white/50">
          Three screens, in the order you meet them.
        </p>

        <div className="mt-9 space-y-5">
          {/* ---------- 1. what the PLAYER gets ---------- */}
          <Frame label="What your players get — one email, no login">
            <div className="rounded-xl bg-white p-5 text-[#0f172a]">
              <p className="text-[17px] font-semibold">Can you play?</p>
              <p className="mt-2 text-[14px] text-slate-600">
                Tuesday, Sep 1 at 9:30 AM — vs Northside Racquet Club (home)
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-[10px] bg-[#D3FB52] px-5 py-3 text-[15px] font-semibold text-[#002838]">
                  Yes
                </span>
                <span className="rounded-[10px] bg-slate-200 px-5 py-3 text-[15px] font-semibold text-slate-700">
                  No
                </span>
                <span className="rounded-[10px] bg-slate-200 px-5 py-3 text-[15px] font-semibold text-slate-700">
                  Maybe
                </span>
              </div>
              <p className="mt-4 text-[12.5px] text-slate-400">
                One tap. No account, no app, no password to reset.
              </p>
            </div>
          </Frame>

          {/* ---------- 2. the availability board ---------- */}
          <Frame label="What you see back — availability, four columns">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { n: 14, label: 'Available', tone: '#D3FB52', names: ['Marta Devlin', 'Priya Raman', 'Joan Whitfield', 'Camille Oduya'] },
                { n: 3, label: 'Maybe', tone: '#fbbf24', names: ['Rae Lindqvist', 'Tess Abara'] },
                { n: 7, label: 'Out', tone: '#f87171', names: ['Dana Kirchner', 'Nour Haddad'] },
                { n: 0, label: 'No answer', tone: '#94a3b8', names: [] },
              ].map((g) => (
                <div key={g.label} className="rounded-xl border border-white/[0.08] bg-[#001820] p-4">
                  <div className="text-2xl font-semibold" style={{ color: g.tone }}>{g.n}</div>
                  <div className="mt-0.5 text-[11px] uppercase tracking-wide text-white/40">{g.label}</div>
                  <div className="mt-3 space-y-1">
                    {g.names.length === 0
                      ? <p className="text-[13px] text-white/20">—</p>
                      : g.names.map((n) => (
                          <p key={n} className="text-[13px] leading-snug text-white/75">{n}</p>
                        ))}
                    {g.names.length > 0 && g.n > g.names.length && (
                      <p className="text-[12px] text-white/30">+{g.n - g.names.length} more</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[13px] text-white/40">Enough to field a lineup (8 spots).</p>
          </Frame>

          {/* ---------- 3. the lineup ---------- */}
          <Frame label="The lineup — sent, and confirming itself">
            <div className="space-y-2">
              {[
                { court: 'Doubles 1', wtn: '30.9', a: 'Marta Devlin (3.5)', b: 'Priya Raman (3.0)' },
                { court: 'Doubles 2', wtn: '27.1', a: 'Joan Whitfield (3.0)', b: 'Rae Lindqvist (3.5)' },
                { court: 'Doubles 3', wtn: '29.8', a: 'Camille Oduya (2.5)', b: 'Tess Abara (3.0)' },
              ].map((c) => (
                <div key={c.court} className="rounded-xl border border-white/[0.08] bg-[#001820] p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-white">{c.court}</span>
                    <span className="text-[12px] text-white/35">avg WTN {c.wtn}</span>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {[c.a, c.b].map((p) => (
                      <div key={p} className="flex items-center gap-2">
                        <span className="text-[13.5px] text-white/85">{p}</span>
                        <span className="text-[11.5px] text-[#D3FB52]">confirmed</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[13px] text-[#D3FB52]">
              8 of 8 confirmed — a week before the match.
            </p>
          </Frame>
        </div>

        <p className="mt-6 text-[13px] text-white/30">
          Recreated from the live product, with example names — no real member data.
        </p>
      </div>
    </section>
  );
}
