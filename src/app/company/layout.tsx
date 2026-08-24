import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Company endpoint",
  description: "Publish a negotiable AI endpoint on your company domain. Airsup connects buyer ChatGPTs to your AI.",
};

export default function CompanyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
