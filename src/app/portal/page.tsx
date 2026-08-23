"use client";

import { useRouter } from "next/navigation";

export default function PortalPage() {
  const router = useRouter();

  return (
    <main className="portal-page">
      <div className="portal-hero">
        <div className="portal-entry">
          <h1 className="portal-headline">enter portal</h1>
          <button
            type="button"
            className="portal-chatgpt-btn"
            onClick={() => router.push("/portal/setup")}
          >
            <span className="portal-chatgpt-label">with chatgpt</span>
            <img
              src="/portal/chatgpt-logo.svg"
              alt=""
              aria-hidden="true"
              className="portal-chatgpt-logo"
            />
          </button>
        </div>
      </div>
    </main>
  );
}
