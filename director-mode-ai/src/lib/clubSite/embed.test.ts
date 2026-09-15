import { describe, expect, it } from 'vitest';
import {
  clubSlugFromPath,
  embedLinkAction,
  embedSnippet,
  frameAncestors,
  keepEmbed,
  normalizeEmbedOrigin,
  normalizeEmbedOrigins,
  parseEmbedSection,
} from './embed';

const PAGE = 'https://clubmode.ai/c/some-club/programs?embed=1';

describe('normalizeEmbedOrigin', () => {
  it('accepts what a director pastes from the address bar', () => {
    expect(normalizeEmbedOrigin('example-club.org')).toBe('https://example-club.org');
    expect(normalizeEmbedOrigin('https://www.example-club.org/Programs?x=1')).toBe(
      'https://www.example-club.org',
    );
    expect(normalizeEmbedOrigin('club.wildapricot.org/')).toBe('https://club.wildapricot.org');
    expect(normalizeEmbedOrigin('http://localhost:5050')).toBe('http://localhost:5050');
  });

  it('keeps a subdomain wildcard', () => {
    expect(normalizeEmbedOrigin('*.example-club.org')).toBe('https://*.example-club.org');
  });

  it('refuses anything that could break the header', () => {
    expect(normalizeEmbedOrigin('*')).toBeNull();
    expect(normalizeEmbedOrigin("example.org; script-src 'unsafe-inline'")).toBeNull();
    expect(normalizeEmbedOrigin('javascript:alert(1)')).toBeNull();
    expect(normalizeEmbedOrigin('not a site')).toBeNull();
    expect(normalizeEmbedOrigin('intranet')).toBeNull();
    expect(normalizeEmbedOrigin('')).toBeNull();
  });

  it('dedupes a list', () => {
    expect(normalizeEmbedOrigins(['a.org', 'https://a.org/x', 'junk', 7])).toEqual(['https://a.org']);
  });
});

describe('frameAncestors', () => {
  it('is same-origin for everything that is not an embed', () => {
    expect(frameAncestors(false, ['https://a.org'])).toBe("'self'");
  });
  it('lets any site embed when the club listed none', () => {
    expect(frameAncestors(true, [])).toBe('*');
    expect(frameAncestors(true, null)).toBe('*');
  });
  it('lists the club sites after self', () => {
    expect(frameAncestors(true, ['https://a.org', 'b.org'])).toBe("'self' https://a.org https://b.org");
  });
  it('treats a hand-edited junk row as no list rather than a broken header', () => {
    expect(frameAncestors(true, ['; frame-ancestors *'])).toBe('*');
  });
});

describe('clubSlugFromPath', () => {
  it('finds the slug on every public club page', () => {
    expect(clubSlugFromPath('/c/some-club')).toBe('some-club');
    expect(clubSlugFromPath('/c/some-club/programs/juniors')).toBe('some-club');
    expect(clubSlugFromPath('/calendar/some-club')).toBe('some-club');
    expect(clubSlugFromPath('/courtsheet/some-club')).toBe('some-club');
  });
  it('does not mistake director tools for a club', () => {
    expect(clubSlugFromPath('/courtsheet/staff')).toBeNull();
    expect(clubSlugFromPath('/calendar/board')).toBeNull();
    expect(clubSlugFromPath('/run/site')).toBeNull();
    expect(clubSlugFromPath('/login')).toBeNull();
  });
});

describe('embedLinkAction', () => {
  it('keeps club pages in the frame, with embed=1', () => {
    expect(embedLinkAction('/c/some-club/programs/juniors', PAGE)).toEqual({
      kind: 'frame',
      href: '/c/some-club/programs/juniors?embed=1',
    });
    expect(embedLinkAction('/courtsheet/some-club', PAGE)).toEqual({
      kind: 'frame',
      href: '/courtsheet/some-club?embed=1',
    });
    expect(embedLinkAction('/c/some-club/courts/book?date=2026-09-20&time=09:00', PAGE)).toEqual({
      kind: 'frame',
      href: '/c/some-club/courts/book?date=2026-09-20&time=09%3A00&embed=1',
    });
  });

  it('sends sign-in and app pages out of the frame', () => {
    expect(embedLinkAction('/login?next=%2Fc%2Fsome-club', PAGE)).toEqual({ kind: 'new-window' });
    expect(embedLinkAction('/courtconnect', PAGE)).toEqual({ kind: 'new-window' });
    expect(embedLinkAction('/terms', PAGE)).toEqual({ kind: 'new-window' });
  });

  it('sends other sites — checkout included — out of the frame', () => {
    expect(embedLinkAction('https://square.link/u/abc', PAGE)).toEqual({ kind: 'new-window' });
  });

  it('leaves mail, phone, anchors and file downloads alone', () => {
    expect(embedLinkAction('mailto:desk@example.org', PAGE)).toEqual({ kind: 'leave' });
    expect(embedLinkAction('tel:5551234567', PAGE)).toEqual({ kind: 'leave' });
    expect(embedLinkAction('#programs', PAGE)).toEqual({ kind: 'leave' });
    expect(embedLinkAction('/api/calendar/public/some-club?format=ics', PAGE)).toEqual({ kind: 'leave' });
  });
});

describe('keepEmbed and sections', () => {
  it('adds embed=1 only when embedded', () => {
    expect(keepEmbed('/c/x/programs/y/registered?r=1', true)).toBe('/c/x/programs/y/registered?r=1&embed=1');
    expect(keepEmbed('/c/x', true)).toBe('/c/x?embed=1');
    expect(keepEmbed('/c/x', false)).toBe('/c/x');
  });
  it('parses sections strictly', () => {
    expect(parseEmbedSection('Calendar')).toBe('calendar');
    expect(parseEmbedSection('admin')).toBeNull();
  });
  it('builds a snippet with an escaped title and the resize script', () => {
    const s = embedSnippet({ appUrl: 'https://clubmode.ai', slug: 'some-club', section: 'team', title: 'Our "team"' });
    expect(s).toContain('src="https://clubmode.ai/c/some-club?embed=1&amp;section=team"');
    expect(s).toContain('title="Our &quot;team&quot;"');
    expect(s).toContain('<script src="https://clubmode.ai/embed.js" async></script>');
  });
});
