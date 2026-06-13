import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MeetingBot",
  description: "AI meeting assistant for Google Meet, Zoom, and Microsoft Teams",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
