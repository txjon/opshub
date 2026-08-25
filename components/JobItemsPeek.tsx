"use client";
import { useState } from "react";
import { T, font, mono } from "@/lib/theme";
import { ModalShell } from "@/components/board-kit";
import { fmtDay } from "@/lib/dates";
import { firstItemDue, closedAt } from "@/lib/project-due";

// The strip's items peek — overlapping mockup thumb cluster (ItemThumbRail) that
// opens the V2 items modal (JobItemsPeek: eyebrow → title → summary → cards →
// Close / Open project). Shared by /projects and the client-profile action feed
// so both strips read identically. thumbs = itemId → drive_file_id.

export const fmtStamp = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
// thumb=1 — serve Drive's pre-rendered thumbnail, NOT the multi-MB original
// (these render at 30-52px; the original PNG was the board's slow part).
const thumbUrl = (driveId: string, size: number) => `/api/files/thumbnail?id=${driveId}&thumb=1&size=${size}`;
const routeLabel: Record<string, string> = { drop_ship: "drop-ship", ship_through: "ship-through", stage: "stage" };

export function sortedItems(job: any): any[] {
  return ([...(job.items || [])] as any[]).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

// Per-item state for the peek — flat uppercase color text (v2 style).
export function itemPeekState(it: any, ps?: { state?: string }): [string, string] {
  if (it.received_at_hpd) return ["Received", T.green];
  if (it.pipeline_stage === "shipped") return ["Shipped", T.blue];
  if (it.pipeline_stage === "in_production") return ["In production", T.blue];
  if (it.artwork_status === "n_a") return ["No proof needed", T.muted];
  if (it.artwork_status === "approved" || ps?.state === "approved") return ["Proof approved", T.green];
  if (ps?.state === "revision") return ["Revision requested", T.amber];
  if (ps?.state === "pending") return ["Proof pending", T.amber];
  return ["No proof yet", T.faint];
}

export function ItemThumbRail({ items, thumbs, open, onToggle, align = "right", width = 130 }: {
  items: any[]; thumbs: Record<string, string>; open: boolean; onToggle: () => void; align?: "left" | "right"; width?: number | "auto";
}) {
  if (!items.length) return null;
  return (
    <button onClick={e => { e.stopPropagation(); onToggle(); }} title={open ? "Hide items" : `Peek ${items.length} item${items.length === 1 ? "" : "s"}`}
      style={{ display: "flex", alignItems: "center", justifyContent: align === "left" ? "flex-start" : "flex-end", width, flexShrink: 0, padding: 0, background: "none", border: "none", cursor: "pointer" }}>
      {items.slice(0, 4).map((it: any, i: number) => (
        <div key={it.id} style={{ width: 30, height: 30, borderRadius: 7, border: `2px solid ${open ? T.text : T.card}`, background: T.surface, overflow: "hidden", marginLeft: i === 0 ? 0 : -9, boxShadow: "0 1px 3px rgba(0,0,0,.12)", flexShrink: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {thumbs[it.id] && <img src={thumbUrl(thumbs[it.id], 60)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
        </div>
      ))}
      <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 800, color: T.muted, marginLeft: 6 }}>{items.length > 4 ? `+${items.length - 4}` : ""}{open ? "▴" : "▾"}</span>
    </button>
  );
}

export function JobItemsPeek({ job, stage, items, thumbs, proofStatus, completed = false, onClose, onOpen }: {
  job: any; stage: { route?: string }; items: any[]; thumbs: Record<string, string>; proofStatus?: Record<string, { state?: string }>;
  completed?: boolean; onClose: () => void; onOpen: () => void;
}) {
  const invNo = (job.type_meta as any)?.qb_invoice_number || job.job_number;
  const firstDue = job.phase === "on_hold" ? null : firstItemDue(job);
  const route = stage?.route || job.shipping_route || "";
  return (
    <div onClick={e => e.stopPropagation()} style={{ cursor: "default" }}>
      <ModalShell onClose={onClose} maxWidth={560}>
        <div style={{ padding: "18px 22px 14px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: T.faint, fontFamily: mono }}>{invNo} · {routeLabel[route] || route}</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 3 }}>{(job.clients as any)?.name || "—"}{job.title ? <span style={{ color: T.muted, fontWeight: 400 }}> · {job.title}</span> : null}</div>
        </div>
        <div style={{ display: "flex", gap: 26, padding: "12px 22px", background: T.surface, flexWrap: "wrap" }}>
          {[
            ["Items", String(items.length)],
            ["Units", String(items.reduce((a: number, it: any) => a + ((it.buy_sheet_lines || []) as any[]).reduce((x: number, l: any) => x + (Number(l.qty_ordered) || 0), 0), 0).toLocaleString())],
            completed ? ["Completed", fmtStamp(closedAt(job))] : ["First due", firstDue ? `~${fmtDay(firstDue)}` : "TBD"],
          ].map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: T.faint }}>{k}</div>
              <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, marginTop: 1, fontVariantNumeric: "tabular-nums" }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: "14px 22px", display: "flex", flexDirection: "column", gap: 8, maxHeight: 420, overflowY: "auto" }}>
          {items.map((it: any) => {
            const units = ((it.buy_sheet_lines || []) as any[]).reduce((a, l) => a + (Number(l.qty_ordered) || 0), 0);
            const [lbl, clr] = itemPeekState(it, proofStatus?.[it.id]);
            return (
              <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <div style={{ width: 52, height: 52, borderRadius: 9, background: T.surface, overflow: "hidden", flexShrink: 0, border: `1px solid ${T.border}` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {thumbs[it.id] && <img src={thumbUrl(thumbs[it.id], 104)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name || "Item"}</div>
                  <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: clr, marginTop: 3 }}>{lbl}</div>
                </div>
                {units > 0 && <div style={{ fontFamily: mono, fontSize: 12, color: T.muted, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{units} u</div>}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 22px", borderTop: `1px solid ${T.border}` }}>
          <button onClick={onClose} style={{ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: "9px 16px", border: `1px solid ${T.border}`, background: T.card, color: T.text, cursor: "pointer", fontFamily: font }}>Close</button>
          <button onClick={onOpen} style={{ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: "9px 18px", border: "none", background: T.text, color: "#0a0a0a", cursor: "pointer", fontFamily: font }}>Open project →</button>
        </div>
      </ModalShell>
    </div>
  );
}

// Convenience: rail + peek wired together with local open state.
export function ItemsPeekRail({ job, stage, thumbs, proofStatus, completed, onOpen, onPeekChange, align, width }: {
  job: any; stage: { route?: string }; thumbs: Record<string, string>; proofStatus?: Record<string, { state?: string }>;
  completed?: boolean; onOpen: () => void; onPeekChange?: (open: boolean) => void; align?: "left" | "right"; width?: number | "auto";
}) {
  const [peek, setPeekRaw] = useState(false);
  const setPeek = (v: boolean) => { setPeekRaw(v); onPeekChange?.(v); };
  const items = sortedItems(job);
  return (<>
    <ItemThumbRail items={items} thumbs={thumbs} open={peek} onToggle={() => setPeek(!peek)} align={align} width={width} />
    {peek && <JobItemsPeek job={job} stage={stage} items={items} thumbs={thumbs} proofStatus={proofStatus} completed={completed} onClose={() => setPeek(false)} onOpen={onOpen} />}
  </>);
}
