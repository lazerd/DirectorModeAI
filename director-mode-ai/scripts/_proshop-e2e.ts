// Pro Shop server e2e (11/25/26): order → proposal → yes, and the staff pack reads it back.
// Writes only proshop_tasks rows tagged run='e2e-test' on the given club, and deletes them at the end.
// Usage: npx tsx scripts/_proshop-e2e.ts <clubId>
import { readFileSync } from 'fs';
for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i < 1) continue;
  process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, '');
}
const clubId = process.argv[2];
const main = async () => {
  const { getSupabaseAdmin } = await import('../src/lib/supabase/admin');
  const { addOrder, taskOut } = await import('../src/lib/proshop/server');
  const { proshopPack } = await import('../src/lib/assistant/packs/proshop');
  const { bindPack } = await import('../src/lib/assistant/framework');
  const db = getSupabaseAdmin();
  const ctx: any = { userId: '00000000-0000-0000-0000-000000000000', db, clubId, clubName: 'test', clubSlug: 'test', timeZone: 'America/Los_Angeles', role: 'owner' };
  const ok = (c: boolean, m: string) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  try {
    // 1. an order lands as waiting, unknown agent falls back to Front Desk
    const t1 = await addOrder(ctx, { agent: 'ledger', text: 'E2E: bill yesterday', run: 'e2e-test' });
    ok(t1.status === 'waiting' && t1.by === 'director' && t1.agent === 'ledger', 'order is waiting, from director, for Ledger');
    const t2 = await addOrder(ctx, { agent: 'nobody', text: 'E2E: route me', run: 'e2e-test' });
    ok(t2.agent === 'frontdesk', 'unknown staff goes to Front Desk');
    // 2. a staff proposal, decided once
    const { data: p } = await db.from('proshop_tasks').insert({ club_id: clubId, agent: 'host', text: 'E2E: bill the social', status: 'proposed', source: 'staff', money: '$1', run: 'e2e-test' }).select('*').single();
    const upd = () => db.from('proshop_tasks').update({ status: 'approved', decided_at: new Date().toISOString() }).eq('id', p.id).eq('club_id', clubId).eq('status', 'proposed').select('*').maybeSingle();
    const first = await upd(); const second = await upd();
    ok(!!first.data && taskOut(first.data).status === 'approved', 'Yes approves a proposal');
    ok(!second.data, 'a second Yes is refused (decided once)');
    // 3. the pack: queue_order + board_status
    const bound = bindPack(proshopPack, ctx);
    const q = await bound.execute('queue_order', { agent: 'courts', order: 'E2E: block court 3' });
    ok(q.ok === true && (q as any).agent === 'courts', 'pack queue_order puts an order on the board');
    await db.from('proshop_tasks').update({ run: 'e2e-test' }).eq('id', (q as any).id);
    const b: any = await bound.execute('board_status', {});
    ok(b.ok && b.open.some((r: any) => r.text === 'E2E: block court 3'), 'board_status sees the open order');
    ok(b.open.some((r: any) => r.text === 'E2E: bill yesterday'), 'board_status sees the director order');
    ok(proshopPack.resolve.length === 2 && (await proshopPack.resolve('x', '/mixer')) === null, 'pack is off outside /proshop');
  } finally {
    const { count } = await db.from('proshop_tasks').delete({ count: 'exact' }).eq('club_id', clubId).eq('run', 'e2e-test');
    console.log('cleaned up', count, 'test rows');
  }
};
main();
