import { describe, expect, it } from 'vitest';
import { isAllowed, parseRobots } from './robots';

describe('robots', () => {
  it('uses the * group, longest match wins', () => {
    const p = parseRobots('User-agent: *\nDisallow: /files/files/\nDisallow: /download/\n\nUser-agent: bingbot\nDisallow: /jobs/?\n');
    expect(isAllowed(p, '/rss/')).toBe(true);
    expect(isAllowed(p, '/jobs/?q=tennis')).toBe(true); // bingbot-only rule
    expect(isAllowed(p, '/download/x.pdf')).toBe(false);
  });
  it('empty Disallow allows everything; crawl-delay is read', () => {
    const p = parseRobots('user-agent: *\ndisallow: \ncrawl-delay: 60');
    expect(isAllowed(p, '/anything')).toBe(true);
    expect(p.crawlDelaySec).toBe(60);
  });
  it('salesforce sites: Disallow / with narrow Allows blocks our paths', () => {
    const p = parseRobots('User-agent: googlebot\nAllow: /\n\nUser-agent: *    # all\nAllow: /?*un=*&pw=*\nDisallow: /      # all');
    expect(isAllowed(p, '/careers/ts2__JobDetails?jobId=1')).toBe(false);
  });
  it('wildcards, $ anchors, allow beats shorter disallow', () => {
    const p = parseRobots('User-agent: *\nDisallow: /jobs/*/apply$\nDisallow: /*.pdf$\nAllow: /private/ok\nDisallow: /private/');
    expect(isAllowed(p, '/jobs/123/apply')).toBe(false);
    expect(isAllowed(p, '/jobs/123/apply/x')).toBe(true);
    expect(isAllowed(p, '/a/b.pdf')).toBe(false);
    expect(isAllowed(p, '/private/ok')).toBe(true);
    expect(isAllowed(p, '/private/no')).toBe(false);
  });
  it('a group naming our bot overrides *', () => {
    const p = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: ClubModeBot\nDisallow: /secret');
    expect(isAllowed(p, '/jobs')).toBe(true);
    expect(isAllowed(p, '/secret')).toBe(false);
  });
});
