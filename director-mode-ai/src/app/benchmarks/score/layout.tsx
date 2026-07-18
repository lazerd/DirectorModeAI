// This page is authored light (dark slate headings/body, teal accents, white
// cards) but the global <body> is dark navy, which left its text unreadable
// (dark-on-navy). Wrap the segment in a light surface so the intended design
// renders correctly. Scoped to this route only — the main /benchmarks page
// stays on the dark theme.
export default function ScoreLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-50">{children}</div>;
}
