"use client";

export default function PortalPage() {
  return (
    <main className="portal-entry">
      <aside className="portal-entry-aside" aria-label="portal entry">
        <button type="button" className="portal-entry-btn">
          <span className="portal-entry-btn-primary">enter portal</span>
          <span className="portal-entry-btn-secondary">with chatgpt</span>
        </button>
      </aside>
      <section className="portal-entry-main" aria-label="portal" />
    </main>
  );
}
