/**
 * checkin-check.mjs — exercise the public QR check-in APIs end to end.
 *
 *   npm run dev -- -p 3471            (in another terminal)
 *   node scripts/checkin-check.mjs --base http://localhost:3471 [--keep]
 *
 * Builds a throwaway club (two courts, a kiosk sign, a pool gate), walks the
 * court register through every rule that matters, and deletes the club at the
 * end. --keep leaves it in place and prints its URLs (for screenshots); run
 * again with --cleanup <slug> to remove it.
 *
 * Time cannot be fast-forwarded through HTTP, so "the limit expires" is done by
 * backdating the session row — the same instant the clock would have reached —
 * and then letting the next API read reconcile it, exactly as a phone poll would.
 * No emails are sent: no group gives an address.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const BASE = arg('--base', 'http://localhost:3471');
const KEEP = process.argv.includes('--keep');
const MIN = 60_000;

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : '');
  }
}

const token = () => Array.from(randomBytes(10), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');

async function call(path, { method = 'GET', body, device = 'check-device-0' } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-checkin-device': device },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function cleanup(clubId) {
  await db.from('reservations').delete().eq('club_id', clubId);
  await db.from('checkin_waits').delete().eq('club_id', clubId);
  await db.from('checkin_sessions').delete().eq('club_id', clubId);
  await db.from('checkin_spaces').delete().eq('club_id', clubId);
  await db.from('courts').delete().eq('club_id', clubId);
  await db.from('cc_clubs').delete().eq('id', clubId);
}

async function main() {
  const cleanupSlug = arg('--cleanup', null);
  if (cleanupSlug) {
    const { data } = await db.from('cc_clubs').select('id').eq('slug', cleanupSlug).maybeSingle();
    if (data) await cleanup(data.id);
    console.log(data ? `Removed ${cleanupSlug}` : `No club ${cleanupSlug}`);
    return;
  }

  // An owner is required (cc_clubs.owner_id, reservations.created_by). Borrow
  // the Rossmoor prospect's owner rather than hardcoding an account.
  const { data: ross } = await db.from('cc_clubs').select('owner_id').eq('slug', 'rossmoor-tennis-club').maybeSingle();
  if (!ross) throw new Error('rossmoor-tennis-club not found (need an owner id to borrow)');

  const slug = `checkin-check-${Date.now().toString(36)}`;
  const { data: club, error: clubErr } = await db
    .from('cc_clubs')
    .insert({ owner_id: ross.owner_id, name: 'Check-In Test Club', slug, is_public: true, timezone: 'America/Los_Angeles', operating_hours: {} })
    .select('id')
    .single();
  if (clubErr) throw clubErr;
  const clubId = club.id;
  console.log(`Temp club ${slug} (${clubId})\n`);

  try {
    const { data: courts, error: courtErr } = await db
      .from('courts')
      .insert([
        { club_id: clubId, number: 1, name: 'Court 1', display_order: 1, status: 'active', sports: ['tennis'] },
        { club_id: clubId, number: 2, name: 'Court 2', display_order: 2, status: 'active', sports: ['tennis'] },
      ])
      .select('id, number');
    if (courtErr) throw courtErr;
    const court1 = courts.find((c) => c.number === 1).id;
    const court2 = courts.find((c) => c.number === 2).id;

    await db.from('checkin_settings').insert({ club_id: clubId, min_players: 2, singles_minutes: 60, doubles_minutes: 90, grace_minutes: 5, claim_minutes: 10 });
    const T = { c1: token(), c2: token(), kiosk: token(), pool: token() };
    // One insert per row: a multi-row insert with differing keys sends NULL for
    // the missing columns, which the NOT NULL defaults reject.
    for (const row of [
      { club_id: clubId, kind: 'court', court_id: court1, name: 'Court 1', token: T.c1, display_order: 1 },
      { club_id: clubId, kind: 'court', court_id: court2, name: 'Court 2', token: T.c2, display_order: 2 },
      { club_id: clubId, kind: 'kiosk', name: 'Wait list', token: T.kiosk, display_order: 0 },
      { club_id: clubId, kind: 'pool', name: 'Pool', token: T.pool, capacity: 5, track_guests: true, display_order: 10 },
    ]) {
      const { error: spaceErr } = await db.from('checkin_spaces').insert(row);
      if (spaceErr) throw spaceErr;
    }

    console.log('1. Check in on a free court');
    let r = await call(`/api/checkin/q/${T.c1}`);
    check('scan shows Court 1 free', r.status === 200 && r.data.court?.state === 'free', r.data);
    r = await call(`/api/checkin/q/${T.c1}`, { method: 'POST', device: 'dev-group-1', body: { action: 'start', play_type: 'doubles', names: ['Solo Player'] } });
    check('one player is refused (club needs 2)', r.status === 400 || (r.status === 409 && r.data.code === 'min_players'), r);
    r = await call(`/api/checkin/q/${T.c1}`, { method: 'POST', device: 'dev-group-1', body: { action: 'start', play_type: 'doubles', names: ['Mary Benin', 'Bert Sebilia', 'Bart Ostro', 'Lori Davis'] } });
    check('doubles group starts on Court 1', r.status === 200 && !!r.data.group_token, r);
    const g1 = r.data.group_token;
    r = await call(`/api/checkin/g/${g1}`, { device: 'dev-group-1' });
    check('timer page: active, no one waiting so no limit in force', r.data.kind === 'session' && r.data.session.status === 'active' && r.data.session.limitActive === false, r.data);
    const limitMinutes = (Date.parse(r.data.session.limitEndsAt) - Date.parse(r.data.session.startedAt)) / MIN;
    check('doubles limit is 90 minutes', Math.round(limitMinutes) === 90, limitMinutes);

    r = await call(`/api/checkin/q/${T.c2}`, { method: 'POST', device: 'dev-group-1', body: { action: 'start', play_type: 'singles', names: ['A B', 'C D'] } });
    check('same phone cannot hold a second court', r.status === 409 && r.data.code === 'device_busy', r);

    console.log('\n2. Second court, then a group joins the wait list');
    r = await call(`/api/checkin/q/${T.c2}`, { method: 'POST', device: 'dev-group-2', body: { action: 'start', play_type: 'singles', names: ['Richard Schulman', 'Roger Emanuel'] } });
    check('singles group starts on Court 2', r.status === 200, r);
    const g2 = r.data.group_token;

    r = await call(`/api/checkin/q/${T.c1}`, { method: 'POST', device: 'dev-walkup', body: { action: 'start', play_type: 'doubles', names: ['Walk Up', 'Walk Two'] } });
    check('walk-up on an occupied court is refused', r.status === 409 && r.data.code === 'occupied', r);

    r = await call(`/api/checkin/q/${T.kiosk}`, { method: 'POST', device: 'dev-group-3', body: { action: 'wait', play_type: 'doubles', names: ['Shrey Trivedi', 'David Hickey'] } });
    check('group joins the wait list from the kiosk sign', r.status === 200, r);
    const g3 = r.data.group_token;
    r = await call(`/api/checkin/g/${g3}`, { device: 'dev-group-3' });
    check('wait page: position 1', r.data.kind === 'wait' && r.data.wait.status === 'waiting' && r.data.wait.position === 1, r.data);
    r = await call(`/api/checkin/g/${g1}`, { device: 'dev-group-1' });
    check('playing group now sees 1 group waiting and its limit in force', r.data.queueLength === 1 && r.data.session.limitActive === true, r.data);

    console.log('\n3. The limit expires -> the court is offered to the waiting group');
    const now = Date.now();
    await db
      .from('checkin_sessions')
      .update({ started_at: new Date(now - 91 * MIN).toISOString(), limit_ends_at: new Date(now - 1 * MIN).toISOString() })
      .eq('group_token', g1);
    r = await call(`/api/checkin/g/${g3}`, { device: 'dev-group-3' });
    check('waiting group is offered Court 1', r.data.kind === 'wait' && r.data.wait.status === 'offered' && r.data.wait.offeredSpace === 'Court 1', r.data);
    r = await call(`/api/checkin/g/${g1}`, { device: 'dev-group-1' });
    check('over-limit group is told a waiting group has the court (still in grace)', r.data.session.status === 'active' && r.data.session.heldFor === true, r.data);
    r = await call(`/api/checkin/q/${T.c1}`, { method: 'POST', device: 'dev-walkup', body: { action: 'start', play_type: 'doubles', names: ['Walk Up', 'Walk Two'] } });
    check('walk-up cannot take a court held for the wait list', r.status === 409 && r.data.code === 'held', r);
    r = await call('/api/checkin/board/' + slug);
    check('board shows Court 1 as time up, held for the group', r.status === 200 && r.data.courts.find((c) => c.name === 'Court 1')?.state === 'overtime', r.data);
    check('board shows first name + last initial only', JSON.stringify(r.data).includes('Mary B.') && !JSON.stringify(r.data).includes('Benin'), r.data.courts);

    await db.from('checkin_sessions').update({ limit_ends_at: new Date(now - 6 * MIN).toISOString() }).eq('group_token', g1);
    r = await call(`/api/checkin/g/${g1}`, { device: 'dev-group-1' });
    check('past limit + grace, the session ends on its own', r.data.session.status === 'ended' && r.data.session.endReason === 'limit', r.data.session);
    r = await call(`/api/checkin/g/${g3}`, { method: 'POST', device: 'dev-group-3', body: { action: 'claim' } });
    check('waiting group claims Court 1', r.status === 200, r);
    r = await call(`/api/checkin/g/${g3}`, { device: 'dev-group-3' });
    check('their page is now a running timer on Court 1', r.data.kind === 'session' && r.data.session.spaceName === 'Court 1' && r.data.session.status === 'active', r.data);

    console.log('\n4. "We\'re done" frees a court early');
    r = await call(`/api/checkin/g/${g2}`, { method: 'POST', device: 'dev-group-2', body: { action: 'done' } });
    check('Court 2 group presses done', r.status === 200, r);
    r = await call(`/api/checkin/q/${T.c2}`);
    check('Court 2 is free again', r.data.court?.state === 'free', r.data.court);
    r = await call(`/api/checkin/g/${g2}`);
    check('their page says ended (done)', r.data.session.status === 'ended' && r.data.session.endReason === 'done', r.data.session);

    console.log('\n4b. Optional CourtSheet mirror');
    await db.from('checkin_settings').update({ mirror_to_courtsheet: true }).eq('club_id', clubId);
    r = await call(`/api/checkin/q/${T.c2}`, { method: 'POST', device: 'dev-mirror', body: { action: 'start', play_type: 'singles', names: ['Mirror One', 'Mirror Two'] } });
    const gm = r.data.group_token;
    const { data: mirrored } = await db.from('checkin_sessions').select('reservation_id').eq('group_token', gm).single();
    const { data: resv } = mirrored?.reservation_id ? await db.from('reservations').select('status, type, source, meta').eq('id', mirrored.reservation_id).single() : { data: null };
    check('session wrote a reservation tagged origin=checkin', resv?.status === 'confirmed' && resv?.meta?.origin === 'checkin', resv);
    r = await call(`/api/checkin/q/${T.c2}`);
    check('the mirror does not count as a booking (court shows in play, not booked)', r.data.court?.state === 'playing', r.data.court);
    await call(`/api/checkin/g/${gm}`, { method: 'POST', device: 'dev-mirror', body: { action: 'done' } });
    const { data: resvAfter } = await db.from('reservations').select('status').eq('id', mirrored.reservation_id).single();
    check('a mis-scan ended within 2 minutes cancels its mirror', resvAfter?.status === 'cancelled', resvAfter);
    await db.from('checkin_settings').update({ mirror_to_courtsheet: false }).eq('club_id', clubId);

    console.log('\n5. A booking blocks walk-on play');
    await db.from('reservations').insert({
      club_id: clubId, court_id: court2, starts_at: new Date(Date.now() - 10 * MIN).toISOString(), ends_at: new Date(Date.now() + 50 * MIN).toISOString(),
      type: 'lesson', source: 'manual', title: 'Private lesson — a child', status: 'confirmed', created_by: ross.owner_id,
    });
    r = await call(`/api/checkin/q/${T.c2}`);
    check('Court 2 shows booked for a lesson, without the booking title', r.data.court?.state === 'blocked' && r.data.court.blockLabel === 'a lesson' && !JSON.stringify(r.data).includes('child'), r.data.court);
    r = await call(`/api/checkin/q/${T.c2}`, { method: 'POST', device: 'dev-walkup', body: { action: 'start', play_type: 'singles', names: ['Walk Up', 'Walk Two'] } });
    check('starting on a booked court is refused', r.status === 409 && r.data.code === 'blocked', r);

    console.log('\n6. Invalid and rotated tokens are rejected');
    r = await call('/api/checkin/q/zzzzzzzzzz');
    check('unknown token -> 404', r.status === 404, r);
    r = await call('/api/checkin/q/not-a-token');
    check('malformed token -> 404', r.status === 404, r);
    const oldC2 = T.c2;
    await db.from('checkin_spaces').update({ token: token(), token_rotated_at: new Date().toISOString() }).eq('token', oldC2);
    r = await call(`/api/checkin/q/${oldC2}`);
    check('rotated (reprinted) sign -> 404 on read', r.status === 404, r);
    r = await call(`/api/checkin/q/${oldC2}`, { method: 'POST', device: 'dev-walkup', body: { action: 'start', play_type: 'singles', names: ['A B', 'C D'] } });
    check('rotated sign -> 404 on write', r.status === 404, r);
    r = await call('/api/checkin/g/0123456789abcdef0123456789abcdef0123');
    check('unknown group token -> 404', r.status === 404, r);

    console.log('\n7. Pool headcount');
    r = await call(`/api/checkin/q/${T.pool}`, { method: 'POST', device: 'dev-pool-1', body: { names: ['Pat Swimmer'], guests: 3, guest_names: ['Guest One', 'Guest Two', 'Guest Three'] } });
    check('member + 3 guests check in', r.status === 200, r);
    const gp = r.data.group_token;
    r = await call(`/api/checkin/q/${T.pool}`);
    check('headcount is 4 of 5', r.data.pool?.headcount === 4 && r.data.pool?.capacity === 5, r.data.pool);
    r = await call(`/api/checkin/q/${T.pool}`, { method: 'POST', device: 'dev-pool-2', body: { names: ['Sam Swimmer'], guests: 1 } });
    check('member + 1 guest refused at capacity', r.status === 409 && r.data.code === 'full', r);
    r = await call(`/api/checkin/q/${T.pool}`, { method: 'POST', device: 'dev-pool-2', body: { names: ['Sam Swimmer'] } });
    check('member alone fits (5 of 5)', r.status === 200, r);
    r = await call(`/api/checkin/board/${slug}`);
    check('board shows pool 5 / 5', r.data.pools?.[0]?.headcount === 5, r.data.pools);
    r = await call(`/api/checkin/g/${gp}`, { method: 'POST', device: 'dev-pool-1', body: { action: 'done' } });
    r = await call(`/api/checkin/q/${T.pool}`);
    check('check-out drops the headcount to 1', r.data.pool?.headcount === 1, r.data.pool);

    if (KEEP) {
      console.log(`\nKept for screenshots:\n  scan court 1   ${BASE}/q/${T.c1}\n  scan court 2   ${BASE}/q/${(await db.from('checkin_spaces').select('token').eq('court_id', court2).single()).data.token}\n  kiosk          ${BASE}/q/${T.kiosk}\n  pool           ${BASE}/q/${T.pool}\n  timer (g3)     ${BASE}/q/s/${g3}\n  board          ${BASE}/checkin/${slug}/board\n  cleanup        node scripts/checkin-check.mjs --cleanup ${slug}`);
    }
  } finally {
    if (!KEEP) {
      await cleanup(clubId);
      const { data: left } = await db.from('cc_clubs').select('id').eq('id', clubId).maybeSingle();
      console.log(left ? '\nCleanup FAILED — club still exists' : '\nCleaned up the temp club.');
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
