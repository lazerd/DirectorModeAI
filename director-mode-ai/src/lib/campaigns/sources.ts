// Per-surface recipient sources for the campaign engine. Each source verifies
// the caller OWNS the target (per-director scoping), then normalizes the surface
// into a CampaignData. Match surfaces (tournaments, quads, individual leagues)
// reduce to a shared assemble(); point/pickup/RSVP surfaces (swim, stringing,
// JTT coaches, CourtConnect) build their recipient lists directly.

import { getSupabaseAdmin } from '@/lib/supabase/admin';
import type { CampaignData, CampaignCopy, NudgePerson, Person, Outstanding } from './core';
import { matchCopy } from './core';
import { quadPromoRenderer } from './quadPromoEmail';
import { getSponsor } from '@/config/sponsors';
import { formatTimeDisplay } from '@/lib/quads';
import { CLUB_TZ } from '@/lib/captain/clubTime';

import { APP_URL } from '@/lib/appUrl';
export type SessionUser = { id: string; email?: string | null };
export type SourceResult = { ok: true; data: CampaignData } | { ok: false; status: number; error: string };

const APP = APP_URL;
const firstNameOf = (s: string) => (s || '').trim().split(/\s+/)[0] || 'there';
const contactBits = (email?: string | null, phone?: string | null) => [email, phone].filter(Boolean).join(' · ');

/** "Thursday, July 24 at 9:00 AM" for the pre-event reminder (null if no date). */
function whenLabel(dateStr?: string | null, timeStr?: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00'); // tolerate date or full-timestamp input
  if (Number.isNaN(d.getTime())) return null;
  const datePart = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  if (!timeStr) return datePart;
  const [h, m] = String(timeStr).split(':').map((x) => parseInt(x, 10));
  if (Number.isNaN(h)) return datePart;
  const dt = new Date(2000, 0, 1, h, Number.isNaN(m) ? 0 : m);
  const timePart = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${datePart} at ${timePart}`;
}

async function branding(user: SessionUser) {
  const admin = getSupabaseAdmin();
  // NOTE: profiles has no `email` column. Selecting one made PostgREST reject
  // the whole query, so every campaign fell back to "Your Club" branding and a
  // "— Your Club" sign-off. Reply-to comes from the session user anyway.
  const { data: p } = await admin.from('profiles').select('organization_name, full_name').eq('id', user.id).maybeSingle();
  const row = (p as { organization_name?: string; full_name?: string } | null) || null;
  const clubName = row?.organization_name?.trim() || 'Your Club';
  const senderName = row?.full_name?.trim() || clubName;
  const replyTo = user.email || 'noreply@mail.clubmode.ai';
  return { clubName, senderName, replyTo };
}

// ---------- shared match-surface machinery ----------
type NEntry = {
  id: string;
  label: string;
  playerName: string;
  playerEmail: string | null;
  playerPhone: string | null;
  partnerName: string | null;
  partnerEmail: string | null;
  partnerPhone: string | null;
  completed: number;
};
type NMatch = { a: string | null; b: string | null; status: string };

const entryContact = (e: NEntry) =>
  [contactBits(e.playerEmail, e.playerPhone), e.partnerName ? contactBits(e.partnerEmail, e.partnerPhone) : '']
    .filter(Boolean)
    .join('  |  ');

function assemble(entries: NEntry[], matches: NMatch[]) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const m of matches) {
    if (m.status !== 'completed') continue;
    if (m.a && byId.has(m.a)) byId.get(m.a)!.completed++;
    if (m.b && byId.has(m.b)) byId.get(m.b)!.completed++;
  }
  const playable = matches.filter((m) => m.status === 'pending' && m.a && m.b);
  const outByEntry = new Map<string, Outstanding[]>();
  for (const m of playable) {
    const A = byId.get(m.a!);
    const B = byId.get(m.b!);
    if (!A || !B) continue;
    (outByEntry.get(A.id) || outByEntry.set(A.id, []).get(A.id)!).push({ label: `vs ${B.label}`, contact: entryContact(B) });
    (outByEntry.get(B.id) || outByEntry.set(B.id, []).get(B.id)!).push({ label: `vs ${A.label}`, contact: entryContact(A) });
  }
  const everyoneMap = new Map<string, Person>();
  const addPerson = (email: string | null, name: string) => {
    if (!email) return;
    const k = email.toLowerCase();
    if (!everyoneMap.has(k)) everyoneMap.set(k, { email, firstName: firstNameOf(name) });
  };
  for (const e of entries) {
    addPerson(e.playerEmail, e.playerName);
    if (e.partnerEmail) addPerson(e.partnerEmail, e.partnerName || '');
  }
  const nudgeMap = new Map<string, NudgePerson>();
  const addNudge = (email: string | null, name: string, played: number, items: Outstanding[]) => {
    if (!email || items.length === 0) return;
    const k = email.toLowerCase();
    let rec = nudgeMap.get(k);
    if (!rec) {
      rec = { email, firstName: firstNameOf(name), played, target: null, outstanding: [] };
      nudgeMap.set(k, rec);
    }
    rec.played = Math.max(rec.played ?? 0, played);
    rec.outstanding.push(...items);
  };
  for (const e of entries) {
    const items = outByEntry.get(e.id) || [];
    if (items.length === 0) continue;
    addNudge(e.playerEmail, e.playerName, e.completed, items);
    if (e.partnerEmail) addNudge(e.partnerEmail, e.partnerName || '', e.completed, items);
  }
  return {
    everyone: [...everyoneMap.values()],
    nudge: [...nudgeMap.values()].sort((a, b) => b.outstanding.length - a.outstanding.length),
    matchesTotal: matches.length,
    matchesCompleted: matches.filter((m) => m.status === 'completed').length,
    playable: playable.length,
  };
}

function matchCopyFor(title: string, activityNoun: string): CampaignCopy {
  const c = matchCopy(activityNoun);
  c.updateSubject = `${title} — Update`;
  c.updateIntro = `A quick check-in on the ${title}. Here's where things stand:`;
  return c;
}

// ---------------- Tournament ----------------
export async function tournamentCampaign(eventId: string, user: SessionUser): Promise<SourceResult> {
  const admin = getSupabaseAdmin();
  const { data: ev } = await admin.from('events').select('id, name, slug, user_id, event_date, start_time').eq('id', eventId).maybeSingle();
  if (!ev) return { ok: false, status: 404, error: 'Event not found' };
  if ((ev as { user_id: string }).user_id !== user.id) return { ok: false, status: 403, error: 'Not authorized' };
  const e = ev as { name: string; slug: string; event_date: string | null; start_time: string | null };

  const { data: entryRows } = await admin
    .from('tournament_entries')
    .select('id, player_name, player_email, parent_email, player_phone, partner_name, partner_email, partner_phone')
    .eq('event_id', eventId);
  const { data: matchRows } = await admin
    .from('tournament_matches')
    .select('status, player1_id, player3_id')
    .eq('event_id', eventId);

  const entries: NEntry[] = ((entryRows as Array<Record<string, unknown>>) || []).map((r) => {
    const playerName = (r.player_name as string) || 'TBD';
    const partnerName = (r.partner_name as string) || null;
    return {
      id: r.id as string,
      label: partnerName ? `${playerName} / ${partnerName}` : playerName,
      playerName,
      playerEmail: (r.player_email as string) || (r.parent_email as string) || null,
      playerPhone: (r.player_phone as string) || null,
      partnerName,
      partnerEmail: (r.partner_email as string) || null,
      partnerPhone: (r.partner_phone as string) || null,
      completed: 0,
    };
  });
  const matches: NMatch[] = ((matchRows as Array<Record<string, unknown>>) || []).map((m) => ({
    a: (m.player1_id as string) || null,
    b: (m.player3_id as string) || null,
    status: m.status as string,
  }));

  const a = assemble(entries, matches);
  const b = await branding(user);
  return {
    ok: true,
    data: {
      ownerId: user.id,
      ...b,
      title: e.name,
      liveUrl: `${APP}/tournaments/${e.slug}`,
      liveUrlLabel: '🎾 View standings & enter scores',
      deadlineNote: null,
      reminderWhen: whenLabel(e.event_date, e.start_time),
      stats: [
        { label: 'Matches played', value: `${a.matchesCompleted} of ${a.matchesTotal}` },
        { label: 'Ready to play now', value: `${a.playable}` },
        { label: 'Players', value: `${a.everyone.length}` },
      ],
      everyone: a.everyone,
      nudge: a.nudge,
      copy: matchCopyFor(e.name, 'tournament'),
    },
  };
}

// ---------------- Quad ----------------
export async function quadCampaign(eventId: string, user: SessionUser): Promise<SourceResult> {
  const admin = getSupabaseAdmin();
  const { data: ev } = await admin.from('events').select('id, name, slug, user_id, event_date, start_time').eq('id', eventId).maybeSingle();
  if (!ev) return { ok: false, status: 404, error: 'Event not found' };
  if ((ev as { user_id: string }).user_id !== user.id) return { ok: false, status: 403, error: 'Not authorized' };
  const e = ev as { name: string; slug: string; event_date: string | null; start_time: string | null };

  const { data: flightRows } = await admin.from('quad_flights').select('id').eq('event_id', eventId);
  const flightIds = ((flightRows as Array<{ id: string }>) || []).map((f) => f.id);
  const { data: entryRows } = await admin
    .from('quad_entries')
    .select('id, player_name, player_email, parent_email, player_phone')
    .eq('event_id', eventId);
  let matches: NMatch[] = [];
  if (flightIds.length) {
    const { data: matchRows } = await admin
      .from('quad_matches')
      .select('status, player1_id, player3_id')
      .in('flight_id', flightIds);
    matches = ((matchRows as Array<Record<string, unknown>>) || []).map((m) => ({
      a: (m.player1_id as string) || null,
      b: (m.player3_id as string) || null,
      status: m.status as string,
    }));
  }
  const entries: NEntry[] = ((entryRows as Array<Record<string, unknown>>) || []).map((r) => {
    const playerName = (r.player_name as string) || 'TBD';
    return {
      id: r.id as string,
      label: playerName,
      playerName,
      playerEmail: (r.player_email as string) || (r.parent_email as string) || null,
      playerPhone: (r.player_phone as string) || null,
      partnerName: null,
      partnerEmail: null,
      partnerPhone: null,
      completed: 0,
    };
  });

  const a = assemble(entries, matches);
  const b = await branding(user);
  return {
    ok: true,
    data: {
      ownerId: user.id,
      ...b,
      title: e.name,
      liveUrl: `${APP}/quads/${e.slug}/results`,
      liveUrlLabel: '🎾 View standings & enter scores',
      deadlineNote: null,
      reminderWhen: whenLabel(e.event_date, e.start_time),
      stats: [
        { label: 'Matches played', value: `${a.matchesCompleted} of ${a.matchesTotal}` },
        { label: 'Ready to play now', value: `${a.playable}` },
        { label: 'Players', value: `${a.everyone.length}` },
      ],
      everyone: a.everyone,
      nudge: a.nudge,
      copy: matchCopyFor(e.name, 'quad'),
    },
  };
}

// ---------------- League (individual) ----------------
export async function leagueCampaign(leagueId: string, user: SessionUser): Promise<SourceResult> {
  const admin = getSupabaseAdmin();
  const { data: lg } = await admin.from('leagues').select('id, name, slug, director_id, format').eq('id', leagueId).maybeSingle();
  if (!lg) return { ok: false, status: 404, error: 'League not found' };
  if ((lg as { director_id: string }).director_id !== user.id) return { ok: false, status: 403, error: 'Not authorized' };
  const l = lg as { name: string; slug: string };

  const { data: entryRows } = await admin
    .from('league_entries')
    .select('id, captain_name, captain_email, captain_phone, partner_name, partner_email, partner_phone')
    .eq('league_id', leagueId);
  const entries: NEntry[] = ((entryRows as Array<Record<string, unknown>>) || []).map((r) => {
    const playerName = (r.captain_name as string) || 'TBD';
    const partnerName = (r.partner_name as string) || null;
    return {
      id: r.id as string,
      label: partnerName ? `${playerName} / ${partnerName}` : playerName,
      playerName,
      playerEmail: (r.captain_email as string) || null,
      playerPhone: (r.captain_phone as string) || null,
      partnerName,
      partnerEmail: (r.partner_email as string) || null,
      partnerPhone: (r.partner_phone as string) || null,
      completed: 0,
    };
  });

  const entryIds = entries.map((e) => e.id);
  let matches: NMatch[] = [];
  if (entryIds.length) {
    const { data: matchRows } = await admin
      .from('league_matches')
      .select('entry_a_id, entry_b_id, status, winner_entry_id')
      .in('entry_a_id', entryIds);
    matches = ((matchRows as Array<Record<string, unknown>>) || []).map((m) => ({
      a: (m.entry_a_id as string) || null,
      b: (m.entry_b_id as string) || null,
      status: m.winner_entry_id || m.status === 'completed' ? 'completed' : (m.status as string),
    }));
  }

  const a = assemble(entries, matches);
  const b = await branding(user);
  return {
    ok: true,
    data: {
      ownerId: user.id,
      ...b,
      title: l.name,
      liveUrl: `${APP}/leagues/${l.slug}`,
      liveUrlLabel: '🎾 View standings & report scores',
      deadlineNote: null,
      stats: [
        { label: 'Matches played', value: `${a.matchesCompleted} of ${a.matchesTotal}` },
        { label: 'Ready to play now', value: `${a.playable}` },
        { label: 'Players / teams', value: `${entries.length}` },
      ],
      everyone: a.everyone,
      nudge: a.nudge,
      copy: matchCopyFor(l.name, 'league'),
    },
  };
}

// ---------------- Swim (volunteer points owed) ----------------
export async function swimCampaign(seasonId: string, user: SessionUser): Promise<SourceResult> {
  const admin = getSupabaseAdmin();
  const { data: sn } = await admin
    .from('swim_seasons')
    .select('id, name, director_id, default_points_required')
    .eq('id', seasonId)
    .maybeSingle();
  if (!sn) return { ok: false, status: 404, error: 'Season not found' };
  if ((sn as { director_id: string }).director_id !== user.id) return { ok: false, status: 403, error: 'Not authorized' };
  const season = sn as { name: string; default_points_required: number | null };

  const { data: famRows } = await admin
    .from('swim_families')
    .select('id, family_name, primary_email, points_required, family_token')
    .eq('season_id', seasonId);
  const families = (famRows as Array<Record<string, unknown>>) || [];
  const famIds = families.map((f) => f.id as string);

  const { data: jobRows } = await admin.from('swim_jobs').select('id, points').eq('season_id', seasonId);
  const jobPoints = new Map<string, number>(((jobRows as Array<{ id: string; points: number }>) || []).map((j) => [j.id, j.points || 0]));

  const earned = new Map<string, number>();
  if (famIds.length) {
    const { data: asgRows } = await admin
      .from('swim_assignments')
      .select('family_id, job_id, points_awarded, status')
      .in('family_id', famIds);
    for (const a of (asgRows as Array<Record<string, unknown>>) || []) {
      const st = a.status as string;
      if (st !== 'signed_up' && st !== 'completed') continue;
      const pts = (a.points_awarded as number) ?? jobPoints.get(a.job_id as string) ?? 0;
      const fid = a.family_id as string;
      earned.set(fid, (earned.get(fid) || 0) + pts);
    }
  }

  const b = await branding(user);
  const everyone: Person[] = [];
  const nudge: NudgePerson[] = [];
  let owing = 0;
  for (const f of families) {
    const email = (f.primary_email as string) || null;
    if (!email) continue;
    const token = (f.family_token as string) || '';
    const ctaUrl = token ? `${APP}/swim-family/${token}` : `${APP}/swim`;
    const name = (f.family_name as string) || 'there';
    everyone.push({ email, firstName: name, ctaUrl });
    const required = (f.points_required as number) ?? season.default_points_required ?? 0;
    const have = earned.get(f.id as string) || 0;
    if (required > 0 && have < required) {
      owing++;
      nudge.push({
        email,
        firstName: name,
        ctaUrl,
        played: have,
        target: required,
        outstanding: [
          {
            label: `You've signed up for ${have} of ${required} volunteer points`,
            sub: `${required - have} more point${required - have === 1 ? '' : 's'} to go for the season`,
            contact: '',
          },
        ],
      });
    }
  }

  const copy: CampaignCopy = {
    updateSubject: `${season.name} — Volunteer Update`,
    updateIntro: `A quick check-in on team volunteering for ${season.name}. Thank you for pitching in — here's where things stand:`,
    nudgeSubject: 'A few volunteer points left to sign up for 🏊',
    nudgeLead: (_n, played) =>
      `Friendly reminder — your family still has volunteer points to fill for the season${played}. Every shift keeps the meets running, and there are plenty of open spots:`,
    nudgeTip: () => `Grab any open job from your family page — it only takes a second, and you can pick what fits your schedule.`,
  };

  return {
    ok: true,
    data: {
      ownerId: user.id,
      ...b,
      title: season.name,
      liveUrl: `${APP}/swim`,
      liveUrlLabel: '🏊 Sign up for shifts',
      deadlineNote: null,
      stats: [
        { label: 'Families', value: `${everyone.length}` },
        { label: 'Still owe points', value: `${owing}` },
      ],
      everyone,
      nudge,
      copy,
    },
  };
}

// ---------------- Stringing (rackets ready for pickup) ----------------
export async function stringingCampaign(user: SessionUser): Promise<SourceResult> {
  const admin = getSupabaseAdmin();
  const { data: custRows } = await admin
    .from('stringing_customers')
    .select('id, full_name, email')
    .eq('user_id', user.id);
  const customers = new Map<string, { name: string; email: string | null }>(
    ((custRows as Array<Record<string, unknown>>) || []).map((c) => [
      c.id as string,
      { name: (c.full_name as string) || 'there', email: (c.email as string) || null },
    ])
  );
  const custIds = [...customers.keys()];

  const nudge: NudgePerson[] = [];
  if (custIds.length) {
    const { data: jobRows } = await admin
      .from('stringing_jobs')
      .select('customer_id, status, picked_up_at, custom_string_name')
      .in('customer_id', custIds)
      .eq('status', 'done');
    for (const j of (jobRows as Array<Record<string, unknown>>) || []) {
      if (j.picked_up_at) continue;
      const c = customers.get(j.customer_id as string);
      if (!c?.email) continue;
      const stringName = (j.custom_string_name as string) || '';
      nudge.push({
        email: c.email,
        firstName: firstNameOf(c.name),
        played: null,
        target: null,
        outstanding: [
          {
            label: `Your racket is strung and ready for pickup 🎾`,
            sub: stringName ? `Strung with ${stringName}` : undefined,
            contact: '',
          },
        ],
      });
    }
  }

  const b = await branding(user);
  const copy: CampaignCopy = {
    updateSubject: '',
    updateIntro: '',
    nudgeSubject: `Your racket's ready for pickup 🎾`,
    nudgeLead: () => `Good news — your racket is strung and ready to grab whenever you're next in. Thanks for your business!`,
  };
  return {
    ok: true,
    data: {
      ownerId: user.id,
      ...b,
      title: 'Stringing',
      liveUrl: '',
      liveUrlLabel: '',
      deadlineNote: null,
      stats: [{ label: 'Ready for pickup', value: `${nudge.length}` }],
      everyone: [], // pickup reminders are nudge-only
      nudge,
      copy,
    },
  };
}

// ---------------- JTT team league ----------------
export async function jttCampaign(leagueId: string, user: SessionUser): Promise<SourceResult> {
  const admin = getSupabaseAdmin();
  const { data: lg } = await admin.from('leagues').select('id, name, director_id, format').eq('id', leagueId).maybeSingle();
  if (!lg) return { ok: false, status: 404, error: 'League not found' };
  if ((lg as { director_id: string }).director_id !== user.id) return { ok: false, status: 403, error: 'Not authorized' };
  const league = lg as { name: string; format: string };

  const { data: divRows } = await admin.from('league_divisions').select('id').eq('league_id', leagueId);
  const divIds = ((divRows as Array<{ id: string }>) || []).map((d) => d.id);
  const { data: clubRows } = await admin
    .from('league_clubs')
    .select('id, name, contact_name, contact_email')
    .eq('league_id', leagueId);
  const clubs = new Map<string, { name: string; contactName: string; contactEmail: string | null }>(
    ((clubRows as Array<Record<string, unknown>>) || []).map((c) => [
      c.id as string,
      { name: (c.name as string) || 'Team', contactName: (c.contact_name as string) || '', contactEmail: (c.contact_email as string) || null },
    ])
  );

  // broadcast: everyone on every roster (players + parents)
  const everyoneMap = new Map<string, Person>();
  const addP = (email: string | null, name: string) => {
    if (!email) return;
    const k = email.toLowerCase();
    if (!everyoneMap.has(k)) everyoneMap.set(k, { email, firstName: firstNameOf(name) });
  };
  if (divIds.length) {
    const { data: rosterRows } = await admin
      .from('league_team_rosters')
      .select('player_name, player_email, parent_name, parent_email')
      .in('division_id', divIds);
    for (const r of (rosterRows as Array<Record<string, unknown>>) || []) {
      addP((r.player_email as string) || null, (r.player_name as string) || '');
      addP((r.parent_email as string) || null, (r.parent_name as string) || (r.player_name as string) || '');
    }
  }

  // nudge: coaches whose team has a past match-day with no result reported
  const today = new Date().toISOString().slice(0, 10);
  const coachNudge = new Map<string, NudgePerson>();
  if (divIds.length) {
    const { data: mRows } = await admin
      .from('league_team_matchups')
      .select('home_club_id, away_club_id, match_date, status, winner')
      .in('division_id', divIds);
    for (const m of (mRows as Array<Record<string, unknown>>) || []) {
      const date = (m.match_date as string) || '';
      const reported = (m.status as string) === 'completed' || !!m.winner;
      if (!date || date > today || reported) continue; // only past, unreported
      const home = clubs.get(m.home_club_id as string);
      const away = clubs.get(m.away_club_id as string);
      const addCoach = (club?: { name: string; contactName: string; contactEmail: string | null }, opp?: { name: string }) => {
        if (!club?.contactEmail || !opp) return;
        const k = club.contactEmail.toLowerCase();
        let rec = coachNudge.get(k);
        if (!rec) {
          rec = { email: club.contactEmail, firstName: firstNameOf(club.contactName || club.name), played: null, target: null, outstanding: [] };
          coachNudge.set(k, rec);
        }
        rec.outstanding.push({
          label: `${club.name} vs ${opp.name} — ${date}`,
          sub: 'Results not reported yet',
          contact: '',
        });
      };
      addCoach(home, away);
      addCoach(away, home);
    }
  }

  const b = await branding(user);
  const copy: CampaignCopy = {
    updateSubject: `${league.name} — Update`,
    updateIntro: `A quick update for everyone in ${league.name}. Thanks for a great season so far!`,
    nudgeSubject: 'Reminder: a match-day result still needs reporting 🎾',
    nudgeLead: (n) =>
      `Quick nudge — your team has <strong>${n} match-day${n === 1 ? '' : 's'}</strong> that ${n === 1 ? "hasn't" : "haven't"} had results reported yet. When you get a chance, please enter the scores so the standings stay current:`,
  };
  return {
    ok: true,
    data: {
      ownerId: user.id,
      ...b,
      title: league.name,
      liveUrl: '',
      liveUrlLabel: '',
      deadlineNote: null,
      stats: [
        { label: 'Players / parents', value: `${everyoneMap.size}` },
        { label: 'Unreported match-days', value: `${[...coachNudge.values()].reduce((s, c) => s + c.outstanding.length, 0)}` },
      ],
      everyone: [...everyoneMap.values()],
      nudge: [...coachNudge.values()].sort((a, c) => c.outstanding.length - a.outstanding.length),
      copy,
    },
  };
}

// ---------------- CourtConnect event RSVPs ----------------
export async function courtconnectCampaign(eventId: string, user: SessionUser): Promise<SourceResult> {
  const admin = getSupabaseAdmin();
  const { data: ev } = await admin
    .from('cc_events')
    .select('id, title, event_date, created_by')
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return { ok: false, status: 404, error: 'Event not found' };
  if ((ev as { created_by: string }).created_by !== user.id) return { ok: false, status: 403, error: 'Not authorized' };
  const e = ev as { title: string; event_date: string | null };

  const { data: playerRows } = await admin
    .from('cc_event_players')
    .select('player_id, guest_name, guest_email, status, responded_at')
    .eq('event_id', eventId);
  const rows = (playerRows as Array<Record<string, unknown>>) || [];

  // resolve member emails via cc_players → profiles
  const memberIds = rows.map((r) => r.player_id as string).filter(Boolean);
  const emailByPlayer = new Map<string, { email: string | null; name: string }>();
  if (memberIds.length) {
    const { data: ccp } = await admin.from('cc_players').select('id, profile_id, display_name').in('id', memberIds);
    const profByPlayer = new Map<string, { profileId: string | null; name: string }>();
    const profileIds: string[] = [];
    for (const p of (ccp as Array<Record<string, unknown>>) || []) {
      const pid = (p.profile_id as string) || null;
      profByPlayer.set(p.id as string, { profileId: pid, name: (p.display_name as string) || '' });
      if (pid) profileIds.push(pid);
    }
    const emailByProfile = new Map<string, string>();
    if (profileIds.length) {
      const { data: profs } = await admin.from('profiles').select('id, email').in('id', profileIds);
      for (const pr of (profs as Array<{ id: string; email: string }>) || []) emailByProfile.set(pr.id, pr.email);
    }
    for (const [playerId, info] of profByPlayer) {
      emailByPlayer.set(playerId, { email: info.profileId ? emailByProfile.get(info.profileId) || null : null, name: info.name });
    }
  }

  const emailFor = (r: Record<string, unknown>): { email: string | null; name: string } => {
    if (r.player_id && emailByPlayer.has(r.player_id as string)) return emailByPlayer.get(r.player_id as string)!;
    return { email: (r.guest_email as string) || null, name: (r.guest_name as string) || '' };
  };
  const dateStr = e.event_date ? new Date(e.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';

  const everyoneMap = new Map<string, Person>();
  const nudgeMap = new Map<string, NudgePerson>();
  for (const r of rows) {
    const { email, name } = emailFor(r);
    if (!email) continue;
    const k = email.toLowerCase();
    if (!everyoneMap.has(k)) everyoneMap.set(k, { email, firstName: firstNameOf(name) });
    if (!r.responded_at && (r.status === 'invited' || r.status == null)) {
      if (!nudgeMap.has(k))
        nudgeMap.set(k, {
          email,
          firstName: firstNameOf(name),
          played: null,
          target: null,
          outstanding: [{ label: `${e.title}${dateStr ? ` — ${dateStr}` : ''}`, sub: 'Please let us know if you can make it', contact: '' }],
        });
    }
  }

  const b = await branding(user);
  const copy: CampaignCopy = {
    updateSubject: `${e.title} — Update`,
    updateIntro: `A quick note about ${e.title}${dateStr ? ` on ${dateStr}` : ''}:`,
    nudgeSubject: `Can you make it? ${e.title}`,
    nudgeLead: () => `You're on the list for <strong>${e.title}</strong>${dateStr ? ` (${dateStr})` : ''}, but we haven't heard back yet. Can you play? Tap below to let us know:`,
  };
  return {
    ok: true,
    data: {
      ownerId: user.id,
      ...b,
      title: e.title,
      liveUrl: `${APP}/courtconnect/events/${eventId}`,
      liveUrlLabel: '✅ RSVP now',
      deadlineNote: null,
      reminderWhen: whenLabel(e.event_date, null),
      stats: [
        { label: 'On the list', value: `${everyoneMap.size}` },
        { label: 'Awaiting RSVP', value: `${nudgeMap.size}` },
      ],
      everyone: [...everyoneMap.values()],
      nudge: [...nudgeMap.values()],
      copy,
    },
  };
}

// ---------------- dispatch ----------------
// ---------------- Quads: invite past players ----------------

/** "14:00:00" → "2:00 PM" (null when absent/unparseable). */
function timeOnly(timeStr?: string | null): string | null {
  if (!timeStr) return null;
  const [h, m] = String(timeStr).split(':').map((x) => parseInt(x, 10));
  if (Number.isNaN(h)) return null;
  return new Date(2000, 0, 1, h, Number.isNaN(m) ? 0 : m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * The words every chosen event name has in common, in the first name's order —
 * "JTT 10U Season-End — Gold" + "JTT 12U Season-End — Compass" → "the JTT
 * Season-End events". A family that played one of four sibling draws should be
 * told which series they were part of, not given a count.
 */
function sharedNameLabel(names: string[]): string | null {
  const tokenize = (n: string) => n.split(/\s+/).filter((t) => /[A-Za-z0-9]/.test(t));
  const [first, ...rest] = names.map(tokenize);
  if (!first?.length) return null;
  const others = rest.map((ts) => new Set(ts.map((t) => t.toLowerCase())));
  const shared = first.filter((t) => others.every((set) => set.has(t.toLowerCase())));
  // Drop leading/trailing connector-ish leftovers and require something substantive.
  const clean = shared.filter((t) => !/^(and|the|of|at|&|·|—|-)$/i.test(t));
  if (!clean.length || clean.join(' ').length < 3) return null;
  return `the ${clean.join(' ')} events`;
}

/** Marketing copy for "come play the next one". */
function promoCopy(title: string, sourceLabel: string, whenText: string | null): CampaignCopy {
  const c = matchCopy('quad');
  c.updateSubject = whenText ? `${title} — ${whenText}` : title;
  c.updateIntro =
    `Your player competed in ${sourceLabel} with us, so I wanted you to hear about this one first. ` +
    `Here are the details:`;
  return c;
}

/**
 * Promotional campaign for an UPCOMING event: reaches the families who already
 * PAID for one of this director's past events.
 *
 * Every other source in this file emails the people already attached to the
 * target. This one deliberately does the opposite — the recipients come from
 * OTHER events entirely, because a new tournament is filled from the people
 * who came last time, not from the handful who have already signed up.
 *
 * `sourceEventIds` narrows which past events to pull from (the panel renders
 * them as checkboxes, so a director can leave out a division that doesn't fit
 * the new event). Omitted = every past event of theirs with paid entries.
 * Ownership is re-checked server-side rather than trusted from the client.
 * Anyone already registered for the target is dropped, so nobody gets pitched
 * something they are already in.
 */
export async function quadPromoteCampaign(
  eventId: string,
  user: SessionUser,
  sourceEventIds?: string[]
): Promise<SourceResult> {
  const admin = getSupabaseAdmin();
  const { data: ev } = await admin
    .from('events')
    .select(
      'id, name, slug, user_id, event_date, start_time, end_time, wave2_start_time, wave2_end_time, round_duration_minutes, entry_fee_cents, registration_closes_at, divisions, sponsor_id, entry_flow, gender_restriction'
    )
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return { ok: false, status: 404, error: 'Event not found' };
  const e = ev as {
    id: string;
    name: string;
    slug: string;
    user_id: string;
    event_date: string | null;
    start_time: string | null;
    end_time: string | null;
    wave2_start_time: string | null;
    wave2_end_time: string | null;
    round_duration_minutes: number | null;
    entry_fee_cents: number | null;
    registration_closes_at: string | null;
    divisions: Array<{ label?: string }> | null;
    sponsor_id: string | null;
    entry_flow: string | null;
    gender_restriction: string | null;
  };
  if (e.user_id !== user.id) return { ok: false, status: 403, error: 'Not authorized' };

  const sources = await pastPaidEvents(user.id, eventId);
  const chosen = sourceEventIds?.length ? sources.filter((s) => sourceEventIds.includes(s.id)) : sources;

  const everyone: Person[] = [];
  if (chosen.length) {
    const { data: paidRows } = await admin
      .from('tournament_entries')
      .select('event_id, player_name, player_email, parent_name, parent_email')
      .in(
        'event_id',
        chosen.map((s) => s.id)
      )
      .eq('payment_status', 'paid');

    // Drop anyone already in the target event, and the director themselves.
    const skip = new Set<string>();
    const { data: already } = await admin.from('quad_entries').select('player_email, parent_email').eq('event_id', eventId);
    for (const r of (already as Array<Record<string, string | null>>) || []) {
      for (const v of [r.player_email, r.parent_email]) if (v) skip.add(v.trim().toLowerCase());
    }
    if (user.email) skip.add(user.email.trim().toLowerCase());

    const seen = new Map<string, Person>();
    for (const r of (paidRows as Array<Record<string, string | null>>) || []) {
      const parentEmail = (r.parent_email || '').trim();
      const email = parentEmail || (r.player_email || '').trim();
      if (!email) continue;
      const key = email.toLowerCase();
      if (skip.has(key) || seen.has(key)) continue;
      // Writing to the parent's address: greet the parent by THEIR name, and
      // when we don't have it, by the family — "Hi Will's family —". Never the
      // child's bare first name; a parent addressed as their kid reads as a
      // mail merge that went wrong. Writing to the player: their first name.
      const playerFirst = firstNameOf(r.player_name || '');
      const greeting = parentEmail
        ? r.parent_name?.trim()
          ? firstNameOf(r.parent_name)
          : playerFirst !== 'there'
            ? `${playerFirst}'s family`
            : 'there'
        : playerFirst;
      seen.set(key, { email, firstName: greeting });
    }
    everyone.push(...seen.values());
  }

  const names = chosen.map((s) => s.name);
  const sourceLabel =
    names.length === 0
      ? 'one of our events'
      : names.length === 1
        ? names[0]
        : sharedNameLabel(names) ||
          (names.length <= 3
            ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
            : 'our events this year');

  // Date only in the subject; a multi-session event can't honestly carry one
  // start time there. The When line spells out the sessions.
  const when = whenLabel(e.event_date, null);
  const t1 = timeOnly(e.start_time);
  const t2 = timeOnly(e.wave2_start_time);
  const whenLine = when ? (t1 && t2 ? `${when} — ${t1} or ${t2} session` : t1 ? `${when} at ${t1}` : when) : null;
  const fee = e.entry_fee_cents
    ? `$${(e.entry_fee_cents / 100).toFixed(e.entry_fee_cents % 100 === 0 ? 0 : 2)}`
    : 'Free';
  const divisionLabels = (e.divisions || []).map((d) => d?.label).filter(Boolean) as string[];

  const stats: { label: string; value: string }[] = [];
  if (whenLine) stats.push({ label: 'When', value: whenLine });
  if (divisionLabels.length) stats.push({ label: 'Divisions', value: divisionLabels.join(' · ') });
  stats.push({ label: 'Entry', value: fee });

  // registration_closes_at is a real timestamp, so it MUST render in club time —
  // an 11:59pm PT deadline formatted in UTC advertises the wrong day.
  let deadlineNote: string | null = null;
  if (e.registration_closes_at) {
    const d = new Date(e.registration_closes_at);
    if (!Number.isNaN(d.getTime())) {
      deadlineNote = `Registration closes ${d.toLocaleDateString('en-US', {
        timeZone: CLUB_TZ,
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })}`;
    }
  }

  const b = await branding(user);
  const signupUrl = `${APP}/quads/${e.slug}`;

  // The promo gets its own layout (quadPromoEmail.ts): the generic update
  // template is a status check-in and reads wrong to a family with no spot
  // yet. Every fact is resolved here so the template stays pure.
  const sessions: string[] = [];
  if (e.start_time && e.end_time) sessions.push(`${formatTimeDisplay(e.start_time)} – ${formatTimeDisplay(e.end_time)}`);
  if (e.wave2_start_time && e.wave2_end_time)
    sessions.push(`${formatTimeDisplay(e.wave2_start_time)} – ${formatTimeDisplay(e.wave2_end_time)}`);
  const whoLine =
    e.gender_restriction === 'boys' ? 'boys' : e.gender_restriction === 'girls' ? 'girls' : 'boys and girls';
  const closesLabel = deadlineNote ? deadlineNote.replace(/^Registration closes /, '') : null;
  const renderUpdate = quadPromoRenderer({
    title: e.name,
    clubName: b.clubName,
    senderName: b.senderName,
    senderTitle: null,
    dateLabel: when,
    sessions,
    playMinutes: 4 * (e.round_duration_minutes ?? 30),
    divisions: divisionLabels,
    whoLine,
    feeLabel: fee,
    closesLabel,
    requestMode: e.entry_flow === 'request_then_invite',
    payWindowHours: 24,
    sourceLabel: names.length ? sourceLabel : null,
    signupUrl,
    sponsor: getSponsor(e.sponsor_id),
  });

  return {
    ok: true,
    data: {
      ownerId: user.id,
      ...b,
      title: e.name,
      liveUrl: signupUrl,
      liveUrlLabel: '🎾 Sign up',
      deadlineNote,
      reminderWhen: null, // promo is a one-shot; the reminder lives on the 'quad' surface
      stats,
      everyone,
      nudge: [],
      copy: promoCopy(e.name, sourceLabel, when),
      renderUpdate,
    },
  };
}

/**
 * The director's own past events that have at least one PAID entry — the pool
 * the promo campaign draws from. Shared with /api/campaigns/past-events so the
 * checkbox list and the send agree on what "past player" means.
 */
export async function pastPaidEvents(
  userId: string,
  excludeEventId: string
): Promise<Array<{ id: string; name: string; eventDate: string | null; paidCount: number }>> {
  const admin = getSupabaseAdmin();
  const { data: ownRows } = await admin
    .from('events')
    .select('id, name, event_date')
    .eq('user_id', userId)
    .neq('id', excludeEventId);
  const today = new Date().toISOString().slice(0, 10);
  const own = ((ownRows as Array<{ id: string; name: string; event_date: string | null }>) || []).filter(
    (r) => !r.event_date || r.event_date.slice(0, 10) <= today
  );
  if (!own.length) return [];

  const { data: paidRows } = await admin
    .from('tournament_entries')
    .select('event_id')
    .in(
      'event_id',
      own.map((o) => o.id)
    )
    .eq('payment_status', 'paid');

  const counts = new Map<string, number>();
  for (const r of (paidRows as Array<{ event_id: string }>) || []) {
    counts.set(r.event_id, (counts.get(r.event_id) || 0) + 1);
  }
  return own
    .filter((o) => counts.has(o.id))
    .map((o) => ({ id: o.id, name: o.name, eventDate: o.event_date, paidCount: counts.get(o.id) || 0 }))
    .sort((a, b) => (b.eventDate || '').localeCompare(a.eventDate || ''));
}

export async function resolveCampaign(
  surface: string,
  targetId: string,
  user: SessionUser,
  opts?: { sourceEventIds?: string[] }
): Promise<SourceResult> {
  switch (surface) {
    case 'quad-promote':
      return quadPromoteCampaign(targetId, user, opts?.sourceEventIds);
    case 'tournament':
      return tournamentCampaign(targetId, user);
    case 'quad':
      return quadCampaign(targetId, user);
    case 'league':
      return leagueCampaign(targetId, user);
    case 'jtt':
      return jttCampaign(targetId, user);
    case 'swim':
      return swimCampaign(targetId, user);
    case 'stringing':
      return stringingCampaign(user);
    case 'courtconnect':
      return courtconnectCampaign(targetId, user);
    default:
      return { ok: false, status: 400, error: `Unknown surface: ${surface}` };
  }
}
