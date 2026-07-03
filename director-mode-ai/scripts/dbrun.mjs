import pg from 'pg';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')]));
const u = new URL(env.DATABASE_URL);
const client = new pg.Client({ host:u.hostname, port:u.port||5432, user:decodeURIComponent(u.username), password:decodeURIComponent(u.password), database:u.pathname.slice(1)||'postgres', ssl:{rejectUnauthorized:false} });
await client.connect();
const arg = process.argv[2];
try {
  if (arg && arg.endsWith('.sql')) { const sql = readFileSync(arg,'utf8'); const r = await client.query(sql); console.log('OK ran', arg); }
  else if (arg) { const r = await client.query(arg); console.table(r.rows); }
} catch (e) { console.error('SQL ERROR:', e.message); process.exitCode = 1; }
await client.end();
