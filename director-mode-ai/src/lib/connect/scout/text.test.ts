import { describe, expect, it } from 'vitest';
import { decodeEntities, fingerprint, htmlToText, looksLikeRacquetsRole, parseLocation, parseRss, toStateCode } from './text';

describe('htmlToText', () => {
  it('drops scripts/styles, keeps block breaks, decodes entities', () => {
    const html = '<html><head><title>x</title></head><body><script>var a=1</script><style>p{}</style>' +
      '<h1>Director&nbsp;of Tennis</h1><p>Smith &amp; Jones</p><ul><li>USPTA</li><li>5 yrs</li></ul></body></html>';
    const t = htmlToText(html);
    expect(t).not.toMatch(/var a|p\{\}/);
    expect(t).toContain('Director of Tennis');
    expect(t).toContain('Smith & Jones');
    expect(t).toMatch(/• USPTA\n+• 5 yrs/);
  });
  it('decodes numeric entities', () => {
    expect(decodeEntities('Men&#039;s &#x2014; ok')).toBe("Men's — ok");
  });
});

describe('fingerprint', () => {
  it('collides across word order, case, punctuation and racquet spellings', () => {
    expect(fingerprint('The Cascades Country Club', 'Tennis Director', 'tx')).toBe(fingerprint('Cascades Country Club, Inc.', 'Director of Tennis', 'TX'));
    expect(fingerprint('A Club', 'Head Rackets Pro', 'NY')).toBe(fingerprint('A Club', 'Head Racquet Professional', 'NY'));
    expect(fingerprint('Wakit Rakit', 'Padel Coach', 'TX')).toBe(fingerprint('Wak it Rak it (Premier Sport International)', 'Padel Coach', 'TX'));
  });
  it('separates different states and titles', () => {
    expect(fingerprint('A Club', 'Director of Tennis', 'NY')).not.toBe(fingerprint('A Club', 'Director of Tennis', 'NJ'));
    expect(fingerprint('A Club', 'Director of Tennis', 'NY')).not.toBe(fingerprint('A Club', 'Director of Pickleball', 'NY'));
  });
});

describe('states and locations', () => {
  it('normalizes names and codes', () => {
    expect(toStateCode('Kentucky')).toBe('KY');
    expect(toStateCode('ny')).toBe('NY');
    expect(toStateCode('Ontario')).toBeNull();
  });
  it('parses "street, city, ST, USA"', () => {
    expect(parseLocation('Cascades Country Club, Briarwood Road, Tyler, TX, USA')).toEqual({ city: 'Tyler', state: 'TX' });
    expect(parseLocation('Rye, New York')).toEqual({ city: 'Rye', state: 'NY' });
    expect(parseLocation('Toronto, ON').state).toBeNull();
  });
});

describe('parseRss', () => {
  it('reads items', () => {
    const xml = '<rss><channel><title>x</title><item><title>Director of Tennis</title><link>https://a.b/job/1/x/</link>' +
      '<description>Tyler, TX\n Club\n &lt;p&gt;hi&lt;/p&gt;</description><pubDate>Wed, 21 Oct 2026 16:55:39 -0400</pubDate></item></channel></rss>';
    const [it] = parseRss(xml);
    expect(it.title).toBe('Director of Tennis');
    expect(it.link).toBe('https://a.b/job/1/x/');
    expect(it.description).toContain('<p>hi</p>');
  });
});

describe('looksLikeRacquetsRole', () => {
  it.each([
    ['Director of Tennis', true],
    ['Head Racquet Sports Professional', true],
    ['Director of Pickleball', true],
    ['Director of Sport', true],
    ["Assistant Men's Tennis Coach", false],
    ['Las Vegas Gladiator League Ambassador (part-time)', false],
    ['Tennis Court Maintenance', false],
    ['Director of Ticket Operations | Baylor University', false],
    ['Junior Tennis Camp Counselor', false],
  ])('%s -> %s', (t, want) => expect(looksLikeRacquetsRole(t)).toBe(want));
});
