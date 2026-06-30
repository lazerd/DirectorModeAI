import type Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

// Agentic JTT match-day tools for the "Ask ClubMode" assistant. These let the
// assistant actually DO things — check players in/out, add/remove roster
// players — instead of just describing where to click. Everything is scoped to
// leagues the calling user DIRECTS (leagues.director_id = user.id); the executor
// refuses to touch anyone else's data even though it runs with service role.

type Admin = ReturnType<typeof getSupabaseAdmin>;

export type JttContext = {
  userId: string;
  leagueId: string | null;   // active league (from the page, validated as director-owned)
  matchupId: string | null;  // current matchup, if on a matchup page
};

const today = () => new Date().toISOString().slice(0, 10);
const norm = (s: string) => (s || '').trim().toLowerCase();
const digits = (s: string) => (s || '').replace(/\D/g, '');

/** Build the assistant's working context: which league it may act on. */
export async function resolveJttContext(userId: string, page: string | undefined): Promise<JttContext> {
  const admin = getSupabaseAdmin();
  const { data: directed } = await admin.from('leagues').select('id').eq('director_id', userId);
  const owned = new Set((directed || []).map((l: any) => l.id));
  if (owned.size === 0) return { userId, leagueId: null, matchupId: null };

  // Parse /mixer/leagues/<leagueId>/jtt/matchup/<matchupId> from the page path.
  const lMatch = page?.match(/leagues\/([0-9a-f-]{36})/i);
  const mMatch = page?.match(/matchup\/([0-9a-f-]{36})/i);
  let leagueId = lMatch && owned.has(lMatch[1]) ? lMatch[1] : null;
  if (!leagueId) leagueId = [...owned][0]; // fall back to their (first) league
  return { userId, leagueId, matchupId: mMatch?.[1] ?? null };
}

export function jttToolsAvailable(ctx: JttContext): boolean {
  return !!ctx.leagueId;
}

// --- Anthropic tool schemas -------------------------------------------------
export const JTT_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'list_today',
    description: "List today's JTT matchups for the director's league: each age group, the two clubs, the full roster per club, and who is currently checked in. Call this first to see names, clubs, and age groups before acting.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'check_in',
    description: 'Check a player in for today\'s match (marks them present so they can be put in a lineup). Use player:"all" to check in every active roster player for that club + age group.',
    input_schema: {
      type: 'object',
      properties: {
        club: { type: 'string', description: 'Club name or short code, e.g. "SH", "MCC".' },
        age: { type: 'string', description: 'Age group number, e.g. "10", "12", "13".' },
        player: { type: 'string', description: 'Player full name, or "all" for the whole active roster.' },
      },
      required: ['club', 'age', 'player'],
    },
  },
  {
    name: 'check_out',
    description: 'Remove a player\'s check-in for today\'s match (they\'re no longer marked present).',
    input_schema: {
      type: 'object',
      properties: {
        club: { type: 'string' }, age: { type: 'string' }, player: { type: 'string' },
      },
      required: ['club', 'age', 'player'],
    },
  },
  {
    name: 'add_player',
    description: "Add a brand-new player to a club's roster for an age group (then they can be checked in).",
    input_schema: {
      type: 'object',
      properties: {
        club: { type: 'string' }, age: { type: 'string' }, player: { type: 'string', description: 'Full name.' },
      },
      required: ['club', 'age', 'player'],
    },
  },
  {
    name: 'remove_player',
    description: 'Remove a player from a roster entirely (and any check-in). Destructive — confirm with the user first unless they were explicit.',
    input_schema: {
      type: 'object',
      properties: {
        club: { type: 'string' }, age: { type: 'string' }, player: { type: 'string' },
      },
      required: ['club', 'age', 'player'],
    },
  },
];

// --- Resolution helpers -----------------------------------------------------
async function clubsOf(admin: Admin, leagueId: string) {
  const { data } = await admin.from('league_clubs').select('id, name, short_code').eq('league_id', leagueId);
  return data || [];
}
async function divisionsOf(admin: Admin, leagueId: string) {
  const { data } = await admin.from('league_divisions').select('id, name, short_code').eq('league_id', leagueId);
  return data || [];
}
const matchClub = (clubs: any[], q: string) =>
  clubs.find((c) => norm(c.short_code) === norm(q)) ||
  clubs.find((c) => norm(c.name).includes(norm(q))) ||
  clubs.find((c) => norm(q).includes(norm(c.short_code)));
const matchDiv = (divs: any[], age: string) => {
  const a = digits(age);
  return divs.find((d) => digits(`${d.short_code || ''}${d.name || ''}`).includes(a) && a.length > 0);
};
async function todaysMatchup(admin: Admin, divisionId: string, clubId: string) {
  const { data } = await admin
    .from('league_team_matchups')
    .select('id, division_id, home_club_id, away_club_id, match_date')
    .eq('division_id', divisionId).eq('match_date', today());
  return (data || []).find((m: any) => m.home_club_id === clubId || m.away_club_id === clubId) || null;
}

// --- Tool executor ----------------------------------------------------------
export async function executeJttTool(name: string, input: any, ctx: JttContext): Promise<any> {
  const admin = getSupabaseAdmin();
  if (!ctx.leagueId) return { ok: false, error: 'No league context. Open one of your league or matchup pages first.' };
  const leagueId = ctx.leagueId;

  // Re-verify ownership every call (defence in depth).
  const { data: lg } = await admin.from('leagues').select('id, director_id').eq('id', leagueId).maybeSingle();
  if (!lg || (lg as any).director_id !== ctx.userId) return { ok: false, error: 'You do not have permission to change this league.' };

  if (name === 'list_today') {
    const clubs = await clubsOf(admin, leagueId);
    const divs = await divisionsOf(admin, leagueId);
    const { data: matchups } = await admin
      .from('league_team_matchups').select('id, division_id, home_club_id, away_club_id')
      .eq('match_date', today()).in('division_id', divs.map((d: any) => d.id));
    const out: any[] = [];
    for (const m of matchups || []) {
      const div = divs.find((d: any) => d.id === (m as any).division_id);
      const ids = [(m as any).home_club_id, (m as any).away_club_id];
      const { data: roster } = await admin
        .from('league_team_rosters').select('id, club_id, player_name, status')
        .eq('division_id', (m as any).division_id).in('club_id', ids).eq('status', 'active');
      const { data: ci } = await admin.from('league_matchup_checkins').select('roster_id').eq('matchup_id', (m as any).id);
      const checked = new Set((ci || []).map((c: any) => c.roster_id));
      const side = (cid: string) => (roster || []).filter((r: any) => r.club_id === cid)
        .map((r: any) => `${r.player_name}${checked.has(r.id) ? ' ✓' : ''}`);
      const club = (cid: string) => clubs.find((c: any) => c.id === cid);
      out.push({
        age: (div as any)?.short_code || (div as any)?.name,
        home: club((m as any).home_club_id)?.short_code, away: club((m as any).away_club_id)?.short_code,
        rosters: {
          [club((m as any).home_club_id)?.short_code || 'home']: side((m as any).home_club_id),
          [club((m as any).away_club_id)?.short_code || 'away']: side((m as any).away_club_id),
        },
      });
    }
    return { ok: true, date: today(), matchups: out, note: '✓ = checked in' };
  }

  // Resolve common args for the write tools.
  const clubs = await clubsOf(admin, leagueId);
  const divs = await divisionsOf(admin, leagueId);
  const club = matchClub(clubs, String(input.club || ''));
  const div = matchDiv(divs, String(input.age || ''));
  if (!club) return { ok: false, error: `Club "${input.club}" not found. Clubs: ${clubs.map((c: any) => c.short_code).join(', ')}` };
  if (!div) return { ok: false, error: `Age group "${input.age}" not found. Divisions: ${divs.map((d: any) => d.short_code).join(', ')}` };

  if (name === 'add_player') {
    const { data: existing } = await admin.from('league_team_rosters')
      .select('id, player_name, ladder_position').eq('division_id', div.id).eq('club_id', club.id);
    if ((existing || []).some((r: any) => norm(r.player_name) === norm(input.player)))
      return { ok: true, message: `${input.player} is already on ${club.short_code} ${div.short_code}.` };
    const nextPos = (existing || []).reduce((mx: number, r: any) => Math.max(mx, r.ladder_position ?? 0), 0) + 1;
    const { error } = await admin.from('league_team_rosters').insert({
      division_id: div.id, club_id: club.id, player_name: String(input.player).trim(), ladder_position: nextPos, status: 'active',
    });
    return error ? { ok: false, error: error.message } : { ok: true, message: `Added ${input.player} to ${club.short_code} ${div.short_code}.` };
  }

  // check_in / check_out / remove_player all need today's matchup for this division+club.
  const mu = await todaysMatchup(admin, div.id, club.id);

  if (name === 'check_in') {
    if (!mu) return { ok: false, error: `No ${div.short_code} match today for ${club.short_code}.` };
    const { data: roster } = await admin.from('league_team_rosters')
      .select('id, player_name, status').eq('division_id', div.id).eq('club_id', club.id);
    let targets = roster || [];
    if (norm(input.player) !== 'all') {
      targets = targets.filter((r: any) => norm(r.player_name) === norm(input.player));
      if (!targets.length) return { ok: false, error: `${input.player} isn't on ${club.short_code} ${div.short_code}. Add them first?` };
    } else {
      targets = targets.filter((r: any) => r.status === 'active');
    }
    await admin.from('league_matchup_checkins').upsert(
      targets.map((r: any) => ({ matchup_id: mu.id, roster_id: r.id })), { onConflict: 'matchup_id,roster_id' });
    return { ok: true, message: `Checked in ${targets.map((r: any) => r.player_name).join(', ')} for ${club.short_code} ${div.short_code}.` };
  }

  if (name === 'check_out') {
    if (!mu) return { ok: false, error: `No ${div.short_code} match today for ${club.short_code}.` };
    const { data: roster } = await admin.from('league_team_rosters')
      .select('id, player_name').eq('division_id', div.id).eq('club_id', club.id);
    const t = (roster || []).find((r: any) => norm(r.player_name) === norm(input.player));
    if (!t) return { ok: false, error: `${input.player} not found on ${club.short_code} ${div.short_code}.` };
    await admin.from('league_matchup_checkins').delete().eq('matchup_id', mu.id).eq('roster_id', t.id);
    return { ok: true, message: `Checked out ${t.player_name} from ${club.short_code} ${div.short_code}.` };
  }

  if (name === 'remove_player') {
    const { data: roster } = await admin.from('league_team_rosters')
      .select('id, player_name').eq('division_id', div.id).eq('club_id', club.id);
    const t = (roster || []).find((r: any) => norm(r.player_name) === norm(input.player));
    if (!t) return { ok: false, error: `${input.player} not found on ${club.short_code} ${div.short_code}.` };
    if (mu) await admin.from('league_matchup_checkins').delete().eq('matchup_id', mu.id).eq('roster_id', t.id);
    await admin.from('league_team_rosters').delete().eq('id', t.id);
    return { ok: true, message: `Removed ${t.player_name} from ${club.short_code} ${div.short_code}.` };
  }

  return { ok: false, error: `Unknown tool ${name}` };
}
