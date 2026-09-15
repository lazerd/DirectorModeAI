'use client';

export default function PrintButton() {
  return (
    <button onClick={() => window.print()} className="rounded-xl bg-cyan-400 px-4 py-2 font-semibold text-[#001820]">
      Print
    </button>
  );
}
