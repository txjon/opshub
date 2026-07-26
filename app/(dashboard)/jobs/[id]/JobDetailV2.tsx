"use client";
// ── JOB DETAIL V2 (parallel scaffold, Jul 25 2026) ────────────────────────────
// A tabless, stage-ordered job canvas — the Track-2 rebuild. Reached via ?v2=1 on
// the job detail so it's fully isolated from the live page (page.tsx branches to
// it after the data is loaded; same job/items/payments/contacts, new shell).
//
// Model: header (state + money + route/address/created) → spine → 4 workflow
// blocks (Products gallery · Client · Production · Logistics). Tapping a gallery
// card opens the ITEM WORKSHEET — a proof-editor-style overlay you flip between
// items with ‹ › (mount-one-show-one, never unmounts), with the task you came to
// do (Build · Cost · Art · Blank) as sub-tabs. Editing panels are read views in
// this scaffold; the real editors (ProductBuilder / CostingTab / ArtTab) wire in
// next. See memory: project_cost_qty_single_source_plan.
import React, { useState, useEffect } from "react";
import { T, font, mono } from "@/lib/theme";
import { createClient } from "@/lib/supabase/client";
import { isCostingLocked } from "@/lib/costing-lock";
import { logJobActivity } from "@/components/JobActivityPanel";

const fmtMoney = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const sumQ = (o: any) => Object.values(o || {}).reduce((a: number, v: any) => a + (Number(v) || 0), 0);
const qtyOf = (it: any) => Number(it?.totalQty) || sumQ(it?.qtys);

const PHASE_HERO: Record<string, { eyebrow: string; title: string; sub: string }> = {
  intake:      { eyebrow: "In intake",       title: "Setting up",         sub: "Building the order — products, sizes, and pricing." },
  pending:     { eyebrow: "With the client", title: "Waiting on client",  sub: "Quote and proofs are out. Production starts once approved and paid." },
  ready:       { eyebrow: "Cleared to make", title: "Ready to make",      sub: "Approved and paid. Order blanks and send the POs." },
  production:  { eyebrow: "At the presses",  title: "In production",      sub: "At the vendor. The House watches the clocks; the dock takes it at landing." },
  receiving:   { eyebrow: "Inbound",         title: "Coming to the dock", sub: "Shipped from the vendor — receiving confirms quantities." },
  fulfillment: { eyebrow: "On the floor",    title: "Fulfillment",        sub: "Received at HPD — staging, packing, shipping." },
  complete:    { eyebrow: "Closed",          title: "Complete",           sub: "Delivered." },
  on_hold:     { eyebrow: "Locked",          title: "On hold",            sub: "Manually held. Resume to recalculate the phase." },
};
const ROUTE_LABEL: Record<string, string> = { drop_ship: "Drop ship", ship_through: "Ship-through", stage: "Stage" };
const ROUTE_SUB: Record<string, string> = { drop_ship: "Vendor → client", ship_through: "→ HPD → client", stage: "→ HPD → fulfillment" };
const TASKS = [["build", "Build"], ["cost", "Cost"], ["art", "Art"], ["blank", "Blank"]] as const;

export function JobDetailV2({ job, items: itemsProp = [], payments = [], contacts = [], thumbByItem = {} }: any) {
  // Local items state so qty edits reflect live in the gallery/totals; reseeds if
  // the parent reloads. The only write V2 makes is qty → buy_sheet_lines (the
  // single source of truth), gated on the costing lock.
  const [items, setItems] = useState<any[]>(itemsProp);
  useEffect(() => { setItems(itemsProp); }, [itemsProp]);
  const locked = isCostingLocked(job);

  const [wsIndex, setWsIndex] = useState<number | null>(null);   // open item worksheet index (null = closed)
  const [wsTask, setWsTask] = useState<string>("build");
  const [open, setOpen] = useState<Record<string, boolean>>({ products: true, client: false, production: true, logistics: false });
  const toggle = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }));

  // Save a single size's qty to buy_sheet_lines (the qty source of truth) and
  // reflect it locally. Blur-triggered, so flipping items never loses an edit.
  const saveQty = async (item: any, size: string, raw: string) => {
    if (isCostingLocked(job)) return;
    const q = parseInt(raw) || 0;
    if (q === Number(item.qtys?.[size] ?? 0)) return; // unchanged
    const newQtys = { ...(item.qtys || {}), [size]: q };
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, qtys: newQtys, totalQty: sumQ(newQtys) } : x));
    try {
      await (createClient().from("buy_sheet_lines") as any).upsert({ item_id: item.id, size, qty_ordered: q }, { onConflict: "item_id,size" });
    } catch (e) { console.error("[JobV2] qty save failed", e); }
  };

  // Record a blank purchase total → items.blanks_order_cost. Per-item. (The S&S
  // order # field was dropped — we log the credit-card purchase total only.)
  const saveBlankCost = async (item: any, raw: string) => {
    const val = raw === "" ? null : parseFloat(String(raw).replace(/[^0-9.]/g, "")) || 0;
    if (val === (item.blanks_order_cost ?? null)) return;
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, blanks_order_cost: val } : x));
    try {
      await (createClient().from("items") as any).update({ blanks_order_cost: val }).eq("id", item.id);
    } catch (e) { console.error("[JobV2] blank cost save failed", e); }
  };

  // Bulk blank purchase — one CC total split across SELECTED items, proportional
  // to each item's calc cost (cost_per_unit × qty); equal split when calc is
  // missing; last item absorbs rounding drift so the row sum matches the total
  // exactly. Faithful port of BlanksTab.applyBulkOrder.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTotal, setBulkTotal] = useState("");
  const toggleSel = (id: string) => setSelectedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const applyBulk = async () => {
    const total = parseFloat(String(bulkTotal).replace(/[^0-9.\-]/g, ""));
    if (bulkTotal === "" || isNaN(total) || total < 0) return;
    const targets = items.filter((it: any) => selectedIds.has(it.id));
    if (!targets.length) return;
    const calcs = targets.map((it: any) => { const q = sumQ(it.qtys); const cpu = Number(it.cost_per_unit); return cpu > 0 && q > 0 ? cpu * q : null; });
    const calcSum = calcs.reduce((a: number, v: any) => a + (v || 0), 0);
    const allKnown = calcs.every((v: any) => v != null && v > 0);
    const cents = Math.round(total * 100);
    const shares = targets.map((_: any, i: number) => allKnown && calcSum > 0 ? Math.round((calcs[i]! / calcSum) * cents) : Math.round(cents / targets.length));
    shares[shares.length - 1] += cents - shares.reduce((a: number, v: number) => a + v, 0);
    const supabase = createClient();
    const summaries: string[] = [];
    await Promise.all(targets.map(async (it: any, i: number) => {
      const dollars = shares[i] / 100;
      setItems(prev => prev.map(x => x.id === it.id ? { ...x, blanks_order_cost: dollars } : x));
      await (supabase.from("items") as any).update({ blanks_order_cost: dollars }).eq("id", it.id);
      summaries.push(`${it.name} · $${dollars.toFixed(2)}`);
    }));
    try { logJobActivity(job.id, `Bulk blanks order: $${total.toFixed(2)} across ${targets.length} item${targets.length !== 1 ? "s" : ""} — ${summaries.join(", ")}`); } catch {}
    setBulkTotal(""); setSelectedIds(new Set());
  };

  // Esc + arrow keys for the worksheet — the proof-editor feel.
  useEffect(() => {
    if (wsIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWsIndex(null);
      if (e.key === "ArrowLeft") setWsIndex(i => i === null ? i : (i - 1 + items.length) % items.length);
      if (e.key === "ArrowRight") setWsIndex(i => i === null ? i : (i + 1) % items.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wsIndex, items.length]);

  const client = job?.clients?.name || "";
  const units = items.reduce((a: number, it: any) => a + qtyOf(it), 0);
  const orderTotal = items.reduce((a: number, it: any) => a + (Number(it.sell_per_unit) || 0) * qtyOf(it), 0);
  const tm = job?.type_meta || {};
  const invoiced = Number(tm.qb_total_with_tax) || 0;
  const invNum = tm.qb_invoice_number || tm.stripe_invoice_number || "";
  const paid = payments.filter((p: any) => p.status === "paid").reduce((a: number, p: any) => a + (Number(p.amount) || 0), 0);
  const toInvoice = Math.round((orderTotal - invoiced) * 100) / 100;
  const route = job?.shipping_route || "";
  const address = tm.venue_address || job?.clients?.shipping_address || "";
  const created = job?.created_at ? new Date(job.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
  const inHands = job?.target_ship_date ? new Date(job.target_ship_date + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
  const hero = PHASE_HERO[job?.phase] || PHASE_HERO.intake;

  // ── spine ──
  const phase = job?.phase || "intake";
  const beyond = (p: string, list: string[]) => list.includes(p);
  const flags = {
    quoted: !!tm.quote_sent_at,
    approved: !!job?.quote_approved,
    invoiced: !!invNum,
    grew: invoiced > 0 && toInvoice > 0.5,
    paid: invoiced > 0 && paid >= invoiced - 0.5,
    po: Array.isArray(tm.po_sent_vendors) && tm.po_sent_vendors.length > 0,
  };
  const spine = [
    { cap: "Quoted", state: flags.quoted ? "done" : "todo" },
    { cap: "Approved", state: flags.approved ? "done" : "todo" },
    { cap: "Invoiced", state: flags.grew ? "warn" : flags.invoiced ? "done" : "todo" },
    { cap: "Paid", state: flags.paid ? "done" : "todo" },
    { cap: "PO · Blanks", state: flags.po ? "done" : "todo" },
    { cap: "Production", state: phase === "production" ? "now" : beyond(phase, ["receiving", "fulfillment", "complete"]) ? "done" : "todo" },
    { cap: "Receiving", state: phase === "receiving" ? "now" : beyond(phase, ["fulfillment", "complete"]) ? "done" : "todo" },
    { cap: "Staging", state: phase === "fulfillment" ? "now" : phase === "complete" ? "done" : "todo" },
  ];
  const segBg = (s: string) => s === "done" ? T.green : s === "warn" ? T.amber : s === "now" ? "transparent" : T.border;

  // ── art / production summaries ──
  const artApproved = items.filter((it: any) => it.artwork_status === "approved").length;
  const inProd = items.filter((it: any) => it.pipeline_stage === "in_production").length;
  const shipped = items.filter((it: any) => it.pipeline_stage === "shipped").length;
  const blanksOrdered = items.filter((it: any) => it.blanks_order_number || it.blanks_order_cost != null).length;

  // ── order gates (mirror BlanksTab): quote approved · payment (terms-specific)
  // · all proofs approved. All three must be met before ordering blanks / POs. ──
  const terms = (job?.payment_terms || "").toLowerCase();
  const paymentGate = /^net/.test(terms) ? flags.approved : terms === "deposit_balance" ? payments.some((p: any) => p.status === "paid") : flags.paid;
  const proofGate = items.length > 0 && artApproved === items.length;
  const canOrder = flags.approved && paymentGate && proofGate;

  // ── per-vendor PO grouping. Group by the costing printVendor (what the PO PDF
  // route filters on with ?vendor=), matching the current PO tab. costing_data
  // rides on `job`. Fall back to the decorator assignment name. ──
  const poSentVendors: string[] = Array.isArray(tm.po_sent_vendors) ? tm.po_sent_vendors : [];
  const costProds: any[] = job?.costing_data?.costProds || [];
  const cpFor = (item: any) => costProds.find(cp => cp.id === item.id)
    || costProds.find(cp => (cp.name || "").trim().toLowerCase() === (item.name || "").trim().toLowerCase());
  const calcBlank = (item: any) => (Number(item.cost_per_unit) || 0) * sumQ({ ...(item.qtys || {}) });
  const vendorGroups: Record<string, any[]> = {};
  for (const item of items) {
    const v = cpFor(item)?.printVendor || item.decorator || "Unassigned";
    (vendorGroups[v] ||= []).push(item);
  }

  const lbl: React.CSSProperties = { fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: T.faint };
  const block = (id: string, tick: "done" | "now" | "todo", title: string, summary: string, body: React.ReactNode, dim = false) => (
    <div id={id} style={{ border: `1px solid ${T.border}`, borderRadius: 16, background: T.card, marginTop: 14, overflow: "hidden", opacity: dim && !open[id] ? 0.6 : 1 }}>
      <div onClick={() => toggle(id)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 20px", cursor: "pointer" }}>
        <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800,
          background: tick === "done" ? T.greenDim : tick === "now" ? "rgba(107,176,232,.14)" : "transparent",
          color: tick === "done" ? T.green : tick === "now" ? "#6bb0e8" : T.faint,
          border: `1px solid ${tick === "done" ? T.green + "66" : tick === "now" ? "#6bb0e880" : T.border}` }}>{tick === "done" ? "✓" : tick === "now" ? "◉" : "○"}</span>
        <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.02em", textTransform: "uppercase" }}>{title}</span>
        <span style={{ flex: 1, fontSize: 12.5, color: T.muted, fontFamily: mono, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
        <span style={{ color: T.faint, fontSize: 13, transform: open[id] ? "none" : "rotate(-90deg)", transition: "transform .2s" }}>▾</span>
      </div>
      {open[id] && <div style={{ padding: "4px 20px 20px", borderTop: `1px solid ${T.border}55` }}>{body}</div>}
    </div>
  );

  const it = wsIndex !== null ? items[wsIndex] : null;

  return (
    <div style={{ fontFamily: font, color: T.text, maxWidth: 1120, margin: "0 auto", padding: "0 20px 80px" }}>
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 0 6px", fontSize: 13 }}>
        <a href="/projects" style={{ color: T.muted, fontWeight: 700, textDecoration: "none" }}>‹ Projects</a>
        <span style={{ fontSize: 10, fontWeight: 700, color: T.faint, letterSpacing: "0.1em", textTransform: "uppercase" }}>V2 preview</span>
      </div>

      {/* title */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "2px 0 16px" }}>
        <h1 style={{ fontSize: "clamp(26px,4vw,40px)", fontWeight: 900, letterSpacing: "-0.02em", lineHeight: 1.02, margin: 0 }}>{client || job?.title}</h1>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 800, color: T.muted }}>{invNum || job?.job_number}</div>
          {invNum && <div style={{ fontFamily: mono, fontSize: 11, color: T.faint }}>{job?.job_number}</div>}
        </div>
      </div>

      {/* HERO + next action */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 18, padding: "22px 24px", display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 24 }}>
        <div>
          <div style={{ color: "#6bb0e8", fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase" }}>{hero.eyebrow}</div>
          <h2 style={{ fontSize: "clamp(28px,5vw,48px)", fontWeight: 900, letterSpacing: "-0.02em", margin: "6px 0 8px", lineHeight: 0.98 }}>{hero.title}</h2>
          <p style={{ color: T.muted, fontSize: 14, maxWidth: "44ch", margin: 0 }}>{hero.sub}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignSelf: "center" }}>
          {flags.grew && (
            <a href="#client" onClick={() => setOpen(o => ({ ...o, client: true }))} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", borderRadius: 12, border: `1px solid ${T.amber}80`, background: T.amberDim, textDecoration: "none" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.amber, flexShrink: 0 }} />
              <span style={{ flex: 1 }}><span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: T.text }}>Order grew {fmtMoney(toInvoice)} since invoicing</span><span style={{ fontSize: 12, color: T.muted }}>Re-invoice the addition · Inv {invNum} was {fmtMoney(invoiced)}</span></span>
              <span style={{ color: T.faint, fontSize: 16 }}>›</span>
            </a>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", borderRadius: 12, border: `1px solid ${T.border}`, background: T.surface }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#6bb0e8", flexShrink: 0 }} />
            <span style={{ flex: 1 }}><span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: T.text }}>{inProd + shipped} of {items.length} items moving</span><span style={{ fontSize: 12, color: T.muted }}>{inProd} in production · {blanksOrdered}/{items.length} blanks ordered</span></span>
          </div>
        </div>
      </div>

      {/* money + logistics strip */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "flex-end", padding: "18px 4px 4px", marginTop: 14, borderTop: `1px solid ${T.border}55` }}>
        {[
          ["Order total", fmtMoney(orderTotal), `${units.toLocaleString()} units`, T.text],
          ["Invoiced", invNum ? fmtMoney(invoiced) : "—", invNum ? "Inv " + invNum : "not sent", T.text],
          ["Paid", fmtMoney(paid), job?.payment_terms ? String(job.payment_terms).replace(/_/g, " ") : "", T.green],
          ...(flags.grew ? [["To invoice", "+" + fmtMoney(toInvoice), "order grew", T.amber]] : []),
        ].map(([l, v, s, c]: any) => (
          <div key={l}><div style={lbl}>{l}</div><div style={{ fontFamily: mono, fontSize: 22, fontWeight: 800, marginTop: 3, color: c }}>{v}</div><div style={{ fontSize: 11, color: T.faint, marginTop: 2, fontFamily: mono }}>{s}</div></div>
        ))}
        <div style={{ minWidth: 200, flex: 1 }}>
          <div style={lbl}>Ship-to · {ROUTE_LABEL[route] || route || "route not set"}</div>
          <div style={{ fontSize: 13, color: address ? T.text : T.faint, marginTop: 4, lineHeight: 1.4 }}>{address || "No address set"}</div>
          <div style={{ fontSize: 11, color: T.faint, marginTop: 2 }}>{ROUTE_SUB[route] || ""}</div>
        </div>
        <div><div style={lbl}>Created</div><div style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, marginTop: 3, color: T.muted }}>{created}</div></div>
        <div><div style={lbl}>In-hands</div><div style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, marginTop: 3, color: inHands === "—" ? T.faint : T.text }}>{inHands}</div></div>
      </div>

      {/* spine */}
      <div style={{ display: "flex", gap: 0, margin: "20px 0 8px", overflowX: "auto" }}>
        {spine.map((s, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: 1, minWidth: 74 }}>
            <div style={{ height: 5, width: "100%", borderRadius: 3, background: segBg(s.state), border: s.state === "now" ? "1px solid #6bb0e866" : "none", backgroundImage: s.state === "now" ? "repeating-linear-gradient(45deg,#6bb0e8,#6bb0e8 5px,transparent 5px,transparent 10px)" : "none" }} />
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap", color: s.state === "now" ? "#6bb0e8" : s.state === "todo" ? T.faint : T.muted }}>{s.cap}</div>
          </div>
        ))}
      </div>

      {/* jump nav */}
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: "rgba(10,10,10,0.82)", backdropFilter: "blur(10px)", display: "flex", gap: 8, padding: "12px 0", margin: "8px 0 6px", borderBottom: `1px solid ${T.border}55`, overflowX: "auto" }}>
        {[["products", "Products & Costing"], ["client", "Client"], ["production", "Purchasing & Production"], ["logistics", "Logistics"]].map(([id, label]) => (
          <a key={id} href={"#" + id} onClick={() => setOpen(o => ({ ...o, [id]: true }))} style={{ fontSize: 12, fontWeight: 700, color: T.muted, textDecoration: "none", padding: "7px 13px", borderRadius: 999, border: `1px solid ${T.border}`, whiteSpace: "nowrap" }}>{label}</a>
        ))}
      </div>

      {/* PRODUCTS gallery */}
      {block("products", "done", "Products & Costing", `${items.length} items · ${units.toLocaleString()} units · ${fmtMoney(orderTotal)}`, (
        <>
          <div style={{ fontSize: 11.5, color: T.faint, padding: "8px 0 12px" }}>Tap a product for its worksheet — sizes, blank cost, decoration, vendor &amp; margin.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(196px,1fr))", gap: 12 }}>
            {items.map((item: any, i: number) => {
              const thumb = thumbByItem[item.id];
              const q = qtyOf(item);
              const line = (Number(item.sell_per_unit) || 0) * q;
              return (
                <div key={item.id} onClick={() => { setWsIndex(i); setWsTask("build"); }} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden", cursor: "pointer" }}>
                  <div style={{ aspectRatio: "1/1", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 44 }}>
                    {thumb ? <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : "👕"}
                  </div>
                  <div style={{ padding: "11px 13px 13px" }}>
                    <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "-0.01em", lineHeight: 1.25 }}>{item.name}</div>
                    <div style={{ fontFamily: mono, fontSize: 10.5, color: T.faint, marginTop: 4 }}>{item.blank_vendor || ""} {item.blank_sku || ""}</div>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 9, gap: 8 }}>
                      <span style={{ fontFamily: mono, fontSize: 12, color: T.muted }}>{q.toLocaleString()}u · ${(Number(item.sell_per_unit) || 0).toFixed(2)}</span>
                      <span style={{ fontFamily: mono, fontSize: 14, fontWeight: 800 }}>{fmtMoney(line)}</span>
                    </div>
                    <div style={{ display: "flex", gap: 9, marginTop: 9, paddingTop: 9, borderTop: `1px solid ${T.border}55`, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      <span style={{ color: item.artwork_status === "approved" ? T.green : T.faint }}>Art {item.artwork_status === "approved" ? "✓" : "…"}</span>
                      <span style={{ color: item.pipeline_stage === "in_production" ? "#6bb0e8" : item.pipeline_stage === "shipped" ? T.green : T.faint }}>{item.pipeline_stage === "in_production" ? "Printing" : item.pipeline_stage === "shipped" ? "Shipped" : "—"}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ))}

      {/* CLIENT */}
      {block("client", flags.approved ? "done" : "todo", "Client",
        `${flags.approved ? "Approved" : flags.quoted ? "Quote sent" : "Not sent"} · ${invNum ? "Inv " + invNum : "no invoice"} · ${fmtMoney(paid)} paid${flags.grew ? " · ⚠ re-invoice" : ""}`, (
        <div>
          {[["Quote", flags.approved ? "Sent · Approved" : flags.quoted ? "Sent" : "Not sent"],
            ["Proofs", `${artApproved}/${items.length} approved`],
            ["Invoice", invNum ? `${invNum} · sent` : "not sent"],
            ["Paid", `${fmtMoney(paid)} of ${fmtMoney(invoiced || orderTotal)}`],
            ...(flags.grew ? [["Outstanding", `${fmtMoney(toInvoice)} added since invoicing — re-invoice`]] : []),
            ["Contacts", (contacts || []).map((c: any) => c.contacts?.name).filter(Boolean).join(", ") || "none on job"]].map(([l, v]: any) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${T.border}55`, fontSize: 13 }}>
              <span style={{ color: T.muted }}>{l}</span><span style={{ fontWeight: 700, color: l === "Outstanding" ? T.amber : T.text }}>{v}</span>
            </div>
          ))}
        </div>
      ))}

      {/* PRODUCTION */}
      {block("production", phase === "production" ? "now" : beyond(phase, ["receiving", "fulfillment", "complete"]) ? "done" : "todo", "Purchasing & Production",
        `${blanksOrdered}/${items.length} blanks · ${Object.keys(vendorGroups).filter(v => poSentVendors.includes(v)).length}/${Object.keys(vendorGroups).length} POs sent`, (
        <div>
          {/* GATES — cleared to order? */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", padding: "8px 12px", marginTop: 6, marginBottom: 16, borderRadius: 10, background: canOrder ? T.greenDim : T.surface, border: `1px solid ${canOrder ? T.green + "44" : T.border}` }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: canOrder ? T.green : T.amber }}>{canOrder ? "Cleared to order" : "Not cleared yet"}</span>
            {[["Quote", flags.approved], ["Payment", paymentGate], ["Proofs", proofGate]].map(([g, ok]: any) => (
              <span key={g} style={{ fontSize: 12, color: T.muted }}>{ok ? <b style={{ color: T.green }}>✓</b> : <b style={{ color: T.faint }}>○</b>} {g}</span>
            ))}
          </div>

          {/* BLANKS — credit-card purchases, per item */}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <span style={lbl}>Blanks · credit-card purchases · {blanksOrdered}/{items.length} logged</span>
            <button onClick={() => setSelectedIds(s => s.size === items.length ? new Set() : new Set(items.map((i: any) => i.id)))}
              style={{ fontSize: 11, fontWeight: 700, color: T.muted, background: "none", border: `1px solid ${T.border}`, borderRadius: 999, padding: "4px 11px", cursor: "pointer", fontFamily: font }}>
              {selectedIds.size === items.length ? "Clear all" : "Select all"}
            </button>
          </div>
          {items.map((item: any) => {
            const calc = calcBlank(item);
            const ordered = item.blanks_order_cost != null && item.blanks_order_cost !== "";
            const actual = ordered ? Number(item.blanks_order_cost) : null;
            const sel = selectedIds.has(item.id);
            return (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${T.border}44`, flexWrap: "wrap" }}>
                <input type="checkbox" checked={sel} onChange={() => toggleSel(item.id)} style={{ width: 15, height: 15, accentColor: T.accent, cursor: "pointer" }} />
                <span style={{ flex: 1, minWidth: 150, fontSize: 13, fontWeight: 600 }}>{item.name}<span style={{ color: T.faint, fontWeight: 400, marginLeft: 8, fontSize: 11 }}>{item.blank_vendor} {item.blank_sku}</span></span>
                <span style={{ fontSize: 11, color: T.faint, fontFamily: mono, width: 74, textAlign: "right" }}>est {fmtMoney(calc)}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <span style={{ fontSize: 11, color: T.faint }}>$</span>
                  <input key={item.id + ":c:" + (item.blanks_order_cost ?? "")} defaultValue={actual != null ? actual.toFixed(2) : ""} placeholder="total paid" inputMode="decimal" onBlur={e => saveBlankCost(item, e.target.value)}
                    style={{ width: 84, padding: "6px 8px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, fontFamily: mono, outline: "none" }} />
                </div>
                <span style={{ width: 62, textAlign: "right", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: ordered ? (actual! > calc ? T.red : T.green) : T.faint }}>{ordered ? (actual! > calc ? "over" : "logged ✓") : "—"}</span>
              </div>
            );
          })}
          {/* Bulk purchase — one CC total split across selected items */}
          {selectedIds.size > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 12, padding: "11px 13px", borderRadius: 10, background: T.surface, border: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.muted }}>{selectedIds.size} selected · split one purchase total:</span>
              <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{ fontSize: 12, color: T.faint }}>$</span>
                <input value={bulkTotal} onChange={e => setBulkTotal(e.target.value)} placeholder="0.00" inputMode="decimal"
                  onKeyDown={e => { if (e.key === "Enter") applyBulk(); }}
                  style={{ width: 100, padding: "7px 9px", borderRadius: 7, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 13, fontFamily: mono, outline: "none" }} />
              </div>
              <button onClick={applyBulk} disabled={!bulkTotal.trim()}
                style={{ fontSize: 12, fontWeight: 800, color: bulkTotal.trim() ? "#0a0a0a" : T.faint, background: bulkTotal.trim() ? T.accent : "transparent", border: `1px solid ${bulkTotal.trim() ? T.accent : T.border}`, borderRadius: 999, padding: "7px 16px", cursor: bulkTotal.trim() ? "pointer" : "default", fontFamily: font }}>Apply to selected</button>
              <span style={{ fontSize: 11, color: T.faint }}>split proportional to each item's estimate</span>
            </div>
          )}

          {/* PURCHASE ORDERS — per vendor */}
          <div style={{ ...lbl, margin: "22px 0 10px" }}>Purchase orders · bill-later vendors</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {Object.entries(vendorGroups).map(([vendor, vitems]) => {
              const sent = poSentVendors.includes(vendor);
              const vUnits = vitems.reduce((a: number, it: any) => a + qtyOf(it), 0);
              const allBlanks = vitems.every((it: any) => it.blanks_order_cost != null && it.blanks_order_cost !== "");
              return (
                <div key={vendor} style={{ border: `1px solid ${T.border}`, borderRadius: 12, background: T.surface, padding: "13px 15px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 800, flex: 1, minWidth: 120 }}>{vendor}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: sent ? T.green : T.faint }}>{sent ? "✓ Sent" : "— Not sent"}</span>
                  </div>
                  <div style={{ fontSize: 12, color: T.muted, marginTop: 4, fontFamily: mono }}>{vitems.map((it: any) => it.name).join(" · ")} · {vUnits.toLocaleString()} u</div>
                  {!allBlanks && <div style={{ fontSize: 11, color: T.amber, marginTop: 6 }}>⚠ Not all blanks ordered for this vendor.</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
                    <a href={`/api/pdf/po/${job.id}?vendor=${encodeURIComponent(vendor)}${sent ? "&revised=1" : ""}`} target="_blank" rel="noreferrer"
                      style={{ fontSize: 12, fontWeight: 800, color: T.text, textDecoration: "none", padding: "8px 15px", borderRadius: 999, border: `1px solid ${T.border}`, background: T.card }}>Preview PO</a>
                    <span title="Send flow (email + ship details) wires in next" style={{ fontSize: 12, fontWeight: 800, color: T.faint, padding: "8px 15px", borderRadius: 999, border: `1px dashed ${T.border}`, cursor: "not-allowed" }}>{sent ? "Re-send" : "Send PO"} · next</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* LOGISTICS */}
      {block("logistics", beyond(phase, ["receiving", "fulfillment", "complete"]) ? "now" : "todo", "Logistics",
        `${ROUTE_LABEL[route] || "route not set"} — ${phase === "receiving" ? "receiving" : phase === "fulfillment" ? "fulfillment" : "waiting on production"}`, (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${T.border}55`, fontSize: 13 }}>
            <span style={{ color: T.muted }}>Route</span><span style={{ fontWeight: 700 }}>{ROUTE_LABEL[route] || "—"} · {ROUTE_SUB[route] || ""}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 13 }}>
            <span style={{ color: T.muted }}>Ship-to</span><span style={{ fontWeight: 700, textAlign: "right", maxWidth: "60%" }}>{address || "—"}</span>
          </div>
        </div>
      ), true)}

      {/* ── ITEM WORKSHEET (proof-editor style: flip between items, never unmount) ── */}
      {it && (
        <div onClick={e => { if (e.target === e.currentTarget) setWsIndex(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 300, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 14px", overflowY: "auto" }}>
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, width: "100%", maxWidth: 640, overflow: "hidden" }}>
            {/* nav strip */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: `1px solid ${T.border}55` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button onClick={() => setWsIndex((wsIndex! - 1 + items.length) % items.length)} aria-label="Previous item" style={navBtn}>‹</button>
                <button onClick={() => setWsIndex((wsIndex! + 1) % items.length)} aria-label="Next item" style={navBtn}>›</button>
                <span style={{ fontFamily: mono, fontSize: 12, color: T.faint, marginLeft: 6 }}>{wsIndex! + 1} / {items.length}</span>
              </div>
              <button onClick={() => setWsIndex(null)} aria-label="Close" style={{ ...navBtn, background: T.surface }}>×</button>
            </div>
            {/* item head */}
            <div style={{ display: "flex", gap: 14, padding: "16px 18px", alignItems: "center" }}>
              <div style={{ width: 56, height: 56, borderRadius: 10, background: "#fff", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>
                {thumbByItem[it.id] ? <img src={thumbByItem[it.id]} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 10 }} /> : "👕"}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: "-0.01em" }}>{it.name}</div>
                <div style={{ fontFamily: mono, fontSize: 11.5, color: T.faint, marginTop: 3 }}>{it.blank_vendor || ""} {it.blank_sku || ""} · {qtyOf(it).toLocaleString()} u · ${(Number(it.sell_per_unit) || 0).toFixed(2)}</div>
              </div>
            </div>
            {/* task tabs — "click the task you're there to do" */}
            <div style={{ display: "flex", gap: 6, padding: "0 18px 4px" }}>
              {TASKS.map(([k, label]) => (
                <button key={k} onClick={() => setWsTask(k)} style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: `1px solid ${wsTask === k ? T.accent : T.border}`, background: wsTask === k ? T.accent : "transparent", color: wsTask === k ? "#0a0a0a" : T.muted, fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: font }}>{label}</button>
              ))}
            </div>
            {/* task panel (scaffold: real data read; real editors wire in next) */}
            <div style={{ padding: "14px 18px 22px", minHeight: 180 }}>
              {wsTask === "build" && (() => {
                const sizes = Object.keys(it.qtys || {});
                return (
                  <div>
                    {sizes.length === 0 ? (
                      <div style={{ fontSize: 13, color: T.faint }}>No sizes on this item yet.</div>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {sizes.map(sz => (
                          <label key={it.id + "_" + sz} style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
                            <span style={{ fontSize: 10, fontWeight: 800, color: T.faint, fontFamily: mono }}>{sz}</span>
                            <input type="text" inputMode="numeric" defaultValue={String(it.qtys?.[sz] ?? 0)} readOnly={locked}
                              onFocus={e => e.target.select()}
                              onBlur={e => saveQty(it, sz, e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                              style={{ width: 56, textAlign: "center", padding: "7px 6px", borderRadius: 8, border: `1px solid ${T.border}`, background: locked ? T.card : T.surface, color: locked ? T.muted : T.text, fontSize: 14, fontWeight: 700, fontFamily: mono, outline: "none" }} />
                          </label>
                        ))}
                        <label style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", justifyContent: "flex-end" }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: T.faint, fontFamily: mono }}>TOTAL</span>
                          <div style={{ width: 64, textAlign: "center", padding: "7px 6px", fontSize: 15, fontWeight: 800, fontFamily: mono }}>{qtyOf(it).toLocaleString()}</div>
                        </label>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 22, marginTop: 14, fontSize: 12.5, color: T.muted }}>
                      <span>Garment <b style={{ color: T.text }}>{it.garment_type || "—"}</b></span>
                      <span>Blank <b style={{ color: T.text }}>{`${it.blank_vendor || ""} ${it.blank_sku || ""}`.trim() || "—"}</b></span>
                    </div>
                    <div style={{ fontSize: 11, color: locked ? T.amber : T.faint, marginTop: 12 }}>
                      {locked ? "🔒 Pricing is locked — unlock in Costing to change quantities." : "Saves to the buy sheet (the single source). Totals update live."}
                    </div>
                  </div>
                );
              })()}
              {wsTask === "cost" && <WsRows rows={[["Sell / unit", "$" + (Number(it.sell_per_unit) || 0).toFixed(2)], ["Blank cost / unit", it.cost_per_unit != null ? "$" + Number(it.cost_per_unit).toFixed(2) : "—"], ["Line total", fmtMoney((Number(it.sell_per_unit) || 0) * qtyOf(it))], ...Object.entries((it.blankCosts || it.blank_costs) || {}).map(([sz, c]: any) => ["  " + sz + " blank", "$" + Number(c).toFixed(2)])]} />}
              {wsTask === "art" && <WsRows rows={[["Artwork", it.artwork_status || "not started"], ["Mockup", thumbByItem[it.id] ? "on file" : "none"]]} />}
              {wsTask === "blank" && (() => {
                const calc = calcBlank(it);
                return (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${T.border}44`, fontSize: 13 }}>
                      <span style={{ color: T.muted }}>Estimated blank cost</span><span style={{ fontWeight: 700, fontFamily: mono }}>{fmtMoney(calc)}</span>
                    </div>
                    <label style={{ display: "block", marginTop: 14 }}>
                      <span style={{ ...lbl, display: "block", marginBottom: 5 }}>Blank purchase total (credit card)</span>
                      <input key={it.id + ":bc:" + (it.blanks_order_cost ?? "")} defaultValue={it.blanks_order_cost != null && it.blanks_order_cost !== "" ? Number(it.blanks_order_cost).toFixed(2) : ""} placeholder="0.00" inputMode="decimal" onBlur={e => saveBlankCost(it, e.target.value)}
                        style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: mono, outline: "none", boxSizing: "border-box" }} />
                    </label>
                    <div style={{ fontSize: 11, color: T.faint, marginTop: 12 }}>Logs the card purchase against this item. Compared to the estimate on the variance check.</div>
                  </div>
                );
              })()}
              <div style={{ fontSize: 11, color: T.faint, marginTop: 16, paddingTop: 12, borderTop: `1px solid ${T.border}55` }}>Scaffold view — the live {TASKS.find(t => t[0] === wsTask)?.[1]} editor wires in here next. Flip items with ‹ › or ← →.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const navBtn: React.CSSProperties = { width: 36, height: 36, borderRadius: 999, border: "none", background: "rgba(255,255,255,0.08)", color: T.text, fontSize: 20, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };

function WsRows({ rows }: { rows: any[] }) {
  return (
    <div>
      {rows.map(([l, v], i) => (
        <div key={l + i} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${T.border}44`, fontSize: 13 }}>
          <span style={{ color: l.startsWith("  ") ? T.faint : T.muted, fontFamily: l.startsWith("  ") ? mono : font, paddingLeft: l.startsWith("  ") ? 8 : 0 }}>{l.trim()}</span>
          <span style={{ fontWeight: 700, fontFamily: mono }}>{v}</span>
        </div>
      ))}
    </div>
  );
}
