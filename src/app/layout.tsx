import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Airsup",
  description: "A dumb, fast mailbox between ChatGPT instances.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
