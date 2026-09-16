import { describe, it, expect } from 'vitest';
import { crmAccessFor, initialsFor, type CrmUserRow } from './access';

/**
 * The CRM's whole security story is this function plus is_crm_user() in SQL.
 * Every case below is a way someone could have got in who must not.
 */

const OWNERS = ['darrinjco@gmail.com'];

const row = (over: Partial<CrmUserRow> = {}): CrmUserRow => ({
  email: 'kevin@example.com',
  user_id: null,
  full_name: 'Kevin Carey',
  initials: null,
  active: true,
  ...over,
});

describe('crmAccessFor', () => {
  it('lets an active allowlist row in by email before they have ever signed in', () => {
    const a = crmAccessFor({ userId: 'u1', email: 'kevin@example.com' }, [row()], OWNERS);
    expect(a.allowed).toBe(true);
    expect(a.via).toBe('allowlist');
    expect(a.row?.full_name).toBe('Kevin Carey');
  });

  it('lets them in by user_id once linked, even if their account email changed', () => {
    const a = crmAccessFor(
      { userId: 'u1', email: 'kevin.carey@newdomain.com' },
      [row({ user_id: 'u1' })],
      OWNERS,
    );
    expect(a.allowed).toBe(true);
    expect(a.via).toBe('allowlist');
  });

  it('is case- and whitespace-insensitive about the email', () => {
    for (const email of ['KEVIN@EXAMPLE.COM', '  Kevin@Example.com  ']) {
      expect(crmAccessFor({ userId: 'u1', email }, [row()], OWNERS).allowed).toBe(true);
    }
  });

  it('refuses a deactivated row', () => {
    expect(crmAccessFor({ userId: 'u1', email: 'kevin@example.com' }, [row({ active: false })], OWNERS).allowed).toBe(
      false,
    );
  });

  it('refuses everyone not on the list — including a club owner with every role there is', () => {
    for (const email of ['hunterhg@comcast.net', 'mary.benin@gmail.com', 'someone@clubmode.ai']) {
      expect(crmAccessFor({ userId: 'u9', email }, [row()], OWNERS).allowed).toBe(false);
    }
  });

  it('lets a platform owner in with an empty allowlist — a bad --remove must not lock us out', () => {
    const a = crmAccessFor({ userId: 'u1', email: 'darrinjco@gmail.com' }, [], OWNERS);
    expect(a.allowed).toBe(true);
    expect(a.via).toBe('platform_owner');
    expect(a.row).toBeNull();
  });

  /*
   * The one that would be a silent disaster: a signed-out request has a null
   * user id, and a freshly added allowlist row has a null user_id. If those
   * were ever compared with ==, anonymous would BE Kevin.
   */
  it('refuses a signed-out caller, even against a row whose user_id is also null', () => {
    expect(crmAccessFor({ userId: null, email: 'kevin@example.com' }, [row()], OWNERS).allowed).toBe(false);
    expect(crmAccessFor({ userId: null, email: null }, [row({ user_id: null })], OWNERS).allowed).toBe(false);
    expect(crmAccessFor({ userId: null, email: 'darrinjco@gmail.com' }, [], OWNERS).allowed).toBe(false);
  });

  it('refuses a signed-in user with no email against a row with no user_id', () => {
    expect(crmAccessFor({ userId: 'u1', email: null }, [row()], OWNERS).allowed).toBe(false);
  });

  it('stamps the lower-cased email for activity rows', () => {
    expect(crmAccessFor({ userId: 'u1', email: 'Kevin@Example.com' }, [row()], OWNERS).email).toBe(
      'kevin@example.com',
    );
  });
});

describe('initialsFor', () => {
  it('uses an explicit value over a derived one', () => {
    expect(initialsFor({ initials: 'KC2', full_name: 'Kevin Carey' })).toBe('KC2');
  });

  it('takes the first and last word of a name', () => {
    expect(initialsFor({ full_name: 'Darrin Cohen' })).toBe('DC');
    expect(initialsFor({ full_name: 'Mary Jane Benin' })).toBe('MB');
  });

  it('falls back to the email, then to a question mark — never to blank', () => {
    expect(initialsFor({ full_name: null, email: 'darrinjco@gmail.com' })).toBe('DA');
    expect(initialsFor({ full_name: '   ', email: null })).toBe('?');
    expect(initialsFor(null)).toBe('?');
  });
});
