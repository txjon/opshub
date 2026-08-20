"use client";
// RELEASES — the client release planner (Jul 21 2026; renamed from Drops
// Aug 11; lineup-decides model Aug 12). A release gathers lines from THREE
// sources — studio ideas, pipeline items, catalog re-runs — into one dated
// drop. No stock/pre-order choice at the door: an all-pipeline lineup
// launches, anything else sells/cuts (lib/release-lanes). Post-sale this is
// also where per-line production numbers get entered. 'releases' grant.
// Accepts ?add=<itemId> from the Catalog tab: the item lands on the one
// building release (created if none; chooser if several).
import { useEffect, useMemo, useRef, useState } from "react";
import { useClientPortal } from "../_shared/context";
import { C, fmtDate } from "../_shared/theme";
import { backwardChain, CHAIN_DEFAULTS } from "@/lib/portal/drop-chain";
import { lineUnits, lineState, LINE_LABELS, type LineTone } from "@/lib/release-lanes";

const thumbSrc = (id: string, size = 300) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;
// Honest landing copy: a past ETA reads "was due", never a confident future.
const landsWord = (eta: string) => `${eta < new Date().toISOString().slice(0, 10) ? "was due" : "lands"} ${fmtDate(eta)}`;
const TONE: Record<LineTone, string> = { green: C.green, amber: C.amber, blue: C.blue, purple: C.purple };

const STATUS_WORDS: Record<string, { label: string; color: string; hint: string }> = {
  building: { label: "Building", color: C.amber, hint: "pull designs on, then send it to us" },
  ready: { label: "With the team", color: C.blue, hint: "we're costing and scheduling it" },
  live: { label: "Live", color: "#fd3aa3", hint: "selling now" },
  closed: { label: "Enter numbers", color: C.amber, hint: "sale closed. Enter your production numbers" },
  cut: { label: "In production", color: C.green, hint: "it's on the floor" },
  shelved: { label: "Shelved", color: C.faint, hint: "" },
};

export default function ReleasesPage() {
  const { data, token } = useClientPortal();
  const feats: string[] = (data as any)?.features || [];
  const hasReleases = feats.includes("releases");
  const hasStudio = feats.includes("studio");
  const [drops, setDrops] = useState<any[] | null>(null);
  // Every item they own, one fetch — split below into the pipeline lane
  // (active runs: slot rides along) and the catalog lane (produced history:
  // slot = re-run). Also the date engine's landing source.
  const [allItems, setAllItems] = useState<any[] | null>(null);
  const [open, setOpen] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [pageErr, setPageErr] = useState("");
  const [chooser, setChooser] = useState<{ itemId: string } | null>(null);
  const addHandled = useRef(false);

  async function load(openId?: string) {
    try {
      const res = await fetch(`/api/portal/client/${token}/releases`);
      const body = await res.json();
      setCommitted(new Set((body.committedBriefIds || []) as string[]));
      setDrops(body.drops || []);
      if (openId) setOpen((body.drops || []).find((d: any) => d.id === openId) || null);
      else if (open) setOpen((body.drops || []).find((d: any) => d.id === open.id) || null);
      return (body.drops || []) as any[];
    } catch { setDrops([]); return [] as any[]; }
  }
  async function loadItems() {
    try {
      const b = await fetch(`/api/portal/client/${token}/items`).then(r => r.json());
      setAllItems(b.items || []);
    } catch { setAllItems(prev => prev || []); }
  }
  useEffect(() => {
    load();
    loadItems();
    // eslint-disable-next-line
  }, [token]);
  // Stale-panel guard: refetch when the tab regains focus so an open sheet
  // never shows yesterday's statuses or numbers.
  useEffect(() => {
    const onFocus = () => { load(); loadItems(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line
  }, [token]);

  const [committed, setCommitted] = useState<Set<string>>(new Set());
  const pipeItems = useMemo(() =>
    (allItems || []).filter((it: any) => !["complete", "archived", "cancelled", "on_hold"].includes(it.status)),
    [allItems]);
  // Catalog lane: produced pieces not currently in flight, one card per
  // piece (same name|sku dedupe as the Catalog tab, newest instance wins).
  const catalogItems = useMemo(() => {
    const activeIds = new Set(pipeItems.map((it: any) => it.id));
    const byKey = new Map<string, any>();
    const sorted = [...(allItems || [])].sort((a: any, b: any) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    for (const it of sorted) {
      if (it.run === false || it.status === "cancelled" || activeIds.has(it.id)) continue;
      const key = `${(it.name || "").trim().toLowerCase()}|${(it.blank_sku || "").trim().toLowerCase()}`;
      if (!byKey.has(key)) byKey.set(key, it);
    }
    return Array.from(byKey.values());
  }, [allItems, pipeItems]);
  const itemsById = useMemo(() => {
    const m: Record<string, any> = {};
    for (const it of (allItems || [])) m[it.id] = it;
    return m;
  }, [allItems]);

  // Add an item to a release — pipeline items ride along, produced history
  // goes on as a RE-RUN (server re-validates the lane).
  async function addItemToRelease(releaseId: string, itemId: string): Promise<boolean> {
    const target = (drops || []).find((d: any) => d.id === releaseId);
    if (target && (target.slots || []).some((s: any) => s.itemId === itemId)) { await load(releaseId); return true; }
    const isActive = pipeItems.some((it: any) => it.id === itemId);
    const res = await fetch(`/api/portal/client/${token}/releases/${releaseId}/slots`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isActive ? { itemId } : { itemId, rerun: true }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { setPageErr(out.error || "Couldn't add that to the release."); return false; }
    await load(releaseId);
    return true;
  }

  // ?add=<itemId> — the Catalog tab's "Add to a release" hand-off.
  useEffect(() => {
    if (addHandled.current || drops === null || allItems === null) return;
    const params = new URLSearchParams(window.location.search);
    const addId = params.get("add");
    addHandled.current = true;
    if (!addId) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (!itemsById[addId]) { setPageErr("Couldn't find that piece."); return; }
    (async () => {
      const building = drops.filter((d: any) => d.status === "building");
      if (building.length > 1) { setChooser({ itemId: addId }); return; }
      let target: string | undefined = building[0]?.id;
      if (!target) target = (await createDrop()) || undefined;
      if (target) await addItemToRelease(target, addId);
    })();
    // eslint-disable-next-line
  }, [drops, allItems]);

  if (data && !hasReleases) {
    return <div style={{ padding: "60px 0", textAlign: "center", color: C.muted, fontSize: 13 }}>This page isn&rsquo;t enabled for your account. Reach out to your rep if you&rsquo;d like release planning here.</div>;
  }
  if (!data) return null;

  // A brand-new client has no designs and no pipeline yet — the empty
  // state below routes them to the Studio instead of a dead end.
  const briefLineCount = (((data as any)?.briefs as any[]) || []).length;
  const noSources = briefLineCount === 0 && pipeItems.length === 0 && catalogItems.length === 0;

  // One tap creates it — auto-named ("Release 03"), rename anytime in the
  // sheet. No decisions at the door: the lineup decides what it becomes.
  async function createDrop(): Promise<string | null> {
    setBusy(true);
    try {
      const n = (drops || []).length + 1;
      const title = `Release ${String(n).padStart(2, "0")}`;
      const res = await fetch(`/api/portal/client/${token}/releases`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const body = await res.json();
      if (res.ok) { await load(body.dropId); return body.dropId as string; }
      return null;
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

      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint, textAlign: "center" }}>Releases</div>
      <h1 style={{ fontSize: "clamp(30px,6.5vw,60px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "8px 0 12px", textAlign: "center" }}>
        Plan the release.
      </h1>
      <div style={{ fontSize: 14, color: C.muted, maxWidth: "52ch", lineHeight: 1.6, margin: "0 auto 26px", textAlign: "center" }}>
        Pull designs from your studio into one release. When every piece is approved, send it our way. We cost it, schedule it, and it goes live.
      </div>

      <div style={{ display: "flex", justifyContent: "center", marginBottom: 34 }}>
        <button onClick={() => createDrop()} disabled={busy}
          style={{ background: "#fff", color: C.bg, border: "none", borderRadius: 999, padding: "13px 26px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", opacity: busy ? 0.6 : 1, fontFamily: C.font }}>
          + Build your next release
        </button>
      </div>

      {pageErr && <div style={{ color: C.red, fontSize: 12.5, fontWeight: 700, textAlign: "center", marginBottom: 16 }}>{pageErr}</div>}

      {drops === null ? (
        <div style={{ color: C.faint, fontSize: 13, textAlign: "center", padding: "30px 0" }}>Loading your releases…</div>
      ) : drops.length === 0 ? (
        // First run — a new client has nothing to pull yet, so point them at
        // the door that feeds this page instead of shrugging at them.
        noSources ? (
          <div style={{ textAlign: "center", padding: "10px 0 40px", maxWidth: "46ch", margin: "0 auto" }}>
            <div style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.65 }}>
              {hasStudio
                ? "Your first release starts in the Studio. Drop an idea there, and once the design is approved it lands here, ready to build into a release."
                : "As your designs get approved and your goods hit the pipeline, they show up here, ready to build into a release."}
            </div>
            {hasStudio && (
              <a href={`/portal/client/${token}/studio`}
                style={{ display: "inline-block", marginTop: 18, border: `1px solid ${C.border}`, borderRadius: 999, padding: "12px 22px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.text, textDecoration: "none" }}>
                Open the Studio
              </a>
            )}
          </div>
        ) : (
          <div style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: "10px 0 40px" }}>No releases yet. Start one and pull your greenlit designs onto it.</div>
        )
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760, margin: "0 auto" }}>
          {drops.map((d: any) => {
            const w = STATUS_WORDS[d.status] || { label: d.status, color: C.faint, hint: "" };
            const ready = d.slots.filter((s: any) => s.ideaApproved).length;
            return (
              <button key={d.id} onClick={() => { setOpen(d); load(d.id); }}
                style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "16px 18px", cursor: "pointer", textAlign: "left", fontFamily: C.font, color: C.text }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 17, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>{d.title}</span>
                  <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: w.color }}>{w.label}</span>
                  {d.target_live_date && <span style={{ fontSize: 10.5, fontFamily: C.mono, color: C.faint }}>live {fmtDate(d.target_live_date)}</span>}
                  <span style={{ marginLeft: "auto", fontSize: 10.5, fontFamily: C.mono, color: C.muted }}>{d.slots.length} line{d.slots.length === 1 ? "" : "s"}{d.status === "building" && d.slots.length ? ` · ${ready}/${d.slots.length} approved` : ""}</span>
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

      {/* Which release? — only when several are building and an item arrives from the Catalog */}
      {chooser && (
        <div className="dx-back">
          <div className="dx-sheet">
            <div className="dx-handle" />
            <div style={{ padding: "18px 20px 20px" }}>
              <div style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>Add it to which release?</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>{itemsById[chooser.itemId]?.name || "This piece"} is ready to go on.</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
                {(drops || []).filter((d: any) => d.status === "building").map((d: any) => (
                  <button key={d.id} disabled={busy}
                    onClick={async () => { setChooser(null); await addItemToRelease(d.id, chooser.itemId); }}
                    style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "13px 16px", cursor: "pointer", textAlign: "left", fontFamily: C.font, color: C.text, fontSize: 13, fontWeight: 800, textTransform: "uppercase" }}>
                    {d.title} <span style={{ color: C.faint, fontWeight: 600, textTransform: "none", fontSize: 11 }}>· {d.slots.length} line{d.slots.length === 1 ? "" : "s"}</span>
                  </button>
                ))}
                <button disabled={busy}
                  onClick={async () => { const c = chooser; setChooser(null); const id = await createDrop(); if (id && c) await addItemToRelease(id, c.itemId); }}
                  style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 12, padding: "13px 16px", cursor: "pointer", textAlign: "left", fontFamily: C.font, color: C.muted, fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>
                  + Start a new release with it
                </button>
                <button onClick={() => setChooser(null)}
                  style={{ background: "none", border: "none", color: C.faint, fontSize: 12, cursor: "pointer", fontFamily: C.font, padding: "6px 0" }}>cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {open && <DropSheet drop={open} token={token} briefs={(data?.briefs as any[]) || []} committed={committed} pipeItems={pipeItems} catalogItems={catalogItems} itemsById={itemsById} onChanged={(id?: string) => load(id)} onClose={() => setOpen(null)} />}
    </div>
  );
}

// Inline slot spec — format + retail live ON the slot, edited in place
// while the release is building (dotted-underline convention).
function SlotSpecEdit({ slot, onSave }: { slot: any; onSave: (patch: { format?: string; retail?: number | null }) => Promise<void> }) {
  const [format, setFormat] = useState<string>(slot.format || "");
  const [retail, setRetail] = useState<string>(slot.retail != null ? String(slot.retail) : "");
  const dotted: any = { background: "transparent", border: "none", borderBottom: `1px dashed ${C.faint}`, color: C.text, fontFamily: C.mono, fontSize: 11, outline: "none", padding: "2px 1px" };
  return (
    <span style={{ display: "inline-flex", gap: 10, alignItems: "baseline", width: "100%", paddingLeft: 52 }}>
      <input value={format} onChange={e => setFormat(e.target.value)} placeholder="Tee, Hoodie…"
        onBlur={() => { if ((format.trim() || null) !== (slot.format || null)) onSave({ format: format.trim() }); }}
        style={{ ...dotted, width: 110 }} />
      <span style={{ display: "inline-flex", alignItems: "baseline", gap: 2 }}>
        <span style={{ fontSize: 11, color: C.faint, fontFamily: C.mono }}>$</span>
        <input value={retail} onChange={e => setRetail(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="retail" inputMode="decimal"
          onBlur={() => { const v = retail === "" ? null : Math.round(Number(retail) * 100) / 100; if (v !== (slot.retail ?? null)) onSave({ retail: v }); }}
          style={{ ...dotted, width: 64 }} />
      </span>
    </span>
  );
}

function DropSheet({ drop, token, briefs, committed, pipeItems, catalogItems, itemsById, onChanged, onClose }: {
  drop: any; token: string; briefs: any[]; committed: Set<string>; pipeItems: any[]; catalogItems: any[]; itemsById: Record<string, any>; onChanged: (id?: string) => void; onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  // In-sheet confirm strip (no browser confirm() on the storefront skin).
  const [confirming, setConfirming] = useState<"submit" | "remove" | null>(null);
  const building = drop.status === "building";
  // Lineup decides: numbers only matter for lines that need a run (ideas +
  // re-runs); an all-pipeline lineup is a launch, not a sale.
  const needsRun = (s: any) => !s.itemId || s.rerun;
  const pipelineOnly = drop.slots.length > 0 && !drop.slots.some(needsRun);
  const numbersOpen = drop.status === "closed" && drop.slots.some(needsRun);
  const w = STATUS_WORDS[drop.status] || { label: drop.status, color: C.faint, hint: "" };
  const ready = drop.slots.filter((s: any) => s.ideaApproved).length;
  const allReady = drop.slots.length > 0 && ready === drop.slots.length;

  // Candidate lines: every product line across their ideas not already slotted.
  const slotted = new Set(drop.slots.map((s: any) => `${s.briefId}|${s.lineId}`));
  const slottedItems = new Set(drop.slots.map((s: any) => s.itemId).filter(Boolean));
  // Timeline order: landed goods first (ready now), then soonest landing,
  // then date-TBD stragglers — the picker reads as "now, next, later".
  const itemCands = pipeItems.filter((it: any) => !slottedItems.has(it.id)).sort((a: any, b: any) => {
    const rank = (it: any) => it.status === "in_stock" ? 0 : it.eta ? 1 : 2;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.eta && b.eta) return a.eta.localeCompare(b.eta);
    return (a.name || "").localeCompare(b.name || "");
  });
  const rerunCands = catalogItems.filter((it: any) => !slottedItems.has(it.id));
  const itemById = (id: string) => itemsById[id];
  // Suggested live date = latest landing across PIPELINE slots + prep
  // (re-run sources are past runs — their dates say nothing about this one).
  const slotEtas = drop.slots.map((s: any) => s.itemId && !s.rerun && itemById(s.itemId)?.eta).filter(Boolean) as string[];
  const suggested = slotEtas.length
    ? new Date(new Date(slotEtas.sort().slice(-1)[0] + "T00:00").getTime() + CHAIN_DEFAULTS.webPrepDays * 86400000).toISOString().slice(0, 10)
    : null;
  // Studio designs pull on DIRECTLY — no product-spec prerequisite. The
  // committed set (open release slots anywhere, open studio orders, born
  // items) keeps one design on one lane; format/retail get set on the slot.
  const slottedBriefs = new Set(drop.slots.map((s: any) => s.briefId).filter(Boolean));
  const candidates = useMemo(() =>
    briefs.filter((b: any) => !slottedBriefs.has(b.id) && !committed.has(b.id)),
    // eslint-disable-next-line
    [briefs, committed, drop.slots]);

  const briefThumb = (b: any): string | null => {
    const t = (b.thumbs || []).find((x: any) => x.preview_drive_file_id || x.drive_file_id);
    const id = t?.preview_drive_file_id || t?.drive_file_id;
    return id ? thumbSrc(id) : null;
  };
  const briefById = (id: string) => briefs.find((b: any) => b.id === id);

  async function call(method: string, path: string, body?: any) {
    setErr("");
    const res = await fetch(`/api/portal/client/${token}/releases/${drop.id}${path}`, {
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
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: w.color }}>{w.label}</span>
              {building ? (
                <label style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint }}>Target live</span>
                  <input type="date" defaultValue={drop.target_live_date || ""}
                    onBlur={e => { if (e.target.value !== (drop.target_live_date || "")) call("PATCH", "", { target_live_date: e.target.value || null }).then(ok => ok && onChanged(drop.id)); }}
                    style={{ padding: "7px 9px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, outline: "none", color: C.text, fontFamily: C.font, fontSize: 11.5, colorScheme: "dark" }} />
                </label>
              ) : drop.target_live_date ? (
                <span style={{ fontSize: 10.5, fontFamily: C.mono, color: C.faint }}>target live {fmtDate(drop.target_live_date)}</span>
              ) : null}
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
            <span style={{ fontSize: 11, color: C.faint, maxWidth: "36ch", lineHeight: 1.45 }}>your last landing + {CHAIN_DEFAULTS.webPrepDays}d prep. The lineup picks the date</span>
          </div>
        )}

        {/* ── The lineup ── */}
        <div style={{ padding: "12px 20px 0" }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint, marginBottom: 8 }}>
            The lineup {drop.slots.length > 0 && <span style={{ color: allReady ? C.green : C.amber }}>· {ready}/{drop.slots.length} approved</span>}
          </div>
          {drop.slots.length === 0 && <div style={{ fontSize: 12.5, color: C.faint, paddingBottom: 8 }}>Nothing on it yet. Pull designs on below.</div>}
          {drop.slots.map((s: any) => {
            const pit = s.itemId ? itemById(s.itemId) : null;
            const b = s.briefId ? briefById(s.briefId) : null;
            const src = pit?.thumb_id ? thumbSrc(pit.thumb_id) : (b ? briefThumb(b) : null);
            const cut = drop.status === "cut";
            const lu = lineUnits(s, pit, cut);
            const lastRunPcs = s.rerun && !cut ? (pit?.qty || 0) : 0;
            const st = lineState(s, pit, { releaseCut: cut, briefState: s.briefState });
            const meta = LINE_LABELS.client[st];
            return (
              <div key={s.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
                <span style={{ width: 40, height: 40, background: "#fff", borderRadius: 8, overflow: "hidden", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  {src && <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.format || "Item"}{s.ideaTitle ? <span style={{ color: C.faint, fontWeight: 600, textTransform: "none" }}> · {s.ideaTitle}</span> : null}</span>
                  <span style={{ display: "block", fontSize: 10, fontFamily: C.mono, color: C.muted, marginTop: 2 }}>
                    {s.rerun && !cut
                      ? `new run${lu.total > 0 ? ` · this run ${lu.total.toLocaleString()} pcs` : lastRunPcs > 0 ? ` · last run ${lastRunPcs.toLocaleString()} pcs` : ""}${s.retail != null ? ` · $${s.retail} retail` : ""}`
                      : s.itemId
                        ? `${lu.total.toLocaleString()} pcs${pit?.eta ? ` · ${landsWord(pit.eta)}` : ""}`
                        : `${s.retail != null ? `$${s.retail} retail` : "retail TBD"}${s.model ? ` · ${s.model === "preorder" ? "pre-order" : s.model === "not_sure" ? "model TBD" : "fixed run"}` : ""}`}
                  </span>
                </span>
                <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: (s.briefState === "killed" || s.briefState === "shelved") && !s.itemId ? C.red : TONE[meta.tone], whiteSpace: "nowrap" }}>
                  {(s.briefState === "killed" || s.briefState === "shelved") && !s.itemId ? "Removed in studio" : meta.label}
                </span>
                {building && (!s.itemId || s.rerun) && <SlotSpecEdit slot={s} onSave={async (patch) => { if (await call("PATCH", "/slots", { slotId: s.id, ...patch })) onChanged(drop.id); }} />}
                {building && (
                  <button onClick={async () => { setBusy(s.id); if (await call("DELETE", `/slots?slotId=${s.id}`)) onChanged(drop.id); setBusy(null); }}
                    style={{ background: "none", border: "none", color: C.faint, fontSize: 16, cursor: "pointer", lineHeight: 1 }} aria-label="Remove">×</button>
                )}
                {numbersOpen && needsRun(s) && <NumbersEntry slot={s} onSave={async (qtys) => { setBusy(s.id); if (await call("PATCH", "/slots", { slotId: s.id, qtys })) onChanged(drop.id); setBusy(null); }} />}
              </div>
            );
          })}
        </div>

        {/* ── Add lines ── */}
        {building && (
          <div style={{ padding: "14px 20px 4px" }}>
            {!adding ? (
              <button onClick={() => setAdding(true)}
                style={{ borderRadius: 999, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", padding: "10px 18px", cursor: "pointer", fontFamily: C.font }}>+ Add to release</button>
            ) : candidates.length === 0 && itemCands.length === 0 && rerunCands.length === 0 ? (
              <div style={{ fontSize: 12, color: C.faint }}>
                {drop.slots.length > 0
                  ? "Everything from your pipeline, catalog, and studio is already on it."
                  : "Nothing to pull yet. Designs you approve in the Studio land here."}
              </div>
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
                    <span style={{ fontSize: 10, fontFamily: C.mono, whiteSpace: "nowrap", color: it.status === "in_stock" ? C.green : it.eta ? C.muted : C.faint, fontWeight: it.status === "in_stock" ? 800 : 500 }}>
                      {it.qty ? `${it.qty.toLocaleString()} pcs · ` : ""}{it.status === "in_stock" ? "ready now" : it.eta ? landsWord(it.eta) : "date TBD"}
                    </span>
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: C.text }}>+ Add</span>
                  </button>
                ))}
                {rerunCands.length > 0 && <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint, padding: "8px 0 2px" }}>From your catalog · run it back</div>}
                {rerunCands.map((it: any) => (
                  <button key={it.id}
                    onClick={async () => { setBusy(it.id); if (await call("POST", "/slots", { itemId: it.id, rerun: true })) onChanged(drop.id); setBusy(null); }}
                    style={{ display: "flex", gap: 10, alignItems: "center", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 10px", cursor: "pointer", textAlign: "left", fontFamily: C.font, color: C.text }}>
                    <span style={{ width: 32, height: 32, background: "#fff", borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>
                      {it.thumb_id && <img src={thumbSrc(it.thumb_id)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />}
                    </span>
                    <span style={{ minWidth: 0, flex: 1, fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                    <span style={{ fontSize: 10, fontFamily: C.mono, color: C.muted, whiteSpace: "nowrap" }}>{it.qty ? `last run ${it.qty.toLocaleString()} pcs` : "past run"}</span>
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: C.text }}>+ Add</span>
                  </button>
                ))}
                {candidates.length > 0 && <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint, padding: "8px 0 2px" }}>From the studio · not yet ordered</div>}
                {candidates.map((brief: any) => {
                  const src = briefThumb(brief);
                  return (
                    <button key={brief.id}
                      onClick={async () => { setBusy(brief.id); if (await call("POST", "/slots", { briefId: brief.id })) onChanged(drop.id); setBusy(null); }}
                      style={{ display: "flex", gap: 10, alignItems: "center", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 10px", cursor: "pointer", textAlign: "left", fontFamily: C.font, color: C.text }}>
                      <span style={{ width: 32, height: 32, background: "#fff", borderRadius: 6, overflow: "hidden", flexShrink: 0 }}>
                        {src && <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />}
                      </span>
                      <span style={{ minWidth: 0, flex: 1, fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {brief.title || "Untitled"}
                      </span>
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
          {building && confirming === "submit" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
              <span style={{ fontSize: 12.5, color: C.text, fontWeight: 700, lineHeight: 1.5 }}>Hand &ldquo;{drop.title}&rdquo; to our team? The lineup locks after this.</span>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button disabled={!!busy}
                  onClick={async () => { setBusy("submit"); if (await call("PATCH", "", { submit: true })) onChanged(drop.id); setBusy(null); setConfirming(null); }}
                  style={{ background: "#fff", color: C.bg, border: "none", borderRadius: 999, padding: "13px 24px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", opacity: busy ? 0.6 : 1, fontFamily: C.font }}>
                  Yes, hand it off
                </button>
                <button onClick={() => setConfirming(null)}
                  style={{ background: "transparent", color: C.text, border: `1px solid ${C.border}`, borderRadius: 999, padding: "13px 22px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font }}>
                  Keep building
                </button>
              </div>
            </div>
          )}
          {building && confirming === "remove" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
              <span style={{ fontSize: 12.5, color: C.text, fontWeight: 700, lineHeight: 1.5 }}>Remove this release? This can&rsquo;t be undone.</span>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button disabled={!!busy}
                  onClick={async () => { setBusy("del"); if (await call("DELETE", "")) { onChanged(); onClose(); } setBusy(null); setConfirming(null); }}
                  style={{ background: "transparent", color: C.red, border: `1px solid ${C.red}`, borderRadius: 999, padding: "13px 22px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", opacity: busy ? 0.6 : 1, fontFamily: C.font }}>
                  Remove it
                </button>
                <button onClick={() => setConfirming(null)}
                  style={{ background: "transparent", color: C.text, border: `1px solid ${C.border}`, borderRadius: 999, padding: "13px 22px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font }}>
                  Keep it
                </button>
              </div>
            </div>
          )}
          {building && !confirming && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={onClose}
                  style={{ background: "transparent", color: C.text, border: `1px solid ${C.border}`, borderRadius: 999, padding: "13px 22px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font }}>
                  Done for now
                </button>
                <button disabled={!allReady || !!busy}
                  onClick={() => setConfirming("submit")}
                  title={allReady ? "" : "Every line needs an approved design first"}
                  style={{ background: "#fff", color: C.bg, border: "none", borderRadius: 999, padding: "13px 24px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: allReady ? "pointer" : "default", opacity: allReady ? 1 : 0.4, fontFamily: C.font }}>
                  Hand it off
                </button>
                <button onClick={() => setConfirming("remove")}
                  style={{ marginLeft: "auto", background: "none", border: "none", color: C.faint, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: C.font }}>
                  Remove
                </button>
              </div>
              <span style={{ fontSize: 11, color: C.faint, lineHeight: 1.5, maxWidth: "58ch" }}>
                Everything saves as you go. Close anytime and keep planning later. When the lineup&rsquo;s final, <b style={{ color: C.muted }}>Hand it off</b> sends it to our team {pipelineOnly ? "to schedule the launch" : "to cost it and open the sale"}; the lineup locks from there.{!allReady && drop.slots.length > 0 ? " (Unlocks once every design on it is approved.)" : ""}
              </span>
            </div>
          )}
          {drop.status === "ready" && <span style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>It&rsquo;s with us. We&rsquo;re costing and scheduling, and you&rsquo;ll see it move here.</span>}
          {numbersOpen && <span style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>Sale closed. Enter production numbers on each line above and we&rsquo;ll confirm.</span>}
          {drop.status === "cut" && (
            drop.payable?.state === "paid" ? (
              <span style={{ fontSize: 12.5, fontWeight: 800, color: C.green, letterSpacing: "0.04em" }}>Paid in full. It&rsquo;s in production. Thank you!</span>
            ) : drop.payable?.state === "ready" && drop.payable.paymentLink ? (
              <>
                <a href={drop.payable.paymentLink} target="_blank" rel="noopener noreferrer"
                  style={{ background: "#fff", color: C.bg, borderRadius: 999, padding: "13px 26px", fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", textDecoration: "none", fontFamily: C.font }}>
                  Pay Now{drop.payable.total ? ` · $${Math.round(drop.payable.total - (drop.payable.paid || 0)).toLocaleString()}` : ""}
                </a>
                <span style={{ fontSize: 11.5, color: C.muted }}>Invoice {drop.payable.invoiceNumber ? `#${drop.payable.invoiceNumber}` : ""} is ready. It&rsquo;s in production.</span>
              </>
            ) : (
              <span style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>It&rsquo;s in production. Your invoice is on its way.</span>
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
