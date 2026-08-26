import { writeFileSync } from 'node:fs';
import { LEVELS, HOUSE_RULES, SUMMIT_REWARDS } from './curriculum.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// print-tuned palette (the screen hexes are too light on paper)
const INK = {
  red:    { bg: '#d13c3c', deep: '#8e1f1f', tint: '#fdf1f1', ages: 'ages 3–4' },
  orange: { bg: '#e0700f', deep: '#a0490a', tint: '#fdf4ec', ages: 'ages 5–6' },
  green:  { bg: '#1a8f4a', deep: '#0f5f31', tint: '#eff8f2', ages: 'ages 7–10' },
  yellow: { bg: '#c99a12', deep: '#8a6708', tint: '#fdf8e9', ages: 'ages 11–13' },
  hp:     { bg: '#5b21b6', deep: '#3d1580', tint: '#f4f0fd', ages: 'by invitation' },
};

const K = Number(process.env.SCALE || 0.88);       // type scale for the exam pages
const z = (n) => +(n * K).toFixed(2);
const PAGES = LEVELS.filter((l) => l.stripes.length > 0);
const TOTAL = PAGES.length + 2; // cover + colors + score sheet

const pips = (n, filled = 0) =>
  Array.from({ length: n }, (_, i) => `<span class="${i < filled ? 'on' : ''}"></span>`).join('');

/* ─────────────────────────── cover ─────────────────────────── */
// a real test, pulled live, used as the anatomy specimen on the cover
const SPEC = LEVELS[0].stripes[1].tests[0];

const climbStrip = LEVELS.map((l, i) => {
  const c = INK[l.key];
  return `<div class="lvl" style="background:${c.bg}">
      <div class="nm">${esc(l.name.toUpperCase())}</div>
      <div class="ct">${esc(l.court)} · ${c.ages}</div>
      <div class="pips">${l.stripes.length ? pips(5) : '<span class="hp">★</span>'}</div>
      ${i < LEVELS.length - 1 ? '<div class="arrow">▸</div>' : ''}
    </div>`;
}).join('');

const cover = `
<section class="page cover">
  <div class="eyebrow">SLEEPY HOLLOW JUNIOR TENNIS &nbsp;·&nbsp; THE JUNIOR PATHWAY &nbsp;·&nbsp; COACH'S COPY</div>
  <h1>THE STRINGS <span class="accent">EXAM.</span></h1>
  <p class="standfirst">
    Every test, at every ball color, in one place. <strong>Four colors, five strings per color,
    three pass/fail tests per string — 60 tests total.</strong> One page per color: run the test
    exactly as written, judge it against the pass bar exactly as written, and every kid at
    Sleepy Hollow is measured against the same standard by whichever coach is on court.
    Clear string 5 and the player is <strong>promoted, announced by name</strong>.
  </p>

  <div class="climb">${climbStrip}</div>
  <div class="climb-caption">5 strings per color &nbsp;·&nbsp; 3 tests per string &nbsp;·&nbsp; <em>string 5 is the promotion test</em> &nbsp;·&nbsp; Yellow 5 earns the High&nbsp;Performance invite</div>

  <div class="cols">
    <div class="col">
      <h2><span class="bar"></span>How Test Day runs</h2>
      <div class="step"><div class="n">1</div><p><strong>First class of the month:</strong> post the month's tests on the fence. Nothing is hidden — the tests <em>are</em> the curriculum.</p></div>
      <div class="step"><div class="n">2</div><p><strong>All month:</strong> train toward them. A kid who can't tap 10 in a row on week one should be tapping 10 by week four.</p></div>
      <div class="step"><div class="n">3</div><p><strong>Last class of the month = Test Day.</strong> Parents are invited to stay for the final 15 minutes. Run each test as written on the color page.</p></div>
      <div class="step"><div class="n">4</div><p><strong>Mark the score sheet</strong> (last page) as you go — name, color, string, which of the 3 tests passed. Hand it to Darrin; he enters it in ClubMode.</p></div>
      <div class="step"><div class="n">5</div><p><strong>The band moment:</strong> all 3 tests passed = call the player to the net, say the string out loud in front of everyone, and tie the band on their racquet.</p></div>

      <h2 style="margin-top:16px"><span class="bar"></span>Judging</h2>
      <div class="judge">
        <p><strong>Read the PASS line, not your gut.</strong> If it says 5 of 8, it's 5 of 8 — for the naturally gifted kid and for the one who's fighting for it.</p>
        <p><strong>Partial credit is real.</strong> Passing 2 of 3 tests banks those two forever. Next month the player only retests what's left.</p>
        <p><strong>Not everyone passes, and that's the product.</strong> A string that can't be failed is a participation trophy and the kids know it.</p>
        <p><strong>When it's a coin flip, retest.</strong> A kid who scrapes through on a technicality doesn't believe the band means anything either — and the one who earns it next month believes in it for good.</p>
      </div>
    </div>

    <div class="col">
      <h2><span class="bar"></span>House rules</h2>
      <div class="rules">${HOUSE_RULES.map((r) => `<p>${esc(r)}</p>`).join('')}</div>

      <h2 style="margin-top:16px"><span class="bar"></span>How to read a test</h2>
      <div class="spec">
        <div class="spec-row"><span class="lg-t">THE&nbsp;STANDARD</span><div class="sp-label"><span class="sp-n">1</span>${esc(SPEC.label)}</div></div>
        <div class="spec-row"><span class="lg-t">MEASURES</span><p class="sp-what">${esc(SPEC.what)}</p></div>
        <div class="spec-row"><span class="lg-t">RUN&nbsp;IT</span><p class="sp-line">${esc(SPEC.how)}</p></div>
        <div class="spec-row"><span class="lg-t gold">PASS&nbsp;BAR</span><p class="sp-line sp-pass">${esc(SPEC.pass)}</p></div>
      </div>
      <p class="spec-note">All 60 tests on the next four pages carry the standard, the run and the pass bar, written exactly this way — the MEASURES line lives on the website, where there's room for it. <strong>The pass bar is the line — don't move it.</strong></p>

      <div class="page-box">
        <p><strong>The whole ladder lives online too.</strong> Every test, every color, no login needed — send it to any parent who asks.</p>
        <div class="link-chip">club.coachmode.ai/pathway/curriculum</div>
      </div>
    </div>
  </div>

  <div class="summit">
    <div class="t">TOP OF THE LADDER</div>
    <p>${SUMMIT_REWARDS.map((r) => `<strong>${esc(r)}</strong>`).join(' &nbsp;·&nbsp; ')}</p>
  </div>

  <footer>
    <div class="l">THE SLEEPY HOLLOW JUNIOR PATHWAY &nbsp;·&nbsp; EARN YOUR STRINGS</div>
    <div class="r">Coach's exam book &nbsp;·&nbsp; page 1 of ${TOTAL}</div>
  </footer>
</section>`;

/* ──────────────────────── one page per color ──────────────────────── */
const stringCard = (st) => `
    <div class="string">
      <div class="s-head">
        <div class="s-num">${st.number}</div>
        <div class="s-title">${esc(st.title)}</div>
        ${st.promotes ? '<div class="s-flag">PROMOTION TEST</div>' : ''}
      </div>
      ${st.tests.map((t, i) => `
      <div class="test">
        <div class="t-label"><span class="t-n">${i + 1}</span>${esc(t.label)}</div>
        <p class="t-line"><span class="tag">RUN IT</span>${esc(t.how)}</p>
        <p class="t-line pass"><span class="tag gold">PASS BAR</span>${esc(t.pass)}</p>
      </div>`).join('')}
    </div>`;

const PROMOTED_TO = {
  red: 'Moves up to <strong>Orange Ball</strong> — 60&prime; court, orange ball — announced by name in front of the whole class.',
  orange: 'Moves up to <strong>Green Ball</strong> — the full 78&prime; court for the first time — announced by name in front of the whole class.',
  green: 'Moves up to <strong>Yellow Ball</strong> — full court, real ball, real matches — announced by name in front of the whole class.',
  yellow: 'Earns the <strong>High Performance invitation</strong>. Yellow 5 is the only door into HP, and it is the Director&rsquo;s call.',
};

const colorPage = (level, idx) => {
  const c = INK[level.key];
  const colA = level.stripes.slice(0, 3).map(stringCard).join('');
  const colB = level.stripes.slice(3).map(stringCard).join('') + `
    <div class="notes">
      <div class="n-t">WHEN STRING 5 IS CLEARED</div>
      <p>${PROMOTED_TO[level.key]}</p>
      <div class="n-cap">COACH NOTES — who is close, who has a retest waiting</div>
      <div class="n-lines"><i></i><i></i><i></i></div>
    </div>`;

  return `
<section class="page exam" style="--lvl:${c.bg};--deep:${c.deep};--tint:${c.tint}">
  <div class="band">
    <div class="band-l">
      <div class="band-eyebrow">THE STRINGS EXAM &nbsp;·&nbsp; ${idx} OF ${PAGES.length}</div>
      <div class="band-name">${esc(level.name.toUpperCase())}</div>
      <div class="band-sub">${esc(level.court)} &nbsp;·&nbsp; ${esc(level.ball)} &nbsp;·&nbsp; ${c.ages}</div>
    </div>
    <div class="band-r">
      <div class="band-count">5 STRINGS &nbsp;/&nbsp; 15 TESTS</div>
      <div class="band-pips">${pips(5)}</div>
    </div>
  </div>
  <p class="tagline">${esc(level.tagline)}</p>

  <div class="sheet">
    <div class="scol">${colA}</div>
    <div class="scol">${colB}</div>
  </div>

  <footer>
    <div class="l">${esc(level.name.toUpperCase())} &nbsp;·&nbsp; ALL 15 TESTS</div>
    <div class="r">Pass all 3 tests in a string → tie the band on the racquet &nbsp;·&nbsp; page ${idx + 1} of ${TOTAL}</div>
  </footer>
</section>`;
};

/* ─────────────────────────── score sheet ─────────────────────────── */
const ROWS = 14;
const row = (n) => `
  <tr>
    <td class="c-n">${n}</td>
    <td class="c-name"></td>
    <td class="c-col">
      <span class="dot" style="border-color:${INK.red.bg};color:${INK.red.bg}">R</span>
      <span class="dot" style="border-color:${INK.orange.bg};color:${INK.orange.bg}">O</span>
      <span class="dot" style="border-color:${INK.green.bg};color:${INK.green.bg}">G</span>
      <span class="dot" style="border-color:${INK.yellow.deep};color:${INK.yellow.deep}">Y</span>
    </td>
    <td class="c-str">${[1, 2, 3, 4, 5].map((i) => `<span class="dot">${i}</span>`).join('')}</td>
    <td class="c-tests">${[1, 2, 3].map((i) => `<span class="chk"><i></i>${i}</span>`).join('')}</td>
    <td class="c-earned"><span class="bigbox"></span></td>
    <td class="c-notes"></td>
  </tr>`;

const scoreSheet = `
<section class="page score">
  <div class="s-band">
    <div>
      <div class="band-eyebrow">THE SLEEPY HOLLOW JUNIOR PATHWAY</div>
      <div class="band-name">TEST DAY SCORE SHEET</div>
    </div>
    <div class="s-band-r">Photocopy this page — one per court, one per Test Day.</div>
  </div>

  <div class="fields">
    <div class="fld" style="flex:1.4"><span>COACH</span><i></i></div>
    <div class="fld" style="flex:1"><span>DATE</span><i></i></div>
    <div class="fld" style="flex:1.4"><span>CLASS / GROUP</span><i></i></div>
    <div class="fld" style="flex:.8"><span>COURT</span><i></i></div>
  </div>

  <table class="grid">
    <thead>
      <tr>
        <th class="c-n"></th>
        <th class="c-name">PLAYER NAME</th>
        <th class="c-col">BALL COLOR<br><em>circle one</em></th>
        <th class="c-str">STRING<br><em>circle one</em></th>
        <th class="c-tests">TESTS PASSED<br><em>tick each</em></th>
        <th class="c-earned">STRING<br>EARNED</th>
        <th class="c-notes">NOTES &nbsp;/&nbsp; WHAT TO RETEST NEXT MONTH</th>
      </tr>
    </thead>
    <tbody>${Array.from({ length: ROWS }, (_, i) => row(i + 1)).join('')}</tbody>
  </table>

  <div class="score-foot">
    <div class="promo">
      <div class="promo-t">PROMOTIONS TODAY <em>— string 5 cleared, moving up a ball color</em></div>
      <div class="promo-lines">
        <div class="pl"><i></i><span>→</span><i class="short"></i></div>
        <div class="pl"><i></i><span>→</span><i class="short"></i></div>
        <div class="pl"><i></i><span>→</span><i class="short"></i></div>
      </div>
    </div>
    <div class="handoff">
      <div class="h-t">WHEN YOU'RE DONE</div>
      <p><strong>1.</strong> Tie the band on every earned racquet, at the net, name said out loud.</p>
      <p><strong>2.</strong> Hand this sheet to Darrin — results go into ClubMode and the family sees it that night.</p>
      <p><strong>3.</strong> Partial passes bank. Only what's blank gets retested next month.</p>
    </div>
  </div>

  <footer>
    <div class="l">TEST DAY = LAST CLASS OF THE MONTH</div>
    <div class="r">club.coachmode.ai/pathway/curriculum &nbsp;·&nbsp; page ${TOTAL} of ${TOTAL}</div>
  </footer>
</section>`;

/* ─────────────────────────── document ─────────────────────────── */
const html = `<!doctype html>
<html><head><meta charset="utf-8">
<title>The Strings Exam — Coach's Copy</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800;900&display=swap">
<style>
  @page { size: letter; margin: 0; }
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  html { background:#FAF7F2; }
  body { font-family: Arial, 'Helvetica Neue', sans-serif; color:#1C2321; }
  .page { width:8.5in; height:11in; background:#FAF7F2; padding:0.42in 0.5in 0.32in; display:flex; flex-direction:column; position:relative; overflow:hidden; }
  .page + .page { page-break-before: always; }
  .disp, h1, h2, .band-name, .s-num, .s-title { font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif; }

  footer { display:flex; justify-content:space-between; align-items:baseline; gap:24px; margin-top:auto; padding-top:7px; border-top:1px solid #ddd7cb; }
  footer .l { font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif; font-weight:800; font-size:10.5px; letter-spacing:.06em; white-space:nowrap; }
  footer .r { font-size:8.5px; color:#8b948c; text-align:right; }

  /* ───────── cover ───────── */
  .eyebrow { font-size:9.5px; font-weight:800; letter-spacing:.24em; color:#6b7268; }
  h1 { font-weight:900; font-size:76px; line-height:.92; letter-spacing:-.01em; margin:3px 0 7px; }
  h1 .accent { color:#b8860b; }
  .standfirst { font-size:12.4px; line-height:1.5; color:#3d453f; max-width:6.6in; }
  .standfirst strong { color:#1C2321; }
  .climb { display:flex; gap:6px; margin:15px 0 5px; }
  .climb .lvl { flex:1; border-radius:8px; padding:10px 11px 9px; color:#fff; position:relative; }
  .climb .lvl .nm { font-family:'Barlow Condensed'; font-weight:800; font-size:18px; letter-spacing:.02em; line-height:1.05; }
  .climb .lvl .ct { font-size:8px; opacity:.93; font-weight:600; margin-top:2px; }
  .climb .pips { display:flex; gap:3.5px; margin-top:6px; height:11px; align-items:center; }
  .climb .pips span { width:9px; height:9px; border-radius:50%; border:2px solid rgba(255,255,255,.95); }
  .climb .pips span.hp { border:none; width:auto; height:auto; font-size:11px; line-height:1; }
  .climb .arrow { position:absolute; right:-8px; top:50%; transform:translateY(-50%); color:#9aa39b; font-weight:800; z-index:2; font-size:12px; }
  .climb-caption { font-size:11px; font-weight:700; text-align:center; color:#4c554e; margin-bottom:12px; }
  .climb-caption em { font-style:normal; color:#b8860b; }
  .cols { display:flex; gap:22px; margin-top:12px; }
  .col { flex:1; }
  h2 { font-weight:800; font-size:21px; letter-spacing:.03em; text-transform:uppercase; margin-bottom:7px; }
  h2 .bar { display:inline-block; width:18px; height:4px; border-radius:2px; background:#b8860b; vertical-align:4px; margin-right:7px; }
  .step { display:flex; gap:9px; margin-bottom:8px; }
  .step .n { flex-shrink:0; width:20px; height:20px; border-radius:50%; background:#1C2321; color:#FAF7F2; font-weight:800; font-size:10.5px; display:flex; align-items:center; justify-content:center; margin-top:1px; }
  .step p { font-size:11px; line-height:1.46; color:#3d453f; }
  .step p strong { color:#1C2321; }
  .step p em { font-style:italic; }
  .judge p, .rules p { font-size:10.6px; line-height:1.5; margin-bottom:5px; color:#4c554e; }
  .judge p strong, .rules p strong { color:#1C2321; }
  .rules { border-left:3px solid #b8860b; padding:2px 0 2px 11px; }
  .judge { border-left:3px solid #ddd7cb; padding:2px 0 2px 11px; }
  .spec { background:#fff; border:1px solid #e3ded4; border-radius:8px; padding:9px 11px 10px; }
  .spec-row { display:flex; gap:9px; align-items:flex-start; }
  .spec-row + .spec-row { margin-top:5px; padding-top:5px; border-top:1px dotted #ece6d8; }
  .sp-label { font-size:10.2px; font-weight:700; line-height:1.3; color:#1C2321; padding-top:1px; }
  .sp-n { display:inline-block; width:12px; height:12px; border-radius:2px; background:#fdf1f1; color:#8e1f1f; border:1px solid #d13c3c; font-size:7.5px; font-weight:800; text-align:center; line-height:10.5px; margin-right:5px; vertical-align:1px; }
  .sp-what { font-size:9px; line-height:1.4; color:#7c8480; font-style:italic; }
  .sp-line { font-size:9.2px; line-height:1.42; color:#3d453f; }
  .sp-pass { color:#1C2321; font-weight:600; }
  .spec-note { font-size:9.4px; line-height:1.45; color:#7c8480; margin:6px 2px 11px; }
  .spec-note strong { color:#8a6708; }
  .lg-t.gold { color:#8a6708; border-color:#e0d6bf; background:#fdf8e9; }
  .legend { margin-bottom:11px; }
  .lg { display:flex; gap:9px; align-items:flex-start; margin-bottom:6px; }
  .lg-t { flex-shrink:0; width:74px; font-size:7.5px; font-weight:800; letter-spacing:.08em; color:#b8860b; border:1px solid #e0d6bf; background:#fff; border-radius:3px; padding:3px 0; text-align:center; margin-top:1px; }
  .lg p { font-size:10.4px; line-height:1.45; color:#4c554e; }
  .page-box { background:#fff; border:1px solid #e3ded4; border-radius:8px; padding:11px 13px; }
  .page-box p { font-size:11px; line-height:1.5; color:#3d453f; }
  .page-box p strong { color:#1C2321; }
  .link-chip { display:inline-block; margin-top:6px; font-size:9.5px; font-weight:700; background:#1C2321; color:#FAF7F2; border-radius:20px; padding:4px 11px; letter-spacing:.02em; }
  .summit { background:#1C2321; color:#FAF7F2; border-radius:10px; padding:13px 17px; margin-top:auto; display:flex; align-items:center; gap:18px; }
  .summit .t { font-family:'Barlow Condensed'; font-weight:800; font-size:19px; letter-spacing:.03em; color:#eab308; white-space:nowrap; }
  .summit p { font-size:11px; line-height:1.5; color:#d3d8d2; }
  .summit p strong { color:#fff; }

  /* ───────── exam pages ───────── */
  .band { background:var(--lvl); color:#fff; border-radius:9px; padding:11px 16px 12px; display:flex; justify-content:space-between; align-items:flex-end; }
  .band-eyebrow { font-size:8px; font-weight:800; letter-spacing:.2em; opacity:.85; }
  .band-name { font-weight:900; font-size:46px; line-height:.9; letter-spacing:-.005em; margin-top:2px; }
  .band-sub { font-size:9.5px; font-weight:700; letter-spacing:.06em; opacity:.95; margin-top:4px; text-transform:uppercase; }
  .band-r { text-align:right; }
  .band-count { font-family:'Barlow Condensed'; font-weight:800; font-size:14px; letter-spacing:.08em; opacity:.95; }
  .band-pips { display:flex; gap:4px; justify-content:flex-end; margin-top:5px; }
  .band-pips span { width:10px; height:10px; border-radius:50%; border:2px solid rgba(255,255,255,.95); }
  .tagline { font-size:11px; line-height:1.4; color:#4c554e; font-weight:600; margin:8px 2px 9px; }

  .sheet { display:flex; gap:17px; align-items:flex-start; }
  .scol { flex:1; min-width:0; }
  .string { background:#fff; border:1px solid #e3ded4; border-radius:7px; padding:6px 9px 5px; margin-bottom:6px; }
  .s-head { display:flex; align-items:center; gap:7px; padding-bottom:4px; margin-bottom:3px; border-bottom:1px solid #eee8dc; }
  .s-num { flex-shrink:0; width:18px; height:18px; border-radius:50%; background:var(--lvl); color:#fff; font-weight:800; font-size:12px; display:flex; align-items:center; justify-content:center; }
  .s-title { font-weight:800; font-size:15.5px; letter-spacing:.02em; text-transform:uppercase; color:var(--deep); line-height:1; }
  .s-flag { margin-left:auto; font-size:6.4px; font-weight:800; letter-spacing:.1em; color:#fff; background:#1C2321; border-radius:3px; padding:3px 5px; }
  .test { padding:${z(5)}px 0; }
  .test + .test { border-top:1px dotted #e6e0d2; }
  .t-label { font-size:${z(10.4)}px; font-weight:700; line-height:1.3; color:#1C2321; }
  .t-n { display:inline-block; width:${z(12)}px; height:${z(12)}px; border-radius:2px; background:var(--tint); color:var(--deep); border:1px solid var(--lvl); font-size:${z(7.6)}px; font-weight:800; text-align:center; line-height:${z(10.5)}px; margin-right:5px; vertical-align:1px; }
  .t-line { font-size:${z(9.4)}px; line-height:1.4; color:#333a36; margin-left:${z(17)}px; margin-top:${z(3)}px; }
  .notes { border:1px dashed #c9c2b2; border-radius:7px; padding:8px 10px 9px; background:rgba(255,255,255,.5); }
  .n-t { font-family:'Barlow Condensed'; font-weight:800; font-size:13px; letter-spacing:.06em; color:var(--deep); }
  .notes p { font-size:8.6px; line-height:1.4; color:#4c554e; margin-top:3px; }
  .notes p strong { color:#1C2321; }
  .n-cap { font-size:6.6px; font-weight:800; letter-spacing:.09em; color:#9aa39b; margin:9px 0 3px; }
  .n-lines i { display:block; border-bottom:1px solid #cfc9bb; height:15px; }
  .t-line.pass { color:#1C2321; }
  .tag { display:inline-block; font-size:${z(7)}px; font-weight:800; letter-spacing:.09em; color:#6b7268; border:1px solid #ddd7cb; border-radius:2px; padding:1px 3px; margin-right:4px; vertical-align:1.5px; background:#faf7f2; }
  .tag.gold { color:#8a6708; border-color:#e0d6bf; background:#fdf8e9; }

  /* ───────── score sheet ───────── */
  .s-band { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:3px solid #1C2321; padding-bottom:8px; }
  .score .band-eyebrow { color:#6b7268; opacity:1; }
  .score .band-name { color:#1C2321; font-size:44px; }
  .s-band-r { font-size:9px; color:#8b948c; font-weight:700; text-align:right; padding-bottom:3px; }
  .fields { display:flex; gap:14px; margin:13px 0 11px; }
  .fld { display:flex; align-items:flex-end; gap:7px; }
  .fld span { font-size:8px; font-weight:800; letter-spacing:.1em; color:#6b7268; white-space:nowrap; padding-bottom:2px; }
  .fld i { flex:1; border-bottom:1.5px solid #b9b3a5; height:19px; }
  .grid { width:100%; border-collapse:collapse; table-layout:fixed; }
  .grid th { font-size:7.6px; font-weight:800; letter-spacing:.08em; color:#4c554e; text-align:center; padding:0 3px 5px; vertical-align:bottom; line-height:1.3; }
  .grid th em { font-style:normal; font-weight:700; font-size:6.4px; color:#9aa39b; letter-spacing:.04em; }
  .grid th.c-name, .grid th.c-notes { text-align:left; }
  .grid td { border-bottom:1px solid #cfc9bb; height:0.5in; padding:0 3px; }
  .grid tbody tr:nth-child(even) td { background:#f3efe6; }
  .c-n { width:0.2in; font-size:8px; color:#b3ada0; font-weight:700; text-align:center; border-bottom-color:transparent !important; background:none !important; }
  .c-name { width:1.72in; border-left:1px solid #cfc9bb; }
  .c-col { width:0.92in; text-align:center; }
  .c-str { width:1.02in; text-align:center; }
  .c-tests { width:0.92in; text-align:center; }
  .c-earned { width:0.55in; text-align:center; }
  .c-notes { border-right:1px solid #cfc9bb; }
  .dot { display:inline-block; width:14px; height:14px; line-height:12px; border-radius:50%; border:1.2px solid #b9b3a5; color:#7c8480; font-size:8px; font-weight:800; text-align:center; margin:0 1px; }
  .chk { display:inline-block; font-size:7px; font-weight:800; color:#9aa39b; margin:0 1.5px; }
  .chk i { display:block; width:13px; height:13px; border:1.2px solid #b9b3a5; border-radius:2px; margin-bottom:1px; }
  .bigbox { display:inline-block; width:19px; height:19px; border:1.6px solid #1C2321; border-radius:3px; }
  .score-foot { display:flex; gap:16px; margin-top:13px; }
  .promo { flex:1.25; background:#1C2321; color:#FAF7F2; border-radius:9px; padding:11px 14px 12px; }
  .promo-t { font-family:'Barlow Condensed'; font-weight:800; font-size:15px; letter-spacing:.05em; color:#eab308; }
  .promo-t em { font-style:normal; font-weight:600; font-size:9.5px; color:#a8b0a8; letter-spacing:.02em; }
  .promo-lines { margin-top:9px; }
  .pl { display:flex; align-items:flex-end; gap:8px; margin-bottom:9px; }
  .pl i { flex:1.5; border-bottom:1px solid #6b7268; height:15px; }
  .pl i.short { flex:1; }
  .pl span { font-size:10px; color:#8b948c; font-weight:800; padding-bottom:1px; }
  .handoff { flex:1; background:#fff; border:1px solid #e3ded4; border-radius:9px; padding:11px 13px; }
  .h-t { font-family:'Barlow Condensed'; font-weight:800; font-size:15px; letter-spacing:.05em; color:#b8860b; margin-bottom:6px; }
  .handoff p { font-size:9.4px; line-height:1.44; color:#3d453f; margin-bottom:4px; }
  .handoff p strong { color:#1C2321; }
</style>
</head>
<body>
${cover}
${PAGES.map((l, i) => colorPage(l, i + 1)).join('\n')}
${scoreSheet}
</body></html>`;

writeFileSync(new URL('./strings-exam.html', import.meta.url), html);
console.log('wrote strings-exam.html —', TOTAL, 'pages,', PAGES.reduce((n, l) => n + l.stripes.length * 3, 0), 'tests');
