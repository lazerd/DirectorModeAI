'use client';

import { Printer } from 'lucide-react';

export default function PrintBar({
  name,
  date,
  format,
}: {
  name: string;
  date: string | null;
  format: string;
}) {
  return (
    <div className="no-print bg-gray-100 border-b border-gray-200 px-4 py-2 flex items-center justify-between gap-2 sticky top-0 z-10">
      <div className="text-xs text-gray-600 truncate">
        <span className="font-semibold text-gray-900">{name}</span>
        <span className="mx-1 text-gray-400">·</span>
        {format}
        {date && (
          <>
            <span className="mx-1 text-gray-400">·</span>
            {date}
          </>
        )}
      </div>
      <button
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#001820] hover:bg-black text-white rounded text-xs font-semibold whitespace-nowrap"
      >
        <Printer size={14} />
        Print / Save PDF
      </button>
    </div>
  );
}
