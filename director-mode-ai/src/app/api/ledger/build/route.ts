/**
 * POST { from, to, uploads?: [{ pro, csv }] } → build the Clubessential charge file.
 *
 * Reads each pro's Google Sheet (shared view-only with the service account) or a CSV the
 * director uploaded instead, turns the rows into lesson lines (metered AI step), matches
 * every student to a member number (never guessing), and returns:
 *   charges (the file's lines), needsYou (with candidates), skipped rows, a per-pro
 *   summary for payroll, and the CSV text to download and import in Clubessential.
 * Nothing posts to Clubessential: the director imports the file and taps Post Batch.
 * The run is saved (clubessential_ledger_runs) and a receipt goes on the Pro Shop board.
 */
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { proshopCaller, canDecide } from '@/lib/proshop/server';
import { buildCharges, chargesCsv, ledgerSetupOf, proSummary, type ChargeSetup, type LessonLine, type RosterMember } from '@/lib/clubessential/charges';
import { EXTRACT_MODEL, extractLessons, readSheet, rowsFromCsv } from '@/lib/clubessential/extract';
import { addUsage, emptyUsage, recordRequest } from '@/lib/assistant/meter';
import { sendBilling } from '@/lib/usageMeter';
import { overMonthlyLimit } from '@/lib/usageMeter';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;

export async function POST(req: Request) {
  const c = await proshopCaller();
  if (!c.ok) return NextResponse.json({ error: c.error }, { status: c.status });
  if (!canDecide(c.ctx)) return NextResponse.json({ error: 'Only the owner or director can build charges.' }, { status: 403 });
  if (!KEY) return NextResponse.json({ error: 'AI is not configured on this server.' }, { status: 503 });
  const body = await req.json().catch(() => null);
  const from = String(body?.from ?? ''), to = String(body?.to ?? '');
  if (!YMD.test(from) || !YMD.test(to) || from > to) return NextResponse.json({ error: 'Pick a start and end date.' }, { status: 400 });

  const billing = await sendBilling(c.ctx.userId);
  if (await overMonthlyLimit(billing.billingUserId, billing.exempt)) {
    return NextResponse.json({ error: "You've reached your monthly limit, so your staff is paused. Raise it on the Pro Shop page." }, { status: 402 });
  }

  const { data } = await c.ctx.db.from('clubessential_ledger').select('roster, pros, setup').eq('club_id', c.ctx.clubId).maybeSingle();
  const row = data as any;
  const roster = (row?.roster ?? []) as RosterMember[];
  if (!roster.length) return NextResponse.json({ error: 'Upload your Clubessential member list first.' }, { status: 400 });
  const pros = (row?.pros ?? []) as { name: string; sheet: string; employee: string }[];
  const s = ledgerSetupOf(row?.setup);
  const setup: ChargeSetup = {
    area: s.area || 'Tennis',
    items: s.items,
    taxExempt: s.taxExempt !== false,
    employees: Object.fromEntries(pros.filter((p) => p.employee).map((p) => [p.name, p.employee])),
  };

  const client = new Anthropic({ apiKey: KEY });
  let usage = emptyUsage(), rounds = 0;
  const lines: LessonLine[] = [];
  const skipped: { row: string; reason: string }[] = [];
  const problems: string[] = [];
  const year = Number(from.slice(0, 4));

  const uploads = Array.isArray(body?.uploads) ? body.uploads.slice(0, 20) : [];
  const sources: { pro: string; name: string; rows: string[][] }[] = [];
  for (const u of uploads) {
    const pro = String(u?.pro ?? '').trim();
    if (pro && typeof u?.csv === 'string') sources.push({ pro, name: 'upload', rows: rowsFromCsv(u.csv.slice(0, 500_000)) });
  }
  const uploadedPros = new Set(sources.map((x) => x.pro));
  for (const p of pros) {
    if (!p.sheet || uploadedPros.has(p.name)) continue;
    try {
      const sh = await readSheet(p.sheet);
      for (const t of sh.tabs) if (t.rows.length > 1) sources.push({ pro: p.name, name: t.name, rows: t.rows });
    } catch (e) { problems.push(`${p.name}: ${(e as Error).message}`); }
  }
  if (!sources.length) return NextResponse.json({ error: problems[0] || 'No sheets to read. Add each pro\'s sheet link, or upload their sheet as a CSV.', problems }, { status: 400 });

  for (const src of sources) {
    try {
      const ex = await extractLessons(client, { pro: src.pro, sheetName: src.name, rows: src.rows, from, to, year, prices: s.prices || undefined });
      usage = addUsage(usage, ex.usage); rounds++;
      lines.push(...ex.lines); skipped.push(...ex.skipped);
    } catch (e) { problems.push(`${src.pro} (${src.name}): couldn't read it (${(e as Error).message})`); }
  }

  if (rounds) {
    await recordRequest(c.ctx.db, {
      billingUserId: billing.billingUserId, userId: c.ctx.userId, clubId: c.ctx.clubId, model: EXTRACT_MODEL,
      rounds, usage, page: '/ledger', exempt: billing.exempt,
    }).catch((e) => console.error('ledger meter failed', e));
  }

  const { charges, needsYou } = buildCharges(lines, roster, setup);
  const csv = chargesCsv(charges);
  const totalCents = Math.round(charges.reduce((a, x) => a + x.price * x.qty, 0) * 100);

  await c.ctx.db.from('clubessential_ledger_runs').insert({
    club_id: c.ctx.clubId, date_from: from, date_to: to, charges: charges.length, total_cents: totalCents,
    needs_you: needsYou.length, csv, detail: { problems, skipped: skipped.length }, created_by: c.ctx.userId,
  });
  await c.ctx.db.from('proshop_tasks').insert({
    club_id: c.ctx.clubId, agent: 'ledger', source: 'staff', status: 'done', created_by: c.ctx.userId,
    text: `Built the Clubessential charge file for ${from} to ${to}`,
    note: `${charges.length} charges, $${(totalCents / 100).toFixed(2)}${needsYou.length ? `; ${needsYou.length} need you` : ''}. Import it and tap Post Batch.`,
  });

  return NextResponse.json({
    from, to,
    charges: charges.map((x) => ({ memberNumber: x.memberNumber, memberName: x.memberName, item: x.itemName, description: x.description, qty: x.qty, price: x.price, employee: x.employeeName, student: x.line.student, source: x.line.source })),
    needsYou: needsYou.map((n) => ({ ...n, line: { ...n.line } })),
    skipped,
    problems,
    pros: proSummary(lines),
    totalCents,
    csv,
  });
}
