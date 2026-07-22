"use client";
// DROPS — the client release builder (Jul 21 2026). A drop gathers product
// lines from ACROSS their ideas into one dated release: name it, pull lines
// on, watch the readiness gate (every contributing design approved), then
// send it to us. Post-sale, this is also where per-line production numbers
// get entered (slots PATCH opens when the drop closes). 'studio' grant.
import { useEffect, useMemo, useState } from "react";
import { useClientPortal } from "../_shared/context";
import { C, fmtDate } from "../_shared/theme";
import { backwardChain, CHAIN_DEFAULTS } from "@/lib/portal/drop-chain";

const thumbSrc = (id: string, size = 300) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;

const STATUS_WORDS: Record<string, { label: string; color: string; hint: string }> = {
  building: { label: "Building", color: C.amber, hint: "pull designs on, then send it to us" },
  ready: { label: "With HPD", color: C.blue, hint: "we're costing and scheduling it" },
  live: { label: "Live", color: "#fd3aa3", hint: "selling now" },
  closed: { label: "Enter numbers", color: C.amber, hint: "sale closed — give us your production numbers" },
  cut: { label: "In production", color: C.green, hint: "it's on the floor" },
  shelved: { label: "Shelved", color: C.faint, hint: "" },
};

export default function DropsPage() {
  const { data, token } = useClientPortal();
  const hasStudio = ((data as any)?.features || []).includes("studio");
  const hasPipeline = ((data as any)?.features || []).includes("pipeline");
  const [drops, setDrops] = useState<any[] | null>(null);
  // Pipeline items — the in-stock lane's slot source + the date engine
  // (target suggested from the latest landing). Needs the pipeline grant.
  const [pipeItems, setPipeItems] = useState<any[]>([]);
  const [open, setOpen] = useState<any>(null);
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load(openId?: string) {
    try {
      const res = await fetch(`/api/portal/client/${token}/drops`);
      const body = await res.json();
      setDrops(body.drops || []);
      if (openId) setOpen((body.drops || []).find((d: any) => d.id === openId) || null);
      else if (open) setOpen((body.drops || []).find((d: any) => d.id === open.id) || null);
    } catch { setDrops([]); }
  }
  useEffect(() => {
    load();
    if (hasPipeline) {
      fetch(`/api/portal/client/${token}/items`).then(r => r.json())
        .then(b => setPipeItems((b.items || []).filter((it: any) => !["complete", "archived", "cancelled", "on_hold"].includes(it.status))))
        .catch(() => {});
    }
    // eslint-disable-next-line
  }, [token]);

  if (data && !hasStudio) {
    return <div style={{ padding: "60px 0", textAlign: "center", color: C.muted, fontSize: 13 }}>This page isn&rsquo;t enabled for your account. Reach out to your rep if you&rsquo;d like drop planning here.</div>;
  }
  if (!data) return null;

  // One tap creates it — auto-named per model ("In-Stock Release 03"),
  // rename anytime in the sheet. No decisions at the door.
  async function createDrop(model: "stock" | "preorder") {
    setBusy(true);
    try {
      const n = (drops || []).filter((d: any) => d.model === model).length + 1;
      const title = `${model === "stock" ? "In-Stock Release" : "Pre-Order"} ${String(n).padStart(2, "0")}`;
      const res = await fetch(`/api/portal/client/${token}/drops`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, model }),
      });
      const body = await res.json();
      if (res.ok) { setNaming(false); await load(body.dropId); }
    } finally { setBusy(false); }
  }

  return (
    <div style={{ paddingTop: "clamp(8px, 3vw, 28px)" }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .dx-back{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:120;display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow-y:auto}
        .dx-sheet{background:${C.card};border:1px solid ${C.border};border-radius:20px;max-width:680px;width:100%;overflow:hidden}
        .dx-handle{display:none}
        @media(max-width:640px){
          .dx-back{align-items:flex-end;padding:0;overflow-y:hidden}
          .dx-sheet{border-radius:18px 18px 0 0;border-bottom:none;max-height:92dvh;overflow-y:auto;animation:dxUp .3s cubic-bezier(.32,.72,0,1)}
          .dx-handle{display:block;width:38px;height:4px;border-radius:999px;background:rgba(255,255,255,0.25);margin:10px auto 0}
        }
        @keyframes dxUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @media(prefers-reduced-motion:reduce){.dx-sheet{animation:none}}
      ` }} />

      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint, textAlign: "center" }}>Drops</div>
      <h1 style={{ fontSize: "clamp(30px,6.5vw,60px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "8px 0 12px", textAlign: "center" }}>
        Plan the release.
      </h1>
      <div style={{ fontSize: 14, color: C.muted, maxWidth: "52ch", lineHeight: 1.6, margin: "0 auto 26px", textAlign: "center" }}>
        Pull designs from your studio into one drop. When every piece is approved, send it our way — we cost it, schedule it, and it goes live.
      </div>

      <div style={{ display: "flex", justifyContent: "center", marginBottom: 34 }}>
        {!naming ? (
          <button onClick={() => setNaming(true)}
            style={{ background: "#fff", color: C.bg, border: "none", borderRadius: 999, padding: "13px 26px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font }}>
            + Build your next release
          </button>
        ) : (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            <button onClick={() => createDrop("stock")} disabled={busy}
              style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "18px 22px", cursor: "pointer", textAlign: "left", fontFamily: C.font, color: C.text, maxWidth: 250, opacity: busy ? 0.6 : 1 }}>
              <span style={{ display: "block", fontSize: 15, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>In-stock</span>
              <span style={{ display: "block", fontSize: 11.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>Built from goods in your pipeline — launches when they land.</span>
            </button>
            <button onClick={() => createDrop("preorder")} disabled={busy}
              style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "18px 22px", cursor: "pointer", textAlign: "left", fontFamily: C.font, color: C.text, maxWidth: 250, opacity: busy ? 0.6 : 1 }}>
              <span style={{ display: "block", fontSize: 15, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>Pre-order</span>
              <span style={{ display: "block", fontSize: 11.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>Sell first — demand sets the run, production follows.</span>
            </button>
            <button onClick={() => setNaming(false)} style={{ background: "none", border: "none", color: C.faint, fontSize: 12, cursor: "pointer", fontFamily: C.font, alignSelf: "center" }}>cancel</button>
          </div>
        )}
      </div>

      {drops === null ? (
        <div style={{ color: C.faint, fontSize: 13, textAlign: "center", padding: "30px 0" }}>Loading your drops…</div>
      ) : drops.length === 0 ? (
        <div style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: "10px 0 40px" }}>No drops yet. Start one and pull your greenlit designs onto it.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760, margin: "0 auto" }}>
          {drops.map((d: any) => {
            const w = STATUS_WORDS[d.status] || { label: d.status, color: C.faint, hint: "" };
            const ready = d.slots.filter((s: any) => s.ideaApproved).length;
            return (
              <button key={d.id} onClick={() => setOpen(d)}
                style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "16px 18px", cursor: "pointer", textAlign: "left", fontFamily: C.font, color: C.text }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 17, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>{d.title}</span>
                  <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: w.color }}>{w.label}</span>
                  {d.target_live_date && <span style={{ fontSize: 10.5, fontFamily: C.mono, color: C.faint }}>live {fmtDate(d.target_live_date)}</span>}
                  <span style={{ marginLeft: "auto", fontSize: 10.5, fontFamily: C.mono, color: C.muted }}>{d.slots.length} line{d.slots.length === 1 ? "" : "s"}{d.status === "building" && d.slots.length ? ` · ${ready}/${d.slots.length} ready` : ""}</span>
                </div>
                {d.status === "cut" && d.payable?.state === "ready" ? (
                  <div style={{ fontSize: 11, color: C.amber, fontWeight: 800, marginTop: 4, letterSpacing: "0.04em" }}>Invoice {d.payable.invoiceNumber ? `#${d.payable.invoiceNumber}` : ""} ready to pay</div>
                ) : d.status === "cut" && d.payable?.state === "paid" ? (
                  <div style={{ fontSize: 11, color: C.green, fontWeight: 800, marginTop: 4, letterSpacing: "0.04em" }}>Paid</div>
                ) : w.hint ? <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4 }}>{w.hint}</div> : null}
              </button>
            );
          })}
        </div>
      )}

      {open && <DropSheet drop={open} token={token} briefs={(data?.briefs as any[]) || []} pipeItems={pipeItems} onChanged={(id?: string) => load(id)} onClose={() => setOpen(null)} />}
    </div>
  );
}

function DropSheet({ drop, token, briefs, pipeItems, onChanged, onClose }: {
  drop: any; token: string; briefs: any[]; pipeItems: any[]; onChanged: (id?: string) => void; onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const building = drop.status === "building";
  const numbersOpen = drop.status === "closed" && drop.model !== "stock";
  const w = STATUS_WORDS[drop.status] || { label: drop.status, color: C.faint, hint: "" };
  const ready = drop.slots.filter((s: any) => s.ideaApproved).length;
  const allReady = drop.slots.length > 0 && ready === drop.slots.length;

  const isStock = drop.model === "stock";
  // Candidate lines: every product line across their ideas not already slotted.
  const slotted = new Set(drop.slots.map((s: any) => `${s.briefId}|${s.lineId}`));
  const slottedItems = new Set(drop.slots.map((s: any) => s.itemId).filter(Boolean));
  const itemCands = pipeItems.filter((it: any) => !slottedItems.has(it.id));
  const itemById = (id: string) => pipeItems.find((it: any) => it.id === id);
  // Suggested live date = latest landing across item-sourced slots + prep.
  const slotEtas = drop.slots.map((s: any) => s.itemId && itemById(s.itemId)?.eta).filter(Boolean) as string[];
  const suggested = slotEtas.length
    ? new Date(new Date(slotEtas.sort().slice(-1)[0] + "T00:00").getTime() + CHAIN_DEFAULTS.webPrepDays * 86400000).toISOString().slice(0, 10)
    : null;
  const candidates = useMemo(() => {
    const out: any[] = [];
    for (const b of briefs) {
      const lines = Array.isArray(b.product_spec?.products) ? b.product_spec.products : [];
      for (const ln of lines) {
        if (slotted.has(`${b.id}|${ln.id}`)) continue;
        out.push({ brief: b, line: ln });
      }
    }
    return out;
    // eslint-disable-next-line
  }, [briefs, drop.slots]);

  const briefThumb = (b: any): string | null => {
    const t = (b.thumbs || []).find((x: any) => x.preview_drive_file_id || x.drive_file_id);
    const id = t?.preview_drive_file_id || t?.drive_file_id;
    return id ? thumbSrc(id) : null;
  };
  const briefById = (id: string) => briefs.find((b: any) => b.id === id);

  async function call(method: string, path: string, body?: any) {
    setErr("");
    const res = await fetch(`/api/portal/client/${token}/drops/${drop.id}${path}`, {
      method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(out.error || "Couldn't do that."); return false; }
    return true;
  }

  return (
    <div className="dx-back">{/* hard exit only — × closes, backdrop does not */}
      <div className="dx-sheet">
        <div className="dx-handle" />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "16px 20px 6px" }}>
          <div style={{ minWidth: 0 }}>
            <input defaultValue={drop.title}
              onBlur={e => { const v = e.target.value.trim(); if (v && v !== drop.title) call("PATCH", "", { title: v }).then(ok => ok && onChanged(drop.id)); }}
              style={{ fontSize: 18, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", lineHeight: 1.2, background: "transparent", border: "none", outline: "none", color: C.text, width: "100%", fontFamily: C.font, padding: 0 }} />
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginTop: 4, flexWrap: "wrap" }}>
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: w.color }}>{w.label}</span>
              {drop.target_live_date && <span style={{ fontSize: 10.5, fontFamily: C.mono, color: C.faint }}>target live {fmtDate(drop.target_live_date)}</span>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: C.muted, fontSize: 26, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        {/* ── The countdown — the date chain run backward from web-live ── */}
        {drop.target_live_date && ["building", "ready"].includes(drop.status) && (() => {
          const steps = backwardChain(drop.target_live_date);
          const today = new Date().toISOString().slice(0, 10);
          const nextIdx = steps.findIndex(s => s.date >= today);
          return (
            <div style={{ padding: "12px 20px 0" }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint, marginBottom: 8 }}>To hit {fmtDate(drop.target_live_date)}</div>
              <div style={{ display: "flex", overflowX: "auto", scrollbarWidth: "none" as any }}>
                {steps.map((s, i) => {
                  const past = s.date < today;
                  const next = i === nextIdx;
                  return (
                    <div key={s.key} style={{ flexShrink: 0, padding: "8px 16px 8px 12px", borderLeft: `2px solid ${next ? C.amber : C.border}` }}>
                      <div style={{ fontSize: 12, fontWeight: 900, fontFamily: C.mono, color: past ? C.red : next ? C.amber : C.text }}>{fmtDate(s.date)}</div>
                      <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint, marginTop: 3, whiteSpace: "nowrap" }}>{s.label}{past ? " · passed" : ""}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ── Suggested date from the lineup's landings ── */}
        {building && suggested && suggested !== drop.target_live_date && (
          <div style={{ padding: "12px 20px 0", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={async () => { if (await call("PATCH", "", { target_live_date: suggested })) onChanged(drop.id); }}
              style={{ background: "#fff", color: C.bg, border: "none", borderRadius: 999, padding: "11px 20px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font }}>
              Set live date · ~{fmtDate(suggested)}
            </button>
            <span style={{ fontSize: 11, color: C.faint, maxWidth: "36ch", lineHeight: 1.45 }}>from your last landing + {CHAIN_DEFAULTS.webPrepDays}d prep — the lineup picks the date</span>
          </div>
        )}

        {/* ── The lineup ── */}
        <div style={{ padding: "12px 20px 0" }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint, marginBottom: 8 }}>
            The lineup {drop.slots.length > 0 && <span style={{ color: allReady ? C.green : C.amber }}>· {ready}/{drop.slots.length} ready</span>}
          </div>
          {drop.slots.length === 0 && <div style={{ fontSize: 12.5, color: C.faint, paddingBottom: 8 }}>Nothing on it yet — pull designs on below.</div>}
          {drop.slots.map((s: any) => {
            const pit = s.itemId ? itemById(s.itemId) : null;
            const b = s.briefId ? briefById(s.briefId) : null;
            const src = pit?.thumb_id ? thumbSrc(pit.thumb_id) : (b ? briefThumb(b) : null);
            return (
              <div key={s.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
                <span style={{ width: 40, height: 40, background: "#fff", borderRadius: 8, overflow: "hidden", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  {src && <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.format || "Item"}{s.ideaTitle ? <span style={{ color: C.faint, fontWeight: 600, textTransform: "none" }}> · {s.ideaTitle}</span> : null}</span>
                  <span style={{ display: "block", fontSize: 10, fontFamily: C.mono, color: C.muted, marginTop: 2 }}>
                    {s.itemId
                      ? `${(pit?.qty || Object.values(s.qtys || {}).reduce((a: number, b: any) => a + Number(b), 0)).toLocaleString()} pcs${pit?.eta ? ` · lands ${fmtDate(pit.eta)}` : ""}`
                      : `${s.retail != null ? `$${s.retail} retail` : "retail TBD"}${s.model ? ` · ${s.model === "preorder" ? "pre-order" : "fixed run"}` : ""}`}
                  </span>
                </span>
                <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: s.ideaApproved ? C.green : C.amber, whiteSpace: "nowrap" }}>
                  {s.itemId ? "In the pipeline" : s.ideaApproved ? "Ready" : "Design pending"}
                </span>
                {building && (
                  <button onClick={async () => { setBusy(s.id); if (await call("DELETE", `/slots?slotId=${s.id}`)) onChanged(drop.id); setBusy(null); }}
                    style={{ background: "none", border: "none", color: C.faint, fontSize: 16, cursor: "pointer", lineHeight: 1 }} aria-label="Remove">×</button>
                )}
                {numbersOpen && <NumbersEntry slot={s} onSave={async (qtys) => { setBusy(s.id); if (await call("PATCH", "/slots", { slotId: s.id, qtys })) onChanged(drop.id); setBusy(null); }} />}
              </div>
            );
          })}
        </div>

        {/* ── Add lines ── */}
        {building && (
          <div style={{ padding: "14px 20px 4px" }}>
            {!adding ? (
              <button onClick={() => setAdding(true)}
                style={{ borderRadius: 999, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", padding: "10px 18px", cursor: "pointer", fontFamily: C.font }}>
                + Pull designs onto the drop
              </button>
            ) : candidates.length === 0 && itemCands.length === 0 ? (
              <div style={{ fontSize: 12, color: C.faint }}>Everything from your pipeline and studio is already on it.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto" }}>
                {itemCands.length > 0 && <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint, padding: "4px 0 2px" }}>From your pipeline</div>}
                {itemCands.map((it: any) => (
                  <button key={it.id}
                    onClick={async () => { setBusy(it.id); if (await call("POST", "/slots", { itemId: it.id })) onChanged(drop.id); setBusy(null); }}
                    style={{ display: "flex", gap: 10, alignItems: "center", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 10px", cursor: "pointer", textAlign: "left", fontFamily: C.font, color: C.text }}>
                    <span style={{ width: 32, height: 32, background: "#fff", borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>
                      {it.thumb_id && <img src={thumbSrc(it.thumb_id)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />}
                    </span>
                    <span style={{ minWidth: 0, flex: 1, fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                    <span style={{ fontSize: 10, fontFamily: C.mono, color: C.muted, whiteSpace: "nowrap" }}>{it.qty ? `${it.qty.toLocaleString()} pcs` : ""}{it.eta ? ` · lands ${fmtDate(it.eta)}` : ""}</span>
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: C.text }}>+ Add</span>
                  </button>
                ))}
                {candidates.length > 0 && <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint, padding: "8px 0 2px" }}>From the studio — not yet ordered</div>}
                {candidates.map(({ brief, line }: any) => {
                  const src = briefThumb(brief);
                  return (
                    <button key={`${brief.id}|${line.id}`}
                      onClick={async () => { setBusy(line.id); if (await call("POST", "/slots", { briefId: brief.id, lineId: line.id })) onChanged(drop.id); setBusy(null); }}
                      style={{ display: "flex", gap: 10, alignItems: "center", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 10px", cursor: "pointer", textAlign: "left", fontFamily: C.font, color: C.text }}>
                      <span style={{ width: 32, height: 32, background: "#fff", borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>
                        {src && <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />}
                      </span>
                      <span style={{ minWidth: 0, flex: 1, fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {line.format || "Item"} <span style={{ color: C.faint, fontWeight: 500 }}>· {brief.title || "Untitled"}</span>
                      </span>
                      <span style={{ fontSize: 10, fontFamily: C.mono, color: C.muted, whiteSpace: "nowrap" }}>{line.retail != null ? `$${line.retail}` : ""}</span>
                      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: C.text }}>+ Add</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {err && <div style={{ padding: "10px 20px 0", color: C.red, fontSize: 12.5, fontWeight: 700 }}>{err}</div>}

        {/* ── Actions ── */}
        <div style={{ padding: "16px 20px 20px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {building && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={onClose}
                  style={{ background: "transparent", color: C.text, border: `1px solid ${C.border}`, borderRadius: 999, padding: "13px 22px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font }}>
                  Done for now
                </button>
                <button disabled={!allReady || !!busy}
                  onClick={async () => { if (!confirm(`Hand "${drop.title}" to our team? The lineup locks — no more adding or removing after this.`)) return; setBusy("submit"); if (await call("PATCH", "", { submit: true })) onChanged(drop.id); setBusy(null); }}
                  title={allReady ? "" : "Every line needs an approved design first"}
                  style={{ background: "#fff", color: C.bg, border: "none", borderRadius: 999, padding: "13px 24px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: allReady ? "pointer" : "default", opacity: allReady ? 1 : 0.4, fontFamily: C.font }}>
                  {isStock ? "Hand it to HPD" : "Hand it to HPD"}
                </button>
                <button onClick={async () => { if (confirm("Remove this drop?")) { setBusy("del"); if (await call("DELETE", "")) { onChanged(); onClose(); } setBusy(null); } }}
                  style={{ marginLeft: "auto", background: "none", border: "none", color: C.faint, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font }}>
                  Remove
                </button>
              </div>
              <span style={{ fontSize: 11, color: C.faint, lineHeight: 1.5, maxWidth: "58ch" }}>
                Everything saves as you go — close anytime and keep planning later. When the lineup&rsquo;s final, <b style={{ color: C.muted }}>Hand it to HPD</b> sends it to our team {isStock ? "to schedule the launch" : "to cost it and open the sale"}; the lineup locks from there.{!allReady && drop.slots.length > 0 ? " (Unlocks once every design on it is approved.)" : ""}
              </span>
            </div>
          )}
          {drop.status === "ready" && <span style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>It&rsquo;s with us — we&rsquo;re costing and scheduling. You&rsquo;ll see it move here.</span>}
          {numbersOpen && <span style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>Sale closed — enter production numbers on each line above and we&rsquo;ll confirm.</span>}
          {drop.status === "cut" && (
            drop.payable?.state === "paid" ? (
              <span style={{ fontSize: 12.5, fontWeight: 800, color: C.green, letterSpacing: "0.04em" }}>Paid in full — it&rsquo;s in production. Thank you!</span>
            ) : drop.payable?.state === "ready" && drop.payable.paymentLink ? (
              <>
                <a href={drop.payable.paymentLink} target="_blank" rel="noopener noreferrer"
                  style={{ background: "#fff", color: C.bg, borderRadius: 999, padding: "13px 26px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", textDecoration: "none", fontFamily: C.font }}>
                  Pay Now{drop.payable.total ? ` · $${Math.round(drop.payable.total - (drop.payable.paid || 0)).toLocaleString()}` : ""}
                </a>
                <span style={{ fontSize: 11.5, color: C.muted }}>Invoice {drop.payable.invoiceNumber ? `#${drop.payable.invoiceNumber}` : ""} — it&rsquo;s in production.</span>
              </>
            ) : (
              <span style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>It&rsquo;s in production — your invoice is on its way.</span>
            )
          )}
        </div>
      </div>
    </div>
  );
}

const DEFAULT_SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];
function NumbersEntry({ slot, onSave }: { slot: any; onSave: (qtys: Record<string, number>) => void }) {
  const [openEntry, setOpenEntry] = useState(false);
  const [q, setQ] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const s of Array.from(new Set([...DEFAULT_SIZES, ...Object.keys(slot.qtys || {})]))) out[s] = slot.qtys?.[s] != null ? String(slot.qtys[s]) : "";
    return out;
  });
  const total = Object.values(q).reduce((a, v) => a + (Math.round(Number(v) || 0)), 0);
  if (!openEntry) {
    const has = Object.keys(slot.qtys || {}).length > 0;
    return (
      <button onClick={() => setOpenEntry(true)}
        style={{ background: has ? "transparent" : "#fff", color: has ? C.muted : C.bg, border: has ? `1px solid ${C.border}` : "none", borderRadius: 999, padding: "8px 14px", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font }}>
        {has ? `${Object.values(slot.qtys).reduce((a: number, b: any) => a + Number(b), 0)} pcs · edit` : "Enter numbers"}
      </button>
    );
  }
  return (
    <div style={{ flexBasis: "100%", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", paddingTop: 8 }}>
      {Object.keys(q).map(sz => (
        <label key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: C.faint, fontFamily: C.mono }}>{sz}</span>
          <input type="text" inputMode="numeric" value={q[sz]} placeholder="0"
            onFocus={e => e.currentTarget.select()}
            onChange={e => setQ(p => ({ ...p, [sz]: e.target.value.replace(/[^0-9]/g, "") }))}
            style={{ width: 50, padding: "8px 0", textAlign: "center", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontFamily: C.mono, fontSize: 12.5, fontWeight: 700, outline: "none" }} />
        </label>
      ))}
      <button onClick={() => { const out: Record<string, number> = {}; for (const [k, v] of Object.entries(q)) { const n = Math.round(Number(v) || 0); if (n > 0) out[k] = n; } onSave(out); setOpenEntry(false); }}
        style={{ background: "#fff", color: C.bg, border: "none", borderRadius: 999, padding: "10px 18px", fontSize: 10, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font }}>
        Save · {total.toLocaleString()}
      </button>
    </div>
  );
}
