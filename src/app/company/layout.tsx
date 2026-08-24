import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "airsup · company",
  description: "Turn on a company AI that other AIs can talk to.",
};

export default function CompanyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
