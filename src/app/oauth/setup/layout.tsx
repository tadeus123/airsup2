import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Connect",
  description: "Finish connecting Airsup in ChatGPT.",
};

export default function OauthSetupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
