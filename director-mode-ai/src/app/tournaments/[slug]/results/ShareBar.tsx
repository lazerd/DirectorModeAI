'use client';

import { useState } from 'react';
import { Printer, Copy, Share2, Check } from 'lucide-react';

export default function ShareBar({
  tournamentName,
  championName,
}: {
  tournamentName: string;
  championName: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const buildShareText = () => {
    const lines = [`🎾 ${tournamentName} — Final Results`, ''];
    if (championName) lines.push(`🏆 Champion: ${championName}`);
    lines.push('');
    lines.push('via club.coachmode.ai');
    return lines.join('\n');
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildShareText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* swallow */
    }
  };

  const onShare = async () => {
    const text = buildShareText();
    if (navigator.share) {
      try {
        await navigator.share({ title: tournamentName, text });
        return;
      } catch {
        /* fall through to copy */
      }
    }
    onCopy();
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex flex-wrap items-center gap-2 print:hidden">
      <button
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 px-3 py-2 bg-white text-gray-900 rounded-lg text-sm font-semibold hover:bg-gray-100"
      >
        <Printer size={14} /> Print / Save PDF
      </button>
      <button
        onClick={onCopy}
        className="inline-flex items-center gap-2 px-3 py-2 bg-white text-gray-900 rounded-lg text-sm font-semibold hover:bg-gray-100"
      >
        {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
        {copied ? 'Copied!' : 'Copy text'}
      </button>
      <button
        onClick={onShare}
        className="inline-flex items-center gap-2 px-3 py-2 bg-[#D3FB52] text-[#002838] rounded-lg text-sm font-semibold hover:bg-[#C0E848]"
      >
        <Share2 size={14} /> Share
      </button>
      <span className="text-xs text-white/40 ml-auto">Tip: screenshot for socials</span>
    </div>
  );
}
