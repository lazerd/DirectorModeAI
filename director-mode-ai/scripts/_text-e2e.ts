// Text staff e2e on the real DB, Telegram channel with NO bot token: every outgoing
// message is logged to text_messages but nothing leaves the machine. Uses a fake chat id,
// a test proposal (no money) on Sleepy Hollow, and cleans up after itself.
// Usage: npx tsx scripts/_text-e2e.ts
import { readFileSync } from 'fs';
for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i < 1) continue;
  process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, '');
}
delete process.env.TELEGRAM_BOT_TOKEN;
const USER = '7ff5078a-ee6d-46b7-9af7-20b35f62729d';
const CLUB = 'c437bf37-1ea2-4dc1-9250-11402f377726';
const CHAT = 'e2e-' + Date.now();

const main = async () => {
  const { getSupabaseAdmin } = await import('../src/lib/supabase/admin');
  const { handleInbound, tick } = await import('../src/lib/textstaff/inbound');
  const db = getSupabaseAdmin();
  const ok = (c: boolean, m: string) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  let seen = 0;
  const outs = async () => {
    const { data } = await db.from('text_messages').select('id, body, kind, direction').eq('address', CHAT).eq('direction', 'out').order('id');
    const all = (data as { id: number; body: string; kind: string }[]) ?? [];
    const fresh = all.slice(seen); seen = all.length;
    for (const m of fresh) console.log(`   [${m.kind}] ${m.body.replace(/\n/g, '\n           ')}`);
    return fresh;
  };
  const send = async (body: string, id?: string) => { console.log(`> ${body}`); await handleInbound({ channel: 'telegram', address: CHAT, body, providerId: id ?? `${CHAT}-${Math.random()}` }); return outs(); };

  // Keep any real Telegram line of Darrin's out of the way: this test uses its own row.
  const { data: prior } = await db.from('text_lines').select('id').eq('user_id', USER).eq('channel', 'telegram').maybeSingle();
  if (prior) { console.log('Darrin already has a Telegram line; not touching it. Skipping.'); return; }
  const { data: line } = await db.from('text_lines').insert({
    user_id: USER, club_id: CLUB, channel: 'telegram', status: 'pending', link_code: 'e2eTEST123',
    link_expires_at: new Date(Date.now() + 600_000).toISOString(),
  }).select('id').single();
  const { data: task } = await db.from('proshop_tasks').insert({
    club_id: CLUB, agent: 'frontdesk', text: 'E2E TEST: draft a welcome note for new members', status: 'proposed', source: 'staff', detail: 'Test row, safe to delete.',
  }).select('id').single();

  try {
    let r = await send('hello');
    ok(r.some((m) => /connect your phone/i.test(m.body)), 'unknown chat is told how to connect');
    r = await send('/start wrongcode');
    ok(r.some((m) => /didn't work/i.test(m.body)), 'a bad code is refused');
    r = await send('/start e2eTEST123', 'dup-1');
    ok(r.some((m) => /^Connected/.test(m.body)) && r.some((m) => m.kind === 'huddle'), 'good code connects and sends the huddle');
    r = await send('/start e2eTEST123', 'dup-1');
    ok(r.length === 0, 'a retried webhook (same update id) does nothing');
    const huddle = (await db.from('text_lines').select('menu').eq('id', line!.id).single()).data!.menu as any[];
    const item = huddle.find((m) => m.kind === 'task' && m.ref.id === task!.id);
    ok(!!item, 'the test proposal is a numbered huddle item');
    r = await send(String(item?.n ?? 1));
    ok(r.some((m) => /welcome note/.test(m.body) && /Reply YES/.test(m.body)), 'a number opens the item with YES/SKIP');
    r = await send('skip');
    const st = (await db.from('proshop_tasks').select('status').eq('id', task!.id).single()).data!.status;
    ok(st === 'declined' && r.some((m) => /Skipped/.test(m.body)), 'SKIP declines it');
    r = await send(String(item?.n ?? 1));
    ok(r.some((m) => /already decided/.test(m.body)), 'reopening a decided item says so');
    r = await send('help');
    ok(r.some((m) => /staff line/.test(m.body)), 'HELP answers');
    r = await send('What can you do for me by text? One line.');
    ok(r.length === 1 && r[0].body.length > 0 && r[0].body.length < 700, 'free text gets a short staff answer');
    r = await send('stop');
    const s2 = (await db.from('text_lines').select('status').eq('id', line!.id).single()).data!.status;
    ok(s2 === 'stopped', 'STOP stops the line');
    r = await send('what needs me?');
    ok(r.length === 0, 'a stopped line gets nothing back');
    r = await send('start');
    ok(r.some((m) => /back on/.test(m.body)), 'START turns it back on');
    // The scheduled huddle: pretend it is 7:30am Pacific today.
    await db.from('text_lines').update({ last_morning: null, last_evening: null }).eq('id', line!.id);
    const pac = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
    const at730 = new Date(`${pac}T15:30:00Z`); // 7:30am PST
    const t = await tick(at730);
    r = await outs();
    ok(t.morning >= 1 && r.some((m) => m.kind === 'huddle'), 'the 7am tick sends the huddle');
    const t2 = await tick(at730);
    ok(t2.morning === 0, 'and only once a day');
  } finally {
    await db.from('proshop_tasks').delete().eq('id', task!.id);
    await db.from('text_messages').delete().eq('address', CHAT);
    await db.from('text_lines').delete().eq('id', line!.id);
    console.log('cleaned up');
  }
};
main();
