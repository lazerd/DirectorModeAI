// Full chain: a text to the staff -> Ask Claude -> ClubSpot pack -> bridge worker on this PC -> reply.
// Telegram channel with no token: replies are logged, nothing is sent. Cleans up after itself.
import { readFileSync } from 'fs';
for (const l of readFileSync('.env.local', 'utf8').split('\n')) { const i = l.indexOf('='); if (i < 1) continue; process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, ''); }
delete process.env.TELEGRAM_BOT_TOKEN;
const USER = '7ff5078a-ee6d-46b7-9af7-20b35f62729d', CLUB = 'c437bf37-1ea2-4dc1-9250-11402f377726', CHAT = 'e2e-cs-' + Date.now();
(async () => {
  const { getSupabaseAdmin } = await import('../src/lib/supabase/admin');
  const { handleInbound } = await import('../src/lib/textstaff/inbound');
  const db = getSupabaseAdmin();
  const { data: prior } = await db.from('text_lines').select('id').eq('user_id', USER).eq('channel', 'telegram').maybeSingle();
  if (prior) { console.log('has a telegram line; skipping'); return; }
  const { data: line } = await db.from('text_lines').insert({ user_id: USER, club_id: CLUB, channel: 'telegram', status: 'active', address: CHAT, verified_at: new Date().toISOString() }).select('id').single();
  try {
    for (const q of [process.argv[2] || "What's on the courts this Friday?"]) {
      console.log('>', q);
      await handleInbound({ channel: 'telegram', address: CHAT, body: q, providerId: CHAT + Math.random() });
      const { data } = await db.from('text_messages').select('body').eq('address', CHAT).eq('direction', 'out').order('id');
      for (const m of data ?? []) console.log('  <', m.body);
    }
  } finally {
    await db.from('text_messages').delete().eq('address', CHAT);
    await db.from('text_lines').delete().eq('id', line!.id);
  }
})();
