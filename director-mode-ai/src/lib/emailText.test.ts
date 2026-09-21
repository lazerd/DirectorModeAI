import { describe, it, expect } from 'vitest';
import { htmlToText, clubFromLine } from './emailText';

/**
 * The text half of every ClubMode email is derived, not written, so these tests
 * are the only thing standing between a filter-friendly message and one that
 * reads as line noise in a text-only client.
 */
describe('htmlToText', () => {
  it('keeps a button as words plus its destination', () => {
    const out = htmlToText(
      `<p><a href="https://clubmode.ai/play/i/abc?a=yes" style="padding:18px">Yes, I&rsquo;m in</a></p>`,
    );
    expect(out).toBe("Yes, I'm in (https://clubmode.ai/play/i/abc?a=yes)");
  });

  it('does not repeat a link whose text is already the URL', () => {
    const out = htmlToText('<a href="https://clubmode.ai/x">https://clubmode.ai/x</a>');
    expect(out).toBe('https://clubmode.ai/x');
  });

  it('reads a details table as label: value lines', () => {
    const out = htmlToText(`
      <table>
        <tr><td>When</td><td>Tuesday, September 22 at 1:00pm</td></tr>
        <tr><td>Playing</td><td>Walden B., Gabrial F.</td></tr>
      </table>`);
    expect(out.split('\n')).toEqual([
      'When: Tuesday, September 22 at 1:00pm',
      'Playing: Walden B., Gabrial F.',
    ]);
  });

  it('decodes the entities our templates emit', () => {
    expect(htmlToText('<p>3.0&ndash;3.5 &amp; up &middot; &ldquo;hi&rdquo;</p>')).toBe('3.0-3.5 & up · "hi"');
  });

  it('reads a fraction as a fraction', () => {
    // durationLabel writes the character itself, and "11/2 hours" is nonsense.
    expect(htmlToText('<p>1½ hours</p>')).toBe('1 1/2 hours');
  });

  it('drops style blocks and collapses the whitespace HTML mail is full of', () => {
    const out = htmlToText(`<style>p{color:red}</style>
      <div>
        <p>One</p>


        <p>Two</p>
      </div>`);
    expect(out).toBe('One\n\nTwo');
  });

  it('survives an empty body', () => {
    expect(htmlToText('')).toBe('');
  });
});

describe('clubFromLine', () => {
  it('puts the club in the inbox, on our sending address', () => {
    expect(clubFromLine('Sleepy Hollow Swim & Tennis Club')).toBe(
      'Sleepy Hollow Swim & Tennis Club <noreply@mail.clubmode.ai>',
    );
  });

  it('will not let a club name write its own header', () => {
    // Quotes, angle brackets and CRLF are gone, so an injected Bcc is only
    // text inside the display name and the address is still ours.
    const line = clubFromLine('Evil "Club" <attacker@example.com>\r\nBcc: x@y.z');
    expect(line).not.toMatch(/[\r\n"]/);
    expect(line.endsWith(' <noreply@mail.clubmode.ai>')).toBe(true);
    expect(line.match(/</g)?.length).toBe(1);
  });

  it('RFC 2047 encodes a name that is not plain ASCII', () => {
    expect(clubFromLine('Club Münster')).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <noreply@mail\.clubmode\.ai>$/);
  });

  it('falls back rather than sending an empty display name', () => {
    expect(clubFromLine('   ')).toBe('ClubMode <noreply@mail.clubmode.ai>');
  });
});
