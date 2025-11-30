'use client';

import { useState, useEffect } from 'react';
import { Plus, Search, Package, Trash2, Check, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type StringItem = { id: string; brand: string; name: string; string_type: string; gauge: string | null; price: number | null; in_stock: boolean; };

export default function CatalogPage() {
  const [strings, setStrings] = useState<StringItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newString, setNewString] = useState({ brand: '', name: '', string_type: 'poly', gauge: '16', price: '', in_stock: true });

  useEffect(() => { fetchStrings(); }, []);

  const fetchStrings = async () => {
    const supabase = createClient();
    const { data } = await supabase.from('stringing_catalog').select('*').order('brand').order('name');
    if (data) setStrings(data);
    setLoading(false);
  };

  const addString = async () => {
    if (!newString.brand || !newString.name) return;
    const supabase = createClient();
    await supabase.from('stringing_catalog').insert({ brand: newString.brand, name: newString.name, string_type: newString.string_type, gauge: newString.gauge, price: newString.price ? parseFloat(newString.price) : null, in_stock: newString.in_stock });
    setNewString({ brand: '', name: '', string_type: 'poly', gauge: '16', price: '', in_stock: true });
    setShowAdd(false);
    fetchStrings();
  };

  const toggleStock = async (id: string, current: boolean) => {
    const supabase = createClient();
    await supabase.from('stringing_catalog').update({ in_stock: !current }).eq('id', id);
    fetchStrings();
  };

  const deleteString = async (id: string) => {
    if (!confirm('Delete this string?')) return;
    const supabase = createClient();
    await supabase.from('stringing_catalog').delete().eq('id', id);
    fetchStrings();
  };

  const filtered = strings.filter(s => s.brand.toLowerCase().includes(search.toLowerCase()) || s.name.toLowerCase().includes(search.toLowerCase()));
  const types: Record<string, string> = { poly: 'Polyester', multi: 'Multifilament', synthetic_gut: 'Synthetic Gut', natural_gut: 'Natural Gut', hybrid: 'Hybrid', other: 'Other' };

  return (
    <div className="p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div><h1 className="font-semibold text-2xl">String Catalog</h1><p className="text-gray-500 text-sm">Manage your inventory</p></div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700"><Plus size={18} />Add String</button>
      </div>

      <div className="relative mb-6">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg" placeholder="Search strings..." />
      </div>

      {showAdd && (
        <div className="bg-white rounded-xl border p-6 mb-6">
          <h2 className="font-semibold text-lg mb-4">Add New String</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <input type="text" value={newString.brand} onChange={(e) => setNewString({ ...newString, brand: e.target.value })} className="px-3 py-2 border rounded-lg" placeholder="Brand *" />
            <input type="text" value={newString.name} onChange={(e) => setNewString({ ...newString, name: e.target.value })} className="px-3 py-2 border rounded-lg" placeholder="Name *" />
            <select value={newString.string_type} onChange={(e) => setNewString({ ...newString, string_type: e.target.value })} className="px-3 py-2 border rounded-lg">
              <option value="poly">Polyester</option><option value="multi">Multifilament</option><option value="synthetic_gut">Synthetic Gut</option><option value="natural_gut">Natural Gut</option><option value="hybrid">Hybrid</option>
            </select>
            <select value={newString.gauge} onChange={(e) => setNewString({ ...newString, gauge: e.target.value })} className="px-3 py-2 border rounded-lg">
              <option value="15">15</option><option value="15L">15L</option><option value="16">16</option><option value="16L">16L</option><option value="17">17</option><option value="18">18</option>
            </select>
            <input type="number" value={newString.price} onChange={(e) => setNewString({ ...newString, price: e.target.value })} className="px-3 py-2 border rounded-lg" placeholder="Price ($)" step="0.01" />
            <label className="flex items-center gap-2 px-3 py-2"><input type="checkbox" checked={newString.in_stock} onChange={(e) => setNewString({ ...newString, in_stock: e.target.checked })} className="w-4 h-4" />In Stock</label>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 border rounded-lg">Cancel</button>
            <button onClick={addString} className="px-4 py-2 bg-purple-600 text-white rounded-lg">Add</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-purple-500 border-t-transparent rounded-full" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border p-12 text-center">
          <Package size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="font-semibold text-lg mb-2">No strings in catalog</h3>
          <button onClick={() => setShowAdd(true)} className="px-4 py-2 bg-purple-600 text-white rounded-lg">Add String</button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full">
            <thead><tr className="bg-gray-50 border-b">
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">String</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Type</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Gauge</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Price</th>
              <th className="text-center px-4 py-3 text-sm font-medium text-gray-500">Stock</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-500"></th>
            </tr></thead>
            <tbody className="divide-y">
              {filtered.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{s.brand} {s.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{types[s.string_type] || s.string_type}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{s.gauge || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{s.price ? `$${s.price.toFixed(2)}` : '-'}</td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => toggleStock(s.id, s.in_stock)} className={`p-1 rounded ${s.in_stock ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                      {s.in_stock ? <Check size={16} /> : <X size={16} />}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right"><button onClick={() => deleteString(s.id)} className="p-2 text-gray-400 hover:text-red-500"><Trash2 size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
