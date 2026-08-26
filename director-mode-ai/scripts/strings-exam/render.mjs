/**
 * Renders the coach's Strings Exam printout to public/strings-exam.pdf.
 *
 *   node scripts/strings-exam/render.mjs
 *
 * Pipeline: curriculum.ts -> esbuild -> build.mjs (HTML) -> Chrome measure -> Chrome PDF.
 * The measure step matters: every page is a fixed 8.5x11in box with overflow:hidden, so a
 * page that grows past the paper is silently CLIPPED. If this script says a page overflows,
 * shrink SCALE in build.mjs (or trim the curriculum text) before shipping the PDF.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const url = (p) => 'file:///' + p.replace(/\\/g, '/');

const CHROME = [
  process.env.CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('Chrome not found — set CHROME=/path/to/chrome');

const chrome = (...args) =>
  execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  });

// 1 — curriculum.ts is the single source of truth for all 60 tests
console.log('compiling curriculum.ts …');
execFileSync(path.join(repo, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild'),
  [path.join(repo, 'src/lib/pathway/curriculum.ts'), '--format=esm', `--outfile=${path.join(here, 'curriculum.mjs')}`],
  { stdio: 'inherit', shell: process.platform === 'win32' });

// 2 — build the HTML
await import(url(path.join(here, 'build.mjs')) + `?t=${process.pid}`);
const htmlPath = path.join(here, 'strings-exam.html');

// 3 — measure every page against the paper before committing to a PDF
const probe = `<script>window.addEventListener('load',()=>{const o=[];
document.querySelectorAll('.page').forEach((p,i)=>{const cs=getComputedStyle(p);
const avail=p.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
const used=[...p.children].reduce((n,k)=>n+k.getBoundingClientRect().height,0);
o.push((i+1)+':'+Math.round(used-avail));});
document.body.setAttribute('data-measure',o.join(','));});</script>`;
const measurePath = path.join(here, 'measure.html');
writeFileSync(measurePath, readFileSync(htmlPath, 'utf8').replace('</body>', probe + '</body>'));
const dom = chrome('--virtual-time-budget=8000', '--window-size=816,1056', '--dump-dom', url(measurePath));
const m = dom.match(/data-measure="([^"]*)"/);
if (!m) throw new Error('measurement probe did not run');
const over = m[1].split(',').map((s) => s.split(':')).filter(([, n]) => Number(n) > 0);
console.log('page fit (px of slack):', m[1].split(',').map(([p, , ...r]) => p).join(''), m[1]);
if (over.length) throw new Error(`page(s) overflow and would print CLIPPED: ${over.map(([p, n]) => `p${p} by ${n}px`).join(', ')}`);

// 4 — print
const out = path.join(here, 'strings-exam.pdf');
chrome('--virtual-time-budget=12000', '--no-pdf-header-footer', `--print-to-pdf=${out}`, url(htmlPath));
const pages = (readFileSync(out, 'latin1').match(/\/Count (\d+)/) || [])[1];
if (pages !== '6') throw new Error(`expected 6 pages, got ${pages}`);
mkdirSync(path.join(repo, 'public'), { recursive: true });
copyFileSync(out, path.join(repo, 'public/strings-exam.pdf'));
console.log(`\npublic/strings-exam.pdf — ${pages} pages, ${(readFileSync(out).length / 1024).toFixed(0)}KB`);
