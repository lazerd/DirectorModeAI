import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { APP_HOST, APP_URL } from '@/lib/appUrl';
import { ensureSpaces, getClubById, getSettings, spaceRules, type SpaceRow } from '@/lib/checkin/server';
import PrintButton from './PrintButton';

/*
 * The printable sign kit: one letter-size page per sign.
 *
 * QR codes are rendered here on the server as inline SVG, so a sign prints
 * sharp at any size and the page works with no client JavaScript at all
 * (PrintButton is just window.print). Each sign carries a short typed URL
 * under the code for the phone whose camera will not cooperate.
 *
 * Printing: the app's rail and banners are hidden with a print stylesheet that
 * shows only #checkin-signs, rather than a second layout, so this stays an
 * ordinary /run page behind the ordinary staff gate.
 */

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Print check-in signs — ClubMode' };

const PRINT_CSS = `
@page { size: letter portrait; margin: 0; }
.sign { width: 8.5in; height: 11in; box-sizing: border-box; padding: 0.6in 0.7in; background: #fff; color: #0b1a17;
  display: flex; flex-direction: column; align-items: center; text-align: center; font-family: Arial, Helvetica, sans-serif;
  margin: 0 auto 24px; box-shadow: 0 2px 16px rgba(0,0,0,.35); overflow: hidden; }
.sign .club { display: flex; align-items: center; gap: 14px; font-size: 26px; font-weight: 700; color: #33463f; }
.sign .club img { height: 64px; width: 64px; object-fit: contain; }
.sign h1 { font-size: 104px; line-height: 1; margin: 0.28in 0 0; font-weight: 900; letter-spacing: -1px; }
.sign .cta { font-size: 42px; font-weight: 800; margin-top: 0.14in; color: #0f5f6b; }
.sign .qr { width: 5.1in; height: 5.1in; margin-top: 0.3in; }
.sign .qr svg { width: 100%; height: 100%; display: block; }
.sign .url { font-size: 28px; font-weight: 700; margin-top: 0.16in; font-family: 'Courier New', monospace; }
.sign .rules { margin-top: auto; font-size: 22px; line-height: 1.4; color: #33463f; }
.sign .how { font-size: 20px; color: #5b6b66; margin-top: 6px; }
@media screen and (max-width: 900px) { .sign { zoom: 0.42; } }
@media print {
  body * { visibility: hidden !important; }
  #checkin-signs, #checkin-signs * { visibility: visible !important; }
  #checkin-signs { position: absolute; left: 0; top: 0; width: 8.5in; }
  .sign { margin: 0; box-shadow: none; page-break-after: always; break-after: page; }
  .no-print { display: none !important; }
}
`;

function signCopy(space: SpaceRow): { title: string; cta: string } {
  if (space.kind === 'kiosk') return { title: 'Wait list', cta: 'Courts busy? Scan to join the line' };
  if (space.kind === 'court') return { title: space.name, cta: 'Scan to start your time' };
  if (space.kind === 'pool') return { title: space.name, cta: 'Scan to check in (and your guests)' };
  return { title: space.name, cta: 'Scan to check in' };
}

export default async function SignsPage({ searchParams }: { searchParams: Promise<{ space?: string }> }) {
  const ctx = await requireStaffForClub();
  if ('error' in ctx) redirect('/login?redirect=/run/checkin/signs');
  const club = await getClubById(ctx.club.id);
  if (!club) redirect('/run/checkin');

  await ensureSpaces(club.id);
  const { space: only } = await searchParams;
  const [settings, { data }] = await Promise.all([
    getSettings(club.id),
    ctx.db.from('checkin_spaces').select('*').eq('club_id', club.id).eq('active', true).order('display_order'),
  ]);
  const all = (data as SpaceRow[] | null) ?? [];
  // Kiosk first, then courts in order, then gates.
  const ordered = [
    ...all.filter((s) => s.kind === 'kiosk'),
    ...all.filter((s) => s.kind === 'court'),
    ...all.filter((s) => s.kind !== 'kiosk' && s.kind !== 'court'),
  ].filter((s) => !only || s.id === only);

  const signs = await Promise.all(
    ordered.map(async (s) => ({
      space: s,
      svg: await QRCode.toString(`${APP_URL}/q/${s.token}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
    })),
  );

  return (
    <div className="min-h-screen bg-[#001820] p-4 pt-20 md:p-10">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="no-print mb-6 flex max-w-3xl flex-wrap items-center justify-between gap-3 text-white">
        <div>
          <h1 className="font-display text-3xl">Check-in signs</h1>
          <p className="text-white/60">
            {signs.length} {signs.length === 1 ? 'sign' : 'signs'}, letter size. Laminate them or use a sheet protector; a zip tie through the corners holds them on a fence.
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/run/checkin" className="rounded-xl border border-white/20 px-4 py-2 font-semibold">
            Back
          </a>
          <PrintButton />
        </div>
      </div>

      <div id="checkin-signs">
        {signs.map(({ space, svg }) => {
          const copy = signCopy(space);
          const rules = spaceRules(settings, space);
          return (
            <section key={space.id} className="sign">
              <div className="club">
                {club.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={club.logo_url} alt="" />
                ) : null}
                <span>{club.name}</span>
              </div>
              <h1>{copy.title}</h1>
              <div className="cta">{copy.cta}</div>
              <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
              <div className="url">
                {APP_HOST}/q/{space.token}
              </div>
              <div className="rules">
                {space.kind === 'court' || space.kind === 'kiosk' ? (
                  <>
                    <div>
                      Singles {rules.singlesMinutes} min · Doubles {rules.doublesMinutes} min
                      {rules.limitsOnlyWhenWaiting ? ' when others are waiting' : ''}
                    </div>
                    {rules.minPlayers > 1 ? <div>{rules.minPlayers} players must be present to sign in</div> : null}
                    <div className="how">No app, no login. Point your phone camera at the code.</div>
                  </>
                ) : (
                  <>
                    {space.capacity ? <div>Up to {space.capacity} people at a time</div> : null}
                    <div className="how">No app, no login. Point your phone camera at the code.</div>
                  </>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
