import type { Metadata } from "next";
import "./globals.css";

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
      <body>{children}</body>
    </html>
  );
}
