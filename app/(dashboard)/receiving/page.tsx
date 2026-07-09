"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono, SIZE_ORDER } from "@/lib/theme";
import { useWarehouse, tQty, type WarehouseJob, type WarehouseItem } from "@/lib/use-warehouse";
import { useShipments, isRealTracking, type Shipment } from "@/lib/use-shipments";
import { resolvePulledInventory, resolvePostShopifyPull } from "@/lib/handoff";
import { computeArrivalEta } from "@/lib/arrival-eta";
import { uploadToReceiving, uploadToDrive, registerFileInDb } from "@/lib/drive-upload-client";
import { DriveFileLink } from "@/components/DriveFileLink";
import { DriveThumb } from "@/components/DriveThumb";
import { MockupPeek } from "@/components/MockupPeek";

// ── Pull requests + delivery ETA ──────────────────────────────────────────
// Pull requests (migration 117) are created on Production (or ad-hoc here)
// and fulfilled by the warehouse. useWarehouse loads only OPEN requests
// (pending/partial) onto item.pull_requests — fulfilled ones live in the
// Pulls tab (pulled_inventory) and the job activity feed.
type PullReq = WarehouseItem["pull_requests"][number];
const PULL_KIND_LABELS: Record<string, string> = {
  sample: "Sample", photo: "Photo shoot", catalog: "Catalog",
  client: "Client", event: "Event", other: "Other",
};
function pullEntries(qtys: Record<string, number> | null | undefined) {
  return Object.entries(qtys || {}).filter(([, n]) => n > 0);
}
function pullReqText(p: PullReq) {
  const entries = pullEntries(p.qtys);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  const sizeStr = entries.map(([s, n]) => (n > 1 ? `${n}×${s}` : s)).join(", ");
  const head = entries.length === 0
    ? "pull"
    : entries.length === 1
      ? `${entries[0][1]}×${entries[0][0]}`
      : `${total} pcs · ${sizeStr}`;
  const tail = [
    p.kind && p.kind !== "sample" ? (PULL_KIND_LABELS[p.kind] || p.kind).toLowerCase() : null,
    p.reason?.trim() || null,
  ].filter(Boolean).join(" — ");
  return tail ? `${head} — ${tail}` : head;
}
function activePulls(item: WarehouseItem): PullReq[] {
  return item.pull_requests || [];
}
function fmtEta(d: string | null) {
  if (!d) return null;
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  if (!y || !m || !day) return d;
  return new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Sort {size: qty} into canonical size order (S, M, L, XL, 2XL…); unknown sizes
// fall to the end in their existing order.
function sortSizeEntries(obj: Record<string, any>): [string, any][] {
  return Object.entries(obj || {}).sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a[0]), ib = SIZE_ORDER.indexOf(b[0]);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
}

// Copy that also works on plain http (LAN IP) where navigator.clipboard is
// unavailable — falls back to a hidden textarea + execCommand.
async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch { /* fall through to legacy path */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand("copy"); } finally { document.body.removeChild(ta); }
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); copyText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {}); }}
      title={copied ? "Copied" : "Copy tracking"}
      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginLeft: 4, color: copied ? T.green : T.faint, fontSize: 11, lineHeight: 1, flexShrink: 0 }}
    >{copied ? "✓" : "⧉"}</button>
  );
}
// Interactive checklist — used in the receive modal. Fulfilling a pull writes
// pulled_inventory, rolls the qty into sample_qtys (which deducts from the
// continuing/forward balance), and drops it from the open list. "Skip" cancels
// a pull that can't be honored (e.g. box came in short) — kept as history.
function PullChecklist({ item, onFulfill, onCancel }: {
  item: WarehouseItem;
  onFulfill: (pull: PullReq) => void;
  onCancel: (pull: PullReq) => void;
}) {
  const pulls = activePulls(item);
  const [busyId, setBusyId] = useState<string | null>(null);
  if (pulls.length === 0) return null;
  return (
    <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 6, background: T.amberDim + "55", border: `1px solid ${T.amber}44` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 9, fontWeight: 800, color: T.amber, textTransform: "uppercase", letterSpacing: "0.06em" }}>Pulls requested</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: T.amber, fontFamily: mono }}>{pulls.length} open</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {pulls.map(p => {
          const countable = pullEntries(p.qtys).some(([s, n]) => n > 0 && item.sizes.includes(s));
          const busy = busyId === p.id;
          return (
            <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ fontSize: 12, color: T.text, lineHeight: 1.3, minWidth: 0, wordBreak: "break-word", flex: 1 }}>
                {pullReqText(p)}
                {p.requested_by_name && <span style={{ color: T.faint }}> · {p.requested_by_name.split("@")[0]}</span>}
                {!countable && <span style={{ color: T.faint, fontStyle: "italic" }}> · sizes don't match item — count manually</span>}
              </span>
              <button disabled={busy}
                onClick={async () => { setBusyId(p.id); try { await onFulfill(p); } finally { setBusyId(null); } }}
                style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 5, border: "none", background: T.amber, color: "#1a1508", cursor: busy ? "default" : "pointer", fontFamily: font, flexShrink: 0, opacity: busy ? 0.6 : 1 }}>
                {busy ? "…" : "Pulled ✓"}
              </button>
              <button disabled={busy} onClick={() => onCancel(p)} title="Can't fulfill — dismiss (kept as history)"
                style={{ fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 5, border: `1px solid ${T.border}`, background: "transparent", color: T.faint, cursor: "pointer", fontFamily: font, flexShrink: 0 }}>
                Skip
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type OutsideShipment = {
  id: string;
  carrier: string;
  tracking: string;
  sender: string;
  description: string;
  condition: string;
  notes: string;
  job_id: string | null;
  client_id: string | null;
  resolved: boolean;
  status: string;                 // 'pending' | 'received' | 'done'
  route?: string | null;          // post-receive intent: 'ship_through' | 'stage'
  received_at: string;
  files: { name: string; driveLink: string; driveFileId: string }[];
  drive_folder_link: string | null;
  line_items?: { name: string; sizes: Record<string, number> }[];
};

type ReceivingProject = WarehouseJob & {
  invoiceNumber: string | null;
  shipDate: string | null;
  decoratorGroups: DecoratorGroup[];
  pendingItems: number;
  receivedItems: number;
  totalUnits: number;
};

type DecoratorGroup = {
  decoratorId: string | null;
  decoratorName: string;
  shortCode: string;
  items: WarehouseItem[];
  pending: number;
  received: number;
  totalUnits: number;
};

type FileRec = { file_name: string; drive_link: string; drive_file_id: string | null; mime_type: string | null };

export default function ReceivingPage() {
  const { loading, jobs, updateReceivedQty, updateSampleQty, markReceived, bulkMarkReceived, undoReceived, returnToProduction, fulfillPull, addPull, cancelPull, logJobActivity } = useWarehouse();
  const supabase = createClient();

  // Pulled inventory (migration 117): units held back from shipments — the
  // physical shelf of samples/photo/client pulls. Held rows are the working
  // list; resolving (returned / shipped out / consumed) clears them off.
  type PulledRow = {
    id: string; item_id: string | null; item_name: string | null; job_id: string | null;
    qtys: Record<string, number>; location: string | null; status: string; notes: string | null;
    created_at: string;
  };
  const [heldPulls, setHeldPulls] = useState<PulledRow[]>([]);
  const [pullJobRefs, setPullJobRefs] = useState<Record<string, string>>({});
  async function loadHeldPulls() {
    const { data } = await supabase
      .from("pulled_inventory").select("*")
      .eq("status", "held")
      .order("created_at", { ascending: false });
    const rows = (data || []) as PulledRow[];
    setHeldPulls(rows);
    const jobIds = Array.from(new Set(rows.map(r => r.job_id).filter(Boolean))) as string[];
    if (jobIds.length > 0) {
      const { data: jrows } = await supabase.from("jobs").select("id, job_number, title, type_meta, clients(name)").in("id", jobIds);
      const refs: Record<string, string> = {};
      for (const j of (jrows || []) as any[]) {
        refs[j.id] = [j.clients?.name, j.type_meta?.qb_invoice_number || j.job_number].filter(Boolean).join(" · ");
      }
      setPullJobRefs(refs);
    }
  }
  useEffect(() => { loadHeldPulls(); }, [jobs.length]);

  // Post-Shopify pull tasks (Jon's rule): once an item is keyed into Shopify,
  // a pull is executed as a Shopify ORDER (fulfillment flow) or a SHELF PULL
  // with a manual Shopify count adjustment. These land in the Holding strip —
  // queried directly so they surface even when the job aged out of the
  // warehouse view.
  type PostShopifyPull = { pull: any; item_name: string; job_ref: string };
  const [postShopifyPulls, setPostShopifyPulls] = useState<PostShopifyPull[]>([]);
  async function loadPostShopifyPulls() {
    const { data: open } = await supabase
      .from("pull_requests")
      .select("*, items!inner(id, name, webstore_entered_at, job_id, jobs(job_number, type_meta, clients(name)))")
      .in("status", ["pending", "partial"])
      .not("items.webstore_entered_at", "is", null)
      .order("created_at");
    setPostShopifyPulls(((open || []) as any[]).map(r => ({
      pull: r,
      item_name: r.items?.name || "Item",
      job_ref: [r.items?.jobs?.clients?.name, r.items?.jobs?.type_meta?.qb_invoice_number || r.items?.jobs?.job_number].filter(Boolean).join(" · "),
    })));
  }
  useEffect(() => { loadPostShopifyPulls(); }, [jobs.length]);
  async function resolvePostShopify(t: PostShopifyPull, mode: "shopify_order" | "shelf_pull") {
    await resolvePostShopifyPull(supabase, t.pull, mode, { itemName: t.item_name });
    setPostShopifyPulls(prev => prev.filter(x => x.pull.id !== t.pull.id));
    if (mode === "shelf_pull") loadHeldPulls();
    const total = Object.values(t.pull.qtys || {}).reduce((a: number, n) => a + (Number(n) || 0), 0);
    if (t.pull.job_id) logJobActivity(t.pull.job_id, `${t.item_name} — ${total} unit pull ${mode === "shopify_order" ? "placed as Shopify order" : "pulled off shelf, Shopify count adjusted"}`);
  }

  async function resolveHeldPull(row: PulledRow, status: "returned" | "shipped_out" | "consumed") {
    await resolvePulledInventory(supabase, row as any, status);
    setHeldPulls(prev => prev.filter(r => r.id !== row.id));
    if (row.job_id) {
      const total = Object.values(row.qtys || {}).reduce((a, n) => a + (Number(n) || 0), 0);
      const verb = status === "returned" ? "returned to stock" : status === "shipped_out" ? "shipped out" : "consumed";
      logJobActivity(row.job_id, `${row.item_name || "Pulled units"} — ${total} pulled unit${total === 1 ? "" : "s"} ${verb}`);
    }
  }

  // Persisted shipment rows (migration 117), keyed by group_key — the SAME key
  // the derived grouping uses, so meta[shipment.key] lines up 1:1. Carries the
  // production→warehouse handoff note. Legacy boxes shipped before 117 simply
  // have no row (no note to show).
  const [shipmentMeta, setShipmentMeta] = useState<Record<string, { id: string; warehouse_notes: string | null }>>({});
  useEffect(() => {
    (async () => {
      const cutoff = new Date(Date.now() - 60 * 86400000).toISOString();
      const { data } = await supabase
        .from("shipments")
        .select("id, group_key, warehouse_notes")
        .eq("direction", "inbound")
        .gte("created_at", cutoff);
      const map: Record<string, { id: string; warehouse_notes: string | null }> = {};
      for (const s of (data || []) as any[]) map[s.group_key] = { id: s.id, warehouse_notes: s.warehouse_notes };
      setShipmentMeta(map);
    })();
  }, [jobs.length]); // refresh alongside the warehouse data

  // Filters / tabs
  const [search, setSearch] = useState("");
  const [filterDecorator, setFilterDecorator] = useState("");
  const [tab, setTab] = useState<"pending" | "received" | "outside">("pending");
  // Silent mode — suppresses the production_complete client email for
  // receives keyed in this session. Used when backfilling historical
  // receives (boxes that physically arrived weeks ago but haven't been
  // marked in OpsHub yet). Activity log + phase recalc still fire so
  // internal state stays consistent. localStorage-persisted so a page
  // navigation doesn't accidentally re-enable emails mid-backfill.
  const [silentMode, setSilentMode] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setSilentMode(window.localStorage.getItem("receivingSilentMode") === "1");
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("receivingSilentMode", silentMode ? "1" : "0");
  }, [silentMode]);

  // Modal — scoped to one Shipment at a time. The receive flow inside
  // unchanged; we just regroup items by (decorator, tracking) at the
  // list level so what shows up here is a single physical box, not a
  // project's full vendor mix.
  const [modalShipmentKey, setModalShipmentKey] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  // Batch-receive confirm modal — the items queued by "Receive Selected".
  const [batchReceiveItems, setBatchReceiveItems] = useState<WarehouseItem[] | null>(null);
  const [mockupPeek, setMockupPeek] = useState<{ driveFileId: string | null; name: string } | null>(null);

  // Receive UI state — keyed by item id
  const [conditionNote, setConditionNote] = useState<Record<string, string>>({});
  const [itemCondition, setItemCondition] = useState<Record<string, string>>({});
  // Ad-hoc pull, inline in the receive modal (one open at a time).
  const [adhocPullFor, setAdhocPullFor] = useState<string | null>(null);
  const [adhocQtys, setAdhocQtys] = useState<Record<string, string>>({});
  const [adhocReason, setAdhocReason] = useState("");
  async function saveAdhocPull(item: WarehouseItem) {
    const qtys: Record<string, number> = {};
    for (const [s, v] of Object.entries(adhocQtys)) { const n = parseInt(v) || 0; if (n > 0) qtys[s] = n; }
    if (Object.keys(qtys).length > 0) {
      await addPull(item, qtys, "sample", adhocReason.trim() || "Pulled at receiving");
      loadHeldPulls();
    }
    setAdhocPullFor(null); setAdhocQtys({}); setAdhocReason("");
  }

  // Files
  const [packingSlips, setPackingSlips] = useState<Record<string, FileRec[]>>({});
  const [receivingPhotos, setReceivingPhotos] = useState<Record<string, FileRec[]>>({});
  const [mockupMap, setMockupMap] = useState<Record<string, { driveFileId: string | null; driveLink: string | null }>>({});
  const [uploadingPhoto, setUploadingPhoto] = useState<string | null>(null);
  const [viewingSlips, setViewingSlips] = useState<{ files: { file_name: string; drive_link: string }[]; index: number; title: string } | null>(null);
  const photoInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Outside
  const [outsideShipments, setOutsideShipments] = useState<OutsideShipment[]>([]);
  const [outsideReceived, setOutsideReceived] = useState<OutsideShipment[]>([]);
  // Receive-an-outside-package modal: the package being received + draft state.
  const [receivingOutside, setReceivingOutside] = useState<OutsideShipment | null>(null);
  const [recvCondition, setRecvCondition] = useState("good");
  const [recvRoute, setRecvRoute] = useState<"ship_through" | "stage">("ship_through");
  const [recvQtys, setRecvQtys] = useState<Record<string, string>>({}); // key `${itemIdx}:${size}`
  const [recvPendingFiles, setRecvPendingFiles] = useState<File[]>([]);
  const [recvBusy, setRecvBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ carrier: "", tracking: "", sender: "", description: "", condition: "", notes: "", destination: "ship_through", clientId: "" });
  // Structured line items for an outside shipment (name + size/qty rows).
  // Editor shape uses arrays for stable editing; collapsed to {name, sizes:{}}
  // on save.
  const [formLineItems, setFormLineItems] = useState<{ id: string; name: string; rows: { size: string; qty: string }[] }[]>([]);
  const [orderSearch, setOrderSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [linkableJobs, setLinkableJobs] = useState<{ id: string; title: string; client_name: string; job_number: string; display_number: string }[]>([]);
  const [linkableClients, setLinkableClients] = useState<{ id: string; name: string }[]>([]);
  const [linkingId, setLinkingId] = useState<string | null>(null); // outside pkg whose client picker is open
  const [linkQuery, setLinkQuery] = useState("");

  useEffect(() => { loadOutside(); loadLinkableJobs(); loadLinkableClients(); }, []);

  // Escape closes modal
  useEffect(() => {
    if (!modalShipmentKey) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setModalShipmentKey(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalShipmentKey]);

  // Reset modal-local state when modal closes
  useEffect(() => {
    if (!modalShipmentKey) {
      setSelectedItemIds(new Set());
    }
  }, [modalShipmentKey]);

  function toggleItemSelected(itemId: string) {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  }

  // Load packing slips + photos when items change
  useEffect(() => {
    if (jobs.length === 0) return;
    const itemIds = jobs.flatMap(j => j.items.map(it => it.id));
    if (itemIds.length === 0) return;
    supabase.from("item_files")
      .select("item_id, file_name, drive_link, drive_file_id, mime_type, stage")
      .in("stage", ["packing_slip", "receiving_photo"])
      .in("item_id", itemIds)
      .then(({ data }) => {
        const slips: Record<string, FileRec[]> = {};
        const photos: Record<string, FileRec[]> = {};
        for (const f of (data || [])) {
          const target = f.stage === "packing_slip" ? slips : photos;
          if (!target[f.item_id]) target[f.item_id] = [];
          target[f.item_id].push({ file_name: f.file_name, drive_link: f.drive_link, drive_file_id: f.drive_file_id, mime_type: f.mime_type });
        }
        setPackingSlips(slips);
        setReceivingPhotos(photos);
      });
  }, [jobs]);

  // Load active mockup thumbnails — one per item, latest first. Filtered
  // by superseded_at IS NULL so we never show old versions after a re-up.
  useEffect(() => {
    if (jobs.length === 0) return;
    const itemIds = jobs.flatMap(j => j.items.map(it => it.id));
    if (itemIds.length === 0) return;
    supabase.from("item_files")
      .select("item_id, drive_file_id, drive_link, created_at")
      .eq("stage", "mockup")
      .is("superseded_at", null)
      .in("item_id", itemIds)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        const m: Record<string, { driveFileId: string | null; driveLink: string | null }> = {};
        for (const f of (data || [])) {
          if (!m[f.item_id]) m[f.item_id] = { driveFileId: f.drive_file_id, driveLink: f.drive_link };
        }
        setMockupMap(m);
      });
  }, [jobs]);

  // No explicit sync effect — the modal reads `shipments.find(s => s.key === modalShipmentKey)`
  // directly during render, so any change to the underlying shipments
  // (item received, qty updated, etc.) flows through naturally without
  // setState chains.

  async function loadOutside() {
    // Every logged package goes through receiving first. Pending = status
    // 'pending' (awaiting receive), newest logged first.
    const { data: pending } = await supabase
      .from("outside_shipments").select("*").eq("status", "pending")
      .order("created_at", { ascending: false });
    setOutsideShipments(pending || []);
    // Received = an audit trail of packages already received (they also live on
    // the Shipping/Fulfillment pages per their route until marked done).
    const { data: received } = await supabase
      .from("outside_shipments").select("*").in("status", ["received", "done"])
      .order("received_at", { ascending: false }).limit(100);
    setOutsideReceived(received || []);
  }

  async function loadLinkableJobs() {
    const { data } = await supabase
      .from("jobs")
      .select("id, title, job_number, type_meta, clients(name)")
      .not("phase", "in", '("complete","cancelled")')
      .order("created_at", { ascending: false }).limit(200);
    setLinkableJobs((data || []).map((j: any) => ({
      id: j.id, title: j.title, client_name: j.clients?.name || "",
      job_number: j.job_number, display_number: j.type_meta?.qb_invoice_number || j.job_number,
    })));
  }

  async function submitOutside() {
    if (!form.description.trim()) return;
    setSaving(true);
    const uploadedFiles: { name: string; driveLink: string; driveFileId: string }[] = [];
    let driveFolderLink: string | null = null;
    if (pendingFiles.length > 0) {
      const today = new Date().toISOString().split("T")[0];
      const label = `${today} — ${form.sender || form.description}`.slice(0, 100);
      for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i];
        setUploadStatus(`Uploading ${i + 1}/${pendingFiles.length}...`);
        try {
          const result = await uploadToReceiving({
            blob: file, fileName: file.name, mimeType: file.type || "application/octet-stream", shipmentLabel: label,
          });
          uploadedFiles.push({ name: file.name, driveLink: result.webViewLink, driveFileId: result.fileId });
          if (!driveFolderLink) driveFolderLink = result.folderLink;
        } catch (err) { console.error("Upload error:", err); }
      }
      setUploadStatus("");
    }
    // Destination is the POST-RECEIVE intent — every package goes through
    // receiving first (status 'pending'), then splits to Shipping (forward) or
    // Fulfillment (stage) once received. The route can still be changed at
    // receive time.
    const route = form.destination === "stage" ? "stage" : "ship_through";
    // Collapse the editor rows to the stored shape; drop empty items/rows.
    const lineItems = formLineItems
      .map(i => ({ name: i.name.trim(), sizes: Object.fromEntries(
        i.rows.filter(r => r.size.trim())
          .sort((a, b) => { const ia = SIZE_ORDER.indexOf(a.size.trim()), ib = SIZE_ORDER.indexOf(b.size.trim()); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib); })
          .map(r => [r.size.trim(), Number(r.qty) || 0])
      ) }))
      .filter(i => i.name || Object.keys(i.sizes).length > 0);
    await supabase.from("outside_shipments").insert({
      carrier: form.carrier || null, tracking: form.tracking || null,
      sender: form.sender || null, description: form.description,
      condition: form.condition || null, notes: form.notes || null,
      files: uploadedFiles.length > 0 ? uploadedFiles : [],
      drive_folder_link: driveFolderLink,
      route, status: "pending", resolved: false, client_id: form.clientId || null,
      line_items: lineItems,
    });
    setForm({ carrier: "", tracking: "", sender: "", description: "", condition: "", notes: "", destination: "ship_through", clientId: "" });
    setFormLineItems([]); setOrderSearch("");
    setPendingFiles([]); setShowForm(false); setSaving(false);
    loadOutside();
  }

  async function loadLinkableClients() {
    const { data } = await supabase.from("clients").select("id, name").order("name").limit(1000);
    setLinkableClients((data || []).map((c: any) => ({ id: c.id, name: c.name })));
  }
  const clientNameOf = (s: OutsideShipment) =>
    (s.client_id && linkableClients.find(c => c.id === s.client_id)?.name)
    || linkableJobs.find(j => j.id === s.job_id)?.client_name
    || "";

  async function linkToClient(shipmentId: string, clientId: string) {
    setLinkingId(null); setLinkQuery("");
    await supabase.from("outside_shipments").update({ client_id: clientId }).eq("id", shipmentId);
    loadOutside();
  }

  // Inline client link/re-link control for an outside package row (so a client
  // can be attached AFTER logging — needed for forwarding/notify on Shipping).
  const renderClientLink = (s: OutsideShipment) => {
    const linkedClient = clientNameOf(s);
    const lnk = { background: "none", border: "none", color: T.accent, fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0, fontFamily: font } as const;
    if (linkingId === s.id) {
      const q = linkQuery.trim().toLowerCase();
      const matches = q ? linkableClients.filter(c => c.name.toLowerCase().includes(q)).slice(0, 6) : [];
      return (
        <span onClick={e => e.stopPropagation()} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <input autoFocus value={linkQuery} onChange={e => setLinkQuery(e.target.value)} placeholder="Search client…"
            style={{ padding: "2px 6px", border: `1px solid ${T.border}`, borderRadius: 4, background: T.card, color: T.text, fontSize: 11, fontFamily: font, outline: "none", width: 130 }} />
          <button onClick={() => { setLinkingId(null); setLinkQuery(""); }} style={{ ...lnk, color: T.faint, fontSize: 13 }}>×</button>
          {q && (
            <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 20, background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, marginTop: 3, minWidth: 160, maxHeight: 200, overflowY: "auto", boxShadow: "0 6px 20px rgba(0,0,0,0.14)" }}>
              {matches.length === 0 ? (
                <div style={{ padding: "6px 10px", fontSize: 11, color: T.faint }}>No matching client</div>
              ) : matches.map(c => (
                <div key={c.id} onClick={() => linkToClient(s.id, c.id)}
                  style={{ padding: "6px 10px", fontSize: 12, cursor: "pointer", fontWeight: 600, borderBottom: `1px solid ${T.border}55` }}
                  onMouseEnter={e => e.currentTarget.style.background = T.surface} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{c.name}</div>
              ))}
            </div>
          )}
        </span>
      );
    }
    return linkedClient
      ? <span>{linkedClient} <button onClick={e => { e.stopPropagation(); setLinkingId(s.id); setLinkQuery(""); }} style={lnk}>change</button></span>
      : <button onClick={e => { e.stopPropagation(); setLinkingId(s.id); setLinkQuery(""); }} style={lnk}>+ Link client</button>;
  };


  // Receive an outside package at HPD. received_at is set to the actual receive
  // time so the Received list shows when it landed; resolved flips it out of the
  // pending queue and into the received list.
  // ── Outside-shipment line-item editor handlers ──
  const liAddItem = () => setFormLineItems(p => [...p, { id: `li_${Date.now()}_${Math.round(Math.random() * 1e6)}`, name: "", rows: [{ size: "", qty: "" }] }]);
  const liRemoveItem = (id: string) => setFormLineItems(p => p.filter(i => i.id !== id));
  const liSetName = (id: string, name: string) => setFormLineItems(p => p.map(i => i.id === id ? { ...i, name } : i));
  const liAddRow = (id: string) => setFormLineItems(p => p.map(i => i.id === id ? { ...i, rows: [...i.rows, { size: "", qty: "" }] } : i));
  const liSetRow = (id: string, idx: number, field: "size" | "qty", val: string) => setFormLineItems(p => p.map(i => i.id === id ? { ...i, rows: i.rows.map((r, j) => j === idx ? { ...r, [field]: val } : r) } : i));
  const liRemoveRow = (id: string, idx: number) => setFormLineItems(p => p.map(i => i.id === id ? { ...i, rows: i.rows.filter((_, j) => j !== idx) } : i));
  const PRESET_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
  const liToggleSize = (id: string, size: string) => setFormLineItems(p => p.map(i => {
    if (i.id !== id) return i;
    const has = i.rows.some(r => r.size === size);
    return { ...i, rows: has ? i.rows.filter(r => r.size !== size) : [...i.rows, { size, qty: "" }] };
  }));

  async function receiveOutside(id: string) {
    await supabase.from("outside_shipments").update({ status: "received", resolved: true, received_at: new Date().toISOString() }).eq("id", id);
    loadOutside();
  }

  // Open the receive modal for an outside package — pre-fill received qtys to
  // the logged (expected) qtys so the receiver only edits discrepancies.
  const openReceiveOutside = (s: OutsideShipment) => {
    setReceivingOutside(s);
    setRecvCondition(s.condition || "good");
    setRecvRoute(s.route === "stage" ? "stage" : "ship_through");
    const q: Record<string, string> = {};
    (s.line_items || []).forEach((it, i) => {
      Object.entries(it.sizes || {}).forEach(([sz, n]) => { q[`${i}:${sz}`] = String(n); });
    });
    setRecvQtys(q);
    setRecvPendingFiles([]);
  };

  async function confirmReceiveOutside() {
    const s = receivingOutside;
    if (!s) return;
    setRecvBusy(true);
    // Upload any receive-time reference photos and append to the package files.
    const newFiles: { name: string; driveLink: string; driveFileId: string }[] = [];
    for (const file of recvPendingFiles) {
      try {
        const r = await uploadToReceiving({ blob: file, fileName: file.name, mimeType: file.type || "application/octet-stream", shipmentLabel: `Received — ${s.description}`.slice(0, 100) });
        newFiles.push({ name: file.name, driveLink: r.webViewLink, driveFileId: r.fileId });
      } catch (e) { console.error("Receive photo upload failed:", e); }
    }
    // Stamp received qtys per size back onto each line item, plus condition.
    const updatedItems = (s.line_items || []).map((it, i) => ({
      ...it,
      received: Object.fromEntries(Object.keys(it.sizes || {}).map(sz => [sz, Number(recvQtys[`${i}:${sz}`]) || 0])),
    }));
    await supabase.from("outside_shipments").update({
      status: "received", resolved: true, received_at: new Date().toISOString(),
      route: recvRoute,   // route can be changed at receive time
      condition: recvCondition, line_items: updatedItems,
      files: [...(s.files || []), ...newFiles],
    }).eq("id", s.id);
    setReceivingOutside(null); setRecvQtys({}); setRecvPendingFiles([]); setRecvBusy(false);
    loadOutside();
  }

  async function handlePhotoUpload(file: File, jobMeta: { client_name: string; title: string }, item: WarehouseItem) {
    setUploadingPhoto(item.id);
    try {
      const result = await uploadToDrive({
        blob: file, fileName: file.name, mimeType: file.type || "image/jpeg",
        clientName: jobMeta.client_name, projectTitle: jobMeta.title, itemName: item.name,
        onProgress: undefined,
      });
      await registerFileInDb({
        fileId: result.fileId, webViewLink: result.webViewLink, folderLink: result.folderLink,
        fileName: file.name, mimeType: file.type, fileSize: file.size,
        itemId: item.id, stage: "receiving_photo", notes: null,
      });
      setReceivingPhotos(prev => ({
        ...prev,
        [item.id]: [...(prev[item.id] || []), { file_name: file.name, drive_link: result.webViewLink, drive_file_id: result.fileId, mime_type: file.type }],
      }));
    } catch (err) { console.error("Photo upload error:", err); }
    setUploadingPhoto(null);
  }

  // Build ReceivingProjects from jobs — group items per decorator, attach
  // ship date, invoice number, and counts. Re-derives on every render
  // because useWarehouse owns the underlying state.
  const projects = useMemo<ReceivingProject[]>(() => {
    return jobs.map(j => {
      const groups = new Map<string, DecoratorGroup>();
      for (const it of j.items) {
        const key = it.decorator_name || "Unassigned";
        if (!groups.has(key)) {
          groups.set(key, {
            decoratorId: null, decoratorName: key, shortCode: it.decorator_short_code || "",
            items: [], pending: 0, received: 0, totalUnits: 0,
          });
        }
        const g = groups.get(key)!;
        g.items.push(it);
        g.totalUnits += tQty(it.qtys);
        if (it.received_at_hpd) g.received++; else g.pending++;
      }
      const decoratorGroups = Array.from(groups.values());
      const pendingItems = j.items.filter(it => !it.received_at_hpd).length;
      const receivedItems = j.items.length - pendingItems;
      const totalUnits = j.items.reduce((a, it) => a + tQty(it.qtys), 0);
      return {
        ...j,
        invoiceNumber: j.display_number !== j.job_number ? j.display_number : null,
        shipDate: null, // receiving doesn't track inbound ship dates yet
        decoratorGroups, pendingItems, receivedItems, totalUnits,
      };
    });
  }, [jobs]);

  const decoratorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) for (const dg of p.decoratorGroups) if (dg.decoratorName !== "Unassigned") set.add(dg.decoratorName);
    return Array.from(set).sort();
  }, [projects]);

  // Shipments — the actual unit of work on receiving. Grouped by
  // (decorator, tracking) so 3 items shipped today + 4 next week from
  // the same vendor are two rows, not one chip. Falls back to date
  // when tracking is missing.
  const shipments = useShipments(jobs);

  const filteredShipments = useMemo(() => {
    let arr = shipments;
    if (search) {
      const q = search.toLowerCase();
      arr = arr.filter(s =>
        s.decorator_name.toLowerCase().includes(q)
        || (s.tracking || "").toLowerCase().includes(q)
        || s.short_code.toLowerCase().includes(q)
        || s.jobs.some(j =>
          j.client_name.toLowerCase().includes(q)
          || j.title.toLowerCase().includes(q)
          || j.job_number.toLowerCase().includes(q)
          || j.display_number.toLowerCase().includes(q))
      );
    }
    if (filterDecorator === "__outside__") return [];   // outside-only view — no job shipments
    if (filterDecorator) arr = arr.filter(s => s.decorator_name === filterDecorator);
    return arr;
  }, [shipments, search, filterDecorator]);

  const tabCounts = useMemo(() => ({
    pending: filteredShipments.filter(s => s.pending_count > 0).length,
    received: filteredShipments.filter(s => s.received_count > 0).length,
    outside: outsideShipments.length,
  }), [filteredShipments, outsideShipments]);

  const visibleShipments = useMemo(() => {
    if (tab === "pending") return filteredShipments.filter(s => s.pending_count > 0);
    if (tab === "received") return filteredShipments.filter(s => s.received_count > 0);
    return [];
  }, [filteredShipments, tab]);

  // Action-required classifier for received shipments. Returns the
  // reason a shipment still needs warehouse attention, or null when
  // it's purely historical (sitting in the Received tab as audit
  // trail, no action needed).
  function actionReasonFor(s: Shipment): string | null {
    if (s.variance_units !== 0) {
      return s.variance_units > 0 ? "Over-receive" : "Short";
    }
    const isStage = s.jobs.some(j => j.shipping_route === "stage");
    const isShipThrough = s.jobs.some(j => j.shipping_route === "ship_through");
    if (isStage && s.received_count > 0) {
      const receivedItems = s.items.filter(it => it.received_at_hpd);
      if (receivedItems.length > 0 && receivedItems.some(it => !it.webstore_entered_at)) {
        // Front-office action — warehouse just needs visibility.
        return "Pending front office";
      }
    }
    if (isShipThrough && s.received_count > 0 && s.all_received) {
      // ship_through that's fully received but hasn't been forwarded
      // out yet. The Mark Shipped outbound action lives on /shipping;
      // surface here as a nudge so the dispatcher knows.
      return "Forward to client";
    }
    return null;
  }

  // "Just live in Shopify" — stage shipments fully entered into Shopify
  // within the last 48h. Surfaces as a fresh-inventory cue so warehouse
  // can physically organize / shelve. Drops naturally after the window
  // (the underlying useWarehouse query filters by 48h, so the shipment
  // disappears entirely once it ages out).
  function isLiveInShopify(s: Shipment): boolean {
    const isStage = s.jobs.some(j => j.shipping_route === "stage");
    if (!isStage) return false;
    const receivedItems = s.items.filter(it => it.received_at_hpd);
    if (receivedItems.length === 0) return false;
    if (receivedItems.some(it => !it.webstore_entered_at)) return false;
    const entered = receivedItems
      .map(it => it.webstore_entered_at)
      .filter(Boolean) as string[];
    if (entered.length === 0) return false;
    const mostRecent = entered.sort().reverse()[0];
    const ageHours = (Date.now() - new Date(mostRecent).getTime()) / 3600000;
    return ageHours <= 48;
  }

  // Received tab buckets: action-required pinned to top, then
  // time-bucketed history (Today / This week / Last 30 / Older).
  // "Older" is hidden behind a toggle to prevent the tab becoming a
  // wall of historical receives once volume builds up.
  const [showAllReceived, setShowAllReceived] = useState(false);
  const receivedBuckets = useMemo(() => {
    if (tab !== "received") return null;
    const liveInShopify: Shipment[] = [];
    const actionRequired: { shipment: Shipment; reason: string }[] = [];
    const today: Shipment[] = [];
    const thisWeek: Shipment[] = [];
    const last30: Shipment[] = [];
    const older: Shipment[] = [];
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(todayStart); monthStart.setDate(monthStart.getDate() - 30);
    // Sort by received_at desc (newest first) before bucketing so
    // each section preserves that order.
    const sorted = [...visibleShipments].sort((a, b) => {
      const aTs = a.received_at ? new Date(a.received_at).getTime() : 0;
      const bTs = b.received_at ? new Date(b.received_at).getTime() : 0;
      return bTs - aTs;
    });
    for (const s of sorted) {
      // Live-in-Shopify is a terminal bucket — takes priority over
      // everything else so a fresh-from-Shopify shipment doesn't also
      // show in Today or Needs Attention.
      if (isLiveInShopify(s)) { liveInShopify.push(s); continue; }
      const reason = actionReasonFor(s);
      if (reason) { actionRequired.push({ shipment: s, reason }); continue; }
      const ts = s.received_at ? new Date(s.received_at).getTime() : 0;
      if (ts >= todayStart.getTime()) today.push(s);
      else if (ts >= weekStart.getTime()) thisWeek.push(s);
      else if (ts >= monthStart.getTime()) last30.push(s);
      else older.push(s);
    }
    return { liveInShopify, actionRequired, today, thisWeek, last30, older };
  }, [visibleShipments, tab]);

  const modalShipment = useMemo(() =>
    modalShipmentKey ? shipments.find(s => s.key === modalShipmentKey) || null : null,
    [modalShipmentKey, shipments]);

  // KPI tiles
  const kpis = useMemo(() => {
    const items = projects.reduce((a, p) => a + p.pendingItems, 0);
    const units = projects.reduce((a, p) => {
      return a + p.items.filter(it => !it.received_at_hpd).reduce((b, it) => b + tQty(it.qtys), 0);
    }, 0);
    const todayStr = new Date().toDateString();
    const receivedToday = projects.reduce((a, p) => {
      return a + p.items.filter(it => it.received_at_hpd && it.received_at_hpd_at && new Date(it.received_at_hpd_at).toDateString() === todayStr).length;
    }, 0);
    return { items, units, receivedToday };
  }, [projects]);

  const ic: React.CSSProperties = { padding: "5px 8px", border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, fontSize: 11, fontFamily: mono, outline: "none", width: "100%" };

  // Shipment row — used by Pending (flat list) and Received (sectioned).
  // Optional adornments:
  //   actionReason → amber reason chip + amber left border
  //   liveInShopify → green "✓ LIVE IN SHOPIFY" chip + green left border;
  //                   indicates fresh inventory just keyed in
  function renderShipmentRow(shipment: Shipment, opts?: { actionReason?: string; liveInShopify?: boolean }) {
    const primaryJob = shipment.jobs[0];
    const multiJob = shipment.jobs.length > 1;
    const shippedLabel = shipment.shipped_at
      ? new Date(shipment.shipped_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : null;
    const receivedLabel = shipment.received_at
      ? new Date(shipment.received_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : null;
    const ageDays = shipment.shipped_at
      ? Math.floor((Date.now() - new Date(shipment.shipped_at).getTime()) / 86400000)
      : 0;
    const isStale = shipment.pending_count > 0 && ageDays >= 5;
    const routeForBadge = primaryJob?.shipping_route || "ship_through";
    // Arrival ETA (ASN) = a per-item expected_arrival override, else the actual
    // ship date + the vendor's transit buffer. NOT client_eta (that's client comms).
    const arrivalOverride = (shipment.items.map(it => it.expected_arrival).filter(Boolean).sort() as string[])[0] || null;
    const transitDays = shipment.items.find(it => it.transit_days != null)?.transit_days ?? null;
    const arrivalEta = arrivalOverride || (shipment.shipped_at ? computeArrivalEta("ship_through", shipment.shipped_at.slice(0, 10), transitDays) : null);
    const eta = fmtEta(arrivalEta);
    const notes = Array.from(new Set(shipment.items.map(it => (it.ship_notes || "").trim()).filter(Boolean)));
    const pullCount = shipment.items.reduce((n, it) => n + activePulls(it).length, 0);
    return (
      <div key={shipment.key}
        onClick={() => setModalShipmentKey(shipment.key)}
        style={{
          background: T.card,
          border: `1px solid ${opts?.liveInShopify ? T.green + "55" : opts?.actionReason ? T.amber + "55" : T.border}`,
          borderLeft: opts?.liveInShopify ? `3px solid ${T.green}` : opts?.actionReason ? `3px solid ${T.amber}` : `1px solid ${T.border}`,
          borderRadius: 10,
          padding: "10px 14px", display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer",
          transition: "background 0.12s", fontSize: 12,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = T.surface; }}
        onMouseLeave={e => { e.currentTarget.style.background = T.card; }}>

        {/* Vendor + route */}
        <div style={{ width: 110, flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, wordBreak: "break-word" }}>
            {shipment.short_code || shipment.decorator_name}
          </div>
          <span style={{
            display: "inline-block", marginTop: 3, fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
            color: routeForBadge === "stage" ? T.purple : T.accent,
            background: (routeForBadge === "stage" ? T.purple : T.accent) + "14",
            padding: "1px 6px", borderRadius: 4,
          }}>
            {routeForBadge === "stage" ? "Fulfillment" : "Shipping"}
          </span>
        </div>

        {/* Client / project + flags */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {shipment.jobs.map(j => (
            <div key={j.id} style={{ marginBottom: 2 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                <Link href={`/jobs/${j.id}`} onClick={e => e.stopPropagation()}
                  style={{ fontSize: 13, fontWeight: 700, color: T.text, textDecoration: "none" }}>
                  {j.client_name || "No client"}
                </Link>
                <span style={{ fontSize: 11, color: T.faint, fontFamily: mono }}>
                  {j.display_number !== j.job_number ? j.display_number : j.job_number}
                </span>
              </div>
              {j.title && <div style={{ fontSize: 11, color: T.faint, wordBreak: "break-word" }}>{j.title}</div>}
            </div>
          ))}
          {multiJob && <div style={{ fontSize: 10, color: T.amber, fontWeight: 600 }}>Multi-project ({shipment.jobs.length})</div>}
          {(pullCount > 0 || notes.length > 0 || shipmentMeta[shipment.key]?.warehouse_notes) && (
            <div style={{ marginTop: 2, display: "flex", flexDirection: "column", gap: 2 }}>
              {shipmentMeta[shipment.key]?.warehouse_notes && (
                <div style={{ fontSize: 11, fontWeight: 600, color: T.text, background: T.amberDim, border: `1px solid ${T.amber}44`, borderRadius: 5, padding: "4px 8px", display: "flex", gap: 6 }}>
                  <span style={{ flexShrink: 0, color: T.amber }}>📋</span>
                  <span style={{ minWidth: 0, wordBreak: "break-word" }}>{shipmentMeta[shipment.key]!.warehouse_notes}</span>
                </div>
              )}
              {pullCount > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: T.amber }}>⚑ {pullCount} open pull{pullCount === 1 ? "" : "s"}</span>}
              {notes.map((n, i) => (
                <div key={i} style={{ fontSize: 11, color: T.amber, display: "flex", gap: 5 }}>
                  <span style={{ flexShrink: 0 }}>✎</span>
                  <span style={{ minWidth: 0, wordBreak: "break-word" }}>{n}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tracking */}
        <div style={{ width: 150, flexShrink: 0, fontFamily: mono, fontSize: 11, lineHeight: 1.3, display: "flex", alignItems: "flex-start" }} title={shipment.pickup ? "Local pickup" : (shipment.tracking || "")}>
          {shipment.pickup
            ? <span style={{ color: T.green, fontWeight: 700, letterSpacing: "0.04em" }}>↑ PICK-UP</span>
            : <><span style={{ color: shipment.tracking ? T.muted : T.amber, wordBreak: "break-all", minWidth: 0 }}>{shipment.tracking || "no tracking"}</span>
          {isRealTracking(shipment.tracking) && <CopyBtn text={shipment.tracking!} />}</>}
        </div>

        {/* Shipped */}
        <div style={{ width: 90, flexShrink: 0, fontFamily: mono, fontSize: 11 }}>
          {shippedLabel ? (
            <>
              <div style={{ color: isStale ? T.amber : T.muted }}>{shippedLabel}</div>
              {!receivedLabel && ageDays >= 1 && <div style={{ color: T.faint, fontSize: 10 }}>{ageDays}d ago</div>}
            </>
          ) : <span style={{ color: T.faint }}>—</span>}
        </div>

        {/* ETA (pending) / Date received (received tab) */}
        {tab === "received" ? (
          <div style={{ width: 64, flexShrink: 0, textAlign: "right", fontFamily: mono, fontSize: 11, color: receivedLabel ? T.green : T.faint, fontWeight: receivedLabel ? 600 : 400 }}>
            {receivedLabel || "—"}
          </div>
        ) : (
          <div style={{ width: 64, flexShrink: 0, textAlign: "right", fontFamily: mono, fontSize: 11, color: eta ? T.accent : T.faint, fontWeight: eta ? 600 : 400 }}>
            {eta || "—"}
          </div>
        )}

        {/* Units */}
        <div style={{ width: 80, flexShrink: 0, textAlign: "right", fontFamily: mono }}>
          <div style={{ fontSize: 12, color: T.text }}>{shipment.total_units.toLocaleString()}</div>
          <div style={{ fontSize: 9, color: T.muted, fontFamily: font, textTransform: "uppercase", letterSpacing: "0.04em" }}>units</div>
        </div>

        {/* Status */}
        <div style={{ width: 96, flexShrink: 0, textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          {opts?.liveInShopify && <span style={{ fontSize: 9, fontWeight: 800, color: T.green, letterSpacing: "0.05em", textTransform: "uppercase" }}>✓ Shopify</span>}
          {opts?.actionReason && <span style={{ fontSize: 9, fontWeight: 800, color: T.amber, letterSpacing: "0.05em", textTransform: "uppercase" }}>{opts.actionReason}</span>}
          {shipment.pending_count > 0 ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.amber, fontFamily: mono, whiteSpace: "nowrap" }}>{shipment.pending_count} of {shipment.total_items}</div>
              <div style={{ fontSize: 9, fontWeight: 600, color: T.faint, letterSpacing: "0.04em", textTransform: "uppercase" }}>to receive</div>
            </>
          ) : (
            <div style={{ fontSize: 11, fontWeight: 700, color: T.green, textTransform: "uppercase", letterSpacing: "0.04em" }}>✓ Received</div>
          )}
          {shipment.variance_units !== 0 && (
            <span style={{ fontSize: 10, color: shipment.variance_units < 0 ? T.red : T.green, fontFamily: mono }}>{shipment.variance_units > 0 ? "+" : ""}{shipment.variance_units} var</span>
          )}
        </div>
      </div>
    );
  }

  // Column header for the shipments-view rows. Widths mirror renderShipmentRow
  // exactly (incl. the 14px row padding + ~1px border → 15px) so labels line up
  // over their columns.
  const shipmentColHeader = (
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "0 15px", fontSize: 9, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", userSelect: "none" }}>
      <div style={{ width: 110, flexShrink: 0 }}>Vendor</div>
      <div style={{ flex: 1, minWidth: 0 }}>Client / Project</div>
      <div style={{ width: 150, flexShrink: 0 }}>Tracking</div>
      <div style={{ width: 90, flexShrink: 0 }}>Shipped</div>
      <div style={{ width: 64, flexShrink: 0, textAlign: "right" }}>{tab === "received" ? "Date" : "ETA"}</div>
      <div style={{ width: 80, flexShrink: 0, textAlign: "right" }}>Units</div>
      <div style={{ width: 96, flexShrink: 0, textAlign: "right" }}>Status</div>
    </div>
  );

  // Outside packages (logged via "Log incoming shipment") that chose the
  // Receiving destination. Shown atop the Pending tab (with a Receive action)
  // and the Received tab (read-only). Not job items, so they render as their
  // own simple section rather than in the shipment/item columns.
  // Outside-package helpers — these file INTO the main pending/received lists
  // (both views) as highlighted rows marked "OUTSIDE", rather than a separate
  // section. They're not job items, so a few columns read "—".
  const outsideUnits = (s: OutsideShipment, received: boolean) => (s.line_items || []).reduce((tot, li) => {
    const disp = (received && (li as any).received) ? (li as any).received : (li.sizes || {});
    return tot + Object.values(disp).reduce((a: number, n) => a + (Number(n) || 0), 0);
  }, 0);
  const outsideItemsSummary = (s: OutsideShipment) => (s.line_items || []).map(li => li.name || "Item").filter(Boolean).join(", ");
  const outsideMatchesSearch = (s: OutsideShipment) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [s.description, s.sender, s.carrier, s.tracking, clientNameOf(s)].filter(Boolean).join(" ").toLowerCase().includes(q);
  };
  // Outside packages have a free-text sender, not a decorator assignment. Under
  // an active decorator filter, only show ones whose sender matches that vendor
  // (case-insensitive) — otherwise they'd leak into every vendor's view.
  const outsideMatchesDecorator = (s: OutsideShipment) =>
    !filterDecorator
    || filterDecorator === "__outside__"   // outside-only view — show all outside packages
    || (s.sender || "").trim().toLowerCase() === filterDecorator.toLowerCase();
  const outsideForTab = (received: boolean) =>
    (received ? outsideReceived : outsideShipments).filter(s => outsideMatchesSearch(s) && outsideMatchesDecorator(s));
  const OUTSIDE_BADGE = (
    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: T.amber, background: T.card, border: `1px solid ${T.amber}`, padding: "1px 5px", borderRadius: 4, whiteSpace: "nowrap" }}>Outside</span>
  );
  // Outside-package row (amber card). Restored — it was deleted by mistake in
  // cf946190 while removing the list-view code, but the shipments view still
  // calls it (Pending + Received tabs), so its absence crashed Receiving the
  // moment any outside shipment existed.
  const renderOutsideShipmentRow = (s: OutsideShipment, received: boolean) => {
    const units = outsideUnits(s, received);
    const summary = outsideItemsSummary(s);
    return (
      <div key={s.id} style={{ background: T.amberDim, border: `1px solid ${T.amber}55`, borderLeft: `3px solid ${T.amber}`, borderRadius: 10, padding: "10px 14px", display: "flex", gap: 12, alignItems: "flex-start", fontSize: 12 }}>
        <div style={{ width: 110, flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, wordBreak: "break-word" }}>{s.sender || "Outside"}</div>
          <div style={{ marginTop: 3 }}>{OUTSIDE_BADGE}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, wordBreak: "break-word" }}>{s.description}</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 1, wordBreak: "break-word", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {renderClientLink(s)}
            {summary && <span style={{ color: T.faint }}>· {summary}</span>}
          </div>
        </div>
        <div style={{ width: 150, flexShrink: 0, fontFamily: mono, fontSize: 11, lineHeight: 1.3, display: "flex", alignItems: "flex-start" }} title={s.tracking || ""}>
          <span style={{ color: s.tracking ? T.muted : T.faint, wordBreak: "break-all", minWidth: 0 }}>{s.tracking || "—"}</span>
          {isRealTracking(s.tracking) && <CopyBtn text={s.tracking} />}
        </div>
        <div style={{ width: 90, flexShrink: 0, fontFamily: mono, fontSize: 11, color: T.muted }}>{s.received_at ? new Date(s.received_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</div>
        <div style={{ width: 64, flexShrink: 0, textAlign: "right", fontFamily: mono, fontSize: 11, color: received ? T.green : T.faint }}>{received ? new Date(s.received_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</div>
        <div style={{ width: 80, flexShrink: 0, textAlign: "right", fontFamily: mono }}>
          <div style={{ fontSize: 12, color: T.text }}>{units.toLocaleString()}</div>
          <div style={{ fontSize: 9, color: T.muted, fontFamily: font, textTransform: "uppercase", letterSpacing: "0.04em" }}>units</div>
        </div>
        <div style={{ width: 96, flexShrink: 0, textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          {received ? (
            <span style={{ fontSize: 11, fontWeight: 700, color: T.green, textTransform: "uppercase", letterSpacing: "0.04em" }}>✓ Received</span>
          ) : (
            <button onClick={() => openReceiveOutside(s)} style={{ background: T.green, color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: font }}>Receive</button>
          )}
        </div>
      </div>
    );
  };


  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading receiving...</div>;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 14, maxWidth: 1100 }}>
      {/* Header — title + search + decorator filter, mirrors Production */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Receiving</h1>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects, clients, decorators..."
          style={{ flex: 1, maxWidth: 360, padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: font, outline: "none" }} />
        <select value={filterDecorator} onChange={e => setFilterDecorator(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: filterDecorator ? T.text : T.muted, fontSize: 12, fontFamily: font, outline: "none" }}>
          <option value="">All decorators</option>
          {(outsideShipments.length > 0 || outsideReceived.length > 0) && <option value="__outside__">Outside shipments</option>}
          {decoratorOptions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        {/* Silent mode toggle — suppresses client emails on receive.
            Visible always so the state is discoverable; the banner
            below makes it impossible to miss when active. */}
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: silentMode ? T.amber : T.muted, cursor: "pointer", fontFamily: font, padding: "6px 10px", borderRadius: 8, border: `1px solid ${silentMode ? T.amber : T.border}`, background: silentMode ? T.amberDim : "transparent" }}>
          <input type="checkbox" checked={silentMode} onChange={e => setSilentMode(e.target.checked)}
            style={{ width: 14, height: 14, accentColor: T.amber, cursor: "pointer" }} />
          Silent mode
        </label>
        <button onClick={() => setShowForm(true)}
          style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: T.accent, color: "#fff", fontSize: 12, fontWeight: 700, fontFamily: font, cursor: "pointer", whiteSpace: "nowrap" }}>
          + Log outside shipment
        </button>
      </div>

      {/* Silent mode banner — loud + persistent so Jon can't forget
          it's on. Backfill scenario: receive a stack of old shipments
          without spamming clients with stale "production complete"
          emails for boxes that arrived weeks ago. */}
      {silentMode && (
        <div style={{ background: T.amberDim, border: `1px solid ${T.amber}`, borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: T.amber, letterSpacing: "0.08em", textTransform: "uppercase" }}>Silent mode</span>
          <span style={{ color: T.text }}>Client "production complete" emails will NOT fire. Use for backfilling historical receives.</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => setSilentMode(false)}
            style={{ background: T.amber, border: "none", color: "#fff", fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 6, cursor: "pointer", fontFamily: font }}>
            Turn off
          </button>
        </div>
      )}

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        {[
          { label: "Items pending", value: kpis.items.toLocaleString(), tone: T.text },
          { label: "Units pending", value: kpis.units.toLocaleString(), tone: T.muted },
          { label: "Received today", value: kpis.receivedToday.toLocaleString(), tone: T.green },
        ].map(s => (
          <div key={s.label} style={{
            background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
            padding: "10px 14px", display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.tone, lineHeight: 1, fontFamily: mono }}>{s.value}</div>
            <div style={{ fontSize: 9, color: T.muted, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Holding strip — no navigation, always in view when non-empty.
          Two kinds of open work: units physically held on the shelf (resolve
          when they move), and post-Shopify pull requests (Shopify order OR
          shelf pull + manual count adjust — Jon's rule). ── */}
      {(heldPulls.length > 0 || postShopifyPulls.length > 0) && (
        <div style={{ background: T.card, border: `1px solid ${T.amber}55`, borderLeft: `3px solid ${T.amber}`, borderRadius: 10, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: T.amber, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Holding · {heldPulls.length + postShopifyPulls.length} open
          </div>
          {postShopifyPulls.map(t => {
            const entries = sortSizeEntries(t.pull.qtys || {}).filter(([, n]) => (Number(n) || 0) > 0);
            const total = entries.reduce((a, [, n]) => a + (Number(n) || 0), 0);
            return (
              <div key={t.pull.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12, paddingTop: 6, borderTop: `1px dashed ${T.border}` }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <span style={{ fontWeight: 700, color: T.text }}>Pull from Shopify stock: {t.item_name}</span>
                  <span style={{ color: T.faint }}> · {t.job_ref}</span>
                  <div style={{ fontSize: 11, color: T.muted }}>
                    {total} pcs ({entries.map(([s, n]) => `${n}×${s}`).join(", ")}){t.pull.reason ? ` — ${t.pull.reason}` : ""}
                  </div>
                </div>
                <button onClick={() => resolvePostShopify(t, "shopify_order")}
                  title="Entered as a real Shopify order — fulfillment ships it, stock decrements itself"
                  style={{ fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 5, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, cursor: "pointer", fontFamily: font }}>
                  Placed as Shopify order
                </button>
                <button onClick={() => resolvePostShopify(t, "shelf_pull")}
                  title="Pulled off the shelf — confirm you adjusted the Shopify count down"
                  style={{ fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 5, border: "none", background: T.amber, color: "#1a1508", cursor: "pointer", fontFamily: font }}>
                  Pulled — Shopify adjusted ✓
                </button>
              </div>
            );
          })}
          {heldPulls.map(row => {
            const entries = sortSizeEntries(row.qtys || {}).filter(([, n]) => (Number(n) || 0) > 0);
            const total = entries.reduce((a, [, n]) => a + (Number(n) || 0), 0);
            return (
              <div key={row.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12, paddingTop: 6, borderTop: `1px dashed ${T.border}` }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <span style={{ fontWeight: 700, color: T.text }}>{row.item_name || "Item"}</span>
                  {row.job_id && pullJobRefs[row.job_id] && <span style={{ color: T.faint }}> · {pullJobRefs[row.job_id]}</span>}
                  <div style={{ fontSize: 11, color: T.muted }}>
                    {total} pcs ({entries.map(([s, n]) => `${n}×${s}`).join(", ")}){row.notes ? ` — ${row.notes}` : ""} · held since {new Date(row.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </div>
                </div>
                <button onClick={() => resolveHeldPull(row, "returned")}
                  title="Put the units back — restores the item's forward/continuing balance"
                  style={{ fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 5, border: `1px solid ${T.green}55`, background: "transparent", color: T.green, cursor: "pointer", fontFamily: font }}>
                  Return to stock
                </button>
                <button onClick={() => resolveHeldPull(row, "shipped_out")}
                  style={{ fontSize: 10, fontWeight: 600, padding: "4px 10px", borderRadius: 5, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, cursor: "pointer", fontFamily: font }}>
                  Shipped out
                </button>
                <button onClick={() => resolveHeldPull(row, "consumed")}
                  style={{ fontSize: 10, fontWeight: 600, padding: "4px 10px", borderRadius: 5, border: `1px solid ${T.border}`, background: "transparent", color: T.muted, cursor: "pointer", fontFamily: font }}>
                  Consumed
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Tab bar — flat underline */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", borderBottom: `1px solid ${T.border}`, paddingBottom: 6 }}>
        {([
          ["pending", "Pending", tabCounts.pending, T.text],
          ["received", "Received", tabCounts.received, T.green],
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

      {/* ── Pending tab — shipment rows, flat list (outside packages filed in,
          highlighted + marked OUTSIDE) ── */}
      {tab === "pending" && (() => {
        const outsideRows = outsideForTab(false);
        if (visibleShipments.length === 0 && outsideRows.length === 0) {
          return <div style={{ textAlign: "center", color: T.muted, fontSize: 13, padding: "2rem" }}>Nothing pending — every box is received.</div>;
        }
        // Interleave outside packages by their logged date (= ship date) so they
        // file in like any other shipment rather than pinning to the top.
        const merged = [
          ...visibleShipments.map(s => ({ ts: s.shipped_at ? new Date(s.shipped_at).getTime() : Infinity, node: renderShipmentRow(s) })),
          ...outsideRows.map(s => ({ ts: s.received_at ? new Date(s.received_at).getTime() : Infinity, node: renderOutsideShipmentRow(s, false) })),
        ].sort((a, b) => a.ts - b.ts);
        return (
          <>
            {shipmentColHeader}
            {merged.map(m => m.node)}
          </>
        );
      })()}

      {/* ── Received tab — sectioned: Needs attention · Today · This
          week · Last 30 days · Older. Action-required pinned on top
          gives the floor a clear daily working list; time buckets
          collapse the historical pile so the page doesn't read as
          a wall of "done" stuff. */}
      {tab === "received" && receivedBuckets && (
        <>
          {visibleShipments.length === 0 && outsideForTab(true).length === 0 && (
            <div style={{ textAlign: "center", color: T.muted, fontSize: 13, padding: "2rem" }}>
              Nothing received recently.
            </div>
          )}

          {(visibleShipments.length > 0 || outsideForTab(true).length > 0) && shipmentColHeader}
          {outsideForTab(true).map(s => renderOutsideShipmentRow(s, true))}

          {/* Live in Shopify — pinned to top. Fresh inventory keyed in
              by front office in the last 48h. Cue for warehouse to
              shelve/organize. Rows auto-drop after the 48h window
              (filtered server-side by useWarehouse). */}
          {receivedBuckets.liveInShopify.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
                <h2 style={{ fontSize: 12, fontWeight: 800, color: T.green, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>
                  ✓ Live in Shopify — shelve
                </h2>
                <span style={{ fontSize: 11, color: T.muted }}>
                  {receivedBuckets.liveInShopify.length} shipment{receivedBuckets.liveInShopify.length === 1 ? "" : "s"} · last 48h
                </span>
              </div>
              {receivedBuckets.liveInShopify.map(s => renderShipmentRow(s, { liveInShopify: true }))}
            </>
          )}

          {/* Needs attention — amber section header, reason badge per row */}
          {receivedBuckets.actionRequired.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
                <h2 style={{ fontSize: 12, fontWeight: 800, color: T.amber, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>
                  Needs attention
                </h2>
                <span style={{ fontSize: 11, color: T.muted }}>
                  {receivedBuckets.actionRequired.length} shipment{receivedBuckets.actionRequired.length === 1 ? "" : "s"}
                </span>
              </div>
              {receivedBuckets.actionRequired.map(({ shipment, reason }) =>
                renderShipmentRow(shipment, { actionReason: reason }))}
            </>
          )}

          {/* Today */}
          {receivedBuckets.today.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 16 }}>
                <h2 style={{ fontSize: 12, fontWeight: 800, color: T.text, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>
                  Today
                </h2>
                <span style={{ fontSize: 11, color: T.muted }}>
                  {receivedBuckets.today.length} shipment{receivedBuckets.today.length === 1 ? "" : "s"}
                </span>
              </div>
              {receivedBuckets.today.map(s => renderShipmentRow(s))}
            </>
          )}

          {/* This week */}
          {receivedBuckets.thisWeek.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 16 }}>
                <h2 style={{ fontSize: 12, fontWeight: 800, color: T.text, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>
                  This week
                </h2>
                <span style={{ fontSize: 11, color: T.muted }}>
                  {receivedBuckets.thisWeek.length} shipment{receivedBuckets.thisWeek.length === 1 ? "" : "s"}
                </span>
              </div>
              {receivedBuckets.thisWeek.map(s => renderShipmentRow(s))}
            </>
          )}

          {/* Last 30 days */}
          {receivedBuckets.last30.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 16 }}>
                <h2 style={{ fontSize: 12, fontWeight: 800, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>
                  Last 30 days
                </h2>
                <span style={{ fontSize: 11, color: T.muted }}>
                  {receivedBuckets.last30.length} shipment{receivedBuckets.last30.length === 1 ? "" : "s"}
                </span>
              </div>
              {receivedBuckets.last30.map(s => renderShipmentRow(s))}
            </>
          )}

          {/* Older — collapsed by default; "Show all" toggle reveals.
              Prevents the tab becoming a wall of historical data. */}
          {receivedBuckets.older.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 16 }}>
                <button onClick={() => setShowAllReceived(v => !v)}
                  style={{ background: "transparent", border: "none", color: T.faint, fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", padding: 0, fontFamily: font }}>
                  {showAllReceived ? "▾" : "▸"} Older
                </button>
                <span style={{ fontSize: 11, color: T.faint }}>
                  {receivedBuckets.older.length} shipment{receivedBuckets.older.length === 1 ? "" : "s"} hidden
                </span>
              </div>
              {showAllReceived && receivedBuckets.older.map(s => renderShipmentRow(s))}
            </>
          )}
        </>
      )}

      {/* ── Shipment receive modal — opens on row click ── */}
      {modalShipment && (() => {
        const shipment = modalShipment;
        const primaryJob = shipment.jobs[0];
        const routeForBadge = primaryJob?.shipping_route || "ship_through";
        const shipmentSlips = shipment.items.flatMap(it => packingSlips[it.id] || []);
        const uniqueSlips = shipmentSlips.filter((s, i, arr) => arr.findIndex(x => x.file_name === s.file_name) === i);
        const allSelected = shipment.items.length > 0 && shipment.items.every(it => selectedItemIds.has(it.id));
        const eligible = shipment.items.filter(it => selectedItemIds.has(it.id) && !it.received_at_hpd);
        // Job lookup so handlePhotoUpload can pass the right client/project
        // for the Drive folder path. Items in a multi-job shipment route
        // to their own project's folder.
        const jobById = new Map(shipment.jobs.map(j => [j.id, j]));
        return (
          <div style={{ position: "fixed", inset: 0, background: T.bg, zIndex: 1000, display: "flex", flexDirection: "column", fontFamily: font, color: T.text }}>
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* Header — vendor + tracking primary; project context secondary */}
              <div style={{ padding: "14px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexShrink: 0, background: T.card }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: T.text, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    <span>{shipment.decorator_name}</span>
                    {shipment.tracking ? (
                      <span style={{ fontFamily: mono, color: T.muted, fontWeight: 600, fontSize: 13 }}>{shipment.tracking}</span>
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 700, color: T.amber, letterSpacing: "0.06em", textTransform: "uppercase" }}>no tracking</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: T.faint, marginTop: 2, display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {shipment.shipped_at && (
                      <span>Shipped {new Date(shipment.shipped_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
                    )}
                    {shipment.received_at && (
                      <span style={{ color: T.green, fontWeight: 600 }}>
                        Received {new Date(shipment.received_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                      </span>
                    )}
                    {shipment.jobs.map(j => (
                      <Link key={j.id} href={`/jobs/${j.id}`} style={{ color: T.muted, textDecoration: "none" }}>
                        {j.client_name} · {j.display_number}
                      </Link>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: routeForBadge === "stage" ? T.purple : T.accent, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    → {routeForBadge === "stage" ? "Fulfillment" : "Shipping"}
                  </span>
                  <button onClick={() => setModalShipmentKey(null)} title="Close (Esc)"
                    style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", padding: "0 6px", lineHeight: 1 }}>×</button>
                </div>
              </div>

              {/* Body */}
              <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px 22px" }}>
                {/* Production's message to the warehouse — the handoff packet.
                    Top of the modal, impossible to miss. */}
                {shipmentMeta[shipment.key]?.warehouse_notes && (
                  <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 8, background: T.amberDim, border: `1px solid ${T.amber}66`, display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 15, flexShrink: 0 }}>📋</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 9, fontWeight: 800, color: T.amber, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>From production</div>
                      <div style={{ fontSize: 13, color: T.text, lineHeight: 1.4, wordBreak: "break-word" }}>{shipmentMeta[shipment.key]!.warehouse_notes}</div>
                    </div>
                  </div>
                )}
                {/* Shipment header — counts + bulk actions */}
                <div style={{ paddingBottom: 14, borderBottom: `1px solid ${T.border}`, marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: "-0.02em", color: T.text }}>
                        {shipment.total_items} item{shipment.total_items !== 1 ? "s" : ""}
                      </h2>
                      <div style={{ fontSize: 13, color: T.muted, marginTop: 6 }}>
                        <strong style={{ color: T.text, fontWeight: 700 }}>{shipment.pending_count}</strong> pending
                        <span style={{ color: T.faint, margin: "0 8px" }}>·</span>
                        <strong style={{ color: T.text, fontWeight: 700 }}>{shipment.received_count}</strong> received
                        <span style={{ color: T.faint, margin: "0 8px" }}>·</span>
                        <strong style={{ color: T.text, fontWeight: 700 }}>{shipment.total_units.toLocaleString()}</strong> units
                      </div>
                    </div>
                  </div>
                </div>

                {/* Action row — Select all + bulk receive · View packing slips */}
                <div style={{ padding: "0 0 14px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => {
                    setSelectedItemIds(prev => {
                      const next = new Set(prev);
                      if (allSelected) {
                        for (const it of shipment.items) next.delete(it.id);
                      } else {
                        for (const it of shipment.items) next.add(it.id);
                      }
                      return next;
                    });
                  }}
                    style={{
                      fontSize: 12, fontWeight: 600, padding: "6px 14px", borderRadius: 6,
                      background: allSelected ? T.text : "transparent",
                      border: `1px solid ${allSelected ? T.text : T.border}`,
                      color: allSelected ? "#fff" : T.text,
                      cursor: "pointer", fontFamily: font,
                    }}>
                    {allSelected ? "Unselect all" : "Select all"}
                  </button>
                  {eligible.length > 0 && (
                    <button onClick={async () => {
                      // bulkMarkReceived resolves per-item condition+notes
                      // from the row inputs, runs all the writes, then
                      // fires the "all received" email + phase recalc
                      // exactly once per affected job after the loop.
                      await bulkMarkReceived(eligible, (it) => ({
                        condition: itemCondition[it.id] || "good",
                        notes: conditionNote[it.id] || "",
                      }), { skipClientEmail: silentMode });
                      setSelectedItemIds(prev => {
                        const next = new Set(prev);
                        for (const it of eligible) next.delete(it.id);
                        return next;
                      });
                    }} style={{ fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 6, background: T.green, color: "#fff", border: "none", cursor: "pointer", fontFamily: font }}>
                      Receive Selected · {eligible.length}
                    </button>
                  )}
                  {eligible.length > 0 && (
                    <button onClick={async () => {
                      for (const it of eligible) await returnToProduction(it);
                      setSelectedItemIds(prev => {
                        const next = new Set(prev);
                        for (const it of eligible) next.delete(it.id);
                        return next;
                      });
                    }} style={{ fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 6, background: T.amber, color: "#fff", border: "none", cursor: "pointer", fontFamily: font }}>
                      ← Return Selected · {eligible.length}
                    </button>
                  )}
                  <div style={{ flex: 1 }} />
                  {uniqueSlips.length > 0 && (
                    <button onClick={(e) => { e.stopPropagation(); setViewingSlips({ files: uniqueSlips, index: 0, title: shipment.short_code || shipment.decorator_name }); }}
                      style={{ fontSize: 11, padding: "5px 12px", borderRadius: 6, background: T.accentDim, color: T.accent, border: "none", cursor: "pointer", fontWeight: 600, fontFamily: font }}>
                      View packing slips ({uniqueSlips.length})
                    </button>
                  )}
                </div>

                {/* Shopify-entry status — informational only. The action
                    moved to the Ecomm Intake tab (front office workflow).
                    Warehouse still sees the pending count so they know
                    handoff is in motion. */}
                {(() => {
                  const isStage = shipment.jobs.some(j => j.shipping_route === "stage");
                  if (!isStage) return null;
                  const receivedItems = shipment.items.filter(it => it.received_at_hpd);
                  if (receivedItems.length === 0) return null;
                  const notEntered = receivedItems.filter(it => !it.webstore_entered_at);
                  const allEntered = notEntered.length === 0;
                  if (allEntered) {
                    return (
                      <div style={{ padding: "8px 12px", marginBottom: 14, borderRadius: 8, background: T.greenDim, border: `1px solid ${T.green}44`, display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: T.green, letterSpacing: "0.08em", textTransform: "uppercase" }}>✓ Entered in Shopify</span>
                        <span style={{ fontSize: 11, color: T.muted }}>
                          {receivedItems.length} item{receivedItems.length === 1 ? "" : "s"} handed off · ShipStation owns fulfillment from here
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div style={{ padding: "8px 12px", marginBottom: 14, borderRadius: 8, background: T.amberDim, border: `1px solid ${T.amber}55`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: T.amber, letterSpacing: "0.08em", textTransform: "uppercase" }}>Awaiting Shopify entry</span>
                      <span style={{ fontSize: 11, color: T.text }}>
                        {notEntered.length} of {receivedItems.length} received item{receivedItems.length === 1 ? "" : "s"} pending front-office entry on /ecomm
                      </span>
                    </div>
                  );
                })()}

                {/* Items */}
                <div>
                  {shipment.items.map(item => {
                                    const isReceived = item.received_at_hpd;
                                    const shippedQty = tQty(item.ship_qtys);
                                    const totalQty = tQty(item.qtys);
                                    const receivedTotal = tQty(item.received_qtys);
                                    const sampleTotal = tQty(item.sample_qtys);
                                    const hasVariance = isReceived && receivedTotal > 0 && receivedTotal !== (shippedQty || totalQty);
                                    return (
                                      <div key={item.id} style={{
                                        padding: "12px 14px", borderRadius: 6, marginBottom: 6,
                                        background: isReceived ? T.greenDim + "44" : "transparent",
                                        border: `1px solid ${isReceived ? T.green + "33" : T.border}`,
                                      }}>
                                        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                                          <input
                                            type="checkbox"
                                            checked={selectedItemIds.has(item.id)}
                                            onChange={() => toggleItemSelected(item.id)}
                                            onClick={e => e.stopPropagation()}
                                            style={{ width: 16, height: 16, cursor: "pointer", accentColor: T.accent, flexShrink: 0, marginTop: 4 }}
                                          />
                                          <span style={{ fontSize: 13, fontWeight: 800, color: T.muted, fontFamily: mono, flexShrink: 0, marginTop: 2 }}>{item.letter}</span>

                                          {/* Mockup thumbnail — visual confirmation
                                              for the receiver. Click enlarges. */}
                                          <div style={{ width: 72, height: 72, flexShrink: 0, borderRadius: 6, overflow: "hidden", background: T.surface, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                            {mockupMap[item.id]?.driveFileId ? (
                                              <DriveThumb
                                                driveFileId={mockupMap[item.id].driveFileId}
                                                enlargeable
                                                title={`${item.name} — mockup`}
                                                driveLink={mockupMap[item.id].driveLink || null}
                                                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                                fallback={<span style={{ fontSize: 9, color: T.faint }}>no mockup</span>}
                                              />
                                            ) : (
                                              <span style={{ fontSize: 9, color: T.faint }}>no mockup</span>
                                            )}
                                          </div>

                                          {/* Title + specs */}
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{item.name}</div>
                                            <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                                              {[item.blank_vendor, item.blank_sku].filter(Boolean).join(" · ") || "—"}
                                              {item.ship_tracking && <> · <span style={{ fontFamily: mono }}>{item.ship_tracking}</span></>}
                                            </div>
                                            {item.ship_notes && <div style={{ fontSize: 11, color: T.amber, marginTop: 3 }}>{item.ship_notes}</div>}
                                            {/* Production-side notes finally cross the handoff:
                                                PO-tab packing/production notes shown to the receiver. */}
                                            {item.production_notes_po && (
                                              <div style={{ fontSize: 11, color: T.muted, marginTop: 3 }}>
                                                <span style={{ fontWeight: 700, color: T.faint, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.05em" }}>Production </span>
                                                {item.production_notes_po}
                                              </div>
                                            )}
                                            {item.packing_notes && (
                                              <div style={{ fontSize: 11, color: T.muted, marginTop: 3 }}>
                                                <span style={{ fontWeight: 700, color: T.faint, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.05em" }}>Packing </span>
                                                {item.packing_notes}
                                              </div>
                                            )}
                                            {fmtEta(item.client_eta) && (
                                              <div style={{ fontSize: 11, fontWeight: 600, color: T.accent, marginTop: 3 }}>ETA {fmtEta(item.client_eta)}</div>
                                            )}

                                            {/* Photos */}
                                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
                                              {(receivingPhotos[item.id] || []).map((p, pi) => (
                                                <DriveFileLink key={pi} driveFileId={p.drive_file_id} fileName={p.file_name} mimeType={p.mime_type}
                                                  style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3, background: T.surface, color: T.muted }}>
                                                  {p.file_name}
                                                </DriveFileLink>
                                              ))}
                                              {uploadingPhoto === item.id ? (
                                                <span style={{ fontSize: 10, color: T.accent }}>Uploading...</span>
                                              ) : (
                                                <>
                                                  <button onClick={() => photoInputRefs.current[item.id]?.click()}
                                                    style={{ fontSize: 10, color: T.faint, background: "none", border: `1px dashed ${T.border}`, borderRadius: 3, padding: "2px 8px", cursor: "pointer" }}>
                                                    + Photo
                                                  </button>
                                                  <input ref={el => { photoInputRefs.current[item.id] = el; }} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
                                                    onChange={e => {
                                                      const f = e.target.files?.[0];
                                                      if (f) {
                                                        const j = jobById.get(item.job_id);
                                                        handlePhotoUpload(f, { client_name: j?.client_name || "", title: j?.title || "" }, item);
                                                      }
                                                      e.target.value = "";
                                                    }} />
                                                </>
                                              )}
                                            </div>
                                          </div>

                                          {/* Per-size receiving grid — single
                                              "Samples" label on the left of the
                                              samples row instead of repeating
                                              above every input. */}
                                          {item.sizes.length > 0 && (
                                            <div style={{
                                              display: "grid",
                                              gridTemplateColumns: `auto repeat(${item.sizes.length}, 56px)`,
                                              columnGap: 8,
                                              rowGap: 2,
                                              alignItems: "center",
                                              fontFamily: mono,
                                              flexShrink: 0,
                                            }}>
                                              {/* Row 1 — size headers */}
                                              <span />
                                              {item.sizes.map(sz => (
                                                <span key={`hdr-${sz}`} style={{ fontSize: 11, color: T.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "center" }}>{sz}</span>
                                              ))}

                                              {/* Row 2 — shipped qty (read-only) */}
                                              <span />
                                              {item.sizes.map(sz => {
                                                const shipped = item.ship_qtys?.[sz] ?? item.qtys?.[sz] ?? 0;
                                                return (
                                                  <span key={`shp-${sz}`} style={{ fontSize: 11, color: T.muted, fontWeight: 600, textAlign: "center" }}>{shipped}</span>
                                                );
                                              })}

                                              {/* Row 3 — received qty (input). Live variance flag
                                                  matches Production: under = amber, over = green,
                                                  equal = neutral. Persists after Receive too so
                                                  the row keeps showing where the gaps were. */}
                                              <span style={{ fontSize: 8, color: T.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", paddingRight: 4, fontFamily: font }}>Delivered</span>
                                              {item.sizes.map(sz => {
                                                const shipped = item.ship_qtys?.[sz] ?? item.qtys?.[sz] ?? 0;
                                                const received = item.received_qtys?.[sz] ?? shipped;
                                                const diffColor = received < shipped ? T.amber : received > shipped ? T.green : null;
                                                return (
                                                  <input key={`rcv-${sz}`} type="number" min="0" value={received}
                                                    onChange={e => updateReceivedQty(item, sz, parseInt(e.target.value) || 0)}
                                                    onFocus={e => e.target.select()}
                                                    title="Received"
                                                    style={{ width: 56, textAlign: "center", padding: "6px 4px", border: `1px solid ${diffColor || T.border}`, borderRadius: 5, background: T.surface, color: diffColor || T.text, fontSize: 13, fontWeight: 600, fontFamily: mono, outline: "none" }} />
                                                );
                                              })}

                                              {/* Row 4 — Samples (single label + per-size inputs) */}
                                              <span style={{ fontSize: 8, color: T.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", paddingRight: 4, fontFamily: font, marginTop: 2 }}>Samples</span>
                                              {item.sizes.map(sz => {
                                                const samples = item.sample_qtys?.[sz] ?? 0;
                                                return (
                                                  <input key={`smp-${sz}`} type="number" min="0" value={samples}
                                                    onChange={e => updateSampleQty(item, sz, parseInt(e.target.value) || 0)}
                                                    onFocus={e => e.target.select()}
                                                    title="Samples pulled (deducts from continuing qty)"
                                                    style={{ width: 56, marginTop: 2, textAlign: "center", padding: "5px 4px", border: `1px solid ${samples > 0 ? T.amber : T.border}`, borderRadius: 5, background: samples > 0 ? T.amberDim : T.surface, color: samples > 0 ? T.amber : T.faint, fontSize: 12, fontWeight: 600, fontFamily: mono, outline: "none" }} />
                                                );
                                              })}
                                            </div>
                                          )}

                                          {/* Right side — condition / status / actions */}
                                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0, minWidth: 130 }}>
                                            {isReceived ? (
                                              <>
                                                <span style={{
                                                  fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                                                  color: (item.receiving_data as any)?.condition === "damaged" ? T.red
                                                    : (item.receiving_data as any)?.condition === "partial_damage" ? T.amber
                                                    : hasVariance ? T.amber : T.green,
                                                }}>
                                                  {(item.receiving_data as any)?.condition === "damaged" ? "Damaged"
                                                    : (item.receiving_data as any)?.condition === "partial_damage" ? "Partial damage"
                                                    : hasVariance ? "Variance" : "Good"}
                                                </span>
                                                {(item.receiving_data as any)?.notes && (
                                                  <div style={{ fontSize: 10, color: T.muted, maxWidth: 130, textAlign: "right", lineHeight: 1.3 }} title={(item.receiving_data as any).notes}>
                                                    {(item.receiving_data as any).notes}
                                                  </div>
                                                )}
                                                <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                                                  <button onClick={() => undoReceived(item)} style={{ fontSize: 10, color: T.faint, background: "none", border: `1px solid ${T.border}`, borderRadius: 4, padding: "3px 10px", cursor: "pointer" }}>Undo</button>
                                                  <button onClick={() => returnToProduction(item)} style={{ fontSize: 10, color: T.amber, background: "none", border: `1px solid ${T.amber}44`, borderRadius: 4, padding: "3px 10px", cursor: "pointer" }} title="Send back to decorator">← Production</button>
                                                </div>
                                              </>
                                            ) : (
                                              <>
                                                {/* Condition is metadata only — damaged units must be
                                                    manually decremented from Delivered above. There's
                                                    no per-size damage column yet, so a "Damaged" tag
                                                    won't auto-deduct from the continuing qty that
                                                    flows to packing slip / QB invoice / fulfillment. */}
                                                <select
                                                  value={itemCondition[item.id] || "good"}
                                                  onChange={e => setItemCondition(prev => ({ ...prev, [item.id]: e.target.value }))}
                                                  style={{ ...ic, width: 130, fontSize: 11, padding: "5px 8px" }}
                                                >
                                                  <option value="good">Good</option>
                                                  <option value="partial_damage">Partial damage</option>
                                                  <option value="damaged">Damaged</option>
                                                </select>
                                                <input
                                                  type="text"
                                                  placeholder={itemCondition[item.id] && itemCondition[item.id] !== "good" ? "Describe damage..." : "Notes (optional)"}
                                                  value={conditionNote[item.id] || ""}
                                                  onChange={e => setConditionNote(prev => ({ ...prev, [item.id]: e.target.value }))}
                                                  style={{
                                                    ...ic, width: 130, fontSize: 11, padding: "5px 8px",
                                                    fontFamily: font,
                                                    borderColor: itemCondition[item.id] && itemCondition[item.id] !== "good" ? T.amber : T.border,
                                                  }}
                                                />
                                                <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                                                  <button onClick={() => returnToProduction(item)} style={{ fontSize: 10, color: T.faint, background: "none", border: `1px solid ${T.border}`, borderRadius: 4, padding: "3px 10px", cursor: "pointer" }} title="Send back to decorator">← Production</button>
                                                  <button onClick={() => markReceived(item, {
                                                    condition: itemCondition[item.id] || "good",
                                                    notes: conditionNote[item.id] || "",
                                                    skipClientEmail: silentMode,
                                                  })} style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: T.green, border: "none", borderRadius: 4, padding: "5px 14px", cursor: "pointer" }}>Receive</button>
                                                </div>
                                              </>
                                            )}
                                          </div>
                                        </div>

                                        {/* Pull requests — "Pulled ✓" fulfills: writes the
                                            pulled_inventory bucket and auto-rolls the qty into
                                            the Samples row above (sample_qtys[size]). */}
                                        <PullChecklist item={item} onFulfill={async p => { await fulfillPull(item, p); loadHeldPulls(); }} onCancel={p => cancelPull(item, p)} />

                                        {/* Ad-hoc pull, right where he's counting — no separate page. */}
                                        {!isReceived && (adhocPullFor === item.id ? (
                                          <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 6, background: T.surface, border: `1px dashed ${T.amber}66`, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                            {item.sizes.map(sz => (
                                              <label key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                                <span style={{ fontSize: 9, color: T.faint, fontWeight: 700, fontFamily: mono }}>{sz}</span>
                                                <input value={adhocQtys[sz] || ""} placeholder="·" inputMode="numeric"
                                                  onChange={e => setAdhocQtys(prev => ({ ...prev, [sz]: e.target.value }))}
                                                  style={{ ...ic, width: 36, textAlign: "center", padding: "4px 2px", fontSize: 12, fontFamily: mono }} />
                                              </label>
                                            ))}
                                            <input value={adhocReason} placeholder="what's it for?"
                                              onChange={e => setAdhocReason(e.target.value)}
                                              onKeyDown={e => { if (e.key === "Enter") saveAdhocPull(item); }}
                                              style={{ ...ic, flex: 1, minWidth: 120, fontSize: 12, padding: "5px 8px" }} />
                                            <button onClick={() => saveAdhocPull(item)}
                                              style={{ fontSize: 10, fontWeight: 700, padding: "5px 12px", borderRadius: 5, border: "none", background: T.amber, color: "#1a1508", cursor: "pointer", fontFamily: font }}>
                                              Pull
                                            </button>
                                            <button onClick={() => { setAdhocPullFor(null); setAdhocQtys({}); setAdhocReason(""); }}
                                              style={{ fontSize: 12, background: "none", border: "none", color: T.faint, cursor: "pointer" }}>×</button>
                                          </div>
                                        ) : (
                                          <button onClick={() => setAdhocPullFor(item.id)}
                                            style={{ marginTop: 6, fontSize: 10, fontWeight: 600, color: T.amber, background: "none", border: `1px dashed ${T.amber}55`, borderRadius: 5, padding: "3px 10px", cursor: "pointer", fontFamily: font, alignSelf: "flex-start" }}>
                                            + Pull from this box
                                          </button>
                                        ))}

                                        {/* Variance / samples summary */}
                                        {(hasVariance || sampleTotal > 0) && (
                                          <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${T.border}`, display: "flex", gap: 14, fontSize: 11, flexWrap: "wrap" }}>
                                            {hasVariance && (
                                              <span style={{ color: T.red, fontWeight: 600 }}>
                                                Variance: {receivedTotal - (shippedQty || totalQty)} units
                                              </span>
                                            )}
                                            {sampleTotal > 0 && (
                                              <span style={{ color: T.muted }}>
                                                <span style={{ color: T.amber, fontWeight: 600 }}>{sampleTotal}</span> sample{sampleTotal !== 1 ? "s" : ""} pulled
                                                {" · "}
                                                <span style={{ color: T.text, fontWeight: 700, fontFamily: mono }}>{receivedTotal - sampleTotal}</span> continuing
                                              </span>
                                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Log incoming shipment modal (opened from the header button) ── */}
      {showForm && (
        <div onClick={() => setShowForm(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 16px", overflowY: "auto" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 18, width: "100%", maxWidth: 720, boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Log outside shipment</div>
                <button onClick={() => setShowForm(false)} aria-label="Close" style={{ background: "none", border: "none", color: T.muted, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Carrier</label>
                  <input style={{ ...ic, fontFamily: font, fontSize: 12 }} value={form.carrier} onChange={e => setForm(f => ({ ...f, carrier: e.target.value }))} placeholder="UPS, FedEx, USPS..." />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Tracking #</label>
                  <input style={{ ...ic, fontFamily: mono }} value={form.tracking} onChange={e => setForm(f => ({ ...f, tracking: e.target.value }))} placeholder="Tracking number" />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Sender</label>
                  <input style={{ ...ic, fontFamily: font, fontSize: 12 }} value={form.sender} onChange={e => setForm(f => ({ ...f, sender: e.target.value }))} placeholder="Who sent it?" />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Condition <span style={{ color: T.faint }}>(optional)</span></label>
                  <select style={{ ...ic, fontFamily: font, fontSize: 12 }} value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}>
                    <option value="">— Not assessed</option>
                    <option value="good">Good</option>
                    <option value="damaged">Damaged</option>
                    <option value="partial">Partial</option>
                    <option value="wrong_item">Wrong item</option>
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Description *</label>
                <input style={{ ...ic, fontFamily: font, fontSize: 12 }} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What is it? e.g. Client samples, return from Nike, supplies box" />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Notes</label>
                <input style={{ ...ic, fontFamily: font, fontSize: 12 }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any additional details" />
              </div>

              {/* Items — name + size/qty rows (optional). Same shape that
                  carries over from production; Part B will auto-fill this from
                  a packing slip. */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <label style={{ fontSize: 10, color: T.faint }}>Items <span style={{ color: T.faint }}>(optional)</span></label>
                  <button type="button" onClick={liAddItem} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.text, fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontFamily: font }}>+ Add item</button>
                </div>
                {formLineItems.map(it => {
                  const total = it.rows.reduce((a, r) => a + (Number(r.qty) || 0), 0);
                  return (
                    <div key={it.id} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 10, marginBottom: 8 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                        <input value={it.name} onChange={e => liSetName(it.id, e.target.value)} placeholder="Item name"
                          style={{ ...ic, fontFamily: font, fontSize: 12, flex: 1 }} />
                        <span style={{ fontSize: 11, color: T.muted, fontFamily: mono, whiteSpace: "nowrap" }}>{total} total</span>
                        <button type="button" onClick={() => liRemoveItem(it.id)} title="Remove item" style={{ background: "none", border: "none", color: T.faint, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
                      </div>
                      {/* Size chips — click to add/remove a size (product-builder style) */}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                        {PRESET_SIZES.map(sz => {
                          const on = it.rows.some(r => r.size === sz);
                          return (
                            <button key={sz} type="button" onClick={() => liToggleSize(it.id, sz)}
                              style={{ minWidth: 38, padding: "4px 8px", fontSize: 11, fontFamily: mono, fontWeight: 700,
                                background: on ? T.accent : T.surface, color: on ? "#fff" : T.muted,
                                border: `1px solid ${on ? T.accent : T.border}`, borderRadius: 6, cursor: "pointer" }}>
                              {sz}
                            </button>
                          );
                        })}
                        <button type="button" onClick={() => liAddRow(it.id)}
                          style={{ padding: "4px 8px", fontSize: 11, fontWeight: 700, background: "transparent", border: `1px dashed ${T.border}`, color: T.muted, borderRadius: 6, cursor: "pointer", fontFamily: font }}>+ custom</button>
                      </div>
                      {/* Qty cells — size label above the box */}
                      {it.rows.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {it.rows.map((r, idx) => (
                            <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                              {PRESET_SIZES.includes(r.size) ? (
                                <span style={{ fontSize: 10, fontWeight: 700, fontFamily: mono, color: T.muted }}>{r.size}</span>
                              ) : (
                                <input value={r.size} onChange={e => liSetRow(it.id, idx, "size", e.target.value)} placeholder="Size"
                                  style={{ ...ic, fontFamily: mono, fontSize: 10, width: 50, padding: "2px 4px", textAlign: "center" }} />
                              )}
                              <input value={r.qty} onChange={e => liSetRow(it.id, idx, "qty", e.target.value)} placeholder="0" inputMode="numeric"
                                style={{ ...ic, fontFamily: mono, fontSize: 13, fontWeight: 600, width: 50, padding: "5px 4px", textAlign: "center" }} />
                              <button type="button" onClick={() => liRemoveRow(it.id, idx)} title="Remove" style={{ background: "none", border: "none", color: T.faint, fontSize: 12, cursor: "pointer", lineHeight: 1 }}>×</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Photos / documents</label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.accent; }}
                  onDragLeave={e => { e.currentTarget.style.borderColor = T.border; }}
                  onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.border; setPendingFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]); }}
                  style={{
                    border: `2px dashed ${T.border}`, borderRadius: 8, padding: "12px 16px",
                    textAlign: "center", cursor: "pointer", transition: "border-color 0.15s",
                  }}>
                  <div style={{ fontSize: 12, color: T.accent, fontWeight: 600 }}>Drop files or click to browse</div>
                  <div style={{ fontSize: 10, color: T.faint, marginTop: 2 }}>Photos of packaging, packing slips, damage, etc.</div>
                </div>
                <input ref={fileInputRef} type="file" multiple style={{ display: "none" }}
                  onChange={e => { setPendingFiles(prev => [...prev, ...Array.from(e.target.files || [])]); e.target.value = ""; }} />
                {pendingFiles.length > 0 && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                    {pendingFiles.map((f, i) => (
                      <span key={i} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: T.surface, color: T.muted, display: "flex", alignItems: "center", gap: 4 }}>
                        {f.name}
                        <button onClick={e => { e.stopPropagation(); setPendingFiles(prev => prev.filter((_, j) => j !== i)); }}
                          style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 11, padding: 0 }}>x</button>
                      </span>
                    ))}
                  </div>
                )}
                {uploadStatus && <div style={{ fontSize: 11, color: T.accent, marginTop: 4 }}>{uploadStatus}</div>}
              </div>

              {/* Post-receive route — every package goes through Receiving
                  first, then splits here once received. Changeable at receive. */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 4 }}>After receiving →</label>
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  {[
                    { id: "ship_through", label: "Forward to client", hint: "Once received, goes to Shipping to forward out" },
                    { id: "stage", label: "Stage at warehouse", hint: "Once received, goes to Fulfillment to hold/pack" },
                  ].map(d => {
                    const active = form.destination === d.id;
                    return (
                      <button key={d.id} type="button" title={d.hint} onClick={() => setForm(f => ({ ...f, destination: d.id }))}
                        style={{ flex: 1, padding: "8px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: font,
                          border: `1px solid ${active ? T.accent : T.border}`,
                          background: active ? T.accent : T.surface,
                          color: active ? "#fff" : T.muted }}>
                        {d.label}
                      </button>
                    );
                  })}
                </div>
                {(() => {
                  const selected = linkableClients.find(c => c.id === form.clientId);
                  if (selected) {
                    return (
                      <div style={{ ...ic, fontFamily: font, fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{selected.name}</span>
                        <button type="button" onClick={() => { setForm(f => ({ ...f, clientId: "" })); setOrderSearch(""); }}
                          style={{ background: "none", border: "none", color: T.faint, fontSize: 16, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
                      </div>
                    );
                  }
                  const q = orderSearch.trim().toLowerCase();
                  const matches = q ? linkableClients.filter(c => c.name.toLowerCase().includes(q)).slice(0, 8) : [];
                  return (
                    <div style={{ position: "relative" }}>
                      <input value={orderSearch} onChange={e => setOrderSearch(e.target.value)} placeholder="Link to client (optional) — needed to forward/notify…"
                        style={{ ...ic, fontFamily: font, fontSize: 12 }} />
                      {q && (
                        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, marginTop: 4, maxHeight: 240, overflowY: "auto", boxShadow: "0 6px 24px rgba(0,0,0,0.14)" }}>
                          {matches.length === 0 ? (
                            <div style={{ padding: "8px 12px", fontSize: 11, color: T.faint }}>No matching client</div>
                          ) : matches.map(c => (
                            <div key={c.id} onClick={() => { setForm(f => ({ ...f, clientId: c.id })); setOrderSearch(""); }}
                              style={{ padding: "8px 12px", fontSize: 12, cursor: "pointer", borderBottom: `1px solid ${T.border}55`, fontWeight: 600 }}
                              onMouseEnter={e => e.currentTarget.style.background = T.surface}
                              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                              {c.name}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={submitOutside} disabled={saving || !form.description.trim()}
                  style={{ padding: "8px 20px", borderRadius: 6, border: "none", cursor: "pointer", background: T.green, color: "#fff", fontSize: 12, fontWeight: 700, opacity: saving || !form.description.trim() ? 0.5 : 1 }}>
                  {saving ? (uploadStatus || "Saving...") : "Log shipment"}
                </button>
                <button onClick={() => setShowForm(false)}
                  style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, cursor: "pointer", background: "transparent", color: T.muted, fontSize: 12 }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
      )}

      {/* ── Receive outside package modal — enter received qtys per size ── */}
      {receivingOutside && (
        <div onClick={() => setReceivingOutside(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 16px", overflowY: "auto" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 18, width: "100%", maxWidth: 640, boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Receive package</div>
              <button onClick={() => setReceivingOutside(null)} aria-label="Close" style={{ background: "none", border: "none", color: T.muted, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{receivingOutside.description}</div>
            <div style={{ fontSize: 11, color: T.muted, marginTop: 1, marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              {receivingOutside.sender && <span>From {receivingOutside.sender}</span>}
              {receivingOutside.carrier && <span>{receivingOutside.carrier}</span>}
              {receivingOutside.tracking && <span style={{ fontFamily: mono }}>{receivingOutside.tracking}</span>}
            </div>

            {(receivingOutside.line_items || []).length === 0 ? (
              <div style={{ fontSize: 12, color: T.faint, marginBottom: 14 }}>No itemized contents — confirm to mark received.</div>
            ) : (
              (receivingOutside.line_items || []).map((it, i) => (
                <div key={i} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{it.name || `Item ${i + 1}`}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {sortSizeEntries(it.sizes || {}).map(([sz, exp]) => {
                      const recv = Number(recvQtys[`${i}:${sz}`]) || 0;
                      const variance = recv - (Number(exp) || 0);
                      const vColor = variance < 0 ? T.red : T.green;
                      return (
                        <div key={sz} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, fontFamily: mono, color: T.muted }}>{sz}</span>
                          <input value={recvQtys[`${i}:${sz}`] ?? ""} inputMode="numeric"
                            onChange={e => setRecvQtys(p => ({ ...p, [`${i}:${sz}`]: e.target.value }))}
                            onFocus={e => e.target.select()}
                            style={{ ...ic, fontFamily: mono, fontSize: 13, fontWeight: 600, width: 52, padding: "5px 4px", textAlign: "center", borderColor: variance !== 0 ? vColor : T.border }} />
                          <span style={{ fontSize: 9, fontFamily: mono, height: 12, lineHeight: "12px", color: variance !== 0 ? vColor : "transparent" }}>
                            {variance > 0 ? `+${variance}` : variance} vs {exp}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}

            <div style={{ marginTop: 6, marginBottom: 14 }}>
              <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 3 }}>Condition</label>
              <select value={recvCondition} onChange={e => setRecvCondition(e.target.value)} style={{ ...ic, fontFamily: font, fontSize: 12, cursor: "pointer" }}>
                <option value="good">Good</option>
                <option value="damaged">Damaged</option>
                <option value="partial">Partial damage</option>
                <option value="wrong_item">Wrong item</option>
              </select>
            </div>

            {/* Post-receive route — where it goes next. Defaults to the logged
                intent; change it here if the box turns out different. */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 4 }}>After receiving →</label>
              <div style={{ display: "flex", gap: 6 }}>
                {[
                  { id: "ship_through" as const, label: "Forward to client", hint: "Goes to the Shipping page to forward out" },
                  { id: "stage" as const, label: "Stage at warehouse", hint: "Goes to Fulfillment to hold/pack" },
                ].map(r => {
                  const active = recvRoute === r.id;
                  return (
                    <button key={r.id} type="button" title={r.hint} onClick={() => setRecvRoute(r.id)}
                      style={{ flex: 1, padding: "8px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: font,
                        border: `1px solid ${active ? T.accent : T.border}`, background: active ? T.accent : T.surface, color: active ? "#fff" : T.muted }}>
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 10, color: T.faint, display: "block", marginBottom: 4 }}>Photos <span style={{ color: T.faint }}>(visual reference)</span></label>
              <label style={{ display: "inline-block", padding: "7px 14px", borderRadius: 8, border: `1px dashed ${T.border}`, color: T.muted, fontSize: 12, cursor: "pointer", fontFamily: font }}>
                + Add photo
                <input type="file" multiple accept="image/*" capture="environment" style={{ display: "none" }}
                  onChange={e => { setRecvPendingFiles(prev => [...prev, ...Array.from(e.target.files || [])]); e.target.value = ""; }} />
              </label>
              {recvPendingFiles.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                  {recvPendingFiles.map((f, idx) => (
                    <span key={idx} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: T.surface, color: T.muted, display: "flex", alignItems: "center", gap: 4 }}>
                      {f.name}
                      <button type="button" onClick={() => setRecvPendingFiles(prev => prev.filter((_, j) => j !== idx))} style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 11, padding: 0 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={confirmReceiveOutside} disabled={recvBusy}
                style={{ padding: "8px 20px", borderRadius: 6, border: "none", cursor: recvBusy ? "default" : "pointer", background: T.green, color: "#fff", fontSize: 12, fontWeight: 700, opacity: recvBusy ? 0.6 : 1 }}>
                {recvBusy ? "Saving…" : "Confirm received"}
              </button>
              <button onClick={() => setReceivingOutside(null)}
                style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, cursor: "pointer", background: "transparent", color: T.muted, fontSize: 12 }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Packing slip viewer modal */}
      {/* Batch-receive confirm — opened by "Receive Selected" in List view.
          Review each item's qty + condition, then commit via bulkMarkReceived.
          Per-size / photo detail stays in the per-item Receive modal. */}
      {mockupPeek && <MockupPeek driveFileId={mockupPeek.driveFileId} name={mockupPeek.name} onClose={() => setMockupPeek(null)} />}

      {batchReceiveItems && (() => {
        const items = batchReceiveItems;
        return (
          <div onClick={() => setBatchReceiveItems(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, width: "min(560px, 100%)", maxHeight: "85vh", display: "flex", flexDirection: "column", fontFamily: font, color: T.text }}>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 16, fontWeight: 800 }}>Receive {items.length} item{items.length !== 1 ? "s" : ""}</div>
                <button onClick={() => setBatchReceiveItems(null)} style={{ background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
                <div style={{ fontSize: 11, color: T.muted, marginBottom: 10 }}>Confirm quantities + condition, then mark received. For per-size or photo detail, use the row&apos;s Receive button instead.</div>
                {items.map(it => {
                  const cond = itemCondition[it.id] || "good";
                  const shipped = tQty(it.ship_qtys) || tQty(it.qtys);
                  return (
                    <div key={it.id} style={{ padding: "10px 0", borderBottom: `1px solid ${T.border}55`, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                          <div style={{ fontSize: 11, color: T.muted }}>{it.decorator_short_code || it.decorator_name || "—"}</div>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, fontFamily: mono, whiteSpace: "nowrap" }}>{shipped} units</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {(["good", "damaged"] as const).map(c => (
                          <button key={c} onClick={() => setItemCondition(prev => ({ ...prev, [it.id]: c }))}
                            style={{ fontSize: 11, fontWeight: 600, padding: "4px 12px", borderRadius: 6, border: `1px solid ${cond === c ? (c === "damaged" ? T.red : T.green) : T.border}`, background: cond === c ? (c === "damaged" ? T.redDim : T.greenDim) : "transparent", color: cond === c ? (c === "damaged" ? T.red : T.green) : T.muted, cursor: "pointer", fontFamily: font, textTransform: "capitalize" }}>{c}</button>
                        ))}
                        {cond === "damaged" && (
                          <input value={conditionNote[it.id] || ""} onChange={e => setConditionNote(prev => ({ ...prev, [it.id]: e.target.value }))} placeholder="What's damaged?"
                            style={{ flex: 1, fontSize: 12, padding: "5px 8px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, outline: "none", fontFamily: font }} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button onClick={() => setBatchReceiveItems(null)} style={{ padding: "8px 16px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: font }}>Cancel</button>
                <button onClick={async () => {
                  await bulkMarkReceived(items, (it) => ({ condition: itemCondition[it.id] || "good", notes: conditionNote[it.id] || "" }), { skipClientEmail: silentMode });
                  setSelectedItemIds(prev => { const next = new Set(prev); for (const it of items) next.delete(it.id); return next; });
                  setBatchReceiveItems(null);
                }} style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: T.green, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: font }}>
                  Mark {items.length} Received
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {viewingSlips && (
        <div onClick={() => setViewingSlips(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: T.card, borderRadius: 12, width: "90vw", maxWidth: 900, height: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{viewingSlips.title} — Packing slips</span>
                {viewingSlips.files.length > 1 && (
                  <span style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>{viewingSlips.index + 1} / {viewingSlips.files.length}</span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {viewingSlips.files.length > 1 && (
                  <>
                    <button onClick={() => setViewingSlips(v => v ? { ...v, index: Math.max(0, v.index - 1) } : null)} disabled={viewingSlips.index === 0}
                      style={{ padding: "4px 10px", borderRadius: 4, border: `1px solid ${T.border}`, background: "none", color: viewingSlips.index === 0 ? T.faint : T.text, cursor: "pointer", fontSize: 12 }}>Prev</button>
                    <button onClick={() => setViewingSlips(v => v ? { ...v, index: Math.min(v.files.length - 1, v.index + 1) } : null)} disabled={viewingSlips.index === viewingSlips.files.length - 1}
                      style={{ padding: "4px 10px", borderRadius: 4, border: `1px solid ${T.border}`, background: "none", color: viewingSlips.index === viewingSlips.files.length - 1 ? T.faint : T.text, cursor: "pointer", fontSize: 12 }}>Next</button>
                  </>
                )}
                <button onClick={() => setViewingSlips(null)}
                  style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: T.surface, color: T.muted, cursor: "pointer", fontSize: 12 }}>Close</button>
              </div>
            </div>
            <div style={{ padding: "6px 16px", fontSize: 11, color: T.muted, borderBottom: `1px solid ${T.border}` }}>
              {viewingSlips.files[viewingSlips.index].file_name}
            </div>
            <div style={{ flex: 1 }}>
              <iframe src={viewingSlips.files[viewingSlips.index].drive_link.replace("/view", "/preview")} style={{ width: "100%", height: "100%", border: "none" }} allow="autoplay" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
