import type { Metadata } from "next";
import "./globals.css";
import AnalyticsTracker from "@/components/shared/AnalyticsTracker";

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
      </body>
    </html>
  );
}
