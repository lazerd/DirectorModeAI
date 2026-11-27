// Darrin's 11/27 text, through the real engine (preview only: no YES is sent).
import { readFileSync } from 'fs';
for (const l of readFileSync('.env.local', 'utf8').split('\n')) { const i = l.indexOf('='); if (i < 1) continue; process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, ''); }
const USER = '7ff5078a-ee6d-46b7-9af7-20b35f62729d', CLUB = 'c437bf37-1ea2-4dc1-9250-11402f377726';
(async () => {
  const { runChat } = await import('../src/lib/assistant/runChat');
  const { withActiveClub } = await import('../src/lib/clubs/activeClub');
  const msg = process.argv[2] || "Can you please send an email to the participants of this morning's Black Friday adult camp to confirm that it is on and that I will see them at 9:30 AM.";
  const r = await withActiveClub(CLUB, () => runChat({ user: { id: USER, email: 'darrinjco@gmail.com' }, message: msg, channel: 'text' }));
  console.log(r.ok ? r.text : 'ERROR ' + r.message);
})();
