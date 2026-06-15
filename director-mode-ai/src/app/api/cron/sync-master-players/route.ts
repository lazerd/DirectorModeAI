import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

// Service-role client (bypasses RLS — this job is the system of record for
// master_players). Resolved lazily through a proxy so merely importing this
// module (e.g. during `next build` page-data collection) doesn't require the
// Supabase env vars to be present.
const supabase = new Proxy({} as ReturnType<typeof getSupabaseAdmin>, {
  get(_target, prop) {
    const client = getSupabaseAdmin() as any;
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

const BATCH_SIZE = 200; // per-table per-run cap

// ───────────────────────────────────────────────────────────────
// Identity helpers
// ───────────────────────────────────────────────────────────────

function normEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}

function normPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

interface PersonCandidate {
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  dob?: string | null;
  parentEmail?: string | null;
  parentPhone?: string | null;
}

/**
 * Find or create a master_player matching this candidate.
 * Match priority: email → phone → none (create new).
 * Returns the matched master_player_id and whether it was newly created.
 */
async function findOrCreateMasterPlayer(c: PersonCandidate): Promise<{ id: string; created: boolean }> {
  const emailNorm = normEmail(c.email);
  const phoneNorm = normPhone(c.phone);

  // 1) Try email match
  if (emailNorm) {
    const { data } = await supabase
      .from('master_players')
      .select('id')
      .eq('email_normalized', emailNorm)
      .limit(1)
      .maybeSingle();
    if (data?.id) return { id: data.id, created: false };
  }

  // 2) Try phone match
  if (phoneNorm) {
    const { data } = await supabase
      .from('master_players')
      .select('id')
      .eq('phone_normalized', phoneNorm)
      .limit(1)
      .maybeSingle();
    if (data?.id) return { id: data.id, created: false };
  }

  // 3) No match → create new
  const { data: created, error } = await supabase
    .from('master_players')
    .insert({
      email: c.email || null,
      phone: c.phone || null,
      phone_normalized: phoneNorm,
      full_name: c.fullName || null,
      dob: c.dob || null,
      parent_email: c.parentEmail || null,
      parent_phone: c.parentPhone || null,
    })
    .select('id')
    .single();

  if (error || !created) {
    throw new Error(`Failed to create master_player: ${error?.message}`);
  }
  return { id: created.id, created: true };
}

// ───────────────────────────────────────────────────────────────
// Per-table sync. Each returns { processed, matched, created }.
// Skips tables that don't exist (e.g. in dev) by returning zeros on error.
// ───────────────────────────────────────────────────────────────

interface SyncResult {
  processed: number;
  matched: number;
  created: number;
  error?: string;
}

async function syncTable(
  table: string,
  selectCols: string,
  buildCandidate: (row: any) => PersonCandidate
): Promise<SyncResult> {
  const result: SyncResult = { processed: 0, matched: 0, created: 0 };

  try {
    const { data: rows, error: selectError } = await supabase
      .from(table)
      .select(selectCols)
      .is('master_player_id', null)
      .limit(BATCH_SIZE);

    if (selectError) {
      result.error = `${table}: ${selectError.message}`;
      return result;
    }
    if (!rows || rows.length === 0) return result;

    for (const row of rows as any[]) {
      const candidate = buildCandidate(row);
      // Skip rows with no identifying info — nothing to match against.
      if (!candidate.email && !candidate.phone && !candidate.fullName) continue;

      try {
        const { id, created } = await findOrCreateMasterPlayer(candidate);
        const { error: updateError } = await supabase
          .from(table)
          .update({ master_player_id: id })
          .eq('id', row.id);

        if (updateError) {
          console.error(`[sync-master-players] update fail ${table}.${row.id}:`, updateError.message);
          continue;
        }
        result.processed++;
        if (created) result.created++;
        else result.matched++;
      } catch (err: any) {
        console.error(`[sync-master-players] row fail ${table}.${row.id}:`, err.message);
      }
    }

    // Record sync state for telemetry
    await supabase
      .from('master_player_sync_state')
      .upsert({
        source_table: table,
        last_synced_at: new Date().toISOString(),
        rows_processed: result.processed,
        rows_matched: result.matched,
        rows_created: result.created,
        last_error: null,
        updated_at: new Date().toISOString(),
      });
  } catch (err: any) {
    result.error = err.message;
    await supabase
      .from('master_player_sync_state')
      .upsert({
        source_table: table,
        last_synced_at: new Date().toISOString(),
        last_error: err.message,
        updated_at: new Date().toISOString(),
      });
  }

  return result;
}

// ───────────────────────────────────────────────────────────────
// Cron handler
// ───────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // Verify cron secret (matches existing cron pattern in /api/lessons/send-reminders)
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const results: Record<string, SyncResult> = {};

  // players (MixerMode V1 — currently live)
  results.players = await syncTable(
    'players',
    'id, name, email, phone',
    (r) => ({ email: r.email, phone: r.phone, fullName: r.name })
  );

  // tournament_entries
  results.tournament_entries = await syncTable(
    'tournament_entries',
    'id, player_name, player_email, player_phone, date_of_birth, parent_email, parent_phone',
    (r) => ({
      email: r.player_email,
      phone: r.player_phone,
      fullName: r.player_name,
      dob: r.date_of_birth,
      parentEmail: r.parent_email,
      parentPhone: r.parent_phone,
    })
  );

  // quad_entries
  results.quad_entries = await syncTable(
    'quad_entries',
    'id, player_name, player_email, player_phone, date_of_birth, parent_email, parent_phone',
    (r) => ({
      email: r.player_email,
      phone: r.player_phone,
      fullName: r.player_name,
      dob: r.date_of_birth,
      parentEmail: r.parent_email,
      parentPhone: r.parent_phone,
    })
  );

  // league_entries (captain side; partner_* synced later)
  results.league_entries = await syncTable(
    'league_entries',
    'id, captain_name, captain_email, captain_phone',
    (r) => ({
      email: r.captain_email,
      phone: r.captain_phone,
      fullName: r.captain_name,
    })
  );

  // league_team_rosters (JTT — high priority for Board Report)
  results.league_team_rosters = await syncTable(
    'league_team_rosters',
    'id, player_name, player_email, player_phone, parent_email, parent_phone',
    (r) => ({
      email: r.player_email,
      phone: r.player_phone,
      fullName: r.player_name,
      parentEmail: r.parent_email,
      parentPhone: r.parent_phone,
    })
  );

  // cc_vault_players (director's CRM)
  results.cc_vault_players = await syncTable(
    'cc_vault_players',
    'id, full_name, email, phone, date_of_birth',
    (r) => ({
      email: r.email,
      phone: r.phone,
      fullName: r.full_name,
      dob: r.date_of_birth,
    })
  );

  // lesson_clients (LastMinuteLesson)
  results.lesson_clients = await syncTable(
    'lesson_clients',
    'id, name, email, phone',
    (r) => ({ email: r.email, phone: r.phone, fullName: r.name })
  );

  // cc_players (linked to profile; pull email via profile join)
  try {
    const { data: ccRows } = await supabase
      .from('cc_players')
      .select('id, display_name, phone, profile_id, profiles!inner(email, full_name)')
      .is('master_player_id', null)
      .limit(BATCH_SIZE);

    let processed = 0, matched = 0, created = 0;
    for (const row of (ccRows || []) as any[]) {
      const candidate: PersonCandidate = {
        email: row.profiles?.email,
        phone: row.phone,
        fullName: row.display_name || row.profiles?.full_name,
      };
      if (!candidate.email && !candidate.phone && !candidate.fullName) continue;
      try {
        const { id, created: wasCreated } = await findOrCreateMasterPlayer(candidate);
        await supabase.from('cc_players').update({ master_player_id: id }).eq('id', row.id);
        processed++;
        if (wasCreated) created++; else matched++;
      } catch (err: any) {
        console.error(`[sync-master-players] cc_players row fail:`, err.message);
      }
    }
    results.cc_players = { processed, matched, created };
    await supabase.from('master_player_sync_state').upsert({
      source_table: 'cc_players',
      last_synced_at: new Date().toISOString(),
      rows_processed: processed,
      rows_matched: matched,
      rows_created: created,
      updated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    results.cc_players = { processed: 0, matched: 0, created: 0, error: err.message };
  }

  // Aggregate
  const totals = Object.values(results).reduce(
    (acc, r) => ({
      processed: acc.processed + r.processed,
      matched: acc.matched + r.matched,
      created: acc.created + r.created,
    }),
    { processed: 0, matched: 0, created: 0 }
  );

  return NextResponse.json({
    ok: true,
    totals,
    perTable: results,
    ranAt: new Date().toISOString(),
  });
}
