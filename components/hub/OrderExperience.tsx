"use client";
// Client Hub V2 — the ORDER EXPERIENCE (P1, greenlit Jul 20 2026). The client's
// view of one order in the shop skin: hero (CLIENT NAME big — the job memo is
// internal and never renders here), client-safe status rail, "Your move"
// approval band, payment band driven by the terms matrix, item cards with
// per-item phases from lib/portal/client-phase, image-first proof overlay, and
// paperwork as DOWNLOADS ONLY (Jon's rule: PDFs are never the viewing surface).
//
// Mobile-first: single column, full-width tap targets, type via clamp(). The
// same component will serve the Client Hub order page at P3 — keep it free of
// route-specific assumptions (everything arrives via props).
import { useState } from "react";
import { H, H_APPROVAL_THEME, fmtMoney } from "./theme";
import { PackageApproval } from "@/components/portal/PackageApproval";
import { itemClientPhase, CLIENT_RAIL, orderRailIndex, type ClientTone } from "@/lib/portal/client-phase";
import ProofDocView from "@/components/ProofDocView";
import { font as PROOF_FONT, mono as PROOF_MONO } from "@/lib/theme";
import { termsVariantForSlug } from "@/lib/order-terms";

const TONE: Record<ClientTone, string> = { warn: H.amber, move: H.blue, done: H.green, dim: H.faint };
const TERMS: Record<string, string> = { net_15: "Net 15", net_30: "Net 30", net_45: "Net 45", net_60: "Net 60", prepaid: "Prepaid", deposit_balance: "Deposit" };
const LBL: React.CSSProperties = { fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint };

const thumbSrc = (driveId: string, size = 500) => `/api/files/thumbnail?id=${driveId}&thumb=1&size=${size}`;
const mockupOf = (it: any) => (it.proofs || []).find((f: any) => f.stage === "mockup") || (it.proofs || []).find((f: any) => f.stage === "proof") || null;

export function OrderExperience({ data, token, onAction }: {
  data: any;               // the /api/portal/[token] payload
  token: string;           // active portal token (PDF links, actions)
  onAction: (action: string, body?: any) => Promise<void>;
}) {
  const { project, client, quote, items, payments, paymentLink, invoiceNumber, invoiceStale } = data;
  const [proofItem, setProofItem] = useState<any>(null);

  const units = items.reduce((a: number, it: any) => a + (it.units || 0), 0);
  const totalPaid = payments.filter((p: any) => p.status === "paid").reduce((s: number, p: any) => s + p.amount, 0);
  const invoiced = quote?.total || 0;
  // The order's live value (costing gross + extras) — when it outgrows the
  // invoiced total, the band shows "Updated total" (revised-after-paid rule).
  const current = Math.max(invoiced, data.currentTotal || 0);
  const total = invoiced;
  const revisedUp = current > invoiced + 0.005;
  const balance = invoiced - totalPaid;
  const termsRaw = (project.paymentTerms || "").toLowerCase();
  const netTerms = /^net/.test(termsRaw);
  const termsLabel = TERMS[termsRaw] || (project.paymentTerms ? String(project.paymentTerms).replace(/_/g, " ") : "");

  const actualProofs = items.flatMap((i: any) => (i.proofs || []).filter((p: any) => p.stage === "proof"));
  const hasProofs = actualProofs.length > 0;
  // An internally-approved item (client PO / verbal sign-off recorded by the
  // team) settles its proofs — same rule as the internal lifecycle gate.
  const itemProofsSettled = (i: any) => i.internalApproved
    || (i.proofs || []).filter((p: any) => p.stage === "proof").every((p: any) => p.approval === "approved");
  const allProofsApproved = hasProofs && items.every(itemProofsSettled);
  const needsYou = items.filter((it: any) => itemClientPhase(it).label === "Awaiting your approval");
  const railIdx = orderRailIndex(project.phase, !!project.quoteApproved);

  // Order-level estimated completion = latest ETA across unfinished items.
  // Any unfinished item WITHOUT a date makes the order honestly TBD.
  const estCompletion = (() => {
    const unfinished = items.filter((it: any) => itemClientPhase(it).label !== "Delivered");
    if (unfinished.length === 0) return null;
    const etas = unfinished.map((it: any) => it.eta).filter(Boolean) as string[];
    if (etas.length < unfinished.length) return "TBD";
    return etas.sort().slice(-1)[0];
  })();
  const fmtEta = (iso: string) => new Date(iso + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const fullyApproved = !!project.quoteApproved && (!hasProofs || allProofsApproved);
  // Greenlit but not yet costed or proofed — the ball's in our court, so the
  // client has nothing to approve (Jon, Jul 22: greenlight ≠ proof approval).
  // Show a calm "we're finalizing" note instead of an Approve CTA on nothing.
  const nothingToApproveYet = !project.quoteApproved && total <= 0 && !hasProofs;

  // ── Payment band per the terms matrix (locked Jul 20; derives from the same
  //    totals + payment records the internal status bar reads). ──
  const payBand = (() => {
    if (current <= 0 && totalPaid <= 0) return null;
    let note: string; let cta: { label: string; href: string } | null = null;
    if (revisedUp) {
      // Revised-after-invoice (locked matrix row): show paid vs the CURRENT
      // value; the delta bills via an updated invoice. Never auto-charge.
      note = `Your order grew since invoice ${invoiceNumber ? `#${invoiceNumber}` : "was sent"}. An updated invoice for the difference is on its way${netTerms && termsLabel ? `, billed on your ${termsLabel} terms` : ""}. Nothing to pay right now.`;
    } else if (invoiceStale) {
      note = "Your invoice is being updated. You'll be notified when the new copy is ready.";
    } else if (totalPaid >= total - 0.005 && total > 0) {
      note = totalPaid > total + 0.005 && balance < -0.005
        ? "Paid in full. Thank you!"
        : "Paid in full. Thank you!";
    } else if (totalPaid > 0 && balance > 0.005) {
      note = `Your order total grew since invoice ${invoiceNumber ? `#${invoiceNumber}` : "was sent"}. An updated invoice for the difference is on its way${netTerms && termsLabel ? `, billed on your ${termsLabel} terms` : ""}. Nothing to pay right now.`;
      if (!netTerms && paymentLink) { note = `Balance remaining on invoice ${invoiceNumber ? `#${invoiceNumber}` : ""}.`; cta = { label: `Pay Now · ${fmtMoney(balance)}`, href: paymentLink }; }
    } else if (netTerms) {
      // Net terms = WHEN it's due, not whether they can pay. Once the
      // invoice is sent with a live link, show it (the old always-no-cta
      // read hid sent invoices from net clients — the #4256 case).
      if (paymentLink && balance > 0.005) {
        note = `Invoice ${invoiceNumber ? `#${invoiceNumber}` : ""} is ready — due on your ${termsLabel || "net"} terms.`;
        cta = { label: `Pay Now · ${fmtMoney(balance)}`, href: paymentLink };
      } else {
        note = `You're on ${termsLabel || "net terms"}. Production proceeds now; your invoice follows on your terms.`;
      }
    } else if (paymentLink && balance > 0.005) {
      // "Production begins once it's paid" is only true pre-production — past
      // that the rail above contradicts it, so drop the clause.
      const preProduction = railIdx < 1;
      note = termsRaw === "deposit_balance"
        ? `Your deposit invoice is ready.${preProduction ? " Production begins once it's received." : ""}`
        : `Your invoice is ready.${preProduction ? " Production begins once it's paid." : ""}`;
      cta = { label: `Pay Now · ${fmtMoney(balance)}`, href: paymentLink };
    } else {
      note = "Your invoice and payment link will appear here once your order is confirmed.";
    }
    return { note, cta };
  })();

  const dl = (label: string, href: string) => (
    <a key={label} href={href} target="_blank" rel="noopener noreferrer"
      style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.dim, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 7 }}
      onMouseEnter={e => (e.currentTarget.style.color = H.text)} onMouseLeave={e => (e.currentTarget.style.color = H.dim)}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v13m0 0l-5-5m5 5l5-5M4 21h16" /></svg>{label}
    </a>
  );

  return (
    <div style={{ fontFamily: H.font, color: H.text }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .hx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
        @media(min-width:720px){.hx-grid{grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}}
        .hx-card{transition:transform .15s ease,border-color .15s ease}
        .hx-card:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.3)}
        .hx-proof-back{position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:300;display:flex;align-items:flex-start;justify-content:center;padding:20px 12px;overflow-y:auto}
        .hx-proof-sheet{background:#fff;color:#0a0a0a;border-radius:16px;max-width:600px;width:100%;position:relative;overflow:hidden}
        .hx-sheet-handle{display:none}
        @media(max-width:640px){
          .hx-proof-back{align-items:flex-end;padding:0;overflow-y:hidden}
          .hx-proof-sheet{border-radius:18px 18px 0 0;max-height:92dvh;overflow-y:auto;animation:hxSheetUp .3s cubic-bezier(.32,.72,0,1)}
          .hx-sheet-handle{display:block;width:38px;height:4px;border-radius:999px;background:rgba(0,0,0,0.18);margin:10px auto 0}
        }
        @keyframes hxSheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @media(prefers-reduced-motion:reduce){.hx-card,.hx-card:hover{transition:none;transform:none}.hx-proof-sheet{animation:none}}
        .hx-approve-pulse{animation:hxpulse 1.2s ease 2}
        @keyframes hxpulse{0%,100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}50%{box-shadow:0 0 0 4px rgba(255,255,255,.25)}}
      ` }} />

      {/* ── Hero: CLIENT NAME. Order number is the identifier; memo never renders. ── */}
      <header style={{ textAlign: "center", padding: "clamp(26px,5vw,48px) 16px 10px" }}>
        <h1 style={{ fontSize: "clamp(30px,7vw,72px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: 0, textWrap: "balance" as any }}>
          {client?.name || "Your order"}.
        </h1>
        <div style={{ fontSize: 13, color: H.dim, marginTop: 14 }}>
          <b style={{ color: H.text, fontFamily: H.mono, fontWeight: 700 }}>Order {invoiceNumber ? `#${invoiceNumber}` : project.jobNumber}</b>
          {" · "}{items.length} item{items.length === 1 ? "" : "s"} · {units.toLocaleString("en-US")} units{termsLabel ? ` · ${termsLabel}` : ""}{estCompletion ? <span style={{ color: estCompletion === "TBD" ? H.faint : H.dim, fontWeight: 700 }}> · est. completion {estCompletion === "TBD" ? "TBD" : fmtEta(estCompletion)}</span> : null}
        </div>

        {/* Client-safe status rail */}
        <div style={{ maxWidth: 620, margin: "26px auto 0", display: "flex", alignItems: "flex-start", padding: "0 8px" }}>
          {CLIENT_RAIL.map((lbl, i) => {
            const done = i < railIdx, on = i === railIdx;
            return (
              <div key={lbl} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, position: "relative" }}>
                {i > 0 && <div style={{ position: "absolute", top: 5, left: "-50%", right: "50%", height: 1.5, background: done || on ? H.text : H.line }} />}
                <div style={{ width: 11, height: 11, borderRadius: "50%", zIndex: 1, background: done ? H.text : H.ink, border: `1.5px solid ${done || on ? H.text : H.line}`, boxShadow: on ? "0 0 0 4px rgba(255,255,255,0.15)" : "none" }} />
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: done || on ? H.text : H.faint, whiteSpace: "nowrap" }}>{lbl}</div>
              </div>
            );
          })}
        </div>
      </header>

      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "22px 14px 60px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* ── Your move: pending proof thumbs + the blanket approval panel ── */}
        {!fullyApproved && needsYou.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "2px 4px" }}>
            <span style={{ ...LBL, marginRight: 4 }}>Needs you</span>
            {needsYou.map((it: any) => {
              const m = mockupOf(it);
              return (
                <button key={it.id} onClick={() => setProofItem(it)} title={it.name}
                  style={{ width: 54, height: 54, borderRadius: 12, background: "#fff", overflow: "hidden", border: `2px solid ${H.amber}`, padding: 0, cursor: "pointer", flexShrink: 0 }}>
                  {m && <img src={thumbSrc(m.driveFileId, 120)} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
                </button>
              );
            })}
          </div>
        )}
        {nothingToApproveYet ? (
          <div style={{ background: H.panel, border: `1px solid ${H.line}`, borderRadius: 16, padding: "18px 20px" }}>
            <div style={{ ...LBL, marginBottom: 8 }}>In the works</div>
            <div style={{ fontSize: 13.5, color: H.dim, lineHeight: 1.55 }}>We&rsquo;re finalizing the art and pricing for this order. Your quote and proofs will land right here for you to approve. A question in the meantime? Reply to your rep.</div>
          </div>
        ) : (
          <div id="hx-approval">
            <PackageApproval c={H_APPROVAL_THEME} approved={!!project.quoteApproved} approvedAt={project.quoteApprovedAt}
              changeRequest={project.changeRequest} quoteTotal={total > 0 ? total : null} terms={project.paymentTerms}
              items={items.map((i: any) => ({ id: i.id, name: i.name }))}
              pendingReapproval={!!project.quoteApproved && hasProofs && !allProofsApproved}
              invoiceState={totalPaid >= total - 0.005 && total > 0 ? (revisedUp ? "settled" : "paid") : payBand?.cta ? "ready" : (invoiceNumber || totalPaid > 0) ? "settled" : "pending"}
              termsVariant={termsVariantForSlug(data.company?.slug)}
              onAction={onAction} />
          </div>
        )}

        {/* ── Payment ── */}
        {payBand && (
          <div style={{ background: H.panel, border: `1px solid ${H.line}`, borderRadius: 16, padding: "18px 20px" }}>
            <div style={{ ...LBL, marginBottom: 10 }}>Payment</div>
            <div style={{ display: "flex", gap: 26, flexWrap: "wrap", alignItems: "flex-end" }}>
              {totalPaid > 0 && <div><div style={LBL}>Paid</div><div style={{ fontFamily: H.mono, fontSize: 22, fontWeight: 800, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(totalPaid)}</div></div>}
              {current > 0 && <div><div style={LBL}>{revisedUp ? "Updated total" : "Order total"}</div><div style={{ fontFamily: H.mono, fontSize: 22, fontWeight: 800, marginTop: 4, color: revisedUp ? H.dim : H.text, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(current)}</div></div>}
              <div style={{ flex: 1, minWidth: 220, fontSize: 12.5, color: H.dim, lineHeight: 1.55 }}>{payBand.note}</div>
              {payBand.cta && (
                <a href={payBand.cta.href} target="_blank" rel="noopener noreferrer"
                  style={{ background: "#fff", color: H.ink, borderRadius: 999, padding: "13px 24px", fontSize: 12.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", textDecoration: "none", whiteSpace: "nowrap" }}>
                  {payBand.cta.label}
                </a>
              )}
            </div>
          </div>
        )}

        {/* ── The pieces ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, padding: "10px 4px 0" }}>
          <h2 style={{ fontSize: "clamp(20px,3.4vw,30px)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", margin: 0 }}>Proofs</h2>
          {needsYou.length > 0 && <span style={{ ...LBL, color: H.amber }}>Amber pieces need you</span>}
        </div>
        <div className="hx-grid">
          {items.map((it: any) => {
            const phase = itemClientPhase(it);
            const m = mockupOf(it);
            const clickable = true; // sheet = the item's expanded view (spec + invoice line), not just proof review
            const sizes = Object.entries(it.sizes || {}).map(([s, q]) => `${s}:${q}`).join("  ");
            return (
              <div key={it.id} className="hx-card" onClick={clickable ? () => setProofItem(it) : undefined}
                style={{ background: H.panel, border: `1px solid ${H.line}`, borderRadius: 16, overflow: "hidden", cursor: clickable ? "pointer" : "default" }}>
                <div style={{ aspectRatio: "1 / 1", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {m ? <img src={thumbSrc(m.driveFileId)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                    : <span style={{ fontSize: 11, color: "#999" }}>Art coming soon</span>}
                </div>
                <div style={{ padding: "12px 14px 14px" }}>
                  <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "-0.01em" }}>{it.name}</div>
                  <div style={{ fontFamily: H.mono, fontSize: 11, color: H.dim, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
                    {(it.units || 0).toLocaleString("en-US")} units{it.sellPerUnit ? ` · ${fmtMoney(it.sellPerUnit)}/unit` : ""}
                  </div>
                  {sizes && <div style={{ fontFamily: H.mono, fontSize: 9.5, color: H.faint, marginTop: 5, letterSpacing: "0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sizes}</div>}
                  <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.11em", textTransform: "uppercase", marginTop: 9, color: TONE[phase.tone] }}>
                    {phase.label}{clickable ? " →" : ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Shipments (when goods are moving) ── */}
        {(data.shipments || []).length > 0 && (
          <div style={{ background: H.panel, border: `1px solid ${H.line}`, borderRadius: 16, padding: "18px 20px" }}>
            <div style={{ ...LBL, marginBottom: 10 }}>Shipments</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.shipments.map((s: any, i: number) => {
                const params = new URLSearchParams({ portal: token, download: "1" });
                if (s.forwardTracking) params.set("forwardTracking", s.forwardTracking);
                else { if (s.decoratorId) params.set("decoratorId", s.decoratorId); if (s.tracking) params.set("tracking", s.tracking); }
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 12px", background: H.surface, borderRadius: 10 }}>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ fontFamily: H.mono, fontSize: 13, fontWeight: 700 }}>{s.tracking}</div>
                      <div style={{ fontSize: 11, color: H.faint, marginTop: 2 }}>{s.itemCount} item{s.itemCount === 1 ? "" : "s"}</div>
                    </div>
                    {dl("Packing slip", `/api/pdf/packing-slip/${project.id}?${params.toString()}`)}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Paperwork: downloads only, never the view ── */}
        <div style={{ background: H.panel, border: `1px solid ${H.line}`, borderRadius: 16, padding: "18px 20px" }}>
          <div style={{ ...LBL, marginBottom: 12 }}>Paperwork</div>
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
            {quote.items.length > 0 && dl("Quote PDF", `/api/pdf/quote/${project.id}?portal=${token}&download=1`)}
            {invoiceNumber && dl(`Invoice #${invoiceNumber}`, `/api/pdf/invoice/${project.id}?portal=${token}&download=1`)}
          </div>
        </div>
      </main>

      {/* ── Proof review: image first, full-bleed; PDF is a download link ── */}
      {proofItem && (() => {
        const it = proofItem;
        const m = mockupOf(it);
        const proofFile = (it.proofs || []).find((f: any) => f.stage === "proof");
        return (
          <div onClick={e => { if (e.target === e.currentTarget) setProofItem(null); }}
            className="hx-proof-back">
            <div className="hx-proof-sheet">
              <div className="hx-sheet-handle" />
              {/* Nav strip — flip between proofs without closing; close on the right.
                  Own strip so it never overlaps the doc's own PRODUCT PROOF header. */}
              {(() => {
                const idx = items.findIndex((x: any) => x.id === it.id);
                const at = (d: number) => items[idx + d];
                const go = (d: number) => { const n = at(d); if (n) setProofItem(n); };
                const arrow = (d: number, label: string, glyph: string) => {
                  const on = !!at(d);
                  return (
                    <button onClick={() => go(d)} disabled={!on} aria-label={label}
                      style={{ background: on ? "#f1f1f1" : "transparent", color: on ? "#0a0a0a" : "#d0d0d0", border: "none", borderRadius: 999, width: 40, height: 40, fontSize: 22, cursor: on ? "pointer" : "default", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>{glyph}</button>
                  );
                };
                return (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", padding: "10px 12px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {arrow(-1, "Previous proof", "‹")}
                      {arrow(1, "Next proof", "›")}
                      {items.length > 1 && <span style={{ fontFamily: PROOF_MONO, fontSize: 12, color: "#8a90a0", marginLeft: 4, fontVariantNumeric: "tabular-nums" as any }}>{idx + 1} / {items.length}</span>}
                    </div>
                    <button onClick={() => setProofItem(null)} aria-label="Close proof"
                      style={{ background: "#0a0a0a", color: "#fff", border: "none", borderRadius: 999, width: 40, height: 40, fontSize: 24, cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                  </div>
                );
              })()}
              {/* The FORMAL proof document — same renderer as our side + the PDF, from
                  items.proof_spec (read-only). */}
              {it.proofSpec ? (
                <div style={{ background: "#fff", padding: "4px 20px 6px" }}>
                  <ProofDocView
                    spec={it.proofSpec}
                    mockupUrl={m ? thumbSrc(m.driveFileId, 1200) : ""}
                    itemName={it.name}
                    clientName={data?.client?.name || ""}
                    font={PROOF_FONT}
                    mono={PROOF_MONO}
                  />
                </div>
              ) : (
                <div style={{ background: "#fff", padding: "16px" }}>
                  {m && <img src={thumbSrc(m.driveFileId, 1200)} alt="" style={{ width: "100%", maxHeight: "58vh", objectFit: "contain", display: "block", margin: "0 auto" }} />}
                </div>
              )}
              {/* Order line — white, larger black type to match the document. No status. */}
              {(() => {
                const lineTotal = it.sellPerUnit != null && it.units ? it.sellPerUnit * it.units : null;
                const sizeEntries = Object.entries(it.sizes || {}) as [string, number][];
                const lbl: React.CSSProperties = { fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8a90a0", display: "block", marginBottom: 3 };
                const val: React.CSSProperties = { fontSize: 16, fontWeight: 800, color: "#0a0a0a", fontFamily: PROOF_MONO };
                return (
                  <div style={{ background: "#fff", margin: "0 24px", borderTop: "1px solid #ececec", paddingTop: 16, display: "flex", flexDirection: "column", gap: 13 }}>
                    <div style={{ display: "flex", gap: 34, flexWrap: "wrap" }}>
                      <span><span style={lbl}>Quantity</span><span style={val}>{(it.units || 0).toLocaleString()} pcs</span></span>
                      {it.sellPerUnit != null && <span><span style={lbl}>Unit price</span><span style={val}>{"$" + Number(it.sellPerUnit).toFixed(2)}</span></span>}
                      {lineTotal != null && <span><span style={lbl}>Line total</span><span style={val}>{fmtMoney(lineTotal)}</span></span>}
                      {it.eta && <span><span style={lbl}>Est. delivery</span><span style={val}>{new Date(it.eta + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></span>}
                    </div>
                    {sizeEntries.length > 0 && (
                      <div style={{ fontSize: 14, fontFamily: PROOF_MONO, color: "#0a0a0a", lineHeight: 1.8 }}>
                        {sizeEntries.map(([sz, q], i) => (
                          <span key={sz}><span style={{ color: "#8a90a0", fontWeight: 700 }}>{sz}</span> <span>{q}</span>{i < sizeEntries.length - 1 ? <span style={{ color: "#c8ccd4" }}>{"  ·  "}</span> : null}</span>
                        ))}
                      </div>
                    )}
                    {it.shipTracking && (
                      <div style={{ fontSize: 12, fontFamily: PROOF_MONO, color: "#444" }}>Tracking <span style={{ fontWeight: 700, color: "#0a0a0a" }}>{it.shipTracking}</span></div>
                    )}
                  </div>
                );
              })()}
              {/* Footer — white, part of the document. Larger black type, no status. */}
              <div style={{ background: "#fff", padding: "18px 24px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
                {fullyApproved ? (
                  <div style={{ fontSize: 15, color: "#0a0a0a", lineHeight: 1.5, fontWeight: 500 }}>
                    Approved for production. Need a change? Message your rep or{" "}
                    <a href="mailto:hello@housepartydistro.com" style={{ color: "#0a0a0a", fontWeight: 800, textDecoration: "underline" }}>message us now</a>.
                  </div>
                ) : (proofFile || (it.proofSpec && it.proofSentAt)) ? (
                  <div style={{ fontSize: 14, color: "#333", lineHeight: 1.55 }}>
                    Flip through your proofs with the arrows above. When you&rsquo;re ready,{" "}
                    <button onClick={() => { setProofItem(null); const el = document.getElementById("hx-approval"); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }}
                      style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "#0a0a0a", fontWeight: 800, textDecoration: "underline", cursor: "pointer" }}>
                      approve or request changes for your order
                    </button>.
                  </div>
                ) : (
                  <div style={{ fontSize: 14, color: "#555", lineHeight: 1.5 }}>
                    We&rsquo;re finalizing the art and building your proof. It&rsquo;ll land right here for you to approve.
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
