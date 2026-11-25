// Clinic signups e2e (11/25/26): a DRAFT test clinic on the given club, signups, spot limit,
// regulars, signed links, and the reminder + spots-left PREVIEWS (nothing is sent).
// Everything it creates is deleted at the end. Usage: npx tsx scripts/_clinic-e2e.ts <clubId> <ownerUserId>
import { readFileSync } from 'fs';
for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i < 1) continue;
  process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, '');
}
const [clubId, ownerId] = process.argv.slice(2);
const main = async () => {
  const { getSupabaseAdmin } = await import('../src/lib/supabase/admin');
  const L = await import('../src/lib/programs/clinicSignups');
  const { clinicsPack } = await import('../src/lib/assistant/packs/clinics');
  const { bindPack } = await import('../src/lib/assistant/framework');
  const db = getSupabaseAdmin();
  const ok = (c: boolean, m: string) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const tz = 'America/Los_Angeles';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const add = (n: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const date = add(1), past = add(-6);
  const { data: prog, error } = await db.from('club_programs').insert({
    club_id: clubId, title: 'E2E Drills and Thrills', slug: 'e2e-drills-' + Date.now(), status: 'draft',
    range_start: add(-14), range_end: add(30), days_of_week: [0, 1, 2, 3, 4, 5, 6], time_start: '09:00', time_end: '10:30',
    capacity: 3, coach_name: 'CC', registration_mode: 'drop_in', audience: 'adult',
  }).select('id').single();
  if (error) { console.error('insert program failed', error.message); return; }
  const pid = prog.id;
  try {
    const found = await L.loadClinic(db, pid);
    ok(!!found && L.meetsOn(found!.program, date, tz), 'test clinic meets tomorrow');
    const program = found!.program; const club = found!.club;
    // a regular from last week
    await L.rsvp(db, { program, date: past, name: 'Regular Rita', email: 'rita.e2e@example.com', status: 'in', source: 'web' });
    const a = await L.rsvp(db, { program, date, name: 'Ann E2E', email: 'ann.e2e@example.com', status: 'in', source: 'web' });
    const b = await L.rsvp(db, { program, date, name: 'Bob E2E', email: 'BOB.e2e@example.com', status: 'in', source: 'web' });
    ok(a.ok && b.ok && (b as any).spotsLeft === 1, 'two in, 1 spot left of 3');
    const again = await L.rsvp(db, { program, date, name: 'Bob E2E', email: 'bob.e2e@example.com', status: 'in', source: 'email' });
    ok(again.ok && (again as any).spotsLeft === 1, 'same person twice (case-insensitive email) takes one spot');
    const c = await L.rsvp(db, { program, date, name: 'Cat E2E', email: 'cat.e2e@example.com', status: 'in', source: 'web' });
    const d = await L.rsvp(db, { program, date, name: 'Dan E2E', email: 'dan.e2e@example.com', status: 'in', source: 'web' });
    ok(c.ok && !d.ok && (d as any).reason === 'full', 'fourth person is refused: full');
    await L.rsvp(db, { program, date, name: 'Cat E2E', email: 'cat.e2e@example.com', status: 'out', source: 'web' });
    const regs = await L.regularsFor(db, program, date);
    ok(regs.length === 1 && regs[0].email === 'rita.e2e@example.com', 'regulars = Rita only (answered people excluded)');
    const tok = L.signClinicToken({ p: pid, d: date, e: 'rita.e2e@example.com', n: 'Rita' });
    ok(!!L.verifyClinicToken(tok) && !L.verifyClinicToken(tok.slice(0, -2) + 'xx'), 'signed link verifies, tampered link fails');
    const rem = await L.sendClinic(db, { program, club, date, kind: 'reminder', mode: 'preview', ownerId, replyTo: 'test@example.com', senderName: 'Test' });
    ok(rem.mode === 'preview' && rem.count === 2 && /See you/.test(rem.subject || ''), `reminder preview: 2 signed up, subject "${(rem as any).subject}"`);
    const sl = await L.sendClinic(db, { program, club, date, kind: 'spots_left', mode: 'preview', ownerId, replyTo: 'test@example.com', senderName: 'Test' });
    ok(sl.mode === 'preview' && sl.count === 1 && /1 spot left/.test(sl.subject || ''), `spots-left preview: 1 regular, subject "${(sl as any).subject}"`);
    ok(!(await L.alreadySent(db, pid, date, 'reminder')), 'previews are not logged as sends');
    // the pack, through the preview gate
    const ctx: any = { userId: ownerId, db, clubId, clubName: club.name, clubSlug: club.slug, timeZone: tz, role: 'owner' };
    const bound = bindPack(clinicsPack, ctx);
    const info: any = await bound.execute('clinic_signups', { clinic: pid, date });
    ok(info.ok && info.in.length === 2 && info.out.length === 1 && info.spotsLeft === 1 && info.regularsNotAnswered === 1, 'pack clinic_signups reads it right');
    const pv: any = await bound.execute('send_clinic_spots_left', { clinic: pid, date });
    ok(pv.ok && pv.needsConfirm && pv.recipients === 1, 'pack send_clinic_spots_left stops at preview without confirm');
  } finally {
    await db.from('club_program_meeting_signups').delete().eq('program_id', pid);
    await db.from('club_program_meeting_sends').delete().eq('program_id', pid);
    await db.from('club_programs').delete().eq('id', pid);
    console.log('cleaned up test clinic');
  }
};
main();
