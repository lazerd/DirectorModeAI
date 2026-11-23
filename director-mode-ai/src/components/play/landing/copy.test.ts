import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { BENEFITS, CTA, FINAL, FORMATS, HERO, STORY, TAGLINE } from './copy';

const src = (p: string) => readFileSync(path.join(__dirname, '..', '..', '..', p), 'utf8');
const route = (href: string) => path.join(__dirname, '..', '..', '..', 'app', href.replace(/^\//, ''), 'page.tsx');

describe('landing copy', () => {
  it('uses the agreed hero and CTA language', () => {
    expect(HERO.title.join(' ')).toBe('More playing. Less planning.');
    expect(CTA.primary.label).toBe('Create a game — Free');
    expect(CTA.secondary.label).toBe('See how it works');
    expect(TAGLINE).toBe('Racquet Sports. Together. In Real Life.');
    expect(FINAL.title).toBe('Your next great game starts here.');
  });

  it('every page link goes to a route that exists (no dead-end CTAs)', () => {
    for (const c of [CTA.primary, CTA.fullDemo, CTA.join, CTA.suite]) {
      expect(existsSync(route(c.href)), c.href).toBe(true);
    }
  });

  it('in-page anchors point at sections the page renders', () => {
    const page = src('components/play/landing/Landing.tsx');
    expect(page).toContain(`id="${CTA.secondary.href.slice(1)}"`);
    expect(page).toContain('id="formats"');
  });

  it('tells the three-stage story, each stage with real screens', () => {
    expect(STORY.map((s) => s.label)).toEqual(['Create it', 'Fill it', 'Play it']);
    const screens = src('components/play/landing/Screens.tsx');
    for (const st of STORY) {
      expect(st.screens.length).toBeGreaterThan(0);
      for (const sc of st.screens) expect(screens).toContain(`case '${sc.id}':`);
    }
  });

  it('captions never name who partners whom (pairings differ by browser engine)', () => {
    for (const sc of STORY.flatMap((s) => [...s.screens] as { id: string; caption: string }[])) expect(sc.caption).not.toMatch(/with (Jordan|Priya|Marcus|Dev|Elena|Chris|Sofia)/);
  });

  it('makes no invented social proof or metrics', () => {
    const all = JSON.stringify({ HERO, STORY, BENEFITS, FORMATS, FINAL });
    expect(all).not.toMatch(/\b\d[\d,]*\+?\s*(users|hosts|players|games played|clubs)\b/i);
    expect(all).not.toMatch(/testimonial|rated|#1|best-in-class|revolutionary|seamless/i);
  });
});

describe('front door', () => {
  it('signed-out /, /racquetsirl and /play all land on the redesign; /racquetsirl/new redirects', () => {
    expect(src('app/racquetsirl/page.tsx')).toContain('<Landing />');
    expect(src('app/(home)/page.tsx')).toContain('<Landing />');
    expect(src('app/play/page.tsx')).toContain("redirect('/racquetsirl')");
    expect(src('app/racquetsirl/new/page.tsx')).toContain("redirect('/racquetsirl')");
    expect(src('app/racquetsirl/page.tsx')).not.toContain('index: false');
  });
});

describe('the landing page mirrors the real Start a game page', () => {
  it('the phone shows the same title and button as /play/new', () => {
    const host = src('components/play/HostClient.tsx');
    const mirror = src('components/play/DemoScreens.tsx');
    for (const [label, inHost] of [['Start a game</h1>', 'Start a game</h1>'], ['Make my link</button>', 'Make my link']]) {
      expect(mirror).toContain(label);
      expect(host).toContain(inHost);
    }
  });

  it('pricing on the landing page matches the paywall', () => {
    const passes = src('lib/play/passes.ts');
    expect(passes).toMatch(/PASS_PRICES = \{ host: 25, club: 100 \}/);
    expect(src('lib/play/pricing.ts')).toMatch(/PASS_PRICES = \{ host: 25, club: 100 \}/);
  });
});
