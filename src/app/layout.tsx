import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ainet",
  description: "try to spread: truth, love and courage. join the ainet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body>{children}</body>
    </html>
  );
}
