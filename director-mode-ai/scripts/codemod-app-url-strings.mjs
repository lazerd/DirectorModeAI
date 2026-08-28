/**
 * Second pass of the clubmode.ai migration: the literal host strings the first
 * codemod deliberately left alone because each one needed a judgement call about
 * whether it becomes APP_URL (a real link), APP_HOST (display text), or stays put.
 *
 * Rules are explicit and per-file so this is reviewable rather than a blind
 * find/replace across the tree. Safe to re-run.
 *
 *   node scripts/codemod-app-url-strings.mjs          # report only
 *   node scripts/codemod-app-url-strings.mjs --write  # apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const WRITE = process.argv.includes('--write');

/** [file, [[find, replace], ...], importsNeeded] */
const RULES = [
  // ---- Transactional email HTML: these are live links sent to real inboxes ----
  ['src/app/api/lessons/booking-notify/route.ts', [
    [/href="https:\/\/club\.coachmode\.ai\//g, 'href="${APP_URL}/'],
  ], ['APP_URL']],
  ['src/app/api/lessons/client-request-notify/route.ts', [
    [/href="https:\/\/club\.coachmode\.ai\//g, 'href="${APP_URL}/'],
  ], ['APP_URL']],
  ['src/app/api/lessons/send-reminders/route.ts', [
    [/href="https:\/\/club\.coachmode\.ai\//g, 'href="${APP_URL}/'],
  ], ['APP_URL']],
  ['src/app/api/lessons/cancel-notify/route.ts', [
    [/'https:\/\/club\.coachmode\.ai(\/[a-z/-]+)'/g, '`${APP_URL}$1`'],
  ], ['APP_URL']],

  // ---- Summer Flex League: the one-tap score-entry links ----
  ['src/lib/flexLeague.ts', [
    [/export const FLEX_URL = 'https:\/\/club\.coachmode\.ai\/flex';/,
      "export const FLEX_URL = `${APP_URL}/flex`;"],
    [/>club\.coachmode\.ai\/flex</g, '>${APP_HOST}/flex<'],
  ], ['APP_URL', 'APP_HOST']],
  ['src/lib/flexPlayoffEmail.ts', [
    [/>club\.coachmode\.ai\/flex</g, '>${APP_HOST}/flex<'],
  ], ['APP_HOST']],

  // ---- Links/text a user copies out of the UI ----
  ['src/app/courtconnect/club/page.tsx', [
    [/`https:\/\/club\.coachmode\.ai\/club\/\$\{form\.slug\}`/, '`${APP_URL}/club/${form.slug}`'],
    [/club\.coachmode\.ai\/club\/\{form\.slug\}/, '{APP_HOST}/club/{form.slug}'],
    [/>club\.coachmode\.ai\/club\/</, '>{APP_HOST}/club/<'],
  ], ['APP_URL', 'APP_HOST']],
  ['src/app/courtconnect/vault/page.tsx', [
    [/typeof window !== 'undefined' \? window\.location\.origin : 'https:\/\/club\.coachmode\.ai'/,
      'originOr()'],
  ], ['originOr']],

  // ---- Display-only strings ----
  ['src/app/lessons/dashboard/page.tsx', [
    [/club\.coachmode\.ai\/coach\/\{coachSlug\}/, '{APP_HOST}/coach/{coachSlug}'],
  ], ['APP_HOST']],
  ['src/app/mixer/leagues/new/page.tsx', [
    [/>club\.coachmode\.ai\/leagues\/</, '>{APP_HOST}/leagues/<'],
  ], ['APP_HOST']],
  ['src/app/page.tsx', [
    [/>club\.coachmode\.ai\/courtsheet</, '>{APP_HOST}/courtsheet<'],
  ], ['APP_HOST']],
  ['src/components/shared/ProductShowcase.tsx', [
    [/(\n\s*)club\.coachmode\.ai(\n)/, '$1{APP_HOST}$2'],
  ], ['APP_HOST']],
  ['src/app/tournaments/[slug]/draw/page.tsx', [
    [/club\.coachmode\.ai · printed/, '{APP_HOST} · printed'],
  ], ['APP_HOST']],
  ['src/app/tournaments/[slug]/results/ShareBar.tsx', [
    [/'via club\.coachmode\.ai'/, '`via ${APP_HOST}`'],
  ], ['APP_HOST']],
  ['src/app/quads/[slug]/results/ShareBar.tsx', [
    [/'via club\.coachmode\.ai'/, '`via ${APP_HOST}`'],
  ], ['APP_HOST']],
  ['src/components/mixer/event/EventSummary.tsx', [
    [/Run your next event at club\.coachmode\.ai/, 'Run your next event at ${APP_HOST}'],
  ], ['APP_HOST']],
  ['src/components/mixer/event/ResultsCardGenerator.tsx', [
    [/ctx\.fillText\("club\.coachmode\.ai"/, 'ctx.fillText(APP_HOST'],
  ], ['APP_HOST']],

  // ---- "Powered by" on the tokenized coach pages ----
  ['src/app/leagues/roster/[token]/page.tsx', [
    [/href="https:\/\/club\.coachmode\.ai"/, 'href={APP_URL}'],
  ], ['APP_URL']],
  ['src/app/leagues/roster/[token]/matchday/page.tsx', [
    [/href="https:\/\/club\.coachmode\.ai"/, 'href={APP_URL}'],
  ], ['APP_URL']],

  // ---- Misc ----
  ['src/app/reports/board/page.tsx', [
    [/h\.get\("host"\) \?\? "club\.coachmode\.ai"/, 'h.get("host") ?? APP_HOST'],
  ], ['APP_HOST']],
  ['src/app/api/admin/dj/seed-library/route.ts', [
    [/https:\/\/club\.coachmode\.ai/g, 'https://clubmode.ai'],
  ], []],
];

function ensureImport(src, names) {
  if (names.length === 0) return src;
  const existing = src.match(/import\s*\{([^}]*)\}\s*from\s*(['"])@\/lib\/appUrl\2;?/);
  if (existing) {
    const have = existing[1].split(',').map((n) => n.trim()).filter(Boolean);
    const merged = [...new Set([...have, ...names])].sort();
    return src.replace(existing[0], `import { ${merged.join(', ')} } from '@/lib/appUrl';`);
  }
  const line = `import { ${[...names].sort().join(', ')} } from '@/lib/appUrl';`;
  const imports = [...src.matchAll(/^import\s.*?;\s*$/gms)];
  if (imports.length === 0) {
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
for (const [rel, subs, imports] of RULES) {
  const file = join(ROOT, rel);
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { console.log(`SKIP (missing) ${rel}`); continue; }
  const before = src;
  let hits = 0;
  for (const [find, replace] of subs) {
    src = src.replace(find, (...a) => { hits++; return typeof replace === 'string' ? replace.replace(/\$(\d)/g, (_, i) => a[Number(i)]) : replace; });
  }
  if (src === before) { console.log(`  no-op  ${rel}`); continue; }
  src = ensureImport(src, imports);
  console.log(`rewrote  ${rel}  (${hits})`);
  changed++;
  if (WRITE) writeFileSync(file, src, 'utf8');
}
console.log(`\n${changed} files ${WRITE ? 'rewritten' : 'would change'}`);
