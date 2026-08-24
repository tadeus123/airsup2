import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Airsup",
  description: "AI on your domain.",
};

export default function CompanyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
