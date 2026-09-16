import { describe, it, expect } from 'vitest';
import { parsePastedContacts } from './pasteContacts';

/**
 * The fixtures are the real shapes: a tab-separated paste out of a table, a
 * space-separated one out of a rendered page, and the mail-client "Name
 * <email>" form.
 */

describe('parsePastedContacts', () => {
  it('reads a tab-separated paste: name, title, email', () => {
    const { contacts } = parsePastedContacts(
      'Mary Benin\tPresident\tmary.benin@gmail.com\nBert Sebilia\tVice President\tsebilia@comcast.net',
    );
    expect(contacts).toEqual([
      { full_name: 'Mary Benin', title: 'President', email: 'mary.benin@gmail.com', phone: null },
      { full_name: 'Bert Sebilia', title: 'Vice President', email: 'sebilia@comcast.net', phone: null },
    ]);
  });

  it('reads a run of two or more spaces, which is what a copied web table gives you', () => {
    const { contacts } = parsePastedContacts('Bart Ostro    Treasurer    bostro@pacbell.net');
    expect(contacts[0]).toEqual({
      full_name: 'Bart Ostro',
      title: 'Treasurer',
      email: 'bostro@pacbell.net',
      phone: null,
    });
  });

  it('keeps a single space inside a name when the line is tabbed', () => {
    const { contacts } = parsePastedContacts('Richard Schulman\trichard.schulman@gmail.com');
    expect(contacts[0].full_name).toBe('Richard Schulman');
    expect(contacts[0].email).toBe('richard.schulman@gmail.com');
  });

  it('reads the "Name <email>" form a mail client pastes', () => {
    const { contacts } = parsePastedContacts('Hunter Gallaway <hunterhg@comcast.net>');
    expect(contacts[0]).toEqual({
      full_name: 'Hunter Gallaway',
      title: null,
      email: 'hunterhg@comcast.net',
      phone: null,
    });
  });

  it('reads a name and email separated by one space', () => {
    const { contacts } = parsePastedContacts('Chris Slee slee.tennis@gmail.com');
    expect(contacts[0].full_name).toBe('Chris Slee');
    expect(contacts[0].email).toBe('slee.tennis@gmail.com');
  });

  /*
   * Half of a volunteer board publishes a title and no address. Dropping those
   * lines would lose exactly the people a rep needs to go and ask about.
   */
  it('keeps a person with no email', () => {
    const { contacts } = parsePastedContacts('Pat Baughman\tCaptain, Women’s 50+/55+');
    expect(contacts[0]).toEqual({
      full_name: 'Pat Baughman',
      title: 'Captain, Women’s 50+/55+',
      email: null,
      phone: null,
    });
  });

  it('picks a phone out of whichever column it is in', () => {
    const { contacts } = parsePastedContacts('Eugenio Ovalle\tTeaching Professional\t925-932-6551');
    expect(contacts[0].phone).toBe('925-932-6551');
    expect(contacts[0].full_name).toBe('Eugenio Ovalle');
    expect(contacts[0].title).toBe('Teaching Professional');
  });

  it('does not mistake a name for a phone number', () => {
    const { contacts } = parsePastedContacts('Hal Kushins\tPresident\t(925) 818 5941');
    expect(contacts[0].full_name).toBe('Hal Kushins');
    expect(contacts[0].phone).toBe('(925) 818 5941');
  });

  it('tolerates any column order', () => {
    const { contacts } = parsePastedContacts('dwonga.wong@gmail.com\tDanny Wong\tVice President');
    expect(contacts[0].full_name).toBe('Danny Wong');
    expect(contacts[0].email).toBe('dwonga.wong@gmail.com');
  });

  it('lower-cases the address, because a board page shouts sometimes', () => {
    const { contacts } = parsePastedContacts('Becky Reiss\tREBECCAREISS@YAHOO.COM');
    expect(contacts[0].email).toBe('rebeccareiss@yahoo.com');
  });

  it('drops a line with no name and reports it, rather than inventing a person', () => {
    const { contacts, skipped } = parsePastedContacts(
      'Mary Benin\tmary.benin@gmail.com\nwebmaster@rossmoor.com\n',
    );
    expect(contacts).toHaveLength(1);
    expect(skipped).toEqual(['webmaster@rossmoor.com']);
  });

  it('ignores blank lines and dashes used as placeholders', () => {
    const { contacts } = parsePastedContacts('\n\nDiane Dauner\tTreasurer\t—\n\n');
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toEqual({ full_name: 'Diane Dauner', title: 'Treasurer', email: null, phone: null });
  });

  it('keeps the first of two lines about the same person', () => {
    const { contacts } = parsePastedContacts('Bob Semar\tParliamentarian\nBob Semar\tDirector');
    expect(contacts).toHaveLength(1);
    expect(contacts[0].title).toBe('Parliamentarian');
  });

  it('never throws on rubbish', () => {
    for (const junk of ['', '   ', '\t\t\t', '@@@\n<<<>>>', 'a'.repeat(5000)]) {
      expect(() => parsePastedContacts(junk)).not.toThrow();
    }
  });
});
