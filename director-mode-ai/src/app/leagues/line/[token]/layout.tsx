// This league sub-page is authored light (dark gray-900 text, white cards),
// like its sibling /bracket which sets `min-h-screen bg-gray-50` itself. The
// page was missing that wrapper, so its text rendered dark-on-navy (the global
// <body> is dark). Provide the light surface here so the page reads correctly.
// Scoped to this segment only — the dark /leagues/[slug] hub is unaffected.
export default function LeagueLightLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gray-50 text-gray-900">{children}</div>;
}
