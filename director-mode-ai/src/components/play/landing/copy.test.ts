import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { BENEFITS, CTA, DEMO_STEPS, FINAL, FORMATS, HERO, STAGES, TAGLINE } from './copy';

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

  it('tells the three-stage story', () => {
    expect(STAGES.map((s) => s.label)).toEqual(['Create it', 'Fill it', 'Play it']);
  });

  it('every demo step has a screen', () => {
    const screens = src('components/play/landing/Screens.tsx');
    for (const s of DEMO_STEPS) expect(screens).toContain(`case '${s.key}':`);
  });

  it('makes no invented social proof or metrics', () => {
    const all = JSON.stringify({ HERO, STAGES, DEMO_STEPS, BENEFITS, FORMATS, FINAL });
    expect(all).not.toMatch(/\b\d[\d,]*\+?\s*(users|hosts|players|games played|clubs)\b/i);
    expect(all).not.toMatch(/testimonial|rated|#1|best-in-class|revolutionary|seamless/i);
  });
});

describe('/play/new and the tours stay in sync', () => {
  it('the create button reads "Create my game" everywhere the tour taps it', () => {
    const host = src('components/play/HostClient.tsx');
    const mirror = src('components/play/DemoScreens.tsx');
    const tour = src('components/play/DemoTour.tsx');
    expect(host).toContain("'Create my game'");
    expect(mirror).toContain('>Create my game</button>');
    expect(tour).toContain("'text:Create my game'");
    expect(host + mirror + tour).not.toMatch(/>\s*Make my link|'text:Make my link'/);
  });
});
