// The "come play the next one" email for a Quads event.
//
// The generic campaign update template is a status check-in ("here's where
// things stand, don't wait on your matches"). Sent as a promo it reads like a
// mail merge that lost its context: a blue club header on a Dunkin' event, a
// bare When/Divisions/Entry table, and a sign-off asking whether "something's
// off with your spot" — to a family that has no spot yet. This template says
// what a parent actually needs before clicking: what the day looks like, how a
// spot is won, what it costs, and what the sponsor is putting on the table.
//
// Pure: no DB, no env, no Resend — the source (sources.ts) resolves every
// fact and this file only lays it out, so it can be rendered in a test or a
// script with no infrastructure at all.

import type { Sponsor } from '@/config/sponsors';
import type { CampaignData, Person } from './core';

export type QuadPromoFacts = {
  title: string;
  clubName: string;
  senderName: string;
  senderTitle?: string | null;
  /** "Saturday, October 3" */
  dateLabel: string | null;
  /** ["12:00 – 2:00 PM", "2:00 – 4:00 PM"] — one entry when there's a single session */
  sessions: string[];
  /** Minutes a player is actually on court (four rounds back to back). */
  playMinutes: number;
  /** ["10 & Under", "12 & Under", "13 & Over"] */
  divisions: string[];
  /** "boys and girls" / "girls" / "boys" — null to omit */
  whoLine: string | null;
  /** "$35" or "Free" */
  feeLabel: string;
  /** "Monday, September 28" — null when registration has no close date */
  closesLabel: string | null;
  /** request_then_invite = free request, invite, 24h to pay */
  requestMode: boolean;
  /** How long an invited player has to pay before the hold lapses. */
  payWindowHours: number;
  /** The words for where these families came from — "the JTT Season-End events". */
  sourceLabel: string | null;
  signupUrl: string;
  sponsor: Sponsor | null;
};

const esc = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const DEFAULT_COLORS = {
  primary: '#1F4FA0',
  secondary: '#163670',
  ink: '#1f2937',
  cream: '#eff4fc',
  surface: '#ffffff',
};

const hours = (minutes: number) => {
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h} hour${h === 1 ? '' : 's'}` : `${minutes} minutes`;
};

export function quadPromoSubject(f: QuadPromoFacts): string {
  const bits = [f.title];
  if (f.dateLabel) bits.push(f.dateLabel);
  const s = bits.join(' — ');
  return f.sponsor?.id === 'dunkin' ? `🍩 ${s}` : `🎾 ${s}`;
}

export function quadPromoHtml(f: QuadPromoFacts, person: Person): { subject: string; html: string } {
  const c = f.sponsor?.colors ?? DEFAULT_COLORS;
  const url = person.ctaUrl || f.signupUrl;
  const sp = f.sponsor;

  const sessionLine =
    f.sessions.length >= 2
      ? `${f.sessions.slice(0, -1).join(', ')} or ${f.sessions[f.sessions.length - 1]} — pick one, ${hours(f.playMinutes)} either way`
      : f.sessions[0]
        ? `${f.sessions[0]} (${hours(f.playMinutes)} of tennis)`
        : `${hours(f.playMinutes)} of tennis`;

  const divisionsLine = f.divisions.length
    ? `${f.divisions.join(' · ')}${f.whoLine ? ` — ${f.whoLine}` : ''}`
    : f.whoLine || 'All ages';

  const feeSub =
    sp && f.feeLabel !== 'Free'
      ? ` — snacks, drinks and the prize included`
      : f.feeLabel === 'Free'
        ? ''
        : ' per player';

  const factRow = (label: string, value: string) =>
    `<tr>
      <td style="padding:7px 14px 7px 0;font-weight:700;white-space:nowrap;vertical-align:top;color:${c.ink}">${esc(label)}</td>
      <td style="padding:7px 0;color:${c.ink};opacity:.85">${esc(value)}</td>
    </tr>`;

  const facts = [
    f.dateLabel ? factRow('Date', f.dateLabel) : '',
    factRow(f.sessions.length >= 2 ? 'Sessions' : 'Time', sessionLine),
    factRow('Divisions', divisionsLine),
    factRow('Entry', `${f.feeLabel}${feeSub}`),
    factRow('Where', f.clubName),
  ].join('');

  const intro = f.sourceLabel
    ? `Your family was part of ${esc(f.sourceLabel)} with us, so you're hearing about this one first.`
    : `You've played with us before, so you're hearing about this one first.`;

  const pitch = sp
    ? `One afternoon, four matches, and ${esc(sp.name)} running the snack table.`
    : `One afternoon, four matches, done in ${hours(f.playMinutes)}.`;

  const step = (n: number, title: string, body: string) =>
    `<tr>
      <td style="width:30px;vertical-align:top;padding:6px 0">
        <div style="width:24px;height:24px;border-radius:12px;background:${c.primary};color:#fff;font-weight:700;font-size:13px;line-height:24px;text-align:center">${n}</div>
      </td>
      <td style="padding:6px 0 6px 8px;vertical-align:top">
        <div style="font-weight:700;color:${c.ink}">${title}</div>
        <div style="font-size:14px;color:${c.ink};opacity:.8">${body}</div>
      </td>
    </tr>`;

  const howToEnter = f.requestMode
    ? `<table style="border-collapse:collapse;margin:4px 0">
        ${step(1, 'Request a spot', `Free, takes a minute. Pick a division and the session you can make.`)}
        ${step(2, 'First four in a division are in', `I review the list and email you a payment link.`)}
        ${step(3, `Pay within ${f.payWindowHours} hours`, `${esc(f.feeLabel)} by card. Only a completed payment locks the spot.`)}
      </table>
      <p style="margin:10px 0 0;padding:12px 14px;background:${c.cream};border-left:4px solid ${c.primary};border-radius:0 8px 8px 0;font-size:14px;color:${c.ink}">
        <strong>Division already full? Get on the list anyway.</strong> A spot that isn't paid for within ${f.payWindowHours} hours
        goes straight to the next player in line, and a division that comes up short of four gives its court to one
        with players waiting. It costs nothing to be on the list, and the list moves.
      </p>`
    : `<p style="margin:4px 0 0;font-size:14px;color:${c.ink};opacity:.85">Sign up online, pick a division and session, and pay ${esc(f.feeLabel)} to lock the spot. First four per division are in; after that you're on the waitlist, and unpaid spots roll to the next player in line.</p>`;

  const rounds = `<table style="border-collapse:collapse;margin:4px 0;width:100%">
      ${[
        ['1', 'Singles', 'Fast4 set, no-ad scoring.'],
        ['2', 'Singles', 'A new opponent from your quad.'],
        ['3', 'Singles', 'Your last singles match sets the 1-2-3-4 ladder.'],
        ['4', 'Doubles', '1st plays with 4th against 2nd and 3rd. Same Fast4, no-ad.'],
      ]
        .map(
          ([n, t, b]) => `<tr>
            <td style="width:30px;vertical-align:top;padding:5px 0;font-weight:800;color:${c.secondary}">R${n}</td>
            <td style="padding:5px 0 5px 8px;vertical-align:top;font-size:14px;color:${c.ink}"><strong>${t}</strong> <span style="opacity:.8">— ${b}</span></td>
          </tr>`
        )
        .join('')}
    </table>
    <p style="margin:8px 0 0;font-size:14px;color:${c.ink};opacity:.85">Every player gets all four matches against players their own age. Most games won across the four rounds takes the quad.</p>`;

  const perks = sp
    ? `<table style="border-collapse:collapse;width:100%;margin:4px 0">
        ${sp.perks
          .map(
            (p) => `<tr>
              <td style="width:34px;font-size:22px;vertical-align:top;padding:5px 0">${p.emoji}</td>
              <td style="padding:5px 0 5px 6px;vertical-align:top;font-size:14px;color:${c.ink}"><strong>${esc(p.title)}.</strong> <span style="opacity:.8">${esc(p.body)}</span></td>
            </tr>`
          )
          .join('')}
      </table>`
    : '';

  const prize = sp
    ? `<div style="margin:18px 0 0;padding:16px 18px;border-radius:12px;background:${c.primary};color:#fff">
        <div style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;opacity:.85;font-weight:700">Champion's prize</div>
        <div style="font-size:18px;font-weight:800;margin-top:4px;line-height:1.3">${esc(sp.prize.headline)}</div>
        <div style="font-size:14px;margin-top:6px;opacity:.95">${esc(sp.prize.body)}</div>
      </div>`
    : '';

  const section = (heading: string, body: string) =>
    `<div style="margin-top:22px">
      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;font-weight:700;color:${c.secondary};margin-bottom:6px">${esc(heading)}</div>
      ${body}
    </div>`;

  const cta = `<div style="margin:24px 0 8px;text-align:center">
      <a href="${url}" style="display:inline-block;background:${c.primary};color:#fff;font-weight:800;text-decoration:none;padding:15px 30px;border-radius:999px;font-size:17px">${
        f.requestMode ? 'Request a spot' : 'Sign up'
      } →</a>
      ${
        f.closesLabel
          ? `<div style="font-size:13px;color:${c.ink};opacity:.75;margin-top:10px">${f.requestMode ? 'Requests' : 'Registration'} closes <strong>${esc(f.closesLabel)}</strong>. Spots go in signup order, so sooner is better.</div>`
          : ''
      }
      <div style="font-size:12px;color:${c.ink};opacity:.6;margin-top:6px"><a href="${url}" style="color:${c.primary}">${esc(url.replace(/^https?:\/\//, ''))}</a></div>
    </div>`;

  const header = sp
    ? `<div style="background:${c.primary};background-image:linear-gradient(135deg,${c.primary} 0%,${c.secondary} 100%);border-radius:14px 14px 0 0;padding:26px 28px;color:#fff">
        <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;opacity:.9">${esc(f.clubName)}</div>
        <div style="font-size:26px;font-weight:900;line-height:1.15;margin-top:8px">${esc(f.title)}</div>
        <div style="margin-top:10px;display:inline-block;background:rgba(255,255,255,.18);border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700">${esc(sp.presentedBy)} ${esc(sp.name)}</div>
        ${f.dateLabel ? `<div style="font-size:14px;font-weight:700;margin-top:12px">${esc(f.dateLabel)} · four matches in ${hours(f.playMinutes)}</div>` : ''}
      </div>`
    : `<div style="background:${c.primary};background-image:linear-gradient(160deg,${c.primary},${c.secondary});border-radius:14px 14px 0 0;padding:22px 28px;color:#fff">
        <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;color:#FFD24F">${esc(f.clubName)}</div>
        <div style="font-size:24px;font-weight:900;line-height:1.15;margin-top:6px">${esc(f.title)}</div>
        ${f.dateLabel ? `<div style="font-size:14px;font-weight:700;margin-top:8px">${esc(f.dateLabel)}</div>` : ''}
      </div>`;

  const inner = `
    <p style="margin:0 0 12px">Hi ${esc(person.firstName)} —</p>
    <p style="margin:0 0 12px">${intro} ${pitch}</p>
    <table style="border-collapse:collapse;margin:14px 0 4px;background:${c.cream};border-radius:10px;padding:8px 14px;width:100%">${facts}</table>
    ${section('How it plays', rounds)}
    ${section(f.requestMode ? 'How to get a spot' : 'How to enter', howToEnter)}
    ${sp ? section(`What ${esc(sp.name)} is bringing`, perks) : ''}
    ${prize}
    ${cta}
    <p style="margin:22px 0 0">Questions? Just reply — this comes straight to me.</p>
    <p style="margin:4px 0 0">— ${esc(f.senderName)}${f.senderTitle ? `, ${esc(f.senderTitle)}` : ''}</p>
    ${sp ? `<p style="margin:20px 0 0;font-size:11px;color:${c.ink};opacity:.55">${esc(sp.legal)}</p>` : ''}`;

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:${c.ink};line-height:1.55;max-width:640px;margin:0 auto">
    ${header}
    <div style="background:${c.surface};border:1px solid rgba(0,0,0,.09);border-top:none;border-radius:0 0 14px 14px;padding:22px 28px">${inner}</div>
  </div>`;

  return { subject: quadPromoSubject(f), html };
}

/** Adapter so the campaign engine can swap this in for the generic update template. */
export function quadPromoRenderer(f: QuadPromoFacts): NonNullable<CampaignData['renderUpdate']> {
  return (_d, person) => quadPromoHtml(f, person);
}

