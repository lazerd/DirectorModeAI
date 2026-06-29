import type { Metadata } from "next";
import "./globals.css";
import AnalyticsTracker from "@/components/shared/AnalyticsTracker";
import AssistantWidget from "@/components/assistant/AssistantWidget";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "ClubMode AI — Run Your Entire Racquet Sports Club",
  description: "One platform to run your club: live court sheets, team leagues & junior team tennis, mixers & tournaments, lessons, stringing, player matching, roster CRM, and AI coaching.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Barlow superfamily — used by the canvas-rendered results card */}
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@800;900&family=Barlow+Semi+Condensed:wght@600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AnalyticsTracker />
        {children}
        <AssistantWidget />
        <Toaster theme="dark" position="bottom-right" toastOptions={{ style: { background: '#002838', color: '#fff', border: '1px solid rgba(255,255,255,0.08)' } }} />
      </body>
    </html>
  );
}
