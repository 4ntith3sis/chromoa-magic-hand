import { Analytics } from "@vercel/analytics/react";
import type { Metadata, Viewport } from "next";
import StageMount from "@/components/StageMount";
import "./globals.css";

export const metadata: Metadata = {
  title: "Magical Wands",
  description: "Your current abilities: Drawing Flowers or Creating Constellations",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0b0f0c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StageMount />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
