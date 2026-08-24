import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Portal",
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="portal-shell">{children}</div>;
}
