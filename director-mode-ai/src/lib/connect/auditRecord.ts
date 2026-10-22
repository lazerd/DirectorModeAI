/**
 * The placement audit record: everything that shows a fee was earned under the
 * terms the club accepted. Pure: the API route gathers the rows, this formats them.
 */

export type AuditInput = {
  generated_at: string;
  club: { name: string | null; owner_email: string | null };
  opening: { id: string; title: string | null; dept: string | null; city: string | null; state: string | null };
  terms: { version: string | null; accepted_at: string | null; accepted_by: string | null };
  application: {
    id: string;
    source: string | null;
    consent_at: string | null;
    introduced_at: string | null;
    invited_at: string | null;
    created_at: string | null;
    hired_at: string | null;
    start_date: string | null;
    stage: string | null;
  };
  candidate: { name: string | null };
  events: { at: string; from_stage: string | null; to_stage: string; actor_role: string | null; actor: string | null; note: string | null }[];
  placement: { id: string; fee_cents: number; status: string; guarantee_until: string | null; start_date: string | null; terms_version: string | null; invoice_ref: string | null } | null;
};

export type AuditRecord = AuditInput & { record_version: 1; fee_usd: number | null };

export function auditRecord(i: AuditInput): AuditRecord {
  const events = [...i.events].sort((a, b) => a.at.localeCompare(b.at));
  return { record_version: 1, ...i, events, fee_usd: i.placement ? i.placement.fee_cents / 100 : null };
}

const v = (s: string | number | null | undefined) => (s === null || s === undefined || s === '' ? '(none)' : String(s));
const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function auditRecordText(i: AuditInput): string {
  const r = auditRecord(i);
  const lines: string[] = [];
  const row = (k: string, val: string | number | null | undefined) => lines.push(`${k.padEnd(22)}${v(val)}`);
  lines.push('CLUBMODE RECRUITING — PLACEMENT RECORD', `Generated ${r.generated_at}`, '');
  lines.push('CLUB AND OPENING');
  row('Club', r.club.name);
  row('Club account', r.club.owner_email);
  row('Opening', r.opening.title || r.opening.dept);
  row('Location', [r.opening.city, r.opening.state].filter(Boolean).join(', ') || null);
  row('Opening id', r.opening.id);
  lines.push('', 'PLACEMENT TERMS');
  row('Terms version', r.terms.version);
  row('Accepted at', r.terms.accepted_at);
  row('Accepted by', r.terms.accepted_by);
  lines.push('', 'CANDIDATE AND INTRODUCTION');
  row('Candidate', r.candidate.name);
  row('Application id', r.application.id);
  row('Source', r.application.source);
  row('Invited at', r.application.invited_at);
  row('Candidate consent at', r.application.consent_at);
  row('Introduced at', r.application.introduced_at);
  lines.push('', 'STAGE HISTORY');
  if (!r.events.length) lines.push('  (no stage changes logged; logging began 2026-10-22)');
  for (const e of r.events) {
    const who = [e.actor_role, e.actor].filter(Boolean).join(' ');
    lines.push(`  ${e.at}  ${v(e.from_stage)} -> ${e.to_stage}${who ? `  by ${who}` : ''}${e.note ? `  (${e.note})` : ''}`);
  }
  lines.push('', 'HIRE AND FEE');
  row('Current stage', r.application.stage);
  row('Hired at', r.application.hired_at);
  row('Start date', r.placement?.start_date ?? r.application.start_date);
  if (r.placement) {
    row('Fee', usd(r.placement.fee_cents));
    row('Fee status', r.placement.status);
    row('Fee terms version', r.placement.terms_version);
    row('Guarantee until', r.placement.guarantee_until);
    row('Invoice', r.placement.invoice_ref);
    row('Placement id', r.placement.id);
  } else {
    lines.push('No placement fee recorded for this application.');
  }
  return `${lines.join('\n')}\n`;
}

/** Safe attachment filename, e.g. placement-congressional-cc-1a2b3c4d.txt */
export function auditFilename(club: string | null, applicationId: string, ext: 'txt' | 'json'): string {
  const slug = (club || 'club').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'club';
  return `placement-${slug}-${applicationId.slice(0, 8)}.${ext}`;
}
