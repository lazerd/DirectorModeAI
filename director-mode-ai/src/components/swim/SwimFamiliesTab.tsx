'use client';

import { useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Edit3,
  Loader2,
  Upload,
  Download,
  AlertCircle,
  Link as LinkIcon,
  Check,
  Mail,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { SwimFamily } from '@/app/swim/[id]/page';

export default function SwimFamiliesTab({
  seasonId,
  defaultPointsRequired,
  families,
  familyProgress,
  onRefresh,
}: {
  seasonId: string;
  defaultPointsRequired: number;
  families: SwimFamily[];
  familyProgress: Map<
    string,
    { earned: number; pending: number; required: number; percent: number; pendingPercent: number }
  >;
  onRefresh: () => Promise<void> | void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [emailed, setEmailed] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState({
    family_name: '',
    primary_email: '',
    primary_phone: '',
    num_swimmers: '' as string | number,
    points_required: '' as string | number,
    notes: '',
  });

  const reset = () => {
    setForm({
      family_name: '',
      primary_email: '',
      primary_phone: '',
      num_swimmers: '',
      points_required: '',
      notes: '',
    });
    setShowAdd(false);
    setEditing(null);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy('save');
    const payload = {
      season_id: seasonId,
      family_name: form.family_name.trim(),
      primary_email: form.primary_email.trim() || null,
      primary_phone: form.primary_phone.trim() || null,
      num_swimmers:
        form.num_swimmers === '' ? null : parseInt(String(form.num_swimmers), 10),
      points_required:
        form.points_required === '' ? null : parseInt(String(form.points_required), 10),
      notes: form.notes.trim() || null,
    };
    const { error: err } = editing
      ? await supabase.from('swim_families').update(payload).eq('id', editing)
      : await supabase.from('swim_families').insert(payload);
    if (err) {
      setError(err.message);
      setBusy(null);
      return;
    }
    reset();
    await onRefresh();
    setBusy(null);
  };

  const startEdit = (f: SwimFamily) => {
    setEditing(f.id);
    setForm({
      family_name: f.family_name,
      primary_email: f.primary_email ?? '',
      primary_phone: f.primary_phone ?? '',
      num_swimmers: f.num_swimmers ?? '',
      points_required: f.points_required ?? '',
      notes: f.notes ?? '',
    });
    setShowAdd(true);
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this family + all their assignments?')) return;
    setBusy(id);
    await supabase.from('swim_families').delete().eq('id', id);
    await onRefresh();
    setBusy(null);
  };

  const linkFor = (token: string) =>
    typeof window !== 'undefined'
      ? `${window.location.origin}/swim-family/${token}`
      : `/swim-family/${token}`;

  const copyLink = async (f: SwimFamily) => {
    try {
      await navigator.clipboard.writeText(linkFor(f.family_token));
      setCopied(f.id);
      setTimeout(() => setCopied((c) => (c === f.id ? null : c)), 1800);
    } catch {
      window.prompt('Copy this link to share with the family:', linkFor(f.family_token));
    }
  };

  const emailLink = async (f: SwimFamily) => {
    if (!f.primary_email) {
      setError(
        `${f.family_name} has no email on file — add one first (✎ Edit), then try again.`
      );
      return;
    }
    setError(null);
    setBusy(`email-${f.id}`);
    try {
      const res = await fetch(`/api/swim/families/${f.id}/email-link`, {
        method: 'POST',
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j?.error || 'Could not send email.');
      } else {
        setEmailed(f.id);
        setTimeout(() => setEmailed((e) => (e === f.id ? null : e)), 2200);
      }
    } catch (e: any) {
      setError(e?.message || 'Network error sending email.');
    }
    setBusy(null);
  };

  const emailAll = async () => {
    const withEmail = families.filter((f) => f.primary_email);
    const withoutEmail = families.length - withEmail.length;
    if (withEmail.length === 0) {
      setError('No families have an email on file.');
      return;
    }
    if (
      !confirm(
        `Email signup links to ${withEmail.length} ${withEmail.length === 1 ? 'family' : 'families'}` +
          (withoutEmail ? ` (${withoutEmail} skipped — no email)` : '') +
          '?'
      )
    )
      return;
    setError(null);
    setBusy('email-all');
    let sent = 0;
    let failed = 0;
    for (const f of withEmail) {
      const res = await fetch(`/api/swim/families/${f.id}/email-link`, { method: 'POST' });
      if (res.ok) sent++;
      else failed++;
    }
    setImportMsg(
      `✓ Sent ${sent} ${sent === 1 ? 'email' : 'emails'}` +
        (failed ? ` · ${failed} failed` : '') +
        (withoutEmail ? ` · ${withoutEmail} skipped (no email)` : '')
    );
    setBusy(null);
  };

  // Naive but adequate CSV parser. Handles quoted fields with commas.
  const parseCsv = (raw: string): Array<Record<string, string>> => {
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return [];
    const splitRow = (line: string) => {
      const out: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (inQuotes && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (c === ',' && !inQuotes) {
          out.push(cur);
          cur = '';
        } else {
          cur += c;
        }
      }
      out.push(cur);
      return out.map((s) => s.trim());
    };
    const headers = splitRow(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
    return lines.slice(1).map((line) => {
      const cells = splitRow(line);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = cells[i] ?? '';
      });
      return row;
    });
  };

  const handleCsvUpload = async (file: File) => {
    setImportMsg(null);
    setError(null);
    setBusy('import');
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) {
        setError('CSV is empty.');
        setBusy(null);
        return;
      }

      const inserts = rows
        .map((r) => {
          const family_name =
            r.family_name || r.family || r.name || r.last_name || '';
          if (!family_name.trim()) return null;
          const numSwim = r.num_swimmers || r.swimmers || '';
          const ptsReq = r.points_required || r.target || '';
          return {
            season_id: seasonId,
            family_name: family_name.trim(),
            primary_email: (r.primary_email || r.email || '').trim() || null,
            primary_phone: (r.primary_phone || r.phone || '').trim() || null,
            num_swimmers: numSwim ? parseInt(numSwim, 10) || null : null,
            points_required: ptsReq ? parseInt(ptsReq, 10) || null : null,
            notes: (r.notes || '').trim() || null,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      if (inserts.length === 0) {
        setError('No valid rows found. Need a "family_name" column.');
        setBusy(null);
        return;
      }

      const { error: err } = await supabase.from('swim_families').insert(inserts);
      if (err) {
        setError(err.message);
      } else {
        setImportMsg(`✓ Imported ${inserts.length} families.`);
        await onRefresh();
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to import CSV');
    }
    setBusy(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const downloadTemplate = () => {
    const csv =
      'family_name,primary_email,primary_phone,num_swimmers,points_required,notes\n' +
      'Cohen,parent@example.com,555-123-4567,2,30,\n' +
      'Smith,jen@example.com,555-987-6543,1,,\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'swim-families-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportLinks = () => {
    const rows = [['Family', 'Email', 'Phone', 'Signup Link']];
    for (const f of [...families].sort((a, b) => a.family_name.localeCompare(b.family_name))) {
      rows.push([
        f.family_name,
        f.primary_email ?? '',
        f.primary_phone ?? '',
        linkFor(f.family_token),
      ]);
    }
    const csv = rows
      .map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'swim-family-signup-links.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const sorted = [...families].sort((a, b) => a.family_name.localeCompare(b.family_name));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-semibold text-lg text-gray-900">Families</h2>
          <p className="text-sm text-gray-600">
            Each family has a private signup link. Per-family target overrides the season default
            ({defaultPointsRequired} pts).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={emailAll}
            disabled={families.length === 0 || busy === 'email-all'}
            className="inline-flex items-center gap-2 px-3 py-2 border border-cyan-300 hover:bg-cyan-50 text-cyan-700 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {busy === 'email-all' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Mail size={14} />
            )}
            Email all links
          </button>
          <button
            onClick={exportLinks}
            disabled={families.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 hover:bg-gray-50 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            <LinkIcon size={14} /> Export signup links
          </button>
          <button
            onClick={downloadTemplate}
            className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 hover:bg-gray-50 rounded-lg text-sm font-medium"
          >
            <Download size={14} /> CSV template
          </button>
          <label className="inline-flex items-center gap-2 px-3 py-2 border border-cyan-300 hover:bg-cyan-50 text-cyan-700 rounded-lg text-sm font-medium cursor-pointer">
            <Upload size={14} /> Upload CSV
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleCsvUpload(f);
              }}
            />
          </label>
          <button
            onClick={() => (showAdd ? reset() : setShowAdd(true))}
            className="inline-flex items-center gap-2 px-3 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-semibold"
          >
            <Plus size={14} />
            {showAdd ? 'Cancel' : 'Add family'}
          </button>
        </div>
      </div>

      {importMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-2.5 text-sm">
          {importMsg}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5 text-sm flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" /> {error}
        </div>
      )}

      {showAdd && (
        <form
          onSubmit={submit}
          className="bg-white rounded-xl border border-gray-200 p-4 space-y-3"
        >
          <h3 className="font-semibold">{editing ? 'Edit family' : 'Add family'}</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Family name *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Cohen"
                value={form.family_name}
                onChange={(e) => setForm({ ...form, family_name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={form.primary_email}
                onChange={(e) => setForm({ ...form, primary_email: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                value={form.primary_phone}
                onChange={(e) => setForm({ ...form, primary_phone: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                # swimmers
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={form.num_swimmers}
                onChange={(e) => setForm({ ...form, num_swimmers: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Target points (override)
              </label>
              <input
                type="number"
                min={0}
                max={1000}
                placeholder={`Default ${defaultPointsRequired}`}
                value={form.points_required}
                onChange={(e) => setForm({ ...form, points_required: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={busy === 'save' || !form.family_name.trim()}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2"
          >
            {busy === 'save' && <Loader2 size={14} className="animate-spin" />}
            {editing ? 'Save changes' : 'Add family'}
          </button>
        </form>
      )}

      {sorted.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500">
          No families yet. Add one manually or upload a CSV above.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-2">Family</th>
                <th className="text-left px-3 py-2">Contact</th>
                <th className="text-left px-3 py-2 w-20">Swimmers</th>
                <th className="text-left px-3 py-2 w-28">Target</th>
                <th className="text-left px-3 py-2 w-56">Signup link</th>
                <th className="text-right px-3 py-2 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((f) => {
                const target = f.points_required ?? defaultPointsRequired;
                const overridden = f.points_required != null;
                return (
                  <tr key={f.id} className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{f.family_name}</div>
                      {f.notes && <div className="text-xs text-gray-500">{f.notes}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700">
                      {f.primary_email || '—'}
                      {f.primary_phone && (
                        <div className="text-gray-500">{f.primary_phone}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700">
                      {f.num_swimmers ?? <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className="font-semibold text-cyan-700">{target}</span>
                      {overridden && (
                        <span className="ml-1 text-[10px] uppercase font-medium text-cyan-600">
                          override
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="inline-flex gap-1">
                        <button
                          onClick={() => copyLink(f)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border border-cyan-300 text-cyan-700 hover:bg-cyan-50 rounded"
                        >
                          {copied === f.id ? (
                            <>
                              <Check size={12} /> Copied
                            </>
                          ) : (
                            <>
                              <LinkIcon size={12} /> Copy
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => emailLink(f)}
                          disabled={busy === `email-${f.id}` || !f.primary_email}
                          title={
                            !f.primary_email
                              ? 'No email on file — edit family to add one'
                              : `Email link to ${f.primary_email}`
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border border-cyan-300 text-cyan-700 hover:bg-cyan-50 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {busy === `email-${f.id}` ? (
                            <>
                              <Loader2 size={12} className="animate-spin" /> Sending
                            </>
                          ) : emailed === f.id ? (
                            <>
                              <Check size={12} /> Sent
                            </>
                          ) : (
                            <>
                              <Mail size={12} /> Email
                            </>
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => startEdit(f)}
                          className="p-1.5 hover:bg-cyan-50 text-cyan-600 rounded"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          onClick={() => remove(f.id)}
                          disabled={busy === f.id}
                          className="p-1.5 hover:bg-red-50 text-red-500 rounded"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
