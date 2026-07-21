"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useClientPortal } from "./_shared/context";
import { C, fmtDate } from "./_shared/theme";

// HOME — the hub's front door (reworked Jul 21 2026). Answers exactly three
// things and nothing else: what needs me, what's dropping next, what's new.
// Studio (Product Development) is hidden pending rethink, so no design
// pills or brief feeds here. Data: orders + items APIs (same as tabs).

export default function HomePage() {
  const { data, token } = useClientPortal();
  const base = `/portal/client/${token}`;
  const [orders, setOrders] = useState<any[] | null>(null);
  const [items, setItems] = useState<any[] | null>(null);
  const hasPipeline = ((data as any)?.features || []).includes("pipeline");

  useEffect(() => {
    (async () => {
      try {
        const [o, i] = await Promise.all([
          fetch(`/api/portal/client/${token}/orders`).then(r => r.json()).catch(() => ({})),
          fetch(`/api/portal/client/${token}/items`).then(r => r.json()).catch(() => ({})),
        ]);
        setOrders(o.orders || []);
        setItems(i.items || []);
      } catch { setOrders([]); setItems([]); }
    })();
    // eslint-disable-next-line
  }, [token]);

  if (!data) return null;

  const unpaid = (orders || []).filter(o => o.payment_status === "unpaid" || o.payment_status === "partial");
  const needsAction = (orders || []).filter(o => !["complete", "cancelled"].includes(o.phase) && ((o.phase === "pending" && !o.quote_approved) || (o.proofs_pending || 0) > 0));
  const active = (items || []).filter(it => !["complete", "archived", "cancelled", "on_hold"].includes(it.status));
  const landing = active
    .filter(it => it.eta && it.status !== "in_stock")
    .sort((a, b) => String(a.eta).localeCompare(String(b.eta)))
    .slice(0, 6);
  const storeReady = active.filter(it => it.status === "in_stock").slice(0, 6);
  const loadingData = orders === null || items === null;

  const pills: { label: string; href: string }[] = [];
  if (needsAction.length > 0) pills.push({
    label: `${needsAction.length} order${needsAction.length === 1 ? "" : "s"} awaiting your approval`,
    // One order -> open it directly; several -> the needs-approval filter.
    href: needsAction.length === 1 ? `${base}/orders?open=${needsAction[0].id}` : `${base}/orders?filter=pending`,
  });

  const thumb = (id: string) => `/api/files/thumbnail?id=${id}&thumb=1&size=500`;

  const Strip = ({ title, sub, list, badge }: { title: string; sub: string; list: any[]; badge: (it: any) => string }) => (
    <section style={{ marginBottom: 38 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>{title}</h2>
        <Link href={`${base}/items`} style={{ fontSize: 10, color: C.muted, textDecoration: "none", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>{sub} →</Link>
      </div>
      <div className="hm-strip">
        {list.map(it => (
          <Link key={it.id} href={`${base}/items`} className="hm-card"
            style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", textDecoration: "none", color: C.text, display: "block" }}>
            <div style={{ background: "#fff", aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {it.thumb_id
                ? <img src={thumb(it.thumb_id)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                : <span style={{ color: "#bbb", fontSize: 11 }}>No preview</span>}
            </div>
            <div style={{ padding: "10px 12px 12px" }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.25, overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical" as any, WebkitLineClamp: 2 }}>{it.name}</div>
              <div style={{ fontSize: 9.5, fontFamily: C.mono, color: C.muted, marginTop: 5 }}>{badge(it)}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );

  return (
    <div style={{ paddingTop: "clamp(8px, 3vw, 28px)" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .hm-strip{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}
        @media(min-width:720px){.hm-strip{grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}}
        .hm-card{transition:transform .15s ease,border-color .15s ease}
        .hm-card:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.3)}
        @media(prefers-reduced-motion:reduce){.hm-card,.hm-card:hover{transition:none;transform:none}}
      ` }} />

      {/* Hero */}
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint, textAlign: "center" }}>
        Welcome back
      </div>
      <h1 style={{ fontSize: "clamp(30px,6.5vw,60px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "8px 0 14px", textWrap: "balance" as any, textAlign: "center" }}>
        {data.client.name}.
      </h1>

      {/* What needs you */}
      {pills.length > 0 ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "0 0 36px", justifyContent: "center" }}>
          {pills.map(n => (
            <Link key={n.label} href={n.href}
              style={{ background: "#fff", color: C.bg, borderRadius: 999, padding: "11px 22px", fontSize: 11, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", textDecoration: "none" }}>
              {n.label} →
            </Link>
          ))}
        </div>
      ) : !loadingData ? (
        <div style={{ fontSize: 14, color: C.muted, margin: "0 0 36px", lineHeight: 1.6, textAlign: "center" }}>
          Nothing needs you right now. Here&rsquo;s what&rsquo;s moving.
        </div>
      ) : <div style={{ height: 36 }} />}

      {loadingData ? (
        <div style={{ color: C.faint, fontSize: 13, padding: "30px 0", textAlign: "center" }}>Loading…</div>
      ) : (
        <>
          {hasPipeline && storeReady.length > 0 && (
            <Strip title="Live-ready." sub="See all" list={storeReady}
              badge={(it) => `${(it.qty || 0).toLocaleString()} pcs ready`} />
          )}
          {hasPipeline && landing.length > 0 && (
            <Strip title="Coming soon." sub="Full pipeline" list={landing}
              badge={(it) => `lands ${fmtDate(it.eta)}`} />
          )}
          {hasPipeline && landing.length === 0 && storeReady.length === 0 && (
            <div style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: "20px 0 40px" }}>
              Nothing in production right now. Tap Reorder to run something back.
            </div>
          )}

          {/* Quick doors */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", margin: "6px 0 20px" }}>
            {[{ label: "Reorder", href: `${base}/reorder` }, { label: "Orders", href: `${base}/orders` }, ...(hasPipeline ? [{ label: "Pipeline", href: `${base}/items` }] : [])].map(d => (
              <Link key={d.label} href={d.href}
                style={{ border: `1px solid ${C.border}`, color: C.muted, borderRadius: 999, padding: "10px 20px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", textDecoration: "none" }}>
                {d.label}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
