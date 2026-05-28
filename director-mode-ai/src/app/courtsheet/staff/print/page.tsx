import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { localToUtc, utcToLocalDate, utcToLocalTime } from '@/lib/courtsheet/timezones';
import { sourceLabel, typeLabel, blockStyleFor } from '@/lib/courtsheet/theme';
import type { Court, Reservation } from '@/lib/courtsheet/types';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ date?: string }>;
}

/**
 * Light-themed print sheet — clean enough to hand to the front desk every
 * morning. Triggers window.print() on load so Cmd+P / phone share sheet
 * lands directly in a print preview.
 */
export default async function PrintCourtSheetPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/courtsheet/staff/print');

  const params = await searchParams;
  const db = getSupabaseAdmin();

  const { data: club } = await db
    .from('cc_clubs')
    .select('id, slug, name, timezone, operating_hours, is_public, owner_id')
    .eq('owner_id', user.id)
    .order('name', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!club) {
    return <div className="p-8">No club found.</div>;
  }

  const timezone = (club as { timezone: string }).timezone;
  const date =
    params.date ??
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());

  const startUtc = localToUtc(date, '00:00', timezone).toISOString();
  const endUtc = localToUtc(addOneDay(date), '00:00', timezone).toISOString();

  const { data: courtsData } = await db
    .from('courts')
    .select('*')
    .eq('club_id', (club as { id: string }).id)
    .neq('status', 'hidden')
    .order('display_order', { ascending: true });
  const courts = (courtsData ?? []) as Court[];

  const { data: resData } = await db
    .from('reservations')
    .select('*')
    .eq('club_id', (club as { id: string }).id)
    .neq('status', 'cancelled')
    .lt('starts_at', endUtc)
    .gt('ends_at', startUtc)
    .order('starts_at', { ascending: true });
  const reservations = (resData ?? []) as Reservation[];

  return (
    <html lang="en">
      <head>
        <title>Court Sheet — {(club as { name: string }).name} — {date}</title>
        <style
          dangerouslySetInnerHTML={{
            __html: `
              * { box-sizing: border-box; }
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
                margin: 0;
                padding: 24px;
                background: #fff;
                color: #0f172a;
              }
              h1 { font-size: 22px; font-weight: 700; margin: 0; }
              .meta { color: #64748b; font-size: 12px; margin-top: 2px; }
              table { width: 100%; border-collapse: collapse; margin-top: 16px; }
              th, td { text-align: left; padding: 6px 8px; font-size: 11px; border-bottom: 1px solid #e2e8f0; }
              th {
                font-weight: 600;
                color: #475569;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                font-size: 9px;
                background: #f8fafc;
              }
              td.tab { font-variant-numeric: tabular-nums; }
              .pill {
                display: inline-block;
                padding: 1px 6px;
                border-radius: 9999px;
                font-size: 9px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.04em;
              }
              .court-section h2 {
                font-size: 13px;
                font-weight: 700;
                margin: 16px 0 4px;
                padding-bottom: 4px;
                border-bottom: 2px solid #0f172a;
              }
              .no-print { display: block; }
              @media print {
                body { padding: 12px; }
                .no-print { display: none !important; }
                a { color: inherit; text-decoration: none; }
              }
              .printbar {
                display: flex;
                gap: 8px;
                justify-content: flex-end;
                margin-bottom: 12px;
              }
              .btn {
                padding: 6px 12px;
                border-radius: 8px;
                background: #0f172a;
                color: #fff;
                font-size: 12px;
                font-weight: 600;
                border: none;
                cursor: pointer;
                text-decoration: none;
              }
              .btn.secondary {
                background: #fff;
                color: #0f172a;
                border: 1px solid #cbd5e1;
              }
            `,
          }}
        />
      </head>
      <body>
        <div className="no-print printbar">
          <a className="btn secondary" href="/courtsheet/staff">
            Back to sheet
          </a>
          <button
            className="btn"
            // @ts-expect-error inline onclick for the static print page
            onClick="window.print()"
          >
            Print
          </button>
        </div>

        <h1>{(club as { name: string }).name}</h1>
        <div className="meta">
          Court sheet · {date} · {timezone} ·{' '}
          {reservations.length} reservation{reservations.length === 1 ? '' : 's'}
        </div>

        {courts.length === 0 ? (
          <div style={{ marginTop: 32, color: '#64748b' }}>
            No courts configured.
          </div>
        ) : (
          courts.map((court) => {
            const rows = reservations.filter((r) => r.court_id === court.id);
            return (
              <div key={court.id} className="court-section">
                <h2>{court.name ?? `Court ${court.number}`}</h2>
                {rows.length === 0 ? (
                  <div style={{ color: '#94a3b8', fontSize: 11, padding: '4px 0' }}>
                    No reservations.
                  </div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: '8%' }}>Start</th>
                        <th style={{ width: '8%' }}>End</th>
                        <th>Title</th>
                        <th style={{ width: '10%' }}>Type</th>
                        <th style={{ width: '15%' }}>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const style = blockStyleFor(r.type, r.color);
                        return (
                          <tr key={r.id}>
                            <td className="tab">{utcToLocalTime(r.starts_at, timezone)}</td>
                            <td className="tab">{utcToLocalTime(r.ends_at, timezone)}</td>
                            <td>{r.title}</td>
                            <td>
                              <span
                                className="pill"
                                style={{ background: style.hex + '22', color: style.hex }}
                              >
                                {typeLabel(r.type)}
                              </span>
                            </td>
                            <td style={{ color: '#64748b' }}>{sourceLabel(r.source)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })
        )}

        {/* Auto-fire the print dialog on load. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `setTimeout(() => window.print(), 250);`,
          }}
        />
      </body>
    </html>
  );
}

function addOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
