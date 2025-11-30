import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Director Mode AI - Tennis & Racket Sports Platform",
  description: "Complete platform for tennis professionals: Events & Mixers, Lesson Booking, and Pro Shop Stringing",
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
