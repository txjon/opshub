"use client";

// Error boundary for every (dashboard) page. It renders INSIDE the dashboard
// layout, so the app shell and nav stay put — the root app/error.tsx replaced
// the whole screen.
//
// Board loaders fail LOUDLY on a bad read (lib/item-state allRows, Oct 2026):
// a failed read used to look like "no rows" and blanked /staging2 with no
// error anywhere. This is where that loud failure lands. Production hides
// server error text from the browser, so the page is named from its URL (the
// same catalog the sidebar uses) and the digest is shown as a reference code
// that matches the server log.

import { useEffect, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PAGE_CATALOG, pathToPageKey } from "@/lib/access";
import { T, mono } from "@/lib/theme";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  const key = pathToPageKey(pathname);
  const page = PAGE_CATALOG.find(p => p.key === key)?.label || "This page";

  useEffect(() => { console.error(`[${pathname}]`, error); }, [error, pathname]);

  // Server-component errors need a fresh render, not just a client reset.
  const retry = () => startRetry(() => { router.refresh(); reset(); });

  return (
    <div style={{ maxWidth: 560, margin: "64px auto", padding: "0 16px" }}>
      <div style={{ padding: "22px 22px 20px", borderRadius: 12, border: `1px solid ${T.border}`, background: T.surface }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.red }}>Didn&apos;t load</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "8px 0 0", color: T.text }}>{page} couldn&apos;t load</h1>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: T.muted, margin: "10px 0 0" }}>
          Nothing was changed. A read from the database failed, so OpsHub stopped here instead of showing a
          board with missing items. Try again. If it keeps happening, send the reference below.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 18 }}>
          <button onClick={retry} disabled={retrying}
            style={{ fontSize: 13, fontWeight: 800, color: "#0a0a0a", background: T.accent, border: "none", borderRadius: 999, padding: "9px 18px", cursor: retrying ? "default" : "pointer", opacity: retrying ? 0.6 : 1 }}>
            {retrying ? "Retrying…" : "Try again"}
          </button>
          {error.digest && (
            <span style={{ fontSize: 12, color: T.faint, fontFamily: mono }}>
              Reference {error.digest}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
