/*
 * Clubessential charge file builder (Ledger for Clubessential clubs).
 *
 * Belvedere TC, 11/25/26: each pro logs lessons in a Google Sheet; the director spends
 * hours a week re-typing them as batch charges in Clubessential Office. Clubessential
 * has an official import (Membership > Member Charges > Member Charge Wizard > Import
 * from CSV, then Post Batch), with this template:
 *
 *   Member Number,Area,Item Name,Description,QTY,Price,Employee Name,Tax Exempt
 *
 * So the Ledger reads the pros' sheets, matches every student to a member number from
 * the club's member list, and writes that file. The director imports it and taps Post
 * Batch: that is the "yes". Nothing posts by itself.
 *
 * MATCHING NEVER GUESSES. Exactly one member with that name = matched. Anything else
 * (no match, two members, a likely nickname) goes to "Needs you" with the candidates,
 * the same rule as Sleepy Hollow's Ledger.
 *
 * Pure functions only; the sheet reading and the AI row extraction live in the API route.
 */

export interface RosterMember { memberNumber: string; first: string; last: string; full: string }

export type LessonKind = 'private' | 'semi' | 'group' | 'clinic' | 'other';
export interface LessonLine {
  date: string;          // YYYY-MM-DD
  student: string;       // as written on the sheet
  pro: string;           // the pro whose sheet it came from (or named on the row)
  kind: LessonKind;
  minutes: number | null;
  qty: number;
  price: number;         // what THIS student is charged for this line, dollars
  note?: string | null;
  source?: string;       // "Carrie's sheet, row 14"
}

export interface ChargeSetup {
  area: string;                                   // e.g. "Tennis"
  items: Partial<Record<LessonKind, string>>;     // kind -> Clubessential item name
  employees: Record<string, string>;              // pro as on the sheet -> "Last, First" in Clubessential
  taxExempt: boolean;                             // lessons are usually not taxed
}

export interface Charge {
  memberNumber: string; memberName: string; area: string; itemName: string;
  description: string; qty: number; price: number; employeeName: string; taxExempt: 0 | 1;
  line: LessonLine;
}
export interface NeedsYou { line: LessonLine; reason: string; candidates: { memberNumber: string; name: string }[] }

// ---------------------------------------------------------------- CSV in/out

/** Minimal RFC 4180 CSV parser (quotes, commas and newlines in quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const csvCell = (v: string | number) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const CE_HEADER = ['Member Number', 'Area', 'Item Name', 'Description', 'QTY', 'Price', 'Employee Name', 'Tax Exempt'];

export function chargesCsv(charges: Charge[]): string {
  const lines = [CE_HEADER.join(',')];
  for (const c of charges) {
    lines.push([c.memberNumber, c.area, c.itemName, c.description, c.qty, c.price.toFixed(2), c.employeeName, c.taxExempt].map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- the member list

const norm = (s: string) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s'-]/g, ' ').replace(/['-]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Read a Clubessential member export (CSV). Finds the member-number column and either
 * first/last columns or one name column ("Last, First" or "First Last"). Header names vary
 * by report, so it looks for the usual words rather than exact titles.
 */
export function parseRoster(text: string): { members: RosterMember[]; error?: string } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { members: [], error: 'The member list looks empty.' };
  const hi = rows.findIndex((r) => r.some((c) => /member\s*(#|no|num|number|id)|^acct|account\s*(#|no|number)/i.test(c.trim())));
  if (hi < 0) return { members: [], error: 'Could not find a member number column (like "Member Number" or "Member ID").' };
  const h = rows[hi].map((c) => c.trim().toLowerCase());
  const col = (re: RegExp) => h.findIndex((c) => re.test(c));
  const iNum = col(/member\s*(#|no|num|number|id)|^acct|account\s*(#|no|number)/);
  const iFirst = col(/^first|first\s*name/);
  const iLast = col(/^last|last\s*name|surname/);
  const iName = col(/^(member\s*)?name$|full\s*name|display\s*name/);
  if (iFirst < 0 && iName < 0) return { members: [], error: 'Could not find name columns (First/Last or Name).' };
  const members: RosterMember[] = [];
  for (const r of rows.slice(hi + 1)) {
    const num = (r[iNum] || '').trim();
    if (!num) continue;
    let first = '', last = '';
    if (iFirst >= 0) { first = (r[iFirst] || '').trim(); last = iLast >= 0 ? (r[iLast] || '').trim() : ''; }
    else {
      const n = (r[iName] || '').trim();
      if (n.includes(',')) { const [l, f] = n.split(','); last = l.trim(); first = (f || '').trim(); }
      else { const p = n.split(/\s+/); first = p.slice(0, -1).join(' ') || p[0]; last = p.length > 1 ? p[p.length - 1] : ''; }
    }
    if (!first && !last) continue;
    members.push({ memberNumber: num, first, last, full: `${first} ${last}`.trim() });
  }
  return members.length ? { members } : { members: [], error: 'No members found under the header row.' };
}

/** Exactly one member, or why not (with candidates). */
export function matchMember(student: string, roster: RosterMember[]): { member: RosterMember } | { reason: string; candidates: RosterMember[] } {
  const raw = String(student || '').trim();
  if (!raw) return { reason: 'No name on this line', candidates: [] };
  // "Last, First" on the sheet
  const s = raw.includes(',') ? norm(raw.split(',').reverse().join(' ')) : norm(raw);
  const parts = s.split(' ').filter(Boolean);
  const exact = roster.filter((m) => norm(m.full) === s);
  if (exact.length === 1) return { member: exact[0] };
  if (exact.length > 1) return { reason: `${exact.length} members are named "${raw}"`, candidates: exact };
  const last = parts[parts.length - 1] || '';
  const first = parts[0] || '';
  const sameLast = roster.filter((m) => norm(m.last) === last);
  const sameLastFirstStart = sameLast.filter((m) => {
    const f = norm(m.first);
    return f && first && (f.startsWith(first) || first.startsWith(f));
  });
  // "Jen K": a last initial -> members whose first name starts with "Jen" and last with "K".
  if (parts.length >= 2 && last.length === 1) {
    const init = roster.filter((m) => norm(m.last).startsWith(last) && norm(m.first).startsWith(first));
    return { reason: `Only a last initial ("${raw}")`, candidates: init.slice(0, 5) };
  }
  if (parts.length >= 2 && sameLastFirstStart.length) {
    return { reason: `Not an exact name match. Did you mean ${sameLastFirstStart.map((m) => m.full).join(' or ')}?`, candidates: sameLastFirstStart.slice(0, 5) };
  }
  if (parts.length === 1) {
    const byFirst = roster.filter((m) => norm(m.first) === first);
    return { reason: `Only one name ("${raw}") on the sheet`, candidates: byFirst.slice(0, 5) };
  }
  return { reason: `No member named "${raw}"`, candidates: sameLast.slice(0, 5) };
}

// ---------------------------------------------------------------- build

const md = (ymd: string) => { const [, m, d] = ymd.split('-'); return `${Number(m)}/${Number(d)}`; };
const KIND_LABEL: Record<LessonKind, string> = { private: 'Private lesson', semi: 'Semi-private lesson', group: 'Group lesson', clinic: 'Clinic', other: 'Lesson' };

export function describe(line: LessonLine): string {
  const mins = line.minutes ? ` (${line.minutes} min)` : '';
  const pro = line.pro ? ` w/ ${line.pro.split(/\s+/)[0]}` : '';
  return `${KIND_LABEL[line.kind] || 'Lesson'}${pro} ${md(line.date)}${mins}`.slice(0, 80);
}

export function buildCharges(lines: LessonLine[], roster: RosterMember[], setup: ChargeSetup): { charges: Charge[]; needsYou: NeedsYou[] } {
  const charges: Charge[] = [];
  const needsYou: NeedsYou[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const itemName = setup.items[line.kind] || setup.items.other || '';
    if (!itemName) { needsYou.push({ line, reason: `No Clubessential item set for "${line.kind}" lessons`, candidates: [] }); continue; }
    if (!(line.price > 0)) { needsYou.push({ line, reason: 'No price on this line', candidates: [] }); continue; }
    const m = matchMember(line.student, roster);
    if (!('member' in m)) {
      needsYou.push({ line, reason: m.reason, candidates: m.candidates.map((c) => ({ memberNumber: c.memberNumber, name: c.full })) });
      continue;
    }
    // Never charge twice: same member, date, pro, kind and price on two rows is flagged.
    const key = [m.member.memberNumber, line.date, line.pro, line.kind, line.price].join('|');
    if (seen.has(key)) { needsYou.push({ line, reason: 'Looks like a duplicate of another line (same member, date, pro and price)', candidates: [] }); continue; }
    seen.add(key);
    charges.push({
      memberNumber: m.member.memberNumber, memberName: m.member.full, area: setup.area, itemName,
      description: describe(line), qty: line.qty || 1, price: Math.round(line.price * 100) / 100,
      employeeName: setup.employees[line.pro] || line.pro, taxExempt: setup.taxExempt ? 1 : 0, line,
    });
  }
  return { charges, needsYou };
}

/** Per pro: lessons, hours and what was billed. The pay itself depends on each pro's deal. */
export function proSummary(lines: LessonLine[]): { pro: string; lessons: number; hours: number; billed: number }[] {
  const by = new Map<string, { pro: string; lessons: number; minutes: number; billed: number }>();
  for (const l of lines) {
    const k = l.pro || 'Unknown';
    const r = by.get(k) ?? { pro: k, lessons: 0, minutes: 0, billed: 0 };
    r.lessons += 1; r.minutes += l.minutes || 0; r.billed += l.price || 0;
    by.set(k, r);
  }
  return [...by.values()].map((r) => ({ pro: r.pro, lessons: r.lessons, hours: Math.round((r.minutes / 60) * 100) / 100, billed: Math.round(r.billed * 100) / 100 })).sort((a, b) => a.pro.localeCompare(b.pro));
}
