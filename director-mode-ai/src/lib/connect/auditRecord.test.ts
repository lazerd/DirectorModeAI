import { describe, expect, it } from 'vitest';
import { auditFilename, auditRecord, auditRecordText, type AuditInput } from './auditRecord';

const input: AuditInput = {
  generated_at: '2026-12-01T00:00:00.000Z',
  club: { name: 'Congressional CC', owner_email: 'gm@ccclub.org' },
  opening: { id: 'open-1', title: 'Director of Racquets', dept: 'Tennis/Racquets', city: 'Bethesda', state: 'MD' },
  terms: { version: '2026-10-22', accepted_at: '2026-10-23T10:00:00Z', accepted_by: 'gm@ccclub.org' },
  application: {
    id: '1a2b3c4d-0000-0000-0000-000000000000', source: 'ai_invite', consent_at: '2026-10-20T09:00:00Z',
    introduced_at: '2026-10-23T10:00:01Z', invited_at: null, created_at: '2026-10-23T10:00:01Z',
    hired_at: '2026-11-20T15:00:00Z', start_date: '2027-01-04', stage: 'hired',
  },
  candidate: { name: 'Sam Rivera' },
  events: [
    { at: '2026-11-20T15:00:00Z', from_stage: 'offer', to_stage: 'hired', actor_role: 'club', actor: 'gm@ccclub.org', note: null },
    { at: '2026-10-23T10:00:01Z', from_stage: null, to_stage: 'applied', actor_role: 'club', actor: 'gm@ccclub.org', note: 'introduced on claim' },
  ],
  placement: { id: 'pl-1', fee_cents: 495000, status: 'pending_start', guarantee_until: '2027-04-04', start_date: '2027-01-04', terms_version: '2026-10-22', invoice_ref: null },
};

describe('auditRecord', () => {
  it('sorts events chronologically and states the fee', () => {
    const r = auditRecord(input);
    expect(r.events.map((e) => e.to_stage)).toEqual(['applied', 'hired']);
    expect(r.fee_usd).toBe(4950);
  });
  it('renders every required field as text', () => {
    const t = auditRecordText(input);
    for (const s of ['Congressional CC', 'Director of Racquets', '2026-10-22', '2026-10-23T10:00:00Z', 'gm@ccclub.org',
      '2026-10-20T09:00:00Z', '2026-10-23T10:00:01Z', '(none) -> applied', 'offer -> hired', '2026-11-20T15:00:00Z',
      '2027-01-04', '$4,950.00', '2027-04-04']) expect(t).toContain(s);
    expect(t.indexOf('-> applied')).toBeLessThan(t.indexOf('-> hired'));
  });
  it('says so when no fee applies', () => {
    expect(auditRecordText({ ...input, placement: null })).toContain('No placement fee recorded');
  });
  it('makes a safe filename', () => {
    expect(auditFilename('Congressional C.C. / "Main"', input.application.id, 'txt')).toBe('placement-congressional-c-c-main-1a2b3c4d.txt');
    expect(auditFilename(null, input.application.id, 'json')).toBe('placement-club-1a2b3c4d.json');
  });
});
