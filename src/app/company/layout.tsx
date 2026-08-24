import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Company",
  description: "Publish a company AI endpoint on Airsup — domain, password, and your own model key.",
};

export default function CompanyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
