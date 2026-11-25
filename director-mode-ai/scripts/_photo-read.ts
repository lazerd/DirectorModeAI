import { readFileSync } from 'fs';
for (const l of readFileSync('.env.local', 'utf8').split('\n')) { const i = l.indexOf('='); if (i < 1) continue; process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, ''); }
(async () => { const { readPhoto } = await import('../src/lib/textstaff/photos');
  const f = process.argv[2]; const mime = /png$/i.test(f) ? 'image/png' : 'image/jpeg';
  console.log(JSON.stringify(await readPhoto({ mime, b64: readFileSync(f).toString('base64') }, '2026-11-25'))); })();
