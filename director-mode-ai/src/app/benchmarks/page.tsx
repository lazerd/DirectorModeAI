'use client';

import { useMemo, useState } from 'react';
import { Search, Download, ExternalLink, TrendingUp, Users, DollarSign, Percent } from 'lucide-react';
import rawData from './_data/benchmarks.json';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';

type Row = {
  club: string; ein: string; state: string; region: string; dept: string;
  title: string; name: string; reported: number; other: number; total: number;
  revenue: number; pct: number | null; year: string; url: string; recent: boolean;
};

const DATA = rawData as Row[];

const DEPTS = [
  { key: 'all', label: 'All positions' },
  { key: 'Tennis/Racquets', label: 'Director of Tennis / Racquets' },
  { key: 'Golf', label: 'Director of Golf' },
  { key: 'GM', label: 'General Manager / COO' },
];

const STATES = Array.from(new Set(DATA.map((r) => r.state).filter(Boolean))).sort();
const REGIONS = ['Northeast', 'South', 'Midwest', 'West'];

const COMP_PRESETS: { label: string; min: string; max: string }[] = [
  { label: '< $100k', min: '', max: '100000' },
  { label: '$100–150k', min: '100000', max: '150000' },
  { label: '$150–250k', min: '150000', max: '250000' },
  { label: '$250k+', min: '250000', max: '' },
];

const usd = (n: number) =>
  n >= 0 ? `$${Math.round(n).toLocaleString()}` : '—';

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

export default function BenchmarksPage() {
  const [dept, setDept] = useState('Tennis/Racquets');
  const [state, setState] = useState('all');
  const [region, setRegion] = useState('all');
  const [query, setQuery] = useState('');
  const [recentOnly, setRecentOnly] = useState(true);
  const [shortlist, setShortlist] = useState<Record<string, Row>>({});
  const [minComp, setMinComp] = useState('');
  const [maxComp, setMaxComp] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const min = minComp ? Number(minComp) : null;
    const max = maxComp ? Number(maxComp) : null;
    return DATA.filter((r) => {
      if (dept !== 'all' && r.dept !== dept) return false;
      if (state !== 'all' && r.state !== state) return false;
      if (region !== 'all' && r.region !== region) return false;
      if (recentOnly && !r.recent) return false;
      if (min != null && r.total < min) return false;
      if (max != null && r.total > max) return false;
      if (q && !(`${r.club} ${r.name} ${r.title}`.toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => b.total - a.total);
  }, [dept, state, region, query, recentOnly, minComp, maxComp]);

  const stats = useMemo(() => {
    const totals = filtered.map((r) => r.total).sort((a, b) => a - b);
    const pcts = filtered.map((r) => r.pct).filter((x): x is number => x != null).sort((a, b) => a - b);
    return {
      n: filtered.length,
      median: percentile(totals, 50),
      p25: percentile(totals, 25),
      p75: percentile(totals, 75),
      p90: percentile(totals, 90),
      max: totals.length ? totals[totals.length - 1] : 0,
      medPct: pcts.length ? pcts[Math.floor(pcts.length / 2)] : null,
    };
  }, [filtered]);

  const shortlistArr = Object.values(shortlist);

  function toggle(r: Row) {
    const id = r.ein + r.name;
    setShortlist((s) => {
      const next = { ...s };
      if (next[id]) delete next[id];
      else next[id] = r;
      return next;
    });
  }

  function exportCsv() {
    const rows = shortlistArr.length ? shortlistArr : filtered;
    const cols = ['club', 'state', 'region', 'dept', 'title', 'name', 'total', 'revenue', 'pct', 'year', 'url'];
    const header = ['Club', 'State', 'Region', 'Department', 'Title', 'Name', 'Total Comp', 'Club Revenue', 'Comp % of Rev', 'Tax Year', 'ProPublica URL'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [header.map(esc).join(',')];
    for (const r of rows) lines.push(cols.map((c) => esc((r as Record<string, unknown>)[c])).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `club-comp-${dept.replace(/\W+/g, '-')}.csv`;
    a.click();
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Compensation Benchmarks &amp; Recruiting</h1>
        <p className="mt-1 text-muted-foreground">
          Real comp data from IRS Form 990 filings — source candidates by position, region, and pay range, then build a shortlist and export your outreach list.
        </p>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="grid gap-1.5">
            <Label>Position</Label>
            <Select value={dept} onValueChange={setDept}>
              <SelectTrigger className="w-[260px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DEPTS.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>State</Label>
            <Select value={state} onValueChange={setState}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All states</SelectItem>
                {STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Region</Label>
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All regions</SelectItem>
                {REGIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Total comp range</Label>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                inputMode="numeric"
                placeholder="Min $"
                className="w-[110px]"
                value={minComp}
                onChange={(e) => setMinComp(e.target.value)}
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="number"
                inputMode="numeric"
                placeholder="Max $"
                className="w-[110px]"
                value={maxComp}
                onChange={(e) => setMaxComp(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Quick ranges</Label>
            <div className="flex flex-wrap gap-1.5">
              {COMP_PRESETS.map((p) => {
                const active = minComp === p.min && maxComp === p.max;
                return (
                  <Button
                    key={p.label}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    onClick={() => {
                      setMinComp(p.min);
                      setMaxComp(p.max);
                    }}
                  >
                    {p.label}
                  </Button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-1.5 flex-1 min-w-[200px]">
            <Label>Search</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Club, name, or title…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch id="recent" checked={recentOnly} onCheckedChange={setRecentOnly} />
            <Label htmlFor="recent" className="cursor-pointer">Most recent per club</Label>
          </div>
        </CardContent>
      </Card>

      {/* Benchmark stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={<Users className="h-4 w-4" />} label="People" value={stats.n.toString()} />
        <StatCard icon={<DollarSign className="h-4 w-4" />} label="Median total comp" value={usd(stats.median)} />
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Middle 50% range" value={`${usd(stats.p25)} – ${usd(stats.p75)}`} />
        <StatCard icon={<Percent className="h-4 w-4" />} label="Median % of revenue" value={stats.medPct != null ? `${(stats.medPct * 100).toFixed(1)}%` : '—'} />
      </div>

      {/* Action bar */}
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {filtered.length} results
          {shortlistArr.length > 0 && <> · <span className="font-medium text-foreground">{shortlistArr.length} on shortlist</span></>}
        </p>
        <Button onClick={exportCsv} variant="outline" size="sm">
          <Download className="mr-2 h-4 w-4" />
          Export {shortlistArr.length > 0 ? 'shortlist' : 'all'} (CSV)
        </Button>
      </div>

      {/* Results table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Club</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Total comp</TableHead>
              <TableHead className="text-right">Club revenue</TableHead>
              <TableHead className="text-right">% rev</TableHead>
              <TableHead>Year</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(0, 300).map((r) => {
              const id = r.ein + r.name;
              return (
                <TableRow key={id} className={shortlist[id] ? 'bg-muted/50' : ''}>
                  <TableCell>
                    <input type="checkbox" checked={!!shortlist[id]} onChange={() => toggle(r)} className="h-4 w-4 cursor-pointer" />
                  </TableCell>
                  <TableCell className="font-medium max-w-[220px] truncate" title={r.club}>{r.club}</TableCell>
                  <TableCell><Badge variant="secondary">{r.state}</Badge></TableCell>
                  <TableCell className="max-w-[200px] truncate" title={r.title}>{r.title}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{usd(r.total)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{usd(r.revenue)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{r.pct != null ? `${(r.pct * 100).toFixed(1)}%` : '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{r.year}</TableCell>
                  <TableCell>
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {filtered.length > 300 && (
          <div className="border-t p-3 text-center text-sm text-muted-foreground">
            Showing top 300 of {filtered.length}. Narrow the filters or export to see all.
          </div>
        )}
        {filtered.length === 0 && (
          <div className="p-10 text-center text-muted-foreground">No matches for these filters.</div>
        )}
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Source: IRS Form 990 Part VII (public filings). Comp = reportable + estimated other compensation. Figures lag 1–2 years and capture only officers/key employees and a club&apos;s five highest-paid staff.
      </p>
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
