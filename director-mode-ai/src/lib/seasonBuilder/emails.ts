/**
 * Season Builder email + newsletter copy. One template per message, written in
 * the director's voice: short, plain, and the ask up front.
 */
import {
  type Answer, type Campaign, SLOT_PHRASE, SLOT_SHORT, fmtDate, fmtMonth, monthEnd, ntrpLabel,
} from './shared';

export const USTA_RENEW_URL = 'https://www.usta.com/en/home/membership.html';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const P = 'font-size:16px;line-height:1.55;margin:0 0 14px';

function shell(clubName: string, body: string): string {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;padding:8px">
  <div style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#64748b;margin:0 0 14px">${esc(clubName)}</div>
  ${body}
</div>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:22px 0"><a href="${href}" style="display:inline-block;background:#002838;color:#ffffff;font-weight:700;padding:14px 26px;border-radius:10px;text-decoration:none;font-size:17px">${esc(label)}</a></p>`;
}

/** "Women's 40 & Over — daytime (...) or nights & weekends (...)" lines. */
function leagueList(c: Campaign): string {
  return c.leagues
    .map((l) => {
      const slots = l.slots.map((s) => SLOT_PHRASE[s]).join(' or ');
      return `<li style="margin:0 0 6px"><b>${esc(l.label)}</b> &mdash; ${esc(slots)}</li>`;
    })
    .join('');
}

function seasonLine(c: Campaign): string {
  if (!c.season_start || !c.season_end) return '';
  return `The regular season runs about <b>${fmtDate(c.season_start, { month: 'short', day: 'numeric' })} &ndash; ${fmtDate(c.season_end, { month: 'short', day: 'numeric' })}</b>.`;
}

function signOff(c: Campaign): string {
  return c.sign_off ? `<p style="${P}">Thanks,<br>${esc(c.sign_off).replace(/,\s*/, '<br>')}</p>` : `<p style="${P}">Thanks!</p>`;
}

/**
 * Lead with their first name: a household inbox gets one email per adult, and
 * the name is how the family tells whose link is whose.
 */
export function inviteSubject(c: Campaign, first?: string): string {
  const by = c.reply_by ? ` (reply by ${fmtDate(c.reply_by, { weekday: 'short', month: 'short', day: 'numeric' })})` : '';
  return `${first ? `${first}, ` : ''}USTA winter teams — are you in?${by}`;
}

export function inviteHtml(c: Campaign, clubName: string, firstName: string, link: string): string {
  const opens = c.registration_opens ? ` starting <b>${fmtDate(c.registration_opens, { weekday: 'long', month: 'long', day: 'numeric' })}</b>` : '';
  const by = c.reply_by ? `<b>${fmtDate(c.reply_by, { weekday: 'long', month: 'long', day: 'numeric' })}</b>` : 'soon';
  return shell(clubName, `
  <p style="${P}">Hi ${esc(firstName)},</p>
  <p style="${P}">We&rsquo;ll be registering our USTA teams${opens}. Before we do, we need an accurate head count: who wants to play, at what level, and who&rsquo;d like to captain a team.</p>
  <ul style="padding-left:20px;${P}">${leagueList(c)}</ul>
  ${seasonLine(c) ? `<p style="${P}">${seasonLine(c)}</p>` : ''}
  ${c.intro ? `<p style="${P}">${esc(c.intro)}</p>` : ''}
  ${button(link, 'Count me in →')}
  <p style="${P}">It takes about a minute. Please answer by ${by}. Not playing this season? Tap the button and say so &mdash; that helps us too.</p>
  ${signOff(c)}`);
}

/** A readable summary of what they told us, for the confirmation and the thank-you screen. */
export function answerSummary(c: Campaign, a: Answer): string[] {
  if (!a.interested) return ['Not playing USTA this season.'];
  const lines = a.choices.map((ch) => {
    const l = c.leagues.find((x) => x.key === ch.league);
    return `${l?.label ?? ch.league} — ${SLOT_SHORT[ch.slot]}`;
  });
  lines.push(`Level: ${ntrpLabel(a.ntrp)}`);
  lines.push(a.role === 'captain' ? 'Would like to captain (and play)' : 'Just play');
  lines.push(
    a.usta_unknown || !a.usta_expires
      ? 'USTA membership: not sure'
      : `USTA membership expires: ${fmtMonth(monthEnd(a.usta_expires))}`,
  );
  return lines;
}

export function confirmSubject(a: Answer, needsRenewal: boolean): string {
  if (!a.interested) return 'Got it — thanks for letting us know';
  return needsRenewal ? 'You’re on the list — one thing to do: renew USTA' : 'You’re on the list for USTA winter teams';
}

export function confirmHtml(
  c: Campaign, clubName: string, firstName: string, a: Answer, needsRenewal: boolean, link: string,
): string {
  const latest = a.choices
    .map((ch) => c.leagues.find((l) => l.key === ch.league)?.valid_through)
    .filter(Boolean)
    .sort()
    .pop() as string | undefined;
  const renew = needsRenewal
    ? `<div style="border:2px solid #f59e0b;background:#fffbeb;border-radius:10px;padding:14px 16px;margin:0 0 16px">
        <p style="${P};margin-bottom:8px"><b>Please renew your USTA membership.</b></p>
        <p style="${P};margin-bottom:8px">${
          a.usta_unknown || !a.usta_expires
            ? 'You weren&rsquo;t sure when yours expires.'
            : `Yours expires in <b>${fmtMonth(monthEnd(a.usta_expires))}</b>.`
        } It has to be current through ${latest ? `<b>${fmtDate(latest, { month: 'long', day: 'numeric', year: 'numeric' })}</b>` : 'the end of the season'} or you can&rsquo;t be added to a roster.</p>
        <p style="margin:0"><a href="${USTA_RENEW_URL}" style="color:#b45309;font-weight:700">Check or renew at USTA.com &rarr;</a></p>
      </div>`
    : '';
  const body = a.interested
    ? `<p style="${P}">Thanks ${esc(firstName)} &mdash; you&rsquo;re on the list. Here&rsquo;s what you told us:</p>
       <ul style="padding-left:20px;${P}">${answerSummary(c, a).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
       ${renew}
       <p style="${P}">We&rsquo;ll be in touch about teams${c.registration_opens ? ` when registration opens ${fmtDate(c.registration_opens, { month: 'short', day: 'numeric' })}` : ''}. Need to change something? <a href="${link}">Update your answers</a>.</p>`
    : `<p style="${P}">Thanks ${esc(firstName)} &mdash; we&rsquo;ve got you down as not playing USTA this season. Change your mind? <a href="${link}">Update your answer</a> any time.</p>`;
  return shell(clubName, body + signOff(c));
}

/** Plain text for Nikki's newsletter / a Constant Contact blast. Uses the PUBLIC link. */
export function newsletterCopy(c: Campaign, publicLink: string): string {
  const opens = c.registration_opens ? ` starting ${fmtDate(c.registration_opens, { weekday: 'long', month: 'long', day: 'numeric' })}` : '';
  const by = c.reply_by ? fmtDate(c.reply_by, { weekday: 'long', month: 'long', day: 'numeric' }) : 'soon';
  const leagues = c.leagues
    .map((l) => `• ${l.label} — ${l.slots.map((s) => SLOT_PHRASE[s]).join(' or ')}`)
    .join('\n');
  const season = c.season_start && c.season_end
    ? `\nThe regular season runs about ${fmtDate(c.season_start, { month: 'short', day: 'numeric' })} – ${fmtDate(c.season_end, { month: 'short', day: 'numeric' })}.\n`
    : '\n';
  return `USTA Winter Teams — Are You In?

We'll be registering our USTA teams${opens}. Before we do, we need an accurate head count: who wants to play, at what level, and who'd like to captain a team.

${leagues}
${season}
Sign up here (takes about a minute): ${publicLink}

Please answer by ${by}.${c.sign_off ? `\n\n${c.sign_off}` : ''}`;
}
