import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { vaultPlayerIds } = await request.json();

    if (!vaultPlayerIds || vaultPlayerIds.length === 0) {
      return NextResponse.json({ error: 'No players specified' }, { status: 400 });
    }

    // Get vault players
    const { data: vaultPlayers } = await supabase
      .from('cc_vault_players')
      .select('*')
      .in('id', vaultPlayerIds);

    if (!vaultPlayers || vaultPlayers.length === 0) {
      return NextResponse.json({ error: 'No players found' }, { status: 404 });
    }

    let imported = 0;
    let skipped = 0;

    for (const vp of vaultPlayers) {
      // Skip if already connected
      if (vp.cc_player_id) {
        skipped++;
        continue;
      }

      // Check if a cc_player already exists for this email (via profile lookup)
      let existingPlayerId: string | null = null;

      if (vp.email) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', vp.email)
          .single();

        if (profile) {
          const { data: existingPlayer } = await supabase
            .from('cc_players')
            .select('id')
            .eq('profile_id', profile.id)
            .single();

          if (existingPlayer) {
            existingPlayerId = existingPlayer.id;
          }
        }
      }

      if (existingPlayerId) {
        // Link vault player to existing cc_player
        await supabase
          .from('cc_vault_players')
          .update({ cc_player_id: existingPlayerId })
          .eq('id', vp.id);

        // Update cc_player_sports with vault ratings if not already set
        if (vp.usta_rating || vp.utr_rating) {
          const { data: existingSport } = await supabase
            .from('cc_player_sports')
            .select('id')
            .eq('player_id', existingPlayerId)
            .eq('sport', vp.primary_sport)
            .single();

          if (!existingSport) {
            await supabase.from('cc_player_sports').insert({
              player_id: existingPlayerId,
              sport: vp.primary_sport,
              ntrp_rating: vp.usta_rating,
              utr_rating: vp.utr_rating,
              is_self_rated: false,
              admin_override: true,
              admin_override_by: vp.director_id,
              admin_override_at: new Date().toISOString(),
              level_label: vp.usta_rating ? `NTRP ${vp.usta_rating}` : null,
            });
          }
        }

        imported++;
      } else {
        // Create a new cc_player record (director-managed, no profile_id link yet)
        // The player will claim this when they sign up and the email matches
        const { data: newPlayer } = await supabase
          .from('cc_players')
          .insert({
            profile_id: vp.director_id, // Temporarily owned by director
            display_name: vp.full_name,
            primary_sport: vp.primary_sport,
            organization_id: vp.organization_id,
          })
          .select()
          .single();

        if (newPlayer) {
          // Link vault to cc_player
          await supabase
            .from('cc_vault_players')
            .update({ cc_player_id: newPlayer.id })
            .eq('id', vp.id);

          // Add sport rating
          if (vp.usta_rating || vp.utr_rating) {
            await supabase.from('cc_player_sports').insert({
              player_id: newPlayer.id,
              sport: vp.primary_sport,
              ntrp_rating: vp.usta_rating,
              utr_rating: vp.utr_rating,
              is_self_rated: false,
              admin_override: true,
              admin_override_by: vp.director_id,
              admin_override_at: new Date().toISOString(),
              level_label: vp.usta_rating ? `NTRP ${vp.usta_rating}` : null,
            });
          }

          imported++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      skipped,
      total: vaultPlayers.length,
    });

  } catch (error) {
    console.error('Vault import error:', error);
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}
