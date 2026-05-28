import type { Metadata } from "next";
import "./globals.css";
import AnalyticsTracker from "@/components/shared/AnalyticsTracker";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "ClubMode AI - The Complete Racquet Sports Platform",
  description: "Six powerful tools for racquet sports clubs: Events, Lessons, Stringing, Player Matching, Roster Management, and AI Coaching.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AnalyticsTracker />
        {children}
        <Toaster theme="dark" position="bottom-right" toastOptions={{ style: { background: '#002838', color: '#fff', border: '1px solid rgba(255,255,255,0.08)' } }} />
      </body>
    </html>
  );
}
