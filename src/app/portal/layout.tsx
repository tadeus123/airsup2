import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "portal · airsup",
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="portal-shell">{children}</div>;
}
