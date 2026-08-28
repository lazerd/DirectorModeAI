/**
 * One-shot codemod: collapse every copy-pasted
 *   process.env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai'
 * into a single `APP_URL` import from '@/lib/appUrl'.
 *
 * Run once for the clubmode.ai migration and kept in scripts/ as the record of
 * what was rewritten. Safe to re-run: it is a no-op on already-migrated files.
 *
 *   node scripts/codemod-app-url.mjs          # report only
 *   node scripts/codemod-app-url.mjs --write  # apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'src');
const WRITE = process.argv.includes('--write');

/** Every shape the old fallback was written in, longest first. */
const PATTERNS = [
  // (process.env.NEXT_PUBLIC_APP_URL || '...').replace(/\/$/, '')
  /\(\s*process\.env\.NEXT_PUBLIC_APP_URL\s*(?:\|\||\?\?)\s*['"]https:\/\/club\.coachmode\.ai['"]\s*\)\s*\.replace\(\s*\/\\\/\$\/\s*,\s*['"]{2}\s*\)/g,
  // process.env.NEXT_PUBLIC_APP_URL || '...'   /   ?? '...'
  /process\.env\.NEXT_PUBLIC_APP_URL\s*(?:\|\||\?\?)\s*['"]https:\/\/club\.coachmode\.ai['"]/g,
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

/** Insert `import { APP_URL } from '@/lib/appUrl';` after the last existing import. */
function ensureImport(src) {
  if (/from ['"]@\/lib\/appUrl['"]/.test(src)) {
    // Already imports something from the module — make sure APP_URL is in the list.
    return src.replace(
      /import\s*\{([^}]*)\}\s*from\s*(['"])@\/lib\/appUrl\2/,
      (m, names, q) =>
        names.split(',').map((n) => n.trim()).includes('APP_URL')
          ? m
          : `import { APP_URL,${names} } from ${q}@/lib/appUrl${q}`,
    );
  }
  const imports = [...src.matchAll(/^import\s.*?;\s*$/gms)];
  const line = `import { APP_URL } from '@/lib/appUrl';`;
  if (imports.length === 0) {
    // Files that open with 'use client' / 'use server' keep the directive first.
    const directive = src.match(/^\s*(['"])use (client|server)\1;\s*\n/);
    return directive
      ? src.slice(0, directive[0].length) + `\n${line}\n` + src.slice(directive[0].length)
      : `${line}\n${src}`;
  }
  const last = imports[imports.length - 1];
  const at = last.index + last[0].length;
  return src.slice(0, at) + `\n${line}` + src.slice(at);
}

let changed = 0;
const report = [];

for (const file of walk(SRC)) {
  // The constant's own home, and the middleware that imports it explicitly.
  if (/lib[\\/]appUrl\.ts$/.test(file)) continue;

  const original = readFileSync(file, 'utf8');
  let src = original;
  let hits = 0;
  for (const re of PATTERNS) {
    src = src.replace(re, () => { hits++; return 'APP_URL'; });
  }
  if (!hits) continue;

  src = ensureImport(src);
  report.push(`${relative(ROOT, file)}  (${hits})`);
  changed++;
  if (WRITE) writeFileSync(file, src, 'utf8');
}

console.log(report.join('\n'));
console.log(`\n${changed} files ${WRITE ? 'rewritten' : 'would change'}`);
