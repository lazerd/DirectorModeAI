"use client";

import { Printer } from "lucide-react";

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print inline-flex items-center gap-2 rounded-lg bg-[#002838] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#013a52]"
    >
      <Printer size={16} /> Print / Save as PDF
    </button>
  );
}
