"use client";
// Per-job client portal — Client Hub V2 shop skin (P1, Jul 20 2026).
// This page is now a thin shell: shop chrome (wordmark, project chips, footer)
// around components/hub/OrderExperience, which owns the whole order view.
// Data + actions are unchanged: GET/POST /api/portal/[token]; switching
// projects swaps the active token (each job keeps its own token — a job link
// shows that job; the chips let multi-job clients move between theirs).
import { useState, useEffect } from "react";
import { H } from "@/components/hub/theme";
import { OrderExperience } from "@/components/hub/OrderExperience";

export default function PortalPage({ params }: { params: { token: string } }) {
  const [activeToken, setActiveToken] = useState(params.token);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadData(token: string, quiet = false) {
    if (!quiet) setLoading(true);
    try {
      const res = await fetch(`/api/portal/${token}`);
      if (!res.ok) { setError("This link is no longer valid."); setData(null); return; }
      setData(await res.json());
      setError("");
    } catch { if (!quiet) setError("Unable to load."); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadData(activeToken); /* eslint-disable-next-line */ }, [activeToken]);

  // Catch external changes (payments, team actions): refresh on tab focus +
  // every 60s while visible.
  useEffect(() => {
    const onFocus = () => loadData(activeToken, true);
    window.addEventListener("focus", onFocus);
    const id = setInterval(() => { if (document.visibilityState === "visible") loadData(activeToken, true); }, 60000);
    return () => { window.removeEventListener("focus", onFocus); clearInterval(id); };
    // eslint-disable-next-line
  }, [activeToken]);

  async function doAction(action: string, body?: any) {
    const res = await fetch(`/api/portal/${activeToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    if (res.ok) await loadData(activeToken, true);
  }

  const wordmark = (data?.company?.name || "house party distro").toLowerCase();
  const projects: any[] = data?.clientProjects || [];
  const active = projects.filter(p => !p.isComplete);
  const completed = projects.filter(p => p.isComplete);

  return (
    <div style={{ minHeight: "100vh", background: H.ink, color: H.text, fontFamily: H.font, display: "flex", flexDirection: "column" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        html{background:${H.ink}}
        .hx-chips{display:flex;gap:8px;overflow-x:auto;padding:14px 16px 4px;scrollbar-width:none}
        .hx-chips::-webkit-scrollbar{display:none}
        .hx-chip{flex-shrink:0;border-radius:999px;border:1px solid ${H.line};background:transparent;color:${H.dim};font-family:${H.mono};font-size:11px;font-weight:700;padding:7px 14px;cursor:pointer;white-space:nowrap}
        .hx-chip.on{background:#fff;color:${H.ink};border-color:#fff}
        .hx-chip.done{opacity:.45}
      ` }} />

      {/* Shop chrome */}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "22px 16px 0" }}>
        <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-0.01em", textTransform: "lowercase" }}>{wordmark}</div>
      </div>

      {/* Project chips for multi-job clients */}
      {projects.length > 1 && (
        <nav className="hx-chips" aria-label="Your orders">
          {active.map(p => (
            <button key={p.jobId} className={`hx-chip${p.portalToken === activeToken ? " on" : ""}`}
              onClick={() => p.portalToken && setActiveToken(p.portalToken)}>
              {p.invoiceNumber ? `#${p.invoiceNumber}` : p.jobNumber}
            </button>
          ))}
          {completed.map(p => (
            <button key={p.jobId} className={`hx-chip done${p.portalToken === activeToken ? " on" : ""}`}
              onClick={() => p.portalToken && setActiveToken(p.portalToken)}>
              {p.invoiceNumber ? `#${p.invoiceNumber}` : p.jobNumber}
            </button>
          ))}
        </nav>
      )}

      <div style={{ flex: 1 }}>
        {loading ? (
          <div style={{ minHeight: "50vh", display: "flex", alignItems: "center", justifyContent: "center", color: H.faint, fontSize: 13 }}>Loading…</div>
        ) : error || !data ? (
          <div style={{ minHeight: "50vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 20, textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 900, textTransform: "uppercase" }}>Link not found.</div>
            <div style={{ fontSize: 13, color: H.dim, maxWidth: "44ch" }}>{error || "This portal link is invalid or has been removed."} If you think that's wrong, reply to your rep and we'll sort it out.</div>
          </div>
        ) : (
          <OrderExperience data={data} token={activeToken} onAction={doAction} />
        )}
      </div>

      <footer style={{ borderTop: `1px solid ${H.line}`, padding: "26px 22px", display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, textTransform: "lowercase" }}>{wordmark}</div>
          <div style={{ fontSize: 11.5, color: H.faint, marginTop: 5 }}>Custom apparel from concept to delivery. Las Vegas, NV</div>
        </div>
        <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint }}>Built in Las Vegas</div>
      </footer>
    </div>
  );
}
