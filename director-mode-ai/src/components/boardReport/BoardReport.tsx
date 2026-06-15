import type {
  BoardReportData,
  TrendPoint,
  AttentionSeverity,
} from "@/lib/boardReport/types";
import { npsLabel } from "@/lib/boardReport/nps";
import PrintButton from "./PrintButton";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

const serif = { fontFamily: "Georgia, 'Times New Roman', serif" };
const NAVY = "#002838";

function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct > 0;
  const flat = pct === 0;
  const color = flat ? "#6b7280" : up ? "#15803d" : "#b91c1c";
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-0.5 text-sm font-semibold" style={{ color }}>
      <Icon size={14} />
      {up ? "+" : ""}
      {pct}%
    </span>
  );
}

function BarRow({ point, max }: { point: TrendPoint; max: number }) {
  const w = max > 0 ? Math.round((point.value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-10 shrink-0 text-xs text-gray-500">{point.label}</span>
      <div className="h-5 flex-1 rounded bg-gray-100">
        <div className="h-5 rounded" style={{ width: `${w}%`, backgroundColor: NAVY }} />
      </div>
      <span className="w-12 shrink-0 text-right text-xs font-medium text-gray-700">
        {point.value}
      </span>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="report-section mb-10 break-inside-avoid">
      <div className="mb-4 border-b border-gray-200 pb-2">
        <h2 className="text-xl font-bold text-gray-900" style={serif}>
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
      {message}
    </div>
  );
}

function Stat({
  value,
  label,
  sub,
}: {
  value: string;
  label: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-3xl font-bold text-gray-900" style={serif}>
        {value}
      </div>
      <div className="mt-1 text-xs uppercase tracking-wide text-gray-500">{label}</div>
      {sub && <div className="mt-1 text-sm">{sub}</div>}
    </div>
  );
}

const severityStyles: Record<AttentionSeverity, { bg: string; border: string; dot: string; tag: string }> = {
  opportunity: { bg: "#f0f9ff", border: "#bae6fd", dot: "#0284c7", tag: "Opportunity" },
  watch: { bg: "#fff7ed", border: "#fed7aa", dot: "#ea580c", tag: "Watch" },
  good: { bg: "#f0fdf4", border: "#bbf7d0", dot: "#16a34a", tag: "Strength" },
};

export default function BoardReport({ data }: { data: BoardReportData }) {
  const { membership, courts, participation, nps, attention } = data;

  const kpis: { value: string; label: string; sub?: React.ReactNode }[] = [
    {
      value: membership.available ? String(membership.active) : "—",
      label: "Active members",
      sub: membership.available ? <Delta pct={pctChange(membership)} /> : null,
    },
    {
      value: courts.available ? `${courts.utilizationPct}%` : "—",
      label: "Court utilization",
      sub: courts.available ? (
        <span className="text-xs text-gray-500">peak {courts.peakUtilizationPct}%</span>
      ) : null,
    },
    {
      value:
        participation.totalUniqueParticipants !== null
          ? String(participation.totalUniqueParticipants)
          : participation.available
          ? String(participation.programs.reduce((a, p) => a + p.participants, 0))
          : "—",
      label: "Program participants",
    },
    {
      value: nps.available && nps.score !== null ? String(nps.score) : "—",
      label: "Net Promoter Score",
      sub: nps.available ? (
        <span className="text-xs text-gray-500">{nps.responses} responses</span>
      ) : null,
    },
  ];

  const maxMembership = Math.max(1, ...membership.trend.map((t) => t.value));

  return (
    <div className="mx-auto max-w-3xl bg-white px-8 py-10 text-gray-900 print:px-0 print:py-0">
      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .report-section { box-shadow: none !important; }
          body { background: white !important; }
        }
        @page { margin: 1.5cm; }
      `}</style>

      {data.isDemo && (
        <div className="no-print mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Sample report.</strong> This is a demonstration with example data so you can
          see the finished product. Live reports populate automatically from your club's real
          activity.
        </div>
      )}

      {/* Header */}
      <header className="mb-8 flex items-start justify-between gap-4 border-b-2 pb-5" style={{ borderColor: NAVY }}>
        <div>
          {data.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.logoUrl} alt={data.clubName} className="mb-3 h-12 w-auto" />
          ) : null}
          <h1 className="text-2xl font-bold leading-tight text-gray-900" style={serif}>
            {data.clubName}
          </h1>
          <p className="mt-1 text-lg text-gray-700" style={serif}>
            Tennis Program — Monthly Board Report
          </p>
          <p className="mt-0.5 text-sm text-gray-500">{data.periodLabel}</p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-gray-400">Prepared by</div>
          <div className="font-semibold" style={{ color: NAVY }}>
            ClubMode AI
          </div>
          <div className="mt-3 text-xs text-gray-400">Generated {data.generatedAtLabel}</div>
          <div className="no-print mt-3">
            <PrintButton />
          </div>
        </div>
      </header>

      {/* KPI strip */}
      <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map((k) => (
          <Stat key={k.label} value={k.value} label={k.label} sub={k.sub} />
        ))}
      </div>

      {/* Membership */}
      <Section title="Membership" subtitle="Are we growing?">
        {membership.available ? (
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2 text-sm">
              <Line label="Active members" value={String(membership.active)} strong />
              <Line label="New this period" value={`+${membership.newThisPeriod}`} />
              <Line label="Lapsed this period" value={`−${membership.lapsedThisPeriod}`} />
              <Line
                label="Net change"
                value={`${membership.netChange >= 0 ? "+" : ""}${membership.netChange}`}
                strong
              />
            </div>
            <div className="space-y-1.5">
              <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">
                Active members, trailing 6 months
              </div>
              {membership.trend.map((t) => (
                <BarRow key={t.label} point={t} max={maxMembership} />
              ))}
            </div>
          </div>
        ) : (
          <EmptyState message="Connect your member roster (PlayerVault) to populate membership trends." />
        )}
      </Section>

      {/* Court utilization */}
      <Section title="Court Utilization" subtitle="Are we getting value from the facility?">
        {courts.available ? (
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2 text-sm">
              <Line label="Overall utilization" value={`${courts.utilizationPct}%`} strong />
              <Line label="Busiest window" value={`${courts.peakWindow} (${courts.peakUtilizationPct}%)`} />
              <Line label="Quietest window" value={courts.quietWindow} />
              <Line
                label="Court-hours used"
                value={`${courts.courtHoursBooked} / ${courts.courtHoursAvailable}`}
              />
            </div>
            <div className="space-y-1.5">
              <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">
                Utilization by day of week
              </div>
              {courts.byDay.map((t) => (
                <BarRow key={t.label} point={{ ...t }} max={100} />
              ))}
            </div>
          </div>
        ) : (
          <EmptyState message="No court reservations found for this period. CourtSheet activity will populate this section." />
        )}
      </Section>

      {/* Participation */}
      <Section title="Program Participation" subtitle="Are people showing up?">
        {participation.available ? (
          <div>
            {participation.totalUniqueParticipants !== null && (
              <p className="mb-4 text-sm text-gray-700">
                <strong>{participation.totalUniqueParticipants}</strong> unique members took part in
                a program this period.
              </p>
            )}
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {participation.programs.map((p) => (
                <div key={p.name} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="font-medium text-gray-900">{p.name}</div>
                    {p.note && <div className="text-xs text-gray-500">{p.note}</div>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-gray-900" style={serif}>
                      {p.participants}
                    </span>
                    <Delta pct={p.deltaPct} />
                  </div>
                </div>
              ))}
            </div>
            {participation.totalUniqueParticipants === null && (
              <p className="mt-3 text-xs text-gray-400">
                A de-duplicated club-wide participation total unlocks as the unified player profile
                connects across every program.
              </p>
            )}
          </div>
        ) : (
          <EmptyState message="Program participation totals unlock as your programs (Junior Team Tennis, mixers, lessons, tournaments) connect to the unified player profile." />
        )}
      </Section>

      {/* NPS */}
      <Section title="Member Satisfaction" subtitle="Are members happy?">
        {nps.available && nps.score !== null ? (
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <div className="flex items-baseline gap-3">
                <span className="text-5xl font-bold" style={{ ...serif, color: NAVY }}>
                  {nps.score}
                </span>
                <span className="text-sm font-medium text-gray-500">{npsLabel(nps.score)}</span>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                Net Promoter Score · {nps.responses} responses
              </div>
              <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full">
                <div style={{ width: `${pct(nps.promoters, nps.responses)}%`, backgroundColor: "#16a34a" }} />
                <div style={{ width: `${pct(nps.passives, nps.responses)}%`, backgroundColor: "#d1d5db" }} />
                <div style={{ width: `${pct(nps.detractors, nps.responses)}%`, backgroundColor: "#dc2626" }} />
              </div>
              <div className="mt-1.5 flex justify-between text-xs text-gray-500">
                <span>{nps.promoters} promoters</span>
                <span>{nps.passives} passive</span>
                <span>{nps.detractors} detractors</span>
              </div>
            </div>
            <div>
              {nps.trend.length > 0 && (
                <>
                  <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">
                    Score trend
                  </div>
                  <div className="space-y-1.5">
                    {nps.trend.map((t) => (
                      <BarRow key={t.label} point={t} max={100} />
                    ))}
                  </div>
                </>
              )}
              {nps.themes.length > 0 && (
                <div className="mt-4">
                  <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">
                    What members are saying
                  </div>
                  <ul className="list-inside list-disc text-sm text-gray-700">
                    {nps.themes.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ) : (
          <EmptyState
            message={
              nps.surveyUrl
                ? "No survey responses yet this period. Share your member survey link to start collecting NPS."
                : "Member satisfaction surveying is not set up yet."
            }
          />
        )}
        {nps.surveyUrl && (
          <p className="no-print mt-3 text-xs text-gray-500">
            Survey link to share: <span className="font-mono text-gray-700">{nps.surveyUrl}</span>
          </p>
        )}
      </Section>

      {/* Board attention */}
      {attention.length > 0 && (
        <Section title="For the Board's Attention">
          <div className="space-y-3">
            {attention.map((a, i) => {
              const s = severityStyles[a.severity];
              return (
                <div
                  key={i}
                  className="break-inside-avoid rounded-lg border p-4"
                  style={{ backgroundColor: s.bg, borderColor: s.border }}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.dot }} />
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: s.dot }}>
                      {s.tag}
                    </span>
                  </div>
                  <div className="font-semibold text-gray-900">{a.title}</div>
                  <p className="mt-0.5 text-sm text-gray-700">{a.detail}</p>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Footer / methodology */}
      <footer className="mt-10 border-t border-gray-200 pt-4 text-xs leading-relaxed text-gray-400">
        <p>
          <strong>Court utilization</strong> is the share of available court-hours (operating hours
          × courts) that were reserved during the period. <strong>NPS</strong> (Net Promoter Score)
          is the percentage of promoters (9–10) minus detractors (0–6), from member survey
          responses. Prepared automatically by ClubMode AI.
        </p>
      </footer>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 pb-1.5">
      <span className="text-gray-600">{label}</span>
      <span className={strong ? "font-bold text-gray-900" : "font-medium text-gray-800"}>{value}</span>
    </div>
  );
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

function pctChange(m: BoardReportData["membership"]): number | null {
  if (m.trend.length < 2) return null;
  const first = m.trend[0].value;
  const last = m.trend[m.trend.length - 1].value;
  if (first === 0) return null;
  return Math.round(((last - first) / first) * 100);
}
