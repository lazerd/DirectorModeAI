'use client';

import { useState, useEffect } from 'react';
import { Search, Database, X, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type VaultPlayer = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  gender: string | null;
  age: number | null;
  usta_rating: number | null;
  utr_rating: number | null;
  primary_sport: string;
  notes: string | null;
};

type VaultPickerProps = {
  onSelect: (player: VaultPlayer) => void;
  onClose: () => void;
  multiSelect?: boolean;
  onMultiSelect?: (players: VaultPlayer[]) => void;
  filterSport?: string;
};

export default function VaultPicker({ onSelect, onClose, multiSelect = false, onMultiSelect, filterSport }: VaultPickerProps) {
  const [players, setPlayers] = useState<VaultPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchVaultPlayers();
  }, []);

  const fetchVaultPlayers = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    let query = supabase
      .from('cc_vault_players')
      .select('id, full_name, email, phone, gender, age, usta_rating, utr_rating, primary_sport, notes')
      .eq('director_id', user.id)
      .eq('membership_status', 'active')
      .order('full_name');

    if (filterSport) {
      query = query.eq('primary_sport', filterSport);
    }

    const { data } = await query;
    if (data) setPlayers(data);
    setLoading(false);
  };

  const filtered = players.filter(p =>
    !search ||
    p.full_name.toLowerCase().includes(search.toLowerCase()) ||
    p.email?.toLowerCase().includes(search.toLowerCase())
  );

  const toggleSelect = (player: VaultPlayer) => {
    if (multiSelect) {
      const next = new Set(selectedIds);
      if (next.has(player.id)) {
        next.delete(player.id);
      } else {
        next.add(player.id);
      }
      setSelectedIds(next);
    } else {
      onSelect(player);
    }
  };

  const handleConfirmMulti = () => {
    if (onMultiSelect) {
      const selected = players.filter(p => selectedIds.has(p.id));
      onMultiSelect(selected);
    }
  };

  const sportLabel = (sport: string) =>
    sport.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

  const genderLabel = (g: string | null) => {
    if (!g) return '';
    if (g === 'non_binary') return 'NB';
    return g.charAt(0).toUpperCase();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Database size={20} className="text-[#D3FB52]" />
            <h2 className="text-lg font-semibold text-white">Import from PlayerVault</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
            <X size={18} className="text-white/60" />
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            placeholder="Search by name or email..."
            className="input pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        {/* Player List */}
        <div className="max-h-80 overflow-y-auto mb-4">
          {loading ? (
            <div className="flex justify-center py-8"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8">
              <Database size={32} className="mx-auto text-white/20 mb-2" />
              <p className="text-white/40 text-sm">
                {players.length === 0 ? 'No players in your vault yet.' : 'No players match your search.'}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map(player => {
                const isSelected = selectedIds.has(player.id);
                return (
                  <button
                    key={player.id}
                    onClick={() => toggleSelect(player)}
                    className={`w-full text-left p-3 rounded-lg transition-all ${
                      isSelected
                        ? 'bg-[#D3FB52]/10 border border-[#D3FB52]/30'
                        : 'hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white text-sm">{player.full_name}</span>
                          {player.gender && (
                            <span className="text-xs text-white/30">{genderLabel(player.gender)}</span>
                          )}
                          {player.usta_rating && (
                            <span className="text-xs px-1.5 py-0.5 bg-emerald-400/10 text-emerald-400 rounded">
                              {player.usta_rating}
                            </span>
                          )}
                          {player.utr_rating && (
                            <span className="text-xs px-1.5 py-0.5 bg-blue-400/10 text-blue-400 rounded">
                              UTR {player.utr_rating}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-white/40 mt-0.5">
                          {player.email || 'No email'}
                          {player.phone && ` · ${player.phone}`}
                          {' · '}{sportLabel(player.primary_sport)}
                        </div>
                      </div>
                      {multiSelect && (
                        <div className={`w-5 h-5 rounded border flex items-center justify-center ml-3 ${
                          isSelected ? 'bg-[#D3FB52] border-[#D3FB52]' : 'border-white/20'
                        }`}>
                          {isSelected && <Check size={12} className="text-[#002838]" />}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {multiSelect && (
          <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
            <span className="text-sm text-white/40">
              {selectedIds.size} selected
            </span>
            <div className="flex gap-2">
              <button onClick={onClose} className="btn btn-ghost btn-sm">Cancel</button>
              <button
                onClick={handleConfirmMulti}
                className="btn btn-sm bg-[#D3FB52] text-[#002838] hover:bg-[#c5f035] font-semibold"
                disabled={selectedIds.size === 0}
              >
                Import {selectedIds.size} Player{selectedIds.size !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
