'use client';

import { Printer } from 'lucide-react';

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#00131c] text-white font-semibold hover:bg-black transition-colors"
    >
      <Printer size={18} />
      Print posters
    </button>
  );
}
