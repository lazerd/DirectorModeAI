import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAYMENTS,
  paymentOffer,
  paymentSentence,
  type ClubPayments,
} from './payments';

const club = (over: Partial<ClubPayments> = {}): ClubPayments => ({
  ...DEFAULT_PAYMENTS,
  ...over,
});

const LINK = 'https://square.link/u/abc123';
const OWN = 'https://square.link/u/classonly';

describe('paymentOffer', () => {
  it('asks for nothing when nothing is owed', () => {
    expect(
      paymentOffer({ amountCents: 0, clubPayments: club({ payment_link: LINK }), surface: 'court' }),
    ).toEqual({ kind: 'free' });
  });

  it('uses the club’s default link', () => {
    const offer = paymentOffer({
      amountCents: 2400,
      clubPayments: club({ payment_link: LINK }),
      surface: 'court',
    });
    expect(offer).toMatchObject({ kind: 'link', url: LINK, label: 'Pay now' });
  });

  it('lets a class’s own link win over the club default', () => {
    const offer = paymentOffer({
      amountCents: 24000,
      clubPayments: club({ payment_link: LINK }),
      surface: 'program',
      ownLink: OWN,
    });
    expect(offer).toMatchObject({ kind: 'link', url: OWN });
  });

  it('honours a class’s own link even where the club switched the surface off', () => {
    // Setting it on the class IS the club saying yes for that class.
    const offer = paymentOffer({
      amountCents: 24000,
      clubPayments: club({ payment_link: LINK, link_on_programs: false }),
      surface: 'program',
      ownLink: OWN,
    });
    expect(offer).toMatchObject({ kind: 'link', url: OWN });
  });

  it('respects a club that wants its link on classes but not on court time', () => {
    const payments = club({ payment_link: LINK, link_on_courts: false });
    expect(
      paymentOffer({ amountCents: 2400, clubPayments: payments, surface: 'court' }).kind,
    ).toBe('in_person');
    expect(
      paymentOffer({ amountCents: 24000, clubPayments: payments, surface: 'program' }).kind,
    ).toBe('link');
  });

  it('falls back to paying in person when the club has no link', () => {
    expect(paymentOffer({ amountCents: 2400, clubPayments: club(), surface: 'court' })).toEqual({
      kind: 'in_person',
      note: null,
    });
  });

  it('refuses a link that is not a link', () => {
    // isPaymentLink is the same gate the event forms use, so a half-typed
    // value cannot become a button pointing nowhere.
    for (const bad of ['square.link/u/abc', 'not a url', 'javascript:alert(1)', '   ']) {
      expect(
        paymentOffer({ amountCents: 2400, clubPayments: club({ payment_link: bad }), surface: 'court' })
          .kind,
      ).toBe('in_person');
    }
  });

  it('uses the club’s own button wording', () => {
    // A club whose link is Venmo should not have a button reading "Pay by card".
    const offer = paymentOffer({
      amountCents: 2400,
      clubPayments: club({ payment_link: LINK, payment_link_label: 'Pay on Venmo' }),
      surface: 'court',
    });
    expect(offer).toMatchObject({ label: 'Pay on Venmo' });
  });

  it('ignores an all-whitespace label rather than rendering a blank button', () => {
    const offer = paymentOffer({
      amountCents: 2400,
      clubPayments: club({ payment_link: LINK, payment_link_label: '   ' }),
      surface: 'court',
    });
    expect(offer).toMatchObject({ label: 'Pay now' });
  });
});

describe('paymentSentence', () => {
  it('says nothing about money when none is owed', () => {
    expect(paymentSentence({ kind: 'free' }, 'court')).toBe('');
  });

  it('matches the wording to the surface', () => {
    const inPerson = { kind: 'in_person' as const, note: null };
    expect(paymentSentence(inPerson, 'court')).toMatch(/desk/i);
    expect(paymentSentence(inPerson, 'program')).toMatch(/in touch about payment/i);
  });

  it('lets the club’s own note replace the default', () => {
    expect(
      paymentSentence(
        { kind: 'link', url: LINK, label: 'Pay now', note: 'Pay within 48 hours.' },
        'court',
      ),
    ).toBe('Pay within 48 hours.');
  });
});
