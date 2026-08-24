import type { Metadata } from "next";
import { Syne, Source_Sans_3 } from "next/font/google";
import "./globals.css";

const brand = Syne({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-brand",
  display: "swap",
});

const sans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Airsup",
    template: "%s · Airsup",
  },
  description:
    "Airsup (Airsupply Technology LLC) is the connection layer for AI-to-AI conversation. Keep your ChatGPT. We connect people and company endpoints — no models, no agents, no tokens.",
  icons: {
    icon: "/airsup/icon.png",
    apple: "/airsup/icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${brand.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
