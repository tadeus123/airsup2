import type { Metadata } from "next";
import { Cormorant_Garamond, DM_Sans } from "next/font/google";

const portalDisplay = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-portal-display",
});

const portalSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-portal-sans",
});

export const metadata: Metadata = {
  title: "portal · airsup",
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`portal-shell ${portalDisplay.variable} ${portalSans.variable}`}>
      {children}
    </div>
  );
}
