"use client";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { T, font, mono } from "@/lib/theme";
import { useWarehouse, tQty, type WarehouseJob, type WarehouseItem } from "@/lib/use-warehouse";
import { logJobActivity } from "@/components/JobActivityPanel";
import { createClient } from "@/lib/supabase/client";
import { deductSamples } from "@/lib/qty";
import { NotifyShipmentDialog } from "@/components/NotifyShipmentDialog";

type ShippedHistoryEntry = {
  id: string;
  jobNumber: string;
  invoiceNumber: string | null;
  title: string;
  clientName: string;
  fulfillmentTracking: string;
  shippedAt: string;
  itemCount: number;
  totalUnits: number;
  isOutside?: boolean;
};

export default function ShippingPage() {
  const { loading, shipThrough, undoReceived, updateFulfillment, debounceFulfillmentTracking, forwardItems, addPull, logJobActivity, supabase, setJobs } = useWarehouse();
  const [outsideShipments, setOutsideShipments] = useState<any[]>([]);
  const [tab, setTab] = useState<"ready" | "shipped">("ready");
  // Silent mode — suppresses the Notify Recipient dialog on Mark Shipped.
  // Used when backfilling historical ships ("we already emailed the
  // client manually"). DB state still advances (fulfillment_status =
  // shipped, phase = complete, activity log). localStorage-persisted
  // so a page nav doesn't accidentally re-enable emails.
  const [silentMode, setSilentMode] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setSilentMode(window.localStorage.getItem("shippingSilentMode") === "1");
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("shippingSilentMode", silentMode ? "1" : "0");
  }, [silentMode]);
  const [shippedHistory, setShippedHistory] = useState<ShippedHistoryEntry[]>([]);
  const [shippedLoading, setShippedLoading] = useState(false);
  const db = createClient();

  // List → modal pattern (mirrors /production + /receiving). Each
  // ship-ready project surfaces as a compact row; clicking opens the
  // full ship modal with the item picker + tracking input. Stored
  // by job id since we re-derive the live job from shipThrough on
  // each render.
  const [modalJobId, setModalJobId] = useState<string | null>(null);
  const modalJob = useMemo(
    () => modalJobId ? shipThrough.find(j => j.id === modalJobId) || null : null,
    [modalJobId, shipThrough],
  );
  // Item-picker state — default to "all selected" on modal open so the
  // common "one box, one tracking" flow doesn't require any checkboxes.
  // When the user explicitly deselects some, we honor that for partial-
  // ship UI (per-item outbound tracking is a follow-up; for now this
  // is the affordance + the future hook).
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  // Per-wave forward state.
  const [forwardTracking, setForwardTracking] = useState("");
  const [pullFor, setPullFor] = useState<string | null>(null);   // item id with the pull form open
  const [pullQtys, setPullQtys] = useState<Record<string, string>>({});
  const [pullReason, setPullReason] = useState("");
  // Ship-through items only (a mixed job's stage items go to Fulfillment).
  const stItemsOf = (job: WarehouseJob) => job.items.filter(it => (it.shipping_route || job.shipping_route) === "ship_through");
  const bucketOf = (it: WarehouseItem) => it.forwarded_at ? "forwarded" : (it.received_at_hpd ? "ready" : "awaiting");
  useEffect(() => {
    // Default-select the READY (received, unforwarded) ship-through items — the
    // common "forward what's landed" flow needs no clicks.
    if (modalJob) setSelectedItemIds(new Set(stItemsOf(modalJob).filter(it => bucketOf(it) === "ready").map(it => it.id)));
    else setSelectedItemIds(new Set());
    setForwardTracking(""); setPullFor(null); setPullQtys({}); setPullReason("");
  }, [modalJobId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Items still IN PRODUCTION on these jobs — invisible to useWarehouse (it only
  // loads shipped/received items). Without this the shipper can't tell a job has
  // 5 more items coming from other vendors, and might forward a partial box that
  // should have waited to consolidate. Keyed by job_id → [{name, vendor}].
  const [stillInProd, setStillInProd] = useState<Record<string, { name: string; vendor: string | null }[]>>({});
  useEffect(() => {
    const ids = shipThrough.map(j => j.id);
    if (ids.length === 0) { setStillInProd({}); return; }
    (async () => {
      const routeByJob: Record<string, string> = {};
      for (const j of shipThrough) routeByJob[j.id] = j.shipping_route || "ship_through";
      const { data } = await supabase
        .from("items")
        .select("job_id, name, shipping_route, pipeline_stage, received_at_hpd, decorator_assignments(decorators(short_code, name))")
        .in("job_id", ids);
      const map: Record<string, { name: string; vendor: string | null }[]> = {};
      for (const it of ((data || []) as any[])) {
        const route = it.shipping_route || routeByJob[it.job_id] || "ship_through";
        if (route === "drop_ship") continue;               // never comes to HPD
        if (it.received_at_hpd || it.pipeline_stage === "shipped") continue; // already landed or in transit (useWarehouse has it)
        const dec = it.decorator_assignments?.[0]?.decorators;
        (map[it.job_id] ||= []).push({ name: it.name, vendor: dec?.short_code || dec?.name || null });
      }
      setStillInProd(map);
    })();
  }, [shipThrough, supabase]);

  useEffect(() => {
    if (!modalJobId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setModalJobId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalJobId]);

  // Notify Recipient dialog — opens after Mark Shipped flips state.
  // Mirrors the production page pattern: ship the goods, then a
  // confirmation dialog picks contacts + edits subject/message before
  // firing the email. Spec: memory/project_notify_recipient_on_ship.md
  const [notifyState, setNotifyState] = useState<{
    jobId: string;
    decoratorId: string | null;
    decoratorName: string;
    tracking: string;
    qbInvoiceNumber: string;
    clientName: string;
    jobTitle: string;
    contacts: Array<{ name: string; email: string; role: string }>;
  } | null>(null);
  const [contactsByJob, setContactsByJob] = useState<Record<string, Array<{ name: string; email: string; role: string }>>>({});
  // Outbound tracking the dispatcher enters per outside package before forwarding.
  const [outboundTracking, setOutboundTracking] = useState<Record<string, string>>({});

  function loadOutsideReady() {
    // Received forward (ship_through) packages, with the linked CLIENT's
    // shipping address + contacts joined so the dispatcher knows where to
    // forward and who to notify.
    db.from("outside_shipments")
      .select("*, clients:client_id(name, shipping_address, contacts(name, email))")
      .eq("route", "ship_through").eq("status", "received")
      .order("received_at", { ascending: false })
      .then(({ data }) => setOutsideShipments(data || []));
  }
  useEffect(() => { loadOutsideReady(); }, []);

  // Load completed ship-through jobs for the Shipped history tab.
  async function loadShippedHistory() {
    setShippedLoading(true);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    // Shipped = fulfillment_status "shipped". Don't gate on phase=complete or
    // job route = ship_through — a MIXED drop-ship job can have a ship_through
    // item that was forwarded while the job stays phase=production (drop_ship
    // items still in production). Filter to ship_through scope client-side
    // (job route OR any item override) so pure stage jobs don't leak in.
    const { data } = await db
      .from("jobs")
      .select("id, job_number, title, shipping_route, type_meta, fulfillment_tracking, fulfillment_status, updated_at, clients(name), items(id, shipping_route, received_qtys, ship_qtys, sample_qtys, buy_sheet_lines(size, qty_ordered))")
      .eq("fulfillment_status", "shipped")
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(80);
    const shipThroughData = ((data as any[]) || []).filter(j =>
      j.shipping_route === "ship_through" || (j.items || []).some((it: any) => it.shipping_route === "ship_through"));
    const mapped: ShippedHistoryEntry[] = shipThroughData.map(j => {
      // Count only the ship_through items (a mixed job's drop_ship items aren't
      // part of this forward).
      const items = (j.items || []).filter((it: any) => (it.shipping_route || j.shipping_route) === "ship_through");
      const totalUnits = items.reduce((sum: number, it: any) => {
        const lines = it.buy_sheet_lines || [];
        const r = it.received_qtys || {};
        const s = it.ship_qtys || {};
        const delivered: Record<string, number> = {};
        for (const l of lines) delivered[l.size] = r[l.size] ?? s[l.size] ?? l.qty_ordered ?? 0;
        const continuing = deductSamples(delivered, it.sample_qtys);
        return sum + Object.values(continuing).reduce((a: number, v) => a + (v || 0), 0);
      }, 0);
      const notifs: any[] = Array.isArray((j.type_meta as any)?.shipping_notifications)
        ? (j.type_meta as any).shipping_notifications
        : [];
      const outboundTypes = new Set(["drop_ship_vendor", "ship_through"]);
      const lastOutbound = [...notifs].reverse().find(n => n?.tracking && outboundTypes.has(n?.type));
      const tracking = j.fulfillment_tracking || lastOutbound?.tracking || "";
      return {
        id: j.id,
        jobNumber: j.job_number,
        invoiceNumber: (j.type_meta as any)?.qb_invoice_number || (j.type_meta as any)?.stripe_invoice_number || null,
        title: j.title || "",
        clientName: j.clients?.name || "",
        fulfillmentTracking: tracking,
        shippedAt: j.updated_at,
        itemCount: items.length,
        totalUnits,
      };
    });
    // Forwarded outside packages (status=done, route=ship_through) belong in
    // shipped history too. Linked client name via job_id for now.
    const { data: outsideDone } = await db
      .from("outside_shipments")
      .select("*, clients:client_id(name)")
      .eq("route", "ship_through").eq("status", "done")
      .gte("received_at", since)
      .order("received_at", { ascending: false }).limit(50);
    const outsideMapped: ShippedHistoryEntry[] = ((outsideDone as any[]) || []).map(s => {
      const li = s.line_items || [];
      const totalUnits = li.reduce((sum: number, it: any) =>
        sum + Object.values(it.received || it.sizes || {}).reduce((a: number, v: any) => a + (Number(v) || 0), 0), 0);
      return {
        id: s.id,
        jobNumber: "Outside",
        invoiceNumber: null,
        title: s.description || "Outside package",
        clientName: s.clients?.name || s.sender || "",
        fulfillmentTracking: s.ship_tracking || "",
        shippedAt: s.received_at,
        itemCount: li.length,
        totalUnits,
        isOutside: true,
      };
    });
    const merged = [...mapped, ...outsideMapped].sort((a, b) => (b.shippedAt || "").localeCompare(a.shippedAt || ""));
    setShippedHistory(merged);
    setShippedLoading(false);
  }

  useEffect(() => { if (tab === "shipped") loadShippedHistory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab]);

  // Bucket shipped history by date for the same visual rhythm the
  // /receiving Received tab uses. Today / This week / Last 30 / Older
  // (older collapsed by default).
  const [showAllShipped, setShowAllShipped] = useState(false);
  // Shipped-row detail modal — read-only summary for warehouse staff
  // who shouldn't navigate to the full project overview. Surfaces the
  // outbound packing slip + tracking + units; everything they need
  // for a "what shipped on what day" lookup.
  const [shippedDetailId, setShippedDetailId] = useState<string | null>(null);
  const shippedDetail = useMemo(
    () => shippedDetailId ? shippedHistory.find(s => s.id === shippedDetailId) || null : null,
    [shippedDetailId, shippedHistory],
  );
  useEffect(() => {
    if (!shippedDetailId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShippedDetailId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shippedDetailId]);
  const shippedBuckets = useMemo(() => {
    if (tab !== "shipped") return null;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(todayStart); monthStart.setDate(monthStart.getDate() - 30);
    const today: ShippedHistoryEntry[] = [];
    const thisWeek: ShippedHistoryEntry[] = [];
    const last30: ShippedHistoryEntry[] = [];
    const older: ShippedHistoryEntry[] = [];
    const sorted = [...shippedHistory].sort((a, b) =>
      new Date(b.shippedAt).getTime() - new Date(a.shippedAt).getTime());
    for (const s of sorted) {
      const ts = new Date(s.shippedAt).getTime();
      if (ts >= todayStart.getTime()) today.push(s);
      else if (ts >= weekStart.getTime()) thisWeek.push(s);
      else if (ts >= monthStart.getTime()) last30.push(s);
      else older.push(s);
    }
    return { today, thisWeek, last30, older };
  }, [shippedHistory, tab]);

  async function loadJobContacts(jobId: string): Promise<Array<{ name: string; email: string; role: string }>> {
    if (contactsByJob[jobId]) return contactsByJob[jobId];
    const { data } = await db
      .from("job_contacts")
      .select("role_on_job, contacts(name, email)")
      .eq("job_id", jobId);
    const list = ((data as any[]) || [])
      .map(r => ({
        name: r.contacts?.name || "Unnamed",
        email: r.contacts?.email || "",
        role: r.role_on_job || "",
      }))
      .filter(c => c.email);
    setContactsByJob(prev => ({ ...prev, [jobId]: list }));
    return list;
  }

  // Forward a WAVE — the selected Ready (received, unforwarded) ship-through
  // items — to the client under one outbound tracking. Stamps forwarded_at +
  // forward_tracking (and completes the job if it empties the last wave), then
  // opens the per-wave client-notify dialog (the email scopes to forward_tracking).
  async function forwardLanded(job: WarehouseJob & { invoiceNumber?: string }) {
    const ready = new Set(stItemsOf(job).filter(it => bucketOf(it) === "ready").map(it => it.id));
    const ids = Array.from(selectedItemIds).filter(id => ready.has(id));
    const tracking = forwardTracking.trim();
    if (ids.length === 0 || !tracking) return;
    await forwardItems(job.id, ids, tracking);
    logJobActivity(job.id, silentMode
      ? `Forwarded ${ids.length} item${ids.length === 1 ? "" : "s"} to client (silent — no email) — tracking ${tracking}`
      : `Forwarded ${ids.length} item${ids.length === 1 ? "" : "s"} to client — tracking ${tracking}`);
    setModalJobId(null);
    if (silentMode) return;
    const contacts = await loadJobContacts(job.id);
    setNotifyState({
      jobId: job.id, decoratorId: null, decoratorName: "",
      tracking,
      qbInvoiceNumber: (job as any).invoiceNumber || (job as any).qb_invoice_number || (job as any).display_number || "",
      clientName: job.client_name || "", jobTitle: job.title || "", contacts,
    });
  }

  // Record a post-receiving product pull (units held back — photos/catalog).
  // Ad-hoc path: creates an already-fulfilled pull_request + pulled_inventory
  // bucket (mig 117) and deducts from the forwardable balance via sample_qtys.
  async function savePull(item: WarehouseItem) {
    const qtys: Record<string, number> = {};
    for (const [s, v] of Object.entries(pullQtys)) { const n = parseInt(v) || 0; if (n > 0) qtys[s] = n; }
    if (Object.keys(qtys).length === 0) { setPullFor(null); return; }
    await addPull(item, qtys, "sample", pullReason.trim() || "Internal");
    setPullFor(null); setPullQtys({}); setPullReason("");
  }

  // Lightweight client-notify dialog for forwarded outside packages (no job/
  // invoice). Recipients come from the linked client's contacts.
  const [outsideNotify, setOutsideNotify] = useState<{
    clientName: string; description: string; tracking: string;
    contacts: Array<{ name: string; email: string }>; sel: Record<number, boolean>; sending: boolean;
  } | null>(null);

  // Forward an outside ship-through package to the client. Requires an outbound
  // tracking number; advances to done; if linked to a client (and not silent),
  // opens the client-notify dialog to email the client their tracking.
  async function markOutsideShipped(s: any) {
    const tracking = (outboundTracking[s.id] || "").trim();
    if (!tracking) return;
    await db.from("outside_shipments").update({ status: "done", ship_tracking: tracking }).eq("id", s.id);
    setOutsideShipments(prev => prev.filter(x => x.id !== s.id));
    const contacts = ((s.clients?.contacts || []) as any[]).filter(c => c?.email).map(c => ({ name: c.name || "", email: c.email }));
    if (silentMode || !s.client_id || contacts.length === 0) return;   // no-one to notify
    const sel: Record<number, boolean> = {};
    contacts.forEach((_, i) => { sel[i] = true; });
    setOutsideNotify({ clientName: s.clients?.name || "", description: s.description || "", tracking, contacts, sel, sending: false });
  }

  async function sendOutsideNotify() {
    if (!outsideNotify) return;
    const recipients = outsideNotify.contacts.filter((_, i) => outsideNotify.sel[i]).map(c => c.email);
    if (recipients.length === 0) { setOutsideNotify(null); return; }
    setOutsideNotify(p => p ? { ...p, sending: true } : p);
    try {
      await fetch("/api/outside-shipments/notify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients, tracking: outsideNotify.tracking, description: outsideNotify.description, clientName: outsideNotify.clientName }),
      });
    } catch { /* best-effort */ }
    setOutsideNotify(null);
  }

  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" };
  const ic: React.CSSProperties = { width: "100%", padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontFamily: font, boxSizing: "border-box" as const, outline: "none" };

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading...</div>;

  // Helper to compute continuing-qty + total-units for a job. Used by
  // both the list row and the modal so the numbers always agree.
  function computeJobMeta(job: WarehouseJob) {
    const continuingByItem: Record<string, Record<string, number>> = {};
    for (const it of job.items) {
      const delivered: Record<string, number> = {};
      const r = it.received_qtys || {};
      const s = it.ship_qtys || {};
      const o = it.qtys || {};
      for (const sz of it.sizes) delivered[sz] = r[sz] ?? s[sz] ?? o[sz] ?? 0;
      continuingByItem[it.id] = deductSamples(delivered, it.sample_qtys);
    }
    const totalUnits = job.items.reduce((a, it) =>
      a + Object.values(continuingByItem[it.id]).reduce((x, q) => x + (q || 0), 0), 0);
    return { continuingByItem, totalUnits };
  }

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Shipping</h1>
        {tab === "ready" && shipThrough.length > 0 && <span style={{ fontSize: 12, color: T.muted }}>{shipThrough.length} order{shipThrough.length === 1 ? "" : "s"} ready to ship</span>}
        {tab === "shipped" && <span style={{ fontSize: 12, color: T.muted }}>last 30 days</span>}
        <span style={{ flex: 1 }} />
        {/* Silent mode toggle — suppresses Notify Recipient dialog on
            Mark Shipped. Discoverable here; banner below makes the
            active state impossible to miss. */}
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: silentMode ? T.amber : T.muted, cursor: "pointer", fontFamily: font, padding: "6px 10px", borderRadius: 8, border: `1px solid ${silentMode ? T.amber : T.border}`, background: silentMode ? T.amberDim : "transparent" }}>
          <input type="checkbox" checked={silentMode} onChange={e => setSilentMode(e.target.checked)}
            style={{ width: 14, height: 14, accentColor: T.amber, cursor: "pointer" }} />
          Silent mode
        </label>
      </div>

      {silentMode && (
        <div style={{ background: T.amberDim, border: `1px solid ${T.amber}`, borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: T.amber, letterSpacing: "0.08em", textTransform: "uppercase" }}>Silent mode</span>
          <span style={{ color: T.text }}>Mark Shipped will NOT fire client emails. Use for backfilling historical ship-outs.</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => setSilentMode(false)}
            style={{ background: T.amber, border: "none", color: "#fff", fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 6, cursor: "pointer", fontFamily: font }}>
            Turn off
          </button>
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", borderBottom: `1px solid ${T.border}`, paddingBottom: 6 }}>
        {([
          ["ready", "Ready to Ship", shipThrough.length, T.text],
          ["shipped", "Shipped", shippedHistory.length, T.green],
        ] as const).map(([k, l, count, tone]) => {
          const active = tab === k;
          return (
            <button key={k} onClick={() => setTab(k as any)}
              style={{
                background: "transparent", border: "none", padding: "4px 0",
                cursor: "pointer", fontFamily: font,
                fontSize: 13, fontWeight: active ? 800 : 600,
                color: active ? T.text : T.muted,
                borderBottom: active ? `2px solid ${T.text}` : "2px solid transparent",
                marginBottom: -7,
              }}>
              {l}
              {count > 0 && (
                <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: active ? tone : T.faint }}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Ready tab — compact row list ── */}
      {tab === "ready" && (<>
      {shipThrough.length === 0 ? (
        <div style={{ ...card, padding: "3rem", textAlign: "center", fontSize: 13, color: T.faint }}>
          No orders ready to ship. Ship-through orders appear here after all items are received.
        </div>
      ) : (
        shipThrough.map(job => {
          const { totalUnits } = computeJobMeta(job);
          const invoiceMissing = !(job as any).invoiceNumber && !(job as any).qb_invoice_number;
          const displayInv = (job as any).qb_invoice_number || (job as any).display_number || job.job_number;
          const cardSt = stItemsOf(job);
          const cardReady = cardSt.filter(it => bucketOf(it) === "ready").length;
          const cardAwaiting = cardSt.filter(it => bucketOf(it) === "awaiting").length;
          return (
            <div key={job.id}
              onClick={() => setModalJobId(job.id)}
              style={{
                ...card, padding: "14px 18px", display: "flex", gap: 16,
                alignItems: "flex-start", cursor: "pointer",
                transition: "border-color 0.12s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; }}>
              {/* Left: client + title + invoice */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{job.client_name || "No client"}</span>
                  <span style={{ fontSize: 11, color: T.faint, fontFamily: mono }}>{displayInv}</span>
                </div>
                {(() => {
                  // Items summary — what's in the box, not the project name.
                  // Forward qty per item = delivered (received ?? shipped ??
                  // ordered) − samples pulled.
                  const readyItems = cardSt.filter(it => bucketOf(it) === "ready");
                  const show = (readyItems.length ? readyItems : cardSt);
                  if (show.length === 0) return null;
                  const fwd = (it: WarehouseItem) => {
                    const szs = it.sizes.length ? it.sizes : Object.keys(it.qtys || {});
                    const delivered = szs.reduce((s, sz) => s + ((it.received_qtys?.[sz] ?? it.ship_qtys?.[sz] ?? it.qtys?.[sz]) ?? 0), 0);
                    const samples = Object.values(it.sample_qtys || {}).reduce((a, n) => a + (Number(n) || 0), 0);
                    return Math.max(0, delivered - samples);
                  };
                  const parts = show.slice(0, 3).map(it => `${it.name} · ${fwd(it)}`);
                  const extra = show.length > 3 ? ` +${show.length - 3} more` : "";
                  return (
                    <div style={{ fontSize: 12, color: T.muted, marginTop: 2, wordBreak: "break-word" }}>
                      {parts.join("  ·  ")}{extra}
                    </div>
                  );
                })()}
                <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap", alignItems: "baseline" }}>
                  {job.ship_method && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      {job.ship_method}
                    </span>
                  )}
                  {invoiceMissing && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: T.amber, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      Invoice missing
                    </span>
                  )}
                </div>
              </div>
              {/* Right: readiness in context. "1 ready" alone reads as "done" —
                  so "still coming" sits right beside it, equal weight, and the
                  whole order only reads green when nothing is outstanding. */}
              {(() => {
                const coming = cardAwaiting + (stillInProd[job.id]?.length || 0);
                const complete = coming === 0 && cardReady > 0;
                return (
                  <div style={{ flexShrink: 0, textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, minWidth: 130 }}>
                    {cardReady > 0 && (
                      <div style={{ fontSize: 13, fontWeight: 700, color: complete ? T.green : T.text, fontFamily: mono }}>
                        {cardReady} ready{complete ? " · all here" : ""}
                      </div>
                    )}
                    {coming > 0 && (
                      <div style={{ fontSize: 12, fontWeight: 700, color: T.amber, fontFamily: mono }}>
                        {coming} still coming
                      </div>
                    )}
                    <span style={{ fontSize: 11, color: T.faint, marginTop: 1 }}>
                      {totalUnits.toLocaleString()} units here
                    </span>
                  </div>
                );
              })()}
            </div>
          );
        })
      )}

      {/* Outside shipments routed to ship-through */}
      {outsideShipments.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 8 }}>Outside Shipments</div>
          {outsideShipments.map(s => {
            const addr = s.clients?.shipping_address || "";
            const clientName = s.clients?.name || "";
            return (
            <div key={s.id} style={{ ...card, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.description}</div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                    {[s.sender, s.carrier, s.tracking].filter(Boolean).join(" · ")}
                    {clientName && <span style={{ marginLeft: 8, color: T.blue }}>{clientName}</span>}
                  </div>
                  {/* Forward-to address pulled from the linked client. */}
                  {addr ? (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 9, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Forward to</div>
                      <div style={{ fontSize: 12, color: T.text, whiteSpace: "pre-line", lineHeight: 1.4 }}>{addr}</div>
                    </div>
                  ) : s.client_id ? (
                    <div style={{ marginTop: 8, fontSize: 11, color: T.amber }}>Linked client has no shipping address on file — enter it manually.</div>
                  ) : (
                    <div style={{ marginTop: 8, fontSize: 11, color: T.faint }}>Not linked to a client — no address / no email on forward.</div>
                  )}
                </div>
                <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, width: 200 }}>
                  <input value={outboundTracking[s.id] || ""} onChange={e => setOutboundTracking(p => ({ ...p, [s.id]: e.target.value }))}
                    placeholder="Outbound tracking #"
                    style={{ ...ic, fontFamily: mono, fontSize: 12 }} />
                  <button onClick={() => markOutsideShipped(s)} disabled={!(outboundTracking[s.id] || "").trim()}
                    style={{ fontSize: 11, fontWeight: 700, padding: "7px 16px", borderRadius: 6, border: "none", background: T.green, color: "#fff",
                      cursor: (outboundTracking[s.id] || "").trim() ? "pointer" : "default", opacity: (outboundTracking[s.id] || "").trim() ? 1 : 0.5 }}>
                    Mark Shipped
                  </button>
                </div>
              </div>
            </div>
          ); })}
        </>
      )}
      </>)}

      {/* ── Shipped history — date-bucketed (matches /receiving Received) ── */}
      {tab === "shipped" && (() => {
        if (shippedLoading) {
          return <div style={{ ...card, padding: "3rem", textAlign: "center", fontSize: 13, color: T.muted }}>Loading…</div>;
        }
        if (shippedHistory.length === 0) {
          return <div style={{ ...card, padding: "3rem", textAlign: "center", fontSize: 13, color: T.faint }}>
            No ship-throughs in the last 30 days.
          </div>;
        }
        if (!shippedBuckets) return null;
        const row = (entry: ShippedHistoryEntry) => (
          <div key={entry.id}
            onClick={() => setShippedDetailId(entry.id)}
            style={{
              ...card, padding: "14px 18px", display: "flex", gap: 16,
              alignItems: "flex-start", cursor: "pointer",
              transition: "border-color 0.12s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; }}>
            {/* Left: client + title + invoice */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{entry.clientName || "No client"}</span>
                <span style={{ fontSize: 11, color: T.faint, fontFamily: mono }}>{entry.invoiceNumber || entry.jobNumber}</span>
              </div>
              {entry.title && (
                <div style={{ fontSize: 12, color: T.muted, marginTop: 2, wordBreak: "break-word" }}>{entry.title}</div>
              )}
              {entry.fulfillmentTracking && (
                <div style={{ fontSize: 11, color: T.faint, fontFamily: mono, marginTop: 4, wordBreak: "break-all" }}>
                  {entry.fulfillmentTracking}
                </div>
              )}
            </div>
            {/* Right: counts + shipped-on */}
            <div style={{ flexShrink: 0, textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 110 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.green, fontFamily: mono }}>
                {entry.itemCount} item{entry.itemCount === 1 ? "" : "s"}
              </div>
              <span style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                {entry.totalUnits.toLocaleString()} units
              </span>
              <span style={{ fontSize: 11, color: T.green, marginTop: 2, fontWeight: 600 }}>
                shipped {new Date(entry.shippedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            </div>
          </div>
        );
        const sectionHeader = (label: string, count: number, color: string) => (
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
            <h2 style={{ fontSize: 12, fontWeight: 800, color, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>
              {label}
            </h2>
            <span style={{ fontSize: 11, color: T.muted }}>
              {count} shipment{count === 1 ? "" : "s"}
            </span>
          </div>
        );
        return (
          <>
            {shippedBuckets.today.length > 0 && <>
              {sectionHeader("Today", shippedBuckets.today.length, T.text)}
              {shippedBuckets.today.map(row)}
            </>}
            {shippedBuckets.thisWeek.length > 0 && <>
              {sectionHeader("This week", shippedBuckets.thisWeek.length, T.text)}
              {shippedBuckets.thisWeek.map(row)}
            </>}
            {shippedBuckets.last30.length > 0 && <>
              {sectionHeader("Last 30 days", shippedBuckets.last30.length, T.muted)}
              {shippedBuckets.last30.map(row)}
            </>}
            {shippedBuckets.older.length > 0 && <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
                <button onClick={() => setShowAllShipped(v => !v)}
                  style={{ background: "transparent", border: "none", color: T.faint, fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", padding: 0, fontFamily: font }}>
                  {showAllShipped ? "▾" : "▸"} Older
                </button>
                <span style={{ fontSize: 11, color: T.faint }}>
                  {shippedBuckets.older.length} shipment{shippedBuckets.older.length === 1 ? "" : "s"} hidden
                </span>
              </div>
              {showAllShipped && shippedBuckets.older.map(row)}
            </>}
          </>
        );
      })()}

      {/* ── Ship modal — mirrors /production modal pattern ── */}
      {modalJob && (() => {
        const job = modalJob;
        const { continuingByItem, totalUnits } = computeJobMeta(job);
        const invoiceMissing = !(job as any).invoiceNumber && !(job as any).qb_invoice_number;
        const displayInv = (job as any).qb_invoice_number || (job as any).display_number || job.job_number;
        // Wave buckets (ship-through items only).
        const st = stItemsOf(job);
        const awaiting = st.filter(it => bucketOf(it) === "awaiting");
        const ready = st.filter(it => bucketOf(it) === "ready");
        const forwarded = st.filter(it => bucketOf(it) === "forwarded");
        const selReady = ready.filter(it => selectedItemIds.has(it.id));
        const allReadySelected = ready.length > 0 && ready.every(it => selectedItemIds.has(it.id));
        const canForward = !invoiceMissing && selReady.length > 0 && forwardTracking.trim().length > 0;
        return (
          <div style={{ position: "fixed", inset: 0, background: T.bg, zIndex: 1000, display: "flex", flexDirection: "column", fontFamily: font, color: T.text }}>
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* Header */}
              <div style={{ padding: "14px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexShrink: 0, background: T.card }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: T.text, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    <span>{job.client_name || "No client"}</span>
                    <span style={{ fontSize: 12, color: T.muted, fontWeight: 600 }}>{job.title}</span>
                    <span style={{ fontFamily: mono, color: T.faint, fontWeight: 500, fontSize: 12 }}>{displayInv}</span>
                  </div>
                  <div style={{ fontSize: 12, color: T.faint, marginTop: 2 }}>
                    {job.items.length} item{job.items.length === 1 ? "" : "s"} · {totalUnits.toLocaleString()} units
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: T.accent, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    → Forward to client
                  </span>
                  <button onClick={() => setModalJobId(null)} title="Close (Esc)"
                    style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", padding: "0 6px", lineHeight: 1 }}>×</button>
                </div>
              </div>

              {/* Body */}
              <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Ship to + contact + ship method — text labels, no pills */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Ship to</div>
                    {job.ship_to_address ? (
                      <div style={{ fontSize: 13, color: T.text, whiteSpace: "pre-line", lineHeight: 1.4 }}>{job.ship_to_address}</div>
                    ) : (
                      <div style={{ fontSize: 12, color: T.red }}>No address on file</div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Contact</div>
                    {job.contact_name ? (
                      <>
                        <div style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>{job.contact_name}</div>
                        {job.contact_phone && <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{job.contact_phone}</div>}
                      </>
                    ) : (
                      <div style={{ fontSize: 12, color: T.faint }}>No contact</div>
                    )}
                    {job.ship_method && (
                      <div style={{ marginTop: 8, fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                        {job.ship_method}
                      </div>
                    )}
                  </div>
                </div>

                {/* Project-level shipping notes */}
                {job.shipping_notes && (
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Shipping notes</div>
                    <div style={{ fontSize: 12, color: T.amber, padding: "8px 12px", background: T.amberDim, borderRadius: 6 }}>{job.shipping_notes}</div>
                  </div>
                )}

                {/* Per-item notes from Production */}
                {job.items.some(it => it.ship_notes) && (
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Production notes</div>
                    {job.items.filter(it => it.ship_notes).map(it => (
                      <div key={it.id} style={{ fontSize: 12, color: T.amber, padding: "6px 10px", background: T.amberDim, borderRadius: 6, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700 }}>{it.name}:</span> {it.ship_notes}
                      </div>
                    ))}
                  </div>
                )}

                {/* Still-coming alert — BOTH in-transit (shipped from decorator,
                    not yet at HPD) AND still-in-production (other vendors haven't
                    shipped). Without the production half, the shipper can't tell
                    more is coming and might forward a partial box early. */}
                {(() => {
                  const inTransit = awaiting.map(it => ({ name: it.name, vendor: it.decorator_short_code || it.decorator_name || null }));
                  const inProd = (stillInProd[job.id] || []).map(x => ({ name: x.name, vendor: x.vendor }));
                  const total = inTransit.length + inProd.length;
                  if (total === 0) return null;
                  const row = (x: { name: string; vendor: string | null }, i: number) => (
                    <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "3px 0" }}>
                      <span style={{ color: T.amber, flexShrink: 0 }}>•</span>
                      <span style={{ flex: 1, minWidth: 0, color: T.text, wordBreak: "break-word" }}>{x.name}</span>
                      {x.vendor && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, fontFamily: mono, color: T.muted, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, padding: "1px 6px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{x.vendor}</span>}
                    </div>
                  );
                  const header = (label: string) => (
                    <div style={{ fontSize: 9, fontWeight: 800, color: T.faint, textTransform: "uppercase", letterSpacing: "0.08em", margin: "8px 0 2px" }}>{label}</div>
                  );
                  return (
                    <div style={{ padding: "12px 14px", borderRadius: 8, background: T.amberDim, border: `1px solid ${T.amber}`, fontSize: 12.5 }}>
                      <div style={{ fontWeight: 800, color: T.amber }}>{total} more item{total === 1 ? "" : "s"} coming on this order</div>
                      {inProd.length > 0 && (<>{header("Still in production")}{inProd.map(row)}</>)}
                      {inTransit.length > 0 && (<>{header("In transit to us")}{inTransit.map(row)}</>)}
                      <div style={{ color: T.faint, marginTop: 8, fontSize: 11.5 }}>Forward what's landed now, or wait to consolidate.</div>
                    </div>
                  );
                })()}

                {/* READY TO FORWARD */}
                {ready.length > 0 && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: T.green, textTransform: "uppercase", letterSpacing: "0.07em" }}>Ready to forward · {ready.length}</div>
                      <button onClick={() => setSelectedItemIds(prev => {
                        const next = new Set(prev);
                        if (allReadySelected) ready.forEach(it => next.delete(it.id)); else ready.forEach(it => next.add(it.id));
                        return next;
                      })}
                        style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 6, background: "transparent", border: `1px solid ${T.border}`, color: T.text, cursor: "pointer", fontFamily: font }}>
                        {allReadySelected ? "Unselect all" : "Select all"}
                      </button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {ready.map(item => {
                        const continuing = continuingByItem[item.id] || {};
                        const itemTotal = Object.values(continuing).reduce((a, q) => a + (q || 0), 0);
                        const sampleTotal = tQty(item.sample_qtys);
                        const isSelected = selectedItemIds.has(item.id);
                        return (
                          <div key={item.id}>
                            <div style={{ padding: "10px 12px", borderRadius: 6, background: isSelected ? T.card : T.surface, border: `1px solid ${isSelected ? T.green + "55" : T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
                              <input type="checkbox" checked={isSelected}
                                onChange={() => setSelectedItemIds(prev => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; })}
                                style={{ width: 16, height: 16, cursor: "pointer", accentColor: T.green, flexShrink: 0 }} />
                              <span style={{ fontSize: 11, fontWeight: 800, color: T.muted, fontFamily: mono, flexShrink: 0 }}>{item.letter}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{item.name}</div>
                                <div style={{ fontSize: 11, color: T.muted, marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
                                  {sampleTotal > 0 && <span style={{ color: T.amber }}>{sampleTotal} pulled</span>}
                                  <button onClick={() => { setPullFor(pullFor === item.id ? null : item.id); setPullQtys({}); setPullReason(""); }}
                                    style={{ background: "none", border: "none", color: T.accent, fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0, fontFamily: font }}>
                                    {pullFor === item.id ? "Cancel pull" : "+ Pull sample"}
                                  </button>
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                                {item.sizes.map(sz => <span key={sz} style={{ fontSize: 10, fontFamily: mono, color: T.muted, padding: "2px 6px", background: T.surface, borderRadius: 3 }}>{sz}:{continuing[sz] ?? 0}</span>)}
                                <span style={{ fontSize: 12, fontWeight: 700, fontFamily: mono, color: T.text, marginLeft: 6 }}>{itemTotal}</span>
                              </div>
                            </div>
                            {/* Inline pull form — hold back units for internal use (photos/catalog) */}
                            {pullFor === item.id && (
                              <div style={{ padding: "10px 12px", background: T.amberDim, borderRadius: 6, marginTop: 4, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                  {item.sizes.map(sz => (
                                    <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                      <span style={{ fontSize: 9, fontWeight: 700, fontFamily: mono, color: T.muted }}>{sz}</span>
                                      <input value={pullQtys[sz] || ""} inputMode="numeric" placeholder="0" onChange={e => setPullQtys(p => ({ ...p, [sz]: e.target.value }))}
                                        style={{ ...ic, width: 44, textAlign: "center", padding: "5px 4px", fontFamily: mono }} />
                                    </div>
                                  ))}
                                </div>
                                <input value={pullReason} onChange={e => setPullReason(e.target.value)} placeholder="For (photos / catalog…)" style={{ ...ic, flex: 1, minWidth: 120 }} />
                                <button onClick={() => savePull(item)} style={{ background: T.amber, color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 700, fontFamily: font, cursor: "pointer" }}>Record pull</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* FORWARDED (done) */}
                {forwarded.length > 0 && (
                  <>
                    <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginTop: 4 }}>Forwarded</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {forwarded.map(item => (
                        <div key={item.id} style={{ padding: "8px 12px", borderRadius: 6, background: T.greenDim, border: `1px solid ${T.green}44`, display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                          <span style={{ fontWeight: 700, color: T.green }}>✓</span>
                          <span style={{ flex: 1, color: T.text }}>{item.name}</span>
                          {item.forward_tracking && <span style={{ fontFamily: mono, color: T.muted, fontSize: 11 }}>{item.forward_tracking}</span>}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {ready.length === 0 && awaiting.length === 0 && forwarded.length > 0 && (
                  <div style={{ fontSize: 12, color: T.faint }}>All items forwarded.</div>
                )}
              </div>

              {/* Footer — per-wave forward */}
              <div style={{ padding: "12px 22px", borderTop: `1px solid ${T.border}`, background: T.card, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4, display: "block" }}>Outbound tracking # (this shipment)</label>
                    <input style={{ ...ic, fontFamily: mono }} value={forwardTracking} placeholder="Enter tracking number" onChange={e => setForwardTracking(e.target.value)} />
                  </div>
                  <button onClick={() => forwardLanded(job as any)}
                    disabled={!canForward}
                    title={invoiceMissing ? "Generate invoice first" : (selReady.length === 0 ? "Select a landed item" : (!forwardTracking.trim() ? "Tracking required" : ""))}
                    style={{ background: canForward ? T.green : T.surface, border: "none", borderRadius: 6, color: canForward ? "#fff" : T.faint, fontSize: 13, fontWeight: 700, padding: "10px 22px", cursor: canForward ? "pointer" : "not-allowed", opacity: canForward ? 1 : 0.5, fontFamily: font, whiteSpace: "nowrap" }}>
                    Forward {selReady.length} to client
                  </button>
                </div>
                {invoiceMissing && (
                  <div style={{ fontSize: 11, color: T.amber, fontWeight: 600 }}>Invoice not yet generated — required before notifying customer.</div>
                )}
                {awaiting.length > 0 && selReady.length > 0 && (
                  <div style={{ fontSize: 11, color: T.muted }}>{awaiting.length} item{awaiting.length === 1 ? "" : "s"} still awaiting — they'll come back here when received.</div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Shipped detail modal — read-only summary for warehouse staff.
          Surfaces tracking, units, ship date + a "View packing slip"
          button that opens the outbound HPD→client packing slip PDF
          (same artifact emailed to the client at Mark Shipped time).
          Intentionally does NOT link out to the project overview —
          warehouse role doesn't need that surface. */}
      {shippedDetail && (
        <div onClick={() => setShippedDetailId(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(12px, 3vw, 32px)", fontFamily: font }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: T.card, borderRadius: 14, width: "min(640px, 100%)", maxHeight: "94vh", overflow: "hidden", display: "flex", flexDirection: "column", border: `1px solid ${T.border}` }}>
            {/* Header */}
            <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>{shippedDetail.clientName || "No client"}</div>
                <div style={{ fontSize: 12, color: T.muted, marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {shippedDetail.title && <span>{shippedDetail.title}</span>}
                  <span style={{ fontFamily: mono, color: T.faint }}>{shippedDetail.invoiceNumber || shippedDetail.jobNumber}</span>
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.green, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                ✓ Shipped
              </span>
              <button onClick={() => setShippedDetailId(null)}
                style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", padding: "0 6px", lineHeight: 1 }}>×</button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Shipped</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
                    {new Date(shippedDetail.shippedAt).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                  </div>
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                    {new Date(shippedDetail.shippedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Units</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
                    {shippedDetail.totalUnits.toLocaleString()} across {shippedDetail.itemCount} item{shippedDetail.itemCount === 1 ? "" : "s"}
                  </div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: T.faint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Tracking</div>
                {shippedDetail.fulfillmentTracking ? (
                  <div style={{ fontSize: 13, fontFamily: mono, color: T.text, wordBreak: "break-all" }}>
                    {shippedDetail.fulfillmentTracking}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: T.faint }}>No tracking recorded</div>
                )}
              </div>
            </div>

            {/* Footer — packing slip CTA */}
            <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setShippedDetailId(null)}
                style={{ padding: "8px 16px", background: "transparent", border: `1px solid ${T.border}`, borderRadius: 8, color: T.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                Close
              </button>
              <a href={`/api/pdf/packing-slip/${shippedDetail.id}`} target="_blank" rel="noopener noreferrer"
                style={{ padding: "8px 18px", background: T.accent, color: "#fff", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", textDecoration: "none", fontFamily: font }}>
                View packing slip
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Notify Recipient dialog */}
      <NotifyShipmentDialog
        open={!!notifyState}
        onClose={() => setNotifyState(null) /* don't drop the job — forwardItems
          already updated local state; the shipThrough filter keeps it only if
          ship-through items remain unforwarded (more waves coming). */}
        onSent={() => { /* state already advanced by forwardItems */ }}
        route="drop_ship"
        jobId={notifyState?.jobId || ""}
        decoratorId={notifyState?.decoratorId || null}
        decoratorName={notifyState?.decoratorName || ""}
        tracking={notifyState?.tracking || ""}
        qbInvoiceNumber={notifyState?.qbInvoiceNumber || ""}
        clientName={notifyState?.clientName || ""}
        jobTitle={notifyState?.jobTitle || ""}
        contacts={notifyState?.contacts || []}
      />

      {/* Client-notify dialog for forwarded outside packages (no job/invoice) */}
      {outsideNotify && (
        <div onClick={() => setOutsideNotify(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 16px", overflowY: "auto" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 18, width: "100%", maxWidth: 440, boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>Notify {outsideNotify.clientName || "client"}</div>
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 12 }}>{outsideNotify.description} · <span style={{ fontFamily: mono }}>{outsideNotify.tracking}</span></div>
            <div style={{ fontSize: 10, color: T.faint, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Recipients</div>
            {outsideNotify.contacts.map((c, i) => (
              <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={!!outsideNotify.sel[i]} onChange={() => setOutsideNotify(p => p ? { ...p, sel: { ...p.sel, [i]: !p.sel[i] } } : p)} style={{ width: 15, height: 15, accentColor: T.green, cursor: "pointer" }} />
                <span style={{ color: T.text }}>{c.name || c.email}</span>
                {c.name && <span style={{ color: T.faint, fontSize: 11 }}>{c.email}</span>}
              </label>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={sendOutsideNotify} disabled={outsideNotify.sending || !outsideNotify.contacts.some((_, i) => outsideNotify.sel[i])}
                style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: T.green, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: outsideNotify.sending ? 0.6 : 1 }}>
                {outsideNotify.sending ? "Sending…" : "Send tracking"}
              </button>
              <button onClick={() => setOutsideNotify(null)} style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, fontSize: 12, cursor: "pointer" }}>
                Skip
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
