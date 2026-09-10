import Link from 'next/link';
import { Lock, Users, DollarSign, TrendingUp, Building2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { MIN_GROUP_SIZE, type CompSummary, type CrossTab, type PublicSnapshot } from '@/lib/benchmarks/aggregate';
import OnRamps from './OnRamps';

// Logged-out /benchmarks: aggregates only, rendered on the server from a
// snapshot that holds no names, clubs or filing links. The full named table
// is one free sign-in away.

const DEPT_LABEL: Record<string, string> = {
  'Tennis/Racquets': 'Director of Tennis / Racquets',
  Golf: 'Director of Golf',
  GM: 'General Manager / COO',
};
const DEPT_SHORT: Record<string, string> = {
  'Tennis/Racquets': 'Tennis / Racquets',
  Golf: 'Golf',
  GM: 'GM / COO',
};

const REGISTER_HREF = '/register?next=/benchmarks';
// /login reads `redirect` (not `next`) — see src/app/login/page.tsx.
const LOGIN_HREF = '/login?redirect=/benchmarks';

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const usdK = (n: number) => `$${Math.round(n / 1000).toLocaleString()}k`;

export default function PublicBenchmarks({ snapshot }: { snapshot: PublicSnapshot }) {
  const { overall } = snapshot;
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Compensation Benchmarks &amp; Recruiting</h1>
        <p className="mt-1 text-muted-foreground">
          What clubs actually pay their Directors of Tennis &amp; Racquets, Directors of Golf and General Managers —
          medians and ranges by region, club type and club size, from public IRS Form 990 filings.
        </p>
      </div>

      <SignInCta />

      <OnRamps />

      {/* Headline stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={<Users className="h-4 w-4" />} label="Club leaders in the data" value={snapshot.people.toLocaleString()} />
        <StatCard icon={<Building2 className="h-4 w-4" />} label="Clubs" value={snapshot.clubs.toLocaleString()} />
        <StatCard icon={<DollarSign className="h-4 w-4" />} label="Median total comp" value={overall ? usd(overall.median) : '—'} />
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Middle 50% range"
          value={overall ? `${usdK(overall.p25)} – ${usdK(overall.p75)}` : '—'}
        />
      </div>

      {/* By role */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">By role</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">People</TableHead>
                <TableHead className="text-right">25th pct</TableHead>
                <TableHead className="text-right">Median</TableHead>
                <TableHead className="text-right">75th pct</TableHead>
                <TableHead className="text-right">90th pct</TableHead>
                <TableHead className="text-right">Median % of club revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.byRole.map(({ dept, summary: s }) => (
                <TableRow key={dept}>
                  <TableCell className="font-medium">{DEPT_LABEL[dept] || dept}</TableCell>
                  {s ? (
                    <>
                      <TableCell className="text-right tabular-nums">{s.n.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{usd(s.p25)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{usd(s.median)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{usd(s.p75)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{s.p90 != null ? usd(s.p90) : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {s.medPct != null ? `${(s.medPct * 100).toFixed(1)}%` : '—'}
                      </TableCell>
                    </>
                  ) : (
                    <TableCell colSpan={6} className="text-muted-foreground">Not enough filings to publish</TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-1">
        <CrossTabCard title="By region" firstCol="Region" tab={snapshot.byRegion} />
        <CrossTabCard title="By club size (annual revenue)" firstCol="Club revenue" tab={snapshot.bySize} />
        <CrossTabCard title="By club type" firstCol="Club type" tab={snapshot.byType} />
      </div>

      <div className="mt-8">
        <SignInCta />
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Source: IRS Form 990 Part VII (public filings), most recent filing per club. Comp = reportable + estimated other
        compensation, rounded to the nearest $1,000. Groups with fewer than {MIN_GROUP_SIZE} people are not shown.
        Figures lag 1–2 years and capture only officers/key employees and a club&apos;s five highest-paid staff.
      </p>
    </div>
  );
}

function SignInCta() {
  return (
    <div className="mb-6 rounded-xl border border-teal-200 bg-gradient-to-r from-teal-50 to-emerald-50 px-5 py-4 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
        <div>
          <div className="font-semibold text-slate-900">Sign in free to see the full comp tables</div>
          <div className="text-sm text-slate-600">
            Filter club-by-club by state, distance from any ZIP and pay range, and open the source filings.
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Link
          href={REGISTER_HREF}
          className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
        >
          Sign in free to see the full comp tables →
        </Link>
        <Link href={LOGIN_HREF} className="text-sm font-medium text-teal-800 hover:underline whitespace-nowrap">
          I have an account
        </Link>
      </div>
    </div>
  );
}

function CrossTabCard({ title, firstCol, tab }: { title: string; firstCol: string; tab: CrossTab }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">Median total comp · middle 50% range · people</p>
      </CardHeader>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{firstCol}</TableHead>
              {tab.cols.map((c) => (
                <TableHead key={c} className="text-right">{DEPT_SHORT[c] || c}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tab.rows.map((r) => (
              <TableRow key={r.label}>
                <TableCell className="font-medium whitespace-nowrap">{r.label}</TableCell>
                {r.cells.map((s, i) => (
                  <TableCell key={tab.cols[i]} className="text-right align-top">
                    <Cell s={s} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {tab.hidden > 0 && (
        <CardContent className="pt-3 text-xs text-muted-foreground">
          — = fewer than {MIN_GROUP_SIZE} people in that group, hidden to keep individuals anonymous.
        </CardContent>
      )}
    </Card>
  );
}

function Cell({ s }: { s: CompSummary | null }) {
  if (!s) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="tabular-nums">
      <div className="font-semibold">{usd(s.median)}</div>
      <div className="text-xs text-muted-foreground whitespace-nowrap">
        {usdK(s.p25)} – {usdK(s.p75)} · {s.n}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
