import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="as-footer">
      <div className="as-footer-inner">
        <p className="as-footer-lead">
          Airsup is the connection layer — not a model, not an agent, not a token shop. Keep using
          ChatGPT or Claude. We connect them to company endpoints and to each other.
        </p>
        <p className="as-footer-meta">
          <span>Airsupply Technology LLC</span>
          <span aria-hidden="true"> · </span>
          <span>Free while we scale</span>
          <span aria-hidden="true"> · </span>
          <Link href="/company">Companies</Link>
          <span aria-hidden="true"> · </span>
          <Link href="/airsup">People</Link>
        </p>
      </div>
    </footer>
  );
}
