/**
 * Builds the JTT season-end tournament sign-up email that the director sends to
 * coaches (who forward it to their players' families). Mirrors the results
 * email, but instead of a match-day recap it carries the per-division public
 * registration links.
 */

export type TournamentDivision = {
  label: string; // "10U", "12U", "13 & Over", "Open"
  when: string; // "Tue, July 21 · 1:00–4:00 PM"
  location: string; // "Orinda Country Club"
  url: string; // full public signup URL
};

export type TournamentEmailInput = {
  leagueName: string;
  divisions: TournamentDivision[];
  entryFeeLabel: string; // "$20"
  note?: string | null;
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildJTTTournamentEmail(input: TournamentEmailInput): {
  subject: string;
  html: string;
} {
  const { divisions, entryFeeLabel, note } = input;
  const subject = 'Lamorinda JTT Season-End Tournament — sign-ups open (please forward to your players)';

  const noteBlock = note
    ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:12px 16px;margin:0 0 18px;color:#92400e;font-size:14px">${esc(
        note
      )}</div>`
    : '';

  const cards = divisions
    .map(
      (d) => `
      <tr><td style="padding:0 0 12px">
        <div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px">
          <div style="font-weight:700;font-size:16px;color:#0f172a">${esc(d.label)}</div>
          <div style="color:#475569;font-size:14px;margin:2px 0 10px">${esc(d.when)} · ${esc(d.location)}</div>
          <a href="${esc(d.url)}" style="display:inline-block;background:#D3FB52;color:#001820;font-weight:700;text-decoration:none;padding:9px 18px;border-radius:8px;font-size:14px">Sign up →</a>
          <div style="color:#94a3b8;font-size:12px;margin-top:8px;word-break:break-all">${esc(d.url)}</div>
        </div>
      </td></tr>`
    )
    .join('');

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9">
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a;line-height:1.5;padding:16px">
    <div style="background:#001820;border-radius:16px 16px 0 0;padding:28px 24px">
      <div style="color:#D3FB52;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700">Lamorinda JTT · Summer 2026</div>
      <div style="color:#ffffff;font-size:26px;font-weight:800;margin-top:6px">Season-End Tournament</div>
      <div style="color:#9fb3bd;font-size:15px;margin-top:4px">Sign-ups are open — please forward to your players</div>
    </div>

    <div style="background:#ffffff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;padding:24px">
      ${noteBlock}
      <p style="margin:0 0 16px">Hi coaches,</p>
      <p style="margin:0 0 16px">To wrap up the Lamorinda JTT summer season, we're running a season-ending tournament for all league participants — four divisions matching the regular season. Please forward this to your players' families so they can register.</p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;margin:0 0 22px">
        <div style="font-weight:700;margin-bottom:8px">How it works</div>
        <ul style="margin:0;padding-left:20px;color:#334155">
          <li style="margin-bottom:6px"><b>${esc(entryFeeLabel)} entry fee per player</b>, paid online at sign-up (secure checkout).</li>
          <li style="margin-bottom:6px">Each division runs <b>Compass draws of 8</b>, seeded by regular-season strength — the top 8 players go in the <b>A flight</b>, the next 8 in the <b>B flight</b>, and so on, so every kid plays others at their level.</li>
          <li style="margin-bottom:6px">Parents register each child and pay online using the division link below.</li>
          <li>Registration closes <b>Wednesday, July 15 at midnight</b> — sign up before then to be included in the draws.</li>
        </ul>
      </div>

      <div style="font-weight:700;font-size:15px;margin:0 0 12px">Divisions &amp; sign-up links</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate">${cards}</table>

      <p style="margin:20px 0 16px">Please forward to your players and encourage them to sign up early. Questions? Just reply to this email.</p>
      <p style="margin:0">Thanks,<br><b>Sleepy Hollow Tennis</b></p>
    </div>
  </div>
</body></html>`;

  return { subject, html };
}

// The 4 season-end division events (fixed for Summer 2026). Slugs match the
// public /tournaments/[slug] pages; the route turns these into full URLs.
export type SeasonEndDivision = { label: string; when: string; location: string; slug: string };

export const SEASON_END_DIVISIONS: SeasonEndDivision[] = [
  { label: '10U', when: 'Tue, July 21 · 1:00–4:00 PM', location: 'Orinda Country Club', slug: 'jtt-season-end-10u' },
  { label: '12U', when: 'Tue, July 21 · 1:00–4:00 PM', location: 'Sleepy Hollow', slug: 'jtt-season-end-12u' },
  { label: '13 & Over', when: 'Tue, July 21 · 1:00–4:00 PM', location: 'Moraga Country Club', slug: 'jtt-season-end-13o' },
  { label: 'Open', when: 'Thu, July 23', location: 'Moraga Country Club', slug: 'jtt-season-end-open' },
];
