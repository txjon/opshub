"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { H, ghostBtn, tag, fmtDue, ago } from "@/lib/studio-theme";
import { woState, woTypeLabel, type WoTarget } from "@/lib/design-work-orders";
import WorkOrderBuilder from "@/components/studio/WorkOrderBuilder";
import WorkOrderPanel from "@/components/studio/WorkOrderPanel";

// THE DESIGNER DOOR on a JOB — the in-job replacement for "Request art
// pricing". Every order on this job's items, + hand an item to a designer
// (vector clean-up / separations by default). Deliveries land on the item;
// Accept makes the delivery the item's print-ready file. Same builder, panel
// and designer page as the studio.
type Props = { open: boolean; job: any; onClose: () => void; openWoId?: string | null };
const STAGE_LABEL: Record<string, string> = { client_art: "Client art", vector: "Vector", mockup: "Mockup", proof: "Proof", print_ready: "Print-ready" };

export default function ItemWorkOrders({ open, job, onClose, openWoId }: Props) {
  const [wos, setWos] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickItem, setPickItem] = useState(false);
  const [building, setBuilding] = useState<any | null>(null);   // the item being handed over
  const [active, setActive] = useState<string | null>(openWoId || null);
  const [notice, setNotice] = useState("");

  async function load() {
    if (!job?.id) return;
    setLoading(true);
    try {
      const w = await fetch(`/api/studio/work-orders?jobId=${job.id}`).then(r => r.json()).catch(() => ({}));
      setWos(w.workOrders || []);
    } finally { setLoading(false); }
  }
  // Items + their live files straight from the client (the job page's own
  // pattern — authenticated RLS covers item_files).
  async function loadFiles() {
    const { createClient } = await import("@/lib/supabase/client");
    const sb = createClient();
    const { data: its } = await sb.from("items").select("id, name, sort_order").eq("job_id", job.id).order("sort_order", { ascending: true });
    const ids = (its || []).map((i: any) => i.id);
    const { data: fs } = ids.length ? await sb.from("item_files").select("id, item_id, drive_file_id, file_name, stage, created_at").in("item_id", ids).is("superseded_at", null).order("created_at", { ascending: true }) : { data: [] };
    setItems(its || []); setFiles((fs || []).filter((f: any) => f.drive_file_id));
  }
  useEffect(() => { if (open) { load(); loadFiles(); setActive(openWoId || null); } /* eslint-disable-next-line */ }, [open, job?.id, openWoId]);

  const targetFor = (it: any): WoTarget => ({ kind: "item", id: it.id, title: it.name || "Item", clientName: job?.clients?.name || null, jobId: job.id, jobTitle: job?.title || null, jobNumber: job?.job_number || null });
  const imagesFor = (itemId: string) => files.filter(f => f.item_id === itemId).map(f => ({ id: f.id, file_id: f.id, drive_file_id: f.drive_file_id, file_url: `/api/files/thumbnail?id=${f.drive_file_id}&thumb=1&size=900`, file_name: f.file_name, reaction: null }));
  const activeWo = useMemo(() => wos.find(w => w.id === active) || null, [wos, active]);
  const activeItem = useMemo(() => activeWo ? items.find(i => i.id === activeWo.item_id) || { id: activeWo.item_id, name: activeWo.design_title } : null, [activeWo, items]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div onClick={e => { if (e.target === e.currentTarget && !building) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "34px 14px", overflowY: "auto", fontFamily: H.font, color: H.text }}>
      <div style={{ background: H.panel, border: `1px solid ${H.line}`, borderRadius: 20, maxWidth: 760, width: "100%", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "18px 22px 6px" }}>
          <div style={{ minWidth: 0 }}>
            <div style={tag(H.faint, 9.5)}>{job?.job_number || "Job"} · designer · Room 2</div>
            <div style={{ fontSize: 18, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", lineHeight: 1.2, marginTop: 2 }}>Hand to a designer</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: H.dim, fontSize: 26, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        {/* tabs: one per order · + new */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "10px 22px 0", borderBottom: `1px solid ${H.line2}`, overflowX: "auto" }}>
          <button onClick={() => setActive(null)} style={{ background: "none", border: "none", borderBottom: !active ? "2px solid #fff" : "2px solid transparent", color: !active ? H.text : H.faint, ...tag(!active ? H.text : H.faint, 10.5), cursor: "pointer", fontFamily: H.font, padding: "6px 0 9px", whiteSpace: "nowrap" }}>Orders · {wos.length}</button>
          {wos.map(w => { const st = woState(w); const on = active === w.id; return (
            <button key={w.id} onClick={() => setActive(w.id)} style={{ background: "none", border: "none", borderBottom: on ? "2px solid #fff" : "2px solid transparent", color: on ? H.text : H.faint, ...tag(on ? H.text : H.faint, 10.5), cursor: "pointer", fontFamily: H.font, padding: "6px 0 9px", whiteSpace: "nowrap", display: "inline-flex", gap: 8, alignItems: "baseline" }}>
              <span>{w.design_title || "Item"} · {woTypeLabel(w.type)}</span><span style={tag(st.color, 9)}>{st.unread ? "●" : ""} {st.label}</span>
            </button>
          ); })}
          <button onClick={() => setPickItem(true)} style={{ marginLeft: "auto", background: "none", border: "none", color: H.blue, ...tag(H.blue, 10.5), cursor: "pointer", fontFamily: H.font, padding: "6px 0 9px", whiteSpace: "nowrap" }}>+ New order</button>
        </div>
        {notice && <div style={{ margin: "8px 22px 0", fontSize: 12, color: H.green }}>{notice}</div>}

        {active && activeWo && activeItem ? (
          <WorkOrderPanel key={active} woId={active} target={targetFor(activeItem)} inline onClose={() => setActive(null)} onChanged={load} />
        ) : (
          <div style={{ padding: "16px 22px 22px" }}>
            {loading && !wos.length ? <div style={{ fontSize: 13, color: H.faint }}>Loading…</div> : wos.length === 0 ? (
              <div style={{ fontSize: 13, color: H.dim, lineHeight: 1.55 }}>
                Nothing out on this job yet. <b style={{ color: H.text }}>+ New order</b> picks an item, pins the brief on its art, and sends the designer a private link. Their delivery lands on the item; <b style={{ color: H.text }}>Accept</b> makes it the print-ready file.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {wos.map(w => { const st = woState(w); return (
                  <button key={w.id} onClick={() => setActive(w.id)} style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "left", background: H.surface, border: `1px solid ${H.line2}`, outline: st.unread ? `2px solid ${H.amber}` : st.late ? `2px solid ${H.red}` : "none", outlineOffset: -1, borderRadius: 12, padding: "10px 14px 10px 10px", cursor: "pointer", color: H.text, fontFamily: H.font, width: "100%" }}>
                    <span style={{ width: 44, height: 44, borderRadius: 8, overflow: "hidden", background: "#fff", flexShrink: 0 }}>{w._thumb && <img src={`/api/files/thumbnail?id=${w._thumb}&thumb=1&size=300`} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.opacity = 0.2; }} />}</span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.design_title || "Item"} · {woTypeLabel(w.type)}</span>
                      <span style={{ display: "block", marginTop: 3, ...tag(st.color, 9) }}>{st.label}<span style={{ color: H.faint, fontWeight: 600, letterSpacing: 0, textTransform: "none", fontFamily: H.mono }}> · {w.designer_name || w.designer_email || "link only"}{w.last_designer_at ? ` · their last word ${ago(w.last_designer_at)}` : ` · out ${ago(w.created_at)}`}{w.due_by ? ` · due ${fmtDue(w.due_by)}` : ""}</span></span>
                    </span>
                  </button>
                ); })}
              </div>
            )}
          </div>
        )}

        {pickItem && (
          <div onClick={e => { if (e.target === e.currentTarget) setPickItem(false); }} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#161616", border: `1px solid ${H.line}`, borderRadius: 18, width: "100%", maxWidth: 520, padding: "20px 22px" }}>
              <div style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase", marginBottom: 4 }}>Which item?</div>
              <div style={{ fontSize: 11.5, color: H.faint, marginBottom: 12 }}>The order hangs off one run. Its art becomes the canvases; the accepted file becomes its print-ready file.</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "50vh", overflowY: "auto" }}>
                {items.map(it => { const fs = files.filter(f => f.item_id === it.id); const first = fs[fs.length - 1]; return (
                  <button key={it.id} disabled={!fs.length} onClick={() => { setPickItem(false); setBuilding(it); }} style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", background: H.surface, border: `1px solid ${H.line2}`, borderRadius: 10, padding: "8px 10px", cursor: fs.length ? "pointer" : "default", color: H.text, fontFamily: H.font, opacity: fs.length ? 1 : 0.4 }}>
                    <span style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden", background: "#fff", flexShrink: 0 }}>{first && <img src={`/api/files/thumbnail?id=${first.drive_file_id}&thumb=1&size=200`} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.opacity = 0.2; }} />}</span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name || "Item"}</span>
                      <span style={{ display: "block", fontSize: 10.5, color: H.faint, marginTop: 2 }}>{fs.length ? `${fs.length} file${fs.length === 1 ? "" : "s"} · ${Array.from(new Set(fs.map((f: any) => STAGE_LABEL[f.stage] || f.stage))).join(", ")}` : "no art yet — upload in Product Builder first"}</span>
                    </span>
                  </button>
                ); })}
                {items.length === 0 && <div style={{ fontSize: 12.5, color: H.faint }}>No items on this job yet.</div>}
              </div>
              <div style={{ display: "flex", marginTop: 12 }}><button onClick={() => setPickItem(false)} style={{ ...ghostBtn, marginLeft: "auto", border: "none", color: H.faint }}>Cancel</button></div>
            </div>
          </div>
        )}

        {building && <WorkOrderBuilder target={targetFor(building)} images={imagesFor(building.id)} notes={[]} onClose={() => setBuilding(null)} onCreated={async (r: any) => {
          setBuilding(null);
          if (r.emailSkipped === "localhost") setNotice("Created — no email from localhost. Send it live from the app, or copy the link.");
          else if (!r.emailSent) { try { await navigator.clipboard.writeText(r.url); setNotice("Work order created — link copied. Paste it to the designer."); } catch { setNotice("Work order created — copy the link from the order."); } }
          else setNotice("Work order sent. The link's in their inbox.");
          setTimeout(() => setNotice(""), 6000);
          await load(); setActive(r.id);
        }} />}
      </div>
    </div>,
    document.body
  );
}
