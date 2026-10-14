"use client";
// THE CLIENT SPACE (Jul 22 2026) — the internal mirror of the client's hub.
// Same spine the client sees (Studio · Drops · Orders · Pipeline · Catalog),
// plus our layers (Archive, Money, contacts, the wire). One mental model on
// both sides of the glass; ours just has more doors.
// The old client page still exists at /clients/[id]/classic (no longer linked)
// (reorder machinery, QB link, file manager) and dies when the space wins.
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { hasRun } from "@/lib/run-gate";
import { H, HUB_PAGE } from "@/components/hub/theme";
import { JOB_DIRECTIVES } from "@/lib/directives";
import { ClientWorkingSheet } from "@/components/ClientWorkingSheet";
import { QBCustomerChooser } from "@/components/QBCustomerChooser";
import { JobStatusBar } from "@/components/JobStatusBar";
import { ItemsPeekRail } from "@/components/JobItemsPeek";
import { deriveProjectStage } from "@/lib/project-stage";
import { loadJobPhasesBatch } from "@/lib/item-state";
import { ClientLocations } from "@/components/ClientLocations";
import { todayPacific } from "@/lib/dates";
import { resolveRecipientEmails } from "@/lib/recipients";
import { AddressFields } from "@/components/AddressFields";
import { EMPTY_ADDR, addrProblem, billAddr, billAddrCols } from "@/lib/address";
import { CatalogRail, ArchiveRail, buildCatalogPieces, CLIENT_CARD_CSS } from "@/components/client/ClientCatalog";

const PURPLE = "#fd3aa3";
// Forward Observations Group — their space carries a link to the internal
// FOG God Mode drop-analytics page (/fog-analytics, owner-gated).
const FOG_CLIENT_ID = "df6df73a-dd64-4c8f-86e9-7ea4e6af1ff1";
const thumbSrc = (id: string, size = 300) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;
const fmt$ = (n: number) => "$" + Math.round(n).toLocaleString();
const fmtDate = (iso?: string | null) => iso ? new Date(String(iso).includes("T") ? iso : iso + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
const fmtShort = (iso?: string | null) => iso ? new Date(String(iso).includes("T") ? iso : iso + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";


const SECTIONS = ["Overview", "Studio", "Drops", "Orders", "Pipeline", "Catalog", "Archive"] as const;
type Section = typeof SECTIONS[number];

export default function ClientSpacePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [section, setSection] = useState<Section>("Overview");
  const [editOpen, setEditOpen] = useState(false);
  // after a save, the QuickBooks customer is updated to match (lib/qb-customer-sync)
  const [qbNote, setQbNote] = useState<{ ok: boolean; t: string } | null>(null);
  const syncQb = async () => {
    setQbNote(null);
    try {
      const r = await fetch(`/api/clients/${params.id}/qb-sync`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "QuickBooks update failed");
      if (d.changed?.length) setQbNote({ ok: true, t: `QuickBooks customer updated: ${d.changed.join(", ")}` });
    } catch (e: any) { setQbNote({ ok: false, t: `Saved in OpsHub, but QuickBooks wasn't updated: ${e.message}` }); }
  };
  // Action feed inputs — same batch loads the /projects board uses, so the
  // status bars here can never disagree with that board.
  const [phaseViews, setPhaseViews] = useState<Map<string, any>>(new Map());
  const [proofStatus, setProofStatus] = useState<Record<string, { allApproved: boolean }> | undefined>(undefined);
  const [itemThumbs, setItemThumbs] = useState<Record<string, string>>({});
  const [client, setClient] = useState<any | null>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [releases, setReleases] = useState<any[]>([]);
  const [briefs, setBriefs] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [archive, setArchive] = useState<any[]>([]);
  const [hist, setHist] = useState<{ gross: number; units: number } | null>(null);
  const [fulfillReports, setFulfillReports] = useState<any[]>([]);
  const [wire, setWire] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const id = params.id;
      const [{ data: c }, { data: cts }, { data: js }, { data: rel }, { data: prods }, { data: arc }] = await Promise.all([
        supabase.from("clients").select("*").eq("id", id).single(),
        supabase.from("contacts").select("*").eq("client_id", id).order("name"),
        supabase.from("jobs")
          // shipping_route / phase_timestamps / quote_approved_at + the item money
          // and lifecycle fields feed the Working Sheet in the Pipeline section.
          .select("id, job_number, title, phase, payment_terms, target_ship_date, created_at, quote_approved, quote_approved_at, shipping_route, phase_timestamps, type_meta, qb_invoice_number, qb_invoice_id, costing_summary, items(id, name, sort_order, ship_est, expected_arrival, created_at, blank_sku, blank_vendor, garment_type, drive_link, pipeline_stage, artwork_status, received_at_hpd, forwarded_at, webstore_entered_at, sell_per_unit, client_retail_per_unit, client_eta, notes, archived_at, completed_at, shipping_route, blanks_order_cost, blanks_order_number, product_id, design_id, decorator_assignments(decorators(name, short_code)), buy_sheet_lines(size, qty_ordered)), payment_records(id, amount, status, due_date, paid_date, invoice_number)")
          .eq("client_id", id).order("created_at", { ascending: false }),
        supabase.from("releases").select("*").eq("client_id", id).order("created_at", { ascending: false }),
        supabase.from("products").select("*").eq("client_id", id).order("created_at", { ascending: false }),
        (async () => {
          // paged — archives beat the 1000-row cap (supdef: 1,565)
          const out: any[] = [];
          for (let from = 0; ; from += 1000) {
            const { data } = await supabase.from("legacy_art_files").select("id, drive_file_id, file_name, mime_type, folder_path").eq("client_id", id).order("folder_path").range(from, from + 999);
            out.push(...(data || []));
            if (!data || data.length < 1000) break;
          }
          return { data: out };
        })(),
      ]);
      setClient(c); setContacts(cts || []); setJobs(js || []); setReleases(rel || []);
      supabase.from("shipstation_reports")
        .select("id, period_label, report_type, qb_invoice_number, qb_total_with_tax, paid_at, paid_amount, created_at")
        .eq("client_id", id).order("created_at", { ascending: false })
        .then(({ data: fr }) => setFulfillReports(fr || []));
      setProducts(prods || []); setArchive(arc || []);
      // pre-OpsHub history (pure — the era wall keeps live jobs uncounted here)
      if ((c as any)?.name) {
        const { data: h } = await supabase.from("history_sales").select("amount, qty")
          .ilike("customer", `%${(c as any).name}%`).is("opshub_job_id", null).limit(5000);
        setHist({
          gross: (h || []).reduce((a: number, r: any) => a + (Number(r.amount) || 0), 0),
          units: (h || []).reduce((a: number, r: any) => a + (Number(r.qty) || 0), 0),
        });
      } else setHist({ gross: 0, units: 0 });
      const jobIds = ((js || []) as any[]).map(j => j.id);
      if (jobIds.length) {
        const { data: act } = await supabase.from("job_activity")
          .select("message, created_at, jobs(job_number, type_meta, qb_invoice_number, qb_invoice_id)").in("job_id", jobIds)
          .order("created_at", { ascending: false }).limit(14);
        setWire(act || []);
      }
      try {
        const res = await fetch("/api/art-briefs");
        const body = await res.json();
        setBriefs((body.briefs || []).filter((b: any) => b.client_id === id && !b.client_aborted_at));
      } catch {}
      setLoaded(true);
      // action-feed batches (fire-and-forget; bars render with gates off until they land)
      const activeJs = ((js || []) as any[]).filter(j => !["complete", "cancelled"].includes(j.phase));
      loadJobPhasesBatch(supabase, activeJs.map(j => j.id)).then(setPhaseViews).catch(() => {});
      // catalog thumbnails (mockup > proof, newest, non-superseded — hub parity)
      (async () => {
        const ids = ((js || []) as any[]).flatMap(j => (j.items || []).map((i: any) => i.id));
        const th: Record<string, string> = {};
        for (let i = 0; i < ids.length; i += 150) {
          const { data: files } = await supabase.from("item_files")
            .select("item_id, stage, drive_file_id, created_at").in("stage", ["mockup", "proof"]).is("superseded_at", null)
            .not("drive_file_id", "is", null).in("item_id", ids.slice(i, i + 150))
            .order("created_at", { ascending: false });
          for (const f of (files || []) as any[]) {
            if (!th[f.item_id] && f.stage === "mockup") th[f.item_id] = f.drive_file_id;
          }
          for (const f of (files || []) as any[]) { if (!th[f.item_id]) th[f.item_id] = f.drive_file_id; }
        }
        setItemThumbs(th);
      })().catch(() => {});
      (async () => {
        const ids = activeJs.flatMap(j => (j.items || []).map((i: any) => i.id));
        const ps: Record<string, { allApproved: boolean; state: "approved" | "revision" | "pending" | "none" }> = {};
        for (let i = 0; i < ids.length; i += 150) {
          const { data: files } = await supabase.from("item_files")
            .select("item_id, stage, approval").eq("stage", "proof").is("superseded_at", null)
            .in("item_id", ids.slice(i, i + 150));
          const byItem: Record<string, any[]> = {};
          for (const f of (files || []) as any[]) (byItem[f.item_id] ||= []).push(f);
          for (const id of ids.slice(i, i + 150)) {
            const proofs = byItem[id] || [];
            // state mirrors /projects so the items peek labels read the same on both.
            const state = proofs.some((f: any) => f.approval === "revision_requested") ? "revision"
              : (proofs.length > 0 && proofs.every((f: any) => f.approval === "approved")) ? "approved"
              : proofs.length > 0 ? "pending" : "none";
            ps[id] = { allApproved: state === "approved", state };
          }
        }
        setProofStatus(ps);
      })().catch(() => {});
    })();
    // eslint-disable-next-line
  }, [params.id]);

  const model = useMemo(() => {
    const liveGross = jobs.reduce((a, j) => a + (Number(j.costing_summary?.grossRev) || 0), 0);
    const liveUnits = jobs.flatMap(j => j.items || []).reduce((a, i) => a + (i.buy_sheet_lines || []).reduce((s: number, l: any) => s + (Number(l.qty_ordered) || 0), 0), 0);
    const active = jobs.filter(j => !["complete", "cancelled"].includes(j.phase));
    const done = jobs.filter(j => ["complete", "cancelled"].includes(j.phase));
    // pipeline: items in flight, with a plain-words stage
    const inFlight = jobs.flatMap(j => (j.items || []).map((i: any) => ({ ...i, job: j })))
      .filter((i: any) => i.pipeline_stage === "in_production" || (i.pipeline_stage === "shipped" && !i.webstore_entered_at && !i.forwarded_at));
    const stageOf = (i: any) => i.pipeline_stage === "in_production" ? { t: "On press", c: H.blue }
      : i.received_at_hpd ? { t: "Landed", c: H.green } : { t: "In transit", c: PURPLE };
    // catalog families: produced items grouped by name across jobs (the
    // pre-products era's history — products table rows are the real catalog).
    // Only RUN pieces count — an intake item is an ask, not history (run-gate).
    const fam = new Map<string, { name: string; runs: number; lastJob: any; units: number; price: number | null; productId: string | null }>();
    for (const j of jobs) for (const i of (j.items || [])) {
      if (!hasRun(j.phase, i.pipeline_stage)) continue;
      const key = (i.name || "").trim().toLowerCase();
      if (!key) continue;
      const units = (i.buy_sheet_lines || []).reduce((s: number, l: any) => s + (Number(l.qty_ordered) || 0), 0);
      const cur = fam.get(key);
      if (cur) { cur.runs++; cur.units += units; }
      else fam.set(key, { name: i.name, runs: 1, lastJob: j, units, price: i.sell_per_unit ?? null, productId: i.product_id || null });
    }
    const families = Array.from(fam.values()).sort((a, b) => b.units - a.units);
    // Catalog pieces — SAME shape/order as the client hub's reorder catalog:
    // dedupe by name|blank_sku, newest instance represents the piece, newest
    // first (Jon, Aug 3: internal catalog mirrors what the client sees).
    const pieces = buildCatalogPieces(jobs);
    const payments = jobs.flatMap(j => (j.payment_records || []).map((p: any) => ({ ...p, job: j })));
    const outstanding = payments.filter(p => !["paid", "void", "draft"].includes(p.status)).reduce((a, p) => a + (Number(p.amount) || 0), 0);
    return { liveGross, liveUnits, active, done, inFlight, stageOf, families, pieces, payments, outstanding };
  }, [jobs]);

  const pill = (active: boolean): React.CSSProperties => ({ borderRadius: 999, border: active ? "1px solid #fff" : `1px solid ${H.line}`, background: active ? "#fff" : "transparent", color: active ? H.ink : H.dim, fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", padding: "9px 15px", cursor: "pointer", fontFamily: H.font });
  const secHead = (title: string, hint: string) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, margin: "34px 0 14px" }}>
      <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>{title}</h2>
      <span style={{ fontSize: 10.5, color: H.faint }}>{hint}</span>
    </div>
  );

  if (!loaded) return <div style={{ background: H.ink, minHeight: "100vh", margin: -24, padding: 48, color: H.faint, fontSize: 13, fontFamily: H.font }}>Opening the space…</div>;
  if (!client) return <div style={{ background: H.ink, minHeight: "100vh", margin: -24, padding: 48, color: H.red, fontSize: 13, fontFamily: H.font }}>No client here.</div>;

  const grants: string[] = Array.isArray(client.portal_features) ? client.portal_features : [];

  return (
    <div style={HUB_PAGE}>
      <style dangerouslySetInnerHTML={{ __html: CLIENT_CARD_CSS }} />
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "26px 0 90px" }}>
        {/* ── Header — name left, actions stacked upper-right (Jon, Sep 16
            2026): a project starts here; their hub sits under it. ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: H.faint }}>
              Client space · {client.client_type || "client"}{client.default_terms ? ` · ${String(client.default_terms).replace(/_/g, " ")}` : ""}
            </div>
            <h1 style={{ fontSize: "clamp(34px,5vw,64px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "6px 0 8px" }}>{client.name}.</h1>
            <div style={{ fontSize: 12, color: H.dim }}>
              {grants.length ? `hub features: ${grants.join(" + ")}` : "no hub features granted yet"}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12, paddingTop: 22, flexShrink: 0 }}>
            <a href={`/jobs/new?client=${params.id}`} style={{ borderRadius: 999, border: "none", background: "#fff", color: H.ink, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", padding: "10px 18px", textDecoration: "none", whiteSpace: "nowrap" }}>+ New project</a>
            {client.portal_token && (
              <a href={`/portal/client/${client.portal_token}`} target="_blank" rel="noreferrer" style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: PURPLE, textDecoration: "none", whiteSpace: "nowrap" }}>their hub ↗</a>
            )}
          </div>
        </div>

        {/* ── KPI strip — operational only (lifetime gross/units removed, Jon) ── */}
        <div style={{ display: "flex", gap: "clamp(18px,4vw,44px)", flexWrap: "wrap", borderTop: `1px solid ${H.line}`, borderBottom: `1px solid ${H.line}`, padding: "16px 0", margin: "16px 0 0" }}>
          <div><div style={{ fontSize: "clamp(22px,3vw,32px)", fontWeight: 900, lineHeight: 1, color: model.active.length ? H.amber : H.text }}>{model.active.length}</div><div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginTop: 5 }}>orders in motion</div></div>
          <div><div style={{ fontSize: "clamp(22px,3vw,32px)", fontWeight: 900, lineHeight: 1, color: PURPLE }}>{products.length}</div><div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginTop: 5 }}>products in catalog</div></div>
          <div><div style={{ fontSize: "clamp(22px,3vw,32px)", fontWeight: 900, lineHeight: 1 }}>{archive.length.toLocaleString()}</div><div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginTop: 5 }}>archive files</div></div>
          {model.outstanding > 0 && <div><div style={{ fontSize: "clamp(22px,3vw,32px)", fontWeight: 900, lineHeight: 1, color: H.red }}>{fmt$(model.outstanding)}</div><div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginTop: 5 }}>outstanding</div></div>}
        </div>

        {/* ── The spine — the client's words, our doors ── */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "18px 0 0" }}>
          {SECTIONS.map(s => {
            const n = s === "Studio" ? briefs.length : s === "Drops" ? releases.length : s === "Orders" ? jobs.length
              : s === "Pipeline" ? model.inFlight.length : s === "Catalog" ? products.length + model.families.length
              : s === "Archive" ? archive.length : 0;
            return (
              <button key={s} style={pill(section === s)} onClick={() => setSection(s)}>
                {s}{n > 0 && s !== "Overview" ? ` · ${n > 999 ? "999+" : n}` : ""}
              </button>
            );
          })}
        </div>

        {section === "Overview" && (
          <>
            <ActionFeed jobs={jobs} phaseViews={phaseViews} proofStatus={proofStatus} thumbs={itemThumbs} router={router} secHead={secHead} />
            <Overview client={client} contacts={contacts} wire={wire} model={model} briefs={briefs} secHead={secHead} onEdit={() => setEditOpen(true)} qbNote={qbNote} onLocationsSaved={syncQb} />
          </>
        )}
        {editOpen && (
          <EditClientModal client={client} contacts={contacts}
            onClose={() => setEditOpen(false)}
            onSaved={(cPatch: any, nextContacts: any[]) => { setClient((c: any) => ({ ...c, ...cPatch })); setContacts(nextContacts); setEditOpen(false); syncQb(); }} />
        )}
        {section === "Studio" && <StudioRail briefs={briefs} secHead={secHead} />}
        {section === "Drops" && <DropsRail releases={releases} secHead={secHead} />}
        {section === "Orders" && <OrdersRail model={model} hist={hist} reports={fulfillReports} secHead={secHead} />}
        {section === "Pipeline" && (
          <>
            {secHead("The pipeline.", "the working sheet — cost, retail, status, promises")}
            {/* The Working Sheet (moved here from classic, Jul 28) — edits
                sync this page's jobs state. */}
            <ClientWorkingSheet
              clientId={params.id}
              clientName={client.name}
              jobs={jobs}
              onItemLocalChange={(itemId, field, value) =>
                setJobs(prev => prev.map((j: any) => ({
                  ...j,
                  items: (j.items || []).map((it: any) => it.id === itemId ? { ...it, [field]: value } : it),
                })))}
            />
          </>
        )}
        {section === "Catalog" && <CatalogRail products={products} briefs={briefs} model={model} router={router} secHead={secHead} thumbs={itemThumbs} clientId={params.id} />}
        {section === "Archive" && <ArchiveRail archive={archive} briefs={briefs} clientId={params.id} secHead={secHead} />}
      </div>
    </div>
  );
}

// ── Overview: the room at a glance ──
function Overview({ client, contacts, wire, model, briefs, secHead, onEdit, qbNote, onLocationsSaved }: any) {
  const wt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 40 }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <div style={{ flex: 1 }}>{secHead("People.", "who picks up when you call")}</div>
            {/* Deliberate edit (Jul-24 spec): explicit action -> modal, never
                casual inline — client info shouldn't be fat-fingered. */}
            {client.id === FOG_CLIENT_ID && (
              <a href="/fog-analytics" style={{ borderRadius: 999, border: `1px solid ${H.line}`, background: "transparent", color: H.dim, fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", padding: "8px 14px", cursor: "pointer", fontFamily: H.font, alignSelf: "center", textDecoration: "none" }}>God Mode</a>
            )}
            <button onClick={onEdit} style={{ borderRadius: 999, border: `1px solid ${H.line}`, background: "transparent", color: H.dim, fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", padding: "8px 14px", cursor: "pointer", fontFamily: H.font, alignSelf: "center" }}>✎ Edit client</button>
          </div>
          {contacts.length === 0 && <div style={{ color: H.faint, fontSize: 12.5 }}>No contacts on file.</div>}
          {contacts.map((c: any) => (
            <div key={c.id} style={{ padding: "9px 0", borderBottom: `1px solid ${H.line}` }}>
              <span style={{ fontSize: 13.5, fontWeight: 800 }}>{c.name}</span>
              {c.is_primary && <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: PURPLE, marginLeft: 8 }}>primary</span>}
              {c.role_label && <span style={{ fontSize: 10, color: H.faint, marginLeft: 8 }}>{c.role_label}</span>}
              <div style={{ fontSize: 11.5, fontFamily: H.mono, color: H.dim, marginTop: 2 }}>
                {c.email && <a href={`mailto:${c.email}`} style={{ color: H.blue, textDecoration: "none" }}>{c.email}</a>}
                {c.phone ? `  ·  ${c.phone}` : ""}
              </div>
            </div>
          ))}
          {/* Company — what the client info form keeps current (Oct 2026). Always
              shown so a blank is visible; edit via Edit client. */}
          {secHead("Company.", "legal entity, billing, tax")}
          {qbNote && <div style={{ fontSize: 12, color: qbNote.ok ? H.green : H.red, margin: "-6px 0 8px" }}>{qbNote.t}</div>}
          {([
            ["Legal name", client.legal_name],
            ["EIN", client.ein],
            ["Billing address", client.billing_address && !client.bill_line1 ? `${client.billing_address}\nNeeds fixing: open Edit client and enter street, city, state and ZIP` : client.billing_address],
            ["Website", client.website],
            ["Invoices", client.invoice_po_required ? "Must carry their PO number" : "No PO required"],
            ["Sales tax", `${client.tax_exempt ? "Exempt" : "Taxable"}${client.qb_customer_id ? " · from QuickBooks" : " · not in QuickBooks yet"}${client.qb_resale_num ? ` · resale ${client.qb_resale_num}` : ""}`],
          ] as [string, any][]).map(([k, v]) => (
            <div key={k} style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, padding: "7px 0", borderBottom: `1px solid ${H.line}`, fontSize: 12.5 }}>
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: H.faint, paddingTop: 2 }}>{k}</span>
              <span style={{ color: v ? H.text : H.faint, whiteSpace: "pre-line" }}>{v || "—"}</span>
            </div>
          ))}
          {/* Locations: the address book — left column, below People (Jon, Sep 15). */}
          <div style={{ marginTop: 28 }}><ClientLocations clientId={client.id} secHead={secHead} onSaved={onLocationsSaved} /></div>
          {client.notes && (
            <>
              {secHead("Notes.", "the standing context")}
              <div style={{ fontSize: 13, color: H.dim, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{client.notes}</div>
            </>
          )}
          <DocsBlock clientId={client.id} secHead={secHead} />
          <InfoTaxBlock client={client} contacts={contacts} secHead={secHead} />
        </div>
        <div>
          {secHead("The wire.", "every move in this room, newest first")}
          {wire.length === 0 && <div style={{ color: H.faint, fontSize: 12.5 }}>Quiet so far.</div>}
          {wire.map((w: any, i: number) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "9px 0", borderBottom: `1px solid ${H.line}` }}>
              <span style={{ fontSize: 10, fontFamily: H.mono, color: H.faint, whiteSpace: "nowrap", flexShrink: 0 }}>{wt(w.created_at)}</span>
              <span style={{ fontSize: 12.5, lineHeight: 1.5, minWidth: 0 }}>
                {/* invoice # is the client-facing identity when it exists (Jon, Aug 3) */}
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: H.faint, marginRight: 7 }}>{w.jobs?.qb_invoice_number ? `#${w.jobs.qb_invoice_number}` : (w.jobs?.job_number || "")}</span>
                {w.message}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Studio: their ideas, art-first (cards mirror studio2) ──
function StudioRail({ briefs, secHead }: any) {
  const bThumb = (b: any) => {
    const t = (b.thumbs || []).find((x: any) => x.preview_drive_file_id || x.drive_file_id);
    return t ? thumbSrc(t.preview_drive_file_id || t.drive_file_id) : null;
  };
  return (
    <>
      {secHead("The studio.", "everything before a job exists — tap through to answer")}
      {briefs.length === 0 && <div style={{ color: H.faint, fontSize: 12.5 }}>No ideas yet — their hub's front door is waiting.</div>}
      <div className="cs-grid">
        {briefs.map((b: any) => {
          const src = bThumb(b);
          return (
            <a key={b.id} className="cs-card" href={`/studio?brief=${b.id}`}>
              {src ? (
                <div style={{ background: "#fff", aspectRatio: "1" }}>
                  <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                </div>
              ) : (
                <div style={{ aspectRatio: "1", display: "flex", alignItems: "flex-end", padding: 14, background: H.surface }}>
                  <span style={{ fontSize: 15, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.15, color: H.dim }}>{b.title || "Untitled"}</span>
                </div>
              )}
              <div style={{ padding: "10px 13px 13px" }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.25, overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical" as any, WebkitLineClamp: 2 }}>{b.title || "Untitled idea"}</div>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: b.state === "approved" ? H.green : H.amber, marginTop: 4 }}>
                  {b.state === "approved" ? "Greenlit" : b.state === "with_client" ? "With them" : b.state === "shelved" ? "Shelved" : b.state === "killed" ? "Killed" : "In the studio"}
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </>
  );
}

// ── Drops ──
function DropsRail({ releases, secHead }: any) {
  return (
    <>
      {secHead("The releases.", "building, live, and cut")}
      {releases.length === 0 && <div style={{ color: H.faint, fontSize: 12.5 }}>No releases yet.</div>}
      {releases.map((r: any) => (
        <a key={r.id} className="cs-row" href="/drops">
          <span style={{ fontSize: 14, fontWeight: 900, textTransform: "uppercase", minWidth: 180 }}>{r.title}</span>
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: r.status === "live" ? H.green : r.status === "cut" ? H.faint : H.amber }}>{r.status}</span>
          <span style={{ fontSize: 11, fontFamily: H.mono, color: H.blue }}>{r.model === "stock" ? "in-stock" : "pre-order"}{r.target_live_date ? ` · live ${fmtShort(r.target_live_date)}` : ""}</span>
        </a>
      ))}
    </>
  );
}

// ── Orders: the jobs, verbs first ──
function OrdersRail({ model, hist, reports, secHead }: any) {
  // Fulfillment/shipping invoices (ShipStation reports) — same list the hub's
  // orders landing shows. Row links to the internal report page.
  const reportRow = (r: any) => {
    const total = Number(r.qb_total_with_tax) || 0;
    const paidAmt = Number(r.paid_amount) || 0;
    // Early-era reports (pre-OpsHub invoice push) have NO QB total on file —
    // their fee was hand-merged into a combined QB invoice (#3682 class). A
    // recorded payment there means settled; never compute against a null total.
    const pay = total <= 0
      ? (paidAmt > 0 || r.paid_at ? { t: `paid${r.paid_at ? " " + fmtShort(r.paid_at) : ""} · merged inv`, c: H.green } : null)
      : paidAmt >= total - 0.01 ? { t: `paid${r.paid_at ? " " + fmtShort(r.paid_at) : ""}`, c: H.green }
      : paidAmt > 0 ? { t: `partial · ${fmt$(Math.max(0, total - paidAmt))} due`, c: H.amber }
      : { t: `${fmt$(total)} due`, c: H.amber };
    const label = r.report_type === "combined" ? "Full service" : (r.report_type === "postage" || r.report_type === "fulfillment") ? "Fulfillment" : "Services";
    return (
      <a key={`rep-${r.id}`} href={`/invoices/fulfillment/${r.id}`}
        style={{ display: "grid", gridTemplateColumns: "84px 64px minmax(160px, 1fr) 130px 120px minmax(150px, 220px)", gap: 12, alignItems: "center", padding: "11px 0", borderBottom: `1px solid ${H.line}`, textDecoration: "none", color: H.text }}>
        <span style={{ fontSize: 12, fontFamily: H.mono, fontWeight: 700, color: H.blue }}>{r.qb_invoice_number ? `#${r.qb_invoice_number}` : "—"}</span>
        <span style={{ fontSize: 10.5, fontFamily: H.mono, color: H.faint }}>{fmtShort(r.created_at)}</span>
        <span style={{ fontSize: 13.5, fontWeight: 800, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label} · {r.period_label}</span>
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: pay ? pay.c : H.faint, whiteSpace: "nowrap" }}>{pay ? pay.t : ""}</span>
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: H.blue, whiteSpace: "nowrap" }}>fulfillment</span>
        <span style={{ fontSize: 11, fontFamily: H.mono, color: H.dim, textAlign: "right", whiteSpace: "nowrap" }}>{fmt$(total > 0 ? total : (paidAmt || Number(r.totals?.fee) || 0))}</span>
      </a>
    );
  };
  const openReports = (reports || []).filter((r: any) => (Number(r.paid_amount) || 0) < (Number(r.qb_total_with_tax) || 0) - 0.01);
  const paidReports = (reports || []).filter((r: any) => !openReports.includes(r));
  const row = (j: any) => {
    const units = (j.items || []).reduce((a: number, i: any) => a + (i.buy_sheet_lines || []).reduce((s: number, l: any) => s + (Number(l.qty_ordered) || 0), 0), 0);
    const ref = j.qb_invoice_number ? `#${j.qb_invoice_number}` : j.job_number;
    const d = JOB_DIRECTIVES[j.phase];
    // Payment chip — the hub's orders-page read: PAID + date, overdue red,
    // due amber, quiet when nothing's invoiced. (Money tab merged in, Aug 3.)
    const recs = (j.payment_records || []).filter((p: any) => p.status !== "void" && p.status !== "draft");
    const paidRecs = recs.filter((p: any) => p.status === "paid");
    const openRecs = recs.filter((p: any) => p.status !== "paid");
    const lastPaid = paidRecs.map((p: any) => p.paid_date).filter(Boolean).sort().pop();
    const overdue = openRecs.some((p: any) => p.status === "overdue" || (p.due_date && p.due_date < todayPacific()));
    // Truth = QB invoice total vs Σ(paid). Records alone lied: a $60k deposit
    // marked paid on a $120k invoice read "paid" (#4365, Aug 3).
    const invoicedTotal = Number(j.type_meta?.qb_total_with_tax) || 0;
    const paidAmt = paidRecs.reduce((a: number, p: any) => a + (Number(p.amount) || 0), 0);
    const openAmt = invoicedTotal > 0 ? Math.max(0, invoicedTotal - paidAmt) : openRecs.reduce((a: number, p: any) => a + (Number(p.amount) || 0), 0);
    const settled = invoicedTotal > 0 ? paidAmt >= invoicedTotal - 0.01 : (paidRecs.length > 0 && !openRecs.length);
    const pay = settled && paidRecs.length ? { t: `paid${lastPaid ? " " + fmtShort(lastPaid) : ""}`, c: H.green }
      : paidAmt > 0 && openAmt > 0 ? { t: `partial · ${fmt$(openAmt)} due`, c: H.amber }
      : openAmt > 0 ? { t: `${fmt$(openAmt)} ${overdue ? "overdue" : "due"}`, c: overdue ? H.red : H.amber }
      : null;
    return (
      // Columnized (Jon, Aug 3): fixed grid so refs / dates / chips align
      // down the page. ref · created · title · paid · status · meta.
      <a key={j.id} href={`/jobs/${j.id}`}
        style={{ display: "grid", gridTemplateColumns: "84px 64px minmax(160px, 1fr) 130px 120px minmax(150px, 220px)", gap: 12, alignItems: "center", padding: "11px 0", borderBottom: `1px solid ${H.line}`, textDecoration: "none", color: H.text }}>
        <span style={{ fontSize: 12, fontFamily: H.mono, fontWeight: 700, color: H.blue }}>{ref}</span>
        <span style={{ fontSize: 10.5, fontFamily: H.mono, color: H.faint }}>{fmtShort(j.created_at)}</span>
        <span style={{ fontSize: 13.5, fontWeight: 800, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.title}</span>
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: pay ? pay.c : H.faint, whiteSpace: "nowrap" }}>{pay ? pay.t : ""}</span>
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: ["complete"].includes(j.phase) ? H.green : H.amber, whiteSpace: "nowrap" }}>{["complete", "cancelled"].includes(j.phase) ? j.phase : (d?.verb || j.phase)}</span>
        <span style={{ fontSize: 11, fontFamily: H.mono, color: H.dim, textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{units ? `${units.toLocaleString()} pcs` : ""}{j.costing_summary?.grossRev ? ` · ${fmt$(j.costing_summary.grossRev)}` : ""}{j.target_ship_date ? ` · ship ${fmtShort(j.target_ship_date)}` : ""}</span>
      </a>
    );
  };
  return (
    <>
      {model.outstanding > 0 && (
        <div style={{ fontSize: 12.5, color: H.dim, margin: "26px 0 -14px" }}>
          Outstanding: <strong style={{ color: H.amber }}>{fmt$(model.outstanding)}</strong>
          <span style={{ color: H.faint }}> · lifetime: pre-OpsHub {fmt$(hist?.gross || 0)} + OpsHub {fmt$(model.liveGross)}</span>
        </div>
      )}
      {secHead("Orders in motion.", "verbs first — tap into the job for the full machine")}
      {model.active.length === 0 && openReports.length === 0 && <div style={{ color: H.faint, fontSize: 12.5 }}>Nothing in motion.</div>}
      {model.active.map(row)}
      {openReports.map(reportRow)}
      {model.done.length > 0 && (
        <>
          {secHead("The record.", `${model.done.length + paidReports.length} completed`)}
          {model.done.slice(0, 15).map(row)}
          {paidReports.slice(0, 10).map(reportRow)}
        </>
      )}
    </>
  );
}


// ── Edit client — deliberate modal (Jul-24 spec: explicit Edit → modal, save
// on commit, no casual inline). Client identity fields + the contact roster;
// primary is exclusive; contact delete unassigns job_contacts first (no ON
// DELETE CASCADE — same guard classic uses). ──
function EditClientModal({ client, contacts, onClose, onSaved }: any) {
  const supabase = createClient();
  const [form, setForm] = useState<any>({
    name: client.name || "", client_type: client.client_type || "",
    default_terms: client.default_terms || "", website: client.website || "",
    bill: client.bill_line1 ? billAddr(client) : EMPTY_ADDR,   // parts (mig 200); billing_address text is trigger-built
    legal_name: client.legal_name || "", ein: client.ein || "", invoice_po_required: !!client.invoice_po_required,
    notes: client.notes || "",
    allow_cc: client.allow_cc !== false, allow_ach: client.allow_ach !== false,
  });
  // QB customer link — same /api/qb/link-customer API classic uses; acts
  // immediately (its own deliberate dialog), independent of Save.
  const [qbLinked, setQbLinked] = useState<any | "loading">("loading");
  const [qbChooserOpen, setQbChooserOpen] = useState(false);
  const [qbBusy, setQbBusy] = useState(false);
  const [qbMsg, setQbMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    fetch(`/api/qb/link-customer?clientId=${client.id}`).then(r => r.json())
      .then(d => setQbLinked(d.current ?? null)).catch(() => setQbLinked(null));
    // eslint-disable-next-line
  }, []);
  async function handleQbAction(a: any) {
    if (qbBusy) return;
    setQbBusy(true); setQbMsg(null);
    try {
      const body = a.type === "select" ? { clientId: client.id, qbCustomerId: a.qbCustomerId }
        : a.type === "create_new" ? { clientId: client.id, createNew: true }
        : { clientId: client.id, qbCustomerId: null };
      const res = await fetch("/api/qb/link-customer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "QB operation failed");
      setQbLinked(a.type === "unlink" ? null : (data.current ?? null));
      setQbChooserOpen(false);
      setQbMsg({ ok: true, text: a.type === "unlink" ? "Unlinked — next push re-runs the smart match." : `Linked to "${data.current?.displayName || ""}".` });
    } catch (e: any) { setQbMsg({ ok: false, text: e.message }); }
    finally { setQbBusy(false); }
  }
  const [rows, setRows] = useState<any[]>(contacts.map((c: any) => ({ ...c })));
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [delName, setDelName] = useState("");
  const delRouter = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line
  }, []);
  const inp = { width: "100%", boxSizing: "border-box" as const, padding: "9px 12px", borderRadius: 8, border: `1px solid ${H.line}`, background: H.surface, color: H.text, fontSize: 13, fontFamily: H.font, outline: "none" };
  const lab = { fontSize: 9.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: H.faint, marginBottom: 5, display: "block" };
  const patchRow = (i: number, patch: any) => setRows(r => r.map((x, j) => j === i ? { ...x, ...patch } : x));
  const toggleRoute = (i: number, cat: string) => setRows(r => r.map((x, j) => {
    if (j !== i) return x;
    const cur: string[] = x.doc_routing || [];
    return { ...x, doc_routing: cur.includes(cat) ? cur.filter((c: string) => c !== cat) : [...cur, cat] };
  }));
  const setPrimary = (i: number) => setRows(r => r.map((x, j) => ({ ...x, is_primary: j === i })));
  const removeRow = (i: number) => setRows(r => { const x = r[i]; if (x.id) setRemoved(d => [...d, x.id]); return r.filter((_, j) => j !== i); });

  // Delete client — classic's cascade EXTENDED for the ledger era
  // (movements / shipment_lines / pulls / client_files / history stamps),
  // gated on typing the client's name. Drive folders are trashed first
  // (recoverable 30 days); any FK failure surfaces instead of silently dying.
  async function deleteClient() {
    if (delName.trim() !== (client.name || "").trim()) { setErr("Type the client name exactly to confirm."); return; }
    setBusy(true); setErr(null);
    try {
      const { data: jobsRows } = await supabase.from("jobs").select("id, items(id)").eq("client_id", client.id);
      const jobIds = (jobsRows || []).map((j: any) => j.id);
      const itemIds = (jobsRows || []).flatMap((j: any) => (j.items || []).map((it: any) => it.id));
      for (const jId of jobIds) {
        try { await fetch("/api/files/cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "archive-project", jobId: jId }) }); } catch {}
      }
      const step = async (label: string, q: any) => { const { error } = await q; if (error) throw new Error(`${label}: ${error.message}`); };
      if (itemIds.length) {
        await step("movements", supabase.from("movements").delete().in("item_id", itemIds));
        await step("shipment lines", supabase.from("shipment_lines").delete().in("item_id", itemIds));
        await step("pulled inventory", supabase.from("pulled_inventory").delete().in("item_id", itemIds));
        await step("pull requests", supabase.from("pull_requests").delete().in("item_id", itemIds));
        await step("buy sheet", supabase.from("buy_sheet_lines").delete().in("item_id", itemIds));
        await step("item files", supabase.from("item_files").delete().in("item_id", itemIds));
        await step("assignments", supabase.from("decorator_assignments").delete().in("item_id", itemIds));
        await step("items", supabase.from("items").delete().in("id", itemIds));
      }
      if (jobIds.length) {
        await step("history stamps", (supabase.from("history_sales") as any).update({ opshub_job_id: null }).in("opshub_job_id", jobIds));
        await step("job contacts", supabase.from("job_contacts").delete().in("job_id", jobIds));
        await step("job activity", supabase.from("job_activity").delete().in("job_id", jobIds));
        await step("payments", supabase.from("payment_records").delete().in("job_id", jobIds));
        await step("jobs", supabase.from("jobs").delete().in("id", jobIds));
      }
      await step("client files", supabase.from("client_files").delete().eq("client_id", client.id));
      await step("contacts (unassign)", supabase.from("job_contacts").delete().in("contact_id", (contacts || []).map((c: any) => c.id).filter(Boolean)));
      await step("contacts", supabase.from("contacts").delete().eq("client_id", client.id));
      await step("client", supabase.from("clients").delete().eq("id", client.id));
      delRouter.push("/clients");
    } catch (e: any) { setErr(e.message || "Delete failed — nothing may have been removed."); setBusy(false); }
  }

  async function save() {
    if (!form.name.trim()) { setErr("Name can't be empty."); return; }
    if (form.bill.line1.trim() && addrProblem(form.bill)) { setErr(`Billing address: ${addrProblem(form.bill)}.`); return; }
    setBusy(true); setErr(null);
    try {
      const cPatch = {
        name: form.name.trim(), client_type: form.client_type || null,
        default_terms: form.default_terms || null, website: form.website.trim() || null,
        // billing address = parts; the text copy is built by the DB trigger. Left
        // blank on a never-split address = untouched (keeps the old text). Shipping
        // addresses live in Locations (client_locations).
        ...(form.bill.line1.trim() ? billAddrCols(form.bill) : client.bill_line1 ? { ...billAddrCols(EMPTY_ADDR), billing_address: null } : {}),
        legal_name: form.legal_name.trim() || null, ein: form.ein.trim() || null, invoice_po_required: !!form.invoice_po_required,
        notes: form.notes.trim() || null,
        allow_cc: !!form.allow_cc, allow_ach: !!form.allow_ach,
      };
      const { data: back, error: ce } = await (supabase.from("clients") as any).update(cPatch).eq("id", client.id).select("billing_address").single();
      if (ce) throw new Error(ce.message);
      (cPatch as any).billing_address = back?.billing_address ?? null;   // the trigger-built text, so the page shows it
      for (const id of removed) {
        const jc = await supabase.from("job_contacts").delete().eq("contact_id", id);
        if (jc.error) throw new Error(`Couldn't unassign contact from projects: ${jc.error.message}`);
        const dc = await supabase.from("contacts").delete().eq("id", id);
        if (dc.error) throw new Error(dc.error.message);
      }
      const next: any[] = [];
      for (const r of rows) {
        const body = { name: (r.name || "").trim(), email: (r.email || "").trim() || null, phone: (r.phone || "").trim() || null, role_label: (r.role_label || "").trim() || null, is_primary: !!r.is_primary, doc_routing: (r.doc_routing && r.doc_routing.length) ? r.doc_routing : null };
        if (!body.name) continue;
        if (r.id) {
          const { error } = await (supabase.from("contacts") as any).update(body).eq("id", r.id);
          if (error) throw new Error(error.message);
          next.push({ ...r, ...body });
        } else {
          const { data, error } = await (supabase.from("contacts") as any).insert({ ...body, client_id: client.id }).select("*").single();
          if (error) throw new Error(error.message);
          next.push(data);
        }
      }
      onSaved(cPatch, next);
    } catch (e: any) { setErr(e.message || "Save failed."); setBusy(false); }
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 400, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "clamp(12px,4vh,48px) 16px", overflowY: "auto", fontFamily: H.font }}>
      <div style={{ background: H.card, border: `1px solid ${H.line}`, borderRadius: 16, width: "min(680px, 100%)", padding: "22px 24px", color: H.text }}>
        <div style={{ fontSize: 17, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em", marginBottom: 16 }}>Edit client.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div><span style={lab}>Name</span><input style={inp} value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div><span style={lab}>Type</span>
              <select style={{ ...inp, cursor: "pointer" }} value={form.client_type} onChange={e => setForm((f: any) => ({ ...f, client_type: e.target.value }))}>
                <option value="">—</option>
                {["corporate", "brand", "artist", "tour", "webstore"].map(t => <option key={t} value={t}>{t}</option>)}
              </select></div>
            <div><span style={lab}>Payment terms</span>
              <select style={{ ...inp, cursor: "pointer" }} value={form.default_terms} onChange={e => setForm((f: any) => ({ ...f, default_terms: e.target.value }))}>
                <option value="">—</option>
                {["net_15", "net_30", "deposit_balance", "prepaid"].map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
              </select></div>
            <div><span style={lab}>Website</span><input style={inp} value={form.website} onChange={e => setForm((f: any) => ({ ...f, website: e.target.value }))} /></div>
            <div><span style={lab}>Legal name</span><input style={inp} value={form.legal_name} onChange={e => setForm((f: any) => ({ ...f, legal_name: e.target.value }))} /></div>
            <div><span style={lab}>EIN</span><input style={inp} value={form.ein} onChange={e => setForm((f: any) => ({ ...f, ein: e.target.value }))} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          </div>
          <div><span style={lab}>Billing address</span>
            {client.billing_address && !client.bill_line1 && <div style={{ fontSize: 12, color: H.dim, whiteSpace: "pre-line", borderLeft: `2px solid ${H.amber}`, paddingLeft: 8, marginBottom: 8 }}>On file (needs fixing): {client.billing_address}</div>}
            <AddressFields idPrefix="bill" value={form.bill} onChange={a => setForm((f: any) => ({ ...f, bill: a }))} inp={inp} problem={form.bill.line1 ? addrProblem(form.bill) : undefined} warn={H.amber} />
          </div>
          <div><span style={lab}>Notes</span><textarea style={{ ...inp, minHeight: 64, resize: "vertical", lineHeight: 1.5 }} value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} /></div>

          <div>
            <span style={lab}>Billing</span>
            <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap", padding: "4px 0 2px" }}>
              {/* Sales tax is READ-ONLY here: QuickBooks' customer record is the
                  switch QB taxes from, mirrored by lib/client-tax-sync (Oct 2026 —
                  the old checkbox did nothing and drifted on 15 clients). A
                  verified resale certificate is the only way to change it. */}
              <span style={{ fontSize: 12.5, color: H.text }}>
                Sales tax: <b style={{ color: client.tax_exempt ? H.green : H.text }}>{client.tax_exempt ? "Exempt" : "Taxable"}</b>
                <span style={{ color: H.faint, fontSize: 11 }}>
                  {client.qb_customer_id
                    ? ` · from QuickBooks${client.qb_resale_num ? ` · resale ${client.qb_resale_num}` : ""}`
                    : " · not in QuickBooks yet"}
                </span>
              </span>
              {([["allow_cc", "Card payments"], ["allow_ach", "ACH payments"], ["invoice_po_required", "Invoices need their PO #"]] as [string, string][]).map(([k, l]) => (
                <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: H.text, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!form[k]} onChange={e => setForm((f: any) => ({ ...f, [k]: e.target.checked }))} style={{ accentColor: "#fff", width: 15, height: 15 }} />
                  {l}
                </label>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                <span style={{ fontSize: 11, color: H.faint }}>QuickBooks:</span>
                <span style={{ fontSize: 11.5, fontFamily: H.mono, color: qbLinked && qbLinked !== "loading" ? H.green : H.faint }}>
                  {qbLinked === "loading" ? "…" : qbLinked ? qbLinked.displayName : "not linked"}
                </span>
                <button onClick={() => setQbChooserOpen(true)}
                  style={{ borderRadius: 999, border: `1px solid ${H.line}`, background: "transparent", color: H.dim, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", padding: "5px 11px", cursor: "pointer", fontFamily: H.font }}>
                  {qbLinked && qbLinked !== "loading" ? "Change" : "Link"}
                </button>
              </div>
            </div>
            {qbMsg && <div style={{ fontSize: 11, color: qbMsg.ok ? H.green : H.red, marginTop: 4 }}>{qbMsg.text}</div>}
          </div>

          <div>
            <span style={lab}>Contacts</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rows.map((r, i) => (
                <div key={r.id || "new-" + i} style={{ borderBottom: `1px solid ${H.line}`, paddingBottom: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.4fr 1fr 1fr auto auto", gap: 8, alignItems: "center" }}>
                    <input style={inp} placeholder="Name" value={r.name || ""} onChange={e => patchRow(i, { name: e.target.value })} />
                    <input style={inp} placeholder="Email" value={r.email || ""} onChange={e => patchRow(i, { email: e.target.value })} />
                    <input style={inp} placeholder="Phone" value={r.phone || ""} onChange={e => patchRow(i, { phone: e.target.value })} />
                    <input style={inp} placeholder="Title (display only)" value={r.role_label || ""} onChange={e => patchRow(i, { role_label: e.target.value })} />
                    <button title="Primary contact" onClick={() => setPrimary(i)}
                      style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 13, color: r.is_primary ? PURPLE : H.faint, fontWeight: 900 }}>{r.is_primary ? "★" : "☆"}</button>
                    <button title="Remove contact" onClick={() => removeRow(i)}
                      style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 14, color: H.faint }}>✕</button>
                  </div>
                  {/* Document routing — which emails this contact receives. NO
                      categories = admin, receives everything (zero-config default). */}
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                    {[["approvals", "Approvals"], ["invoices", "Invoices"], ["shipping", "Shipping"]].map(([cat, label]) => {
                      const on = (r.doc_routing || []).includes(cat);
                      return (
                        <button key={cat} onClick={() => toggleRoute(i, cat)}
                          style={{ borderRadius: 999, border: `1px solid ${on ? "#fff" : H.line}`, background: on ? "#fff" : "transparent", color: on ? H.ink : H.faint, fontSize: 9, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", padding: "5px 11px", cursor: "pointer", fontFamily: H.font }}>{label}</button>
                      );
                    })}
                    <span style={{ fontSize: 9.5, color: H.faint, marginLeft: 4 }}>{(r.doc_routing || []).length === 0 ? "none set = receives everything" : "receives only these"}</span>
                  </div>
                </div>
              ))}
              <button onClick={() => setRows(r => [...r, { name: "", email: "", phone: "", role_label: "", is_primary: r.length === 0 }])}
                style={{ alignSelf: "flex-start", borderRadius: 999, border: `1px solid ${H.line}`, background: "transparent", color: H.dim, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", padding: "8px 14px", cursor: "pointer", fontFamily: H.font }}>+ Add contact</button>
            </div>
            {removed.length > 0 && <div style={{ fontSize: 10.5, color: H.amber, marginTop: 6 }}>{removed.length} contact{removed.length === 1 ? "" : "s"} will be removed on save (also unassigned from projects).</div>}
          </div>
        </div>
        {err && <div style={{ color: H.red, fontSize: 12.5, marginTop: 12 }}>{err}</div>}
        {delOpen && (
          <div style={{ marginTop: 14, padding: "12px 14px", border: `1px solid ${H.red}`, borderRadius: 10 }}>
            <div style={{ fontSize: 12, color: H.red, fontWeight: 700, marginBottom: 8 }}>
              This deletes {client.name} with every project, item, shipment record, payment, contact, and document. It cannot be undone. Type the client name to confirm.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={inp} placeholder={client.name} value={delName} onChange={e => setDelName(e.target.value)} />
              <button disabled={busy || delName.trim() !== (client.name || "").trim()} onClick={deleteClient}
                style={{ borderRadius: 999, border: "none", background: H.red, color: "#fff", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", padding: "10px 18px", cursor: "pointer", fontFamily: H.font, opacity: (busy || delName.trim() !== (client.name || "").trim()) ? 0.5 : 1, whiteSpace: "nowrap" }}>
                {busy ? "Deleting…" : "Delete forever"}
              </button>
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button disabled={busy} onClick={save}
            style={{ borderRadius: 999, border: "none", background: "#fff", color: H.ink, fontSize: 12, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", padding: "11px 22px", cursor: "pointer", fontFamily: H.font, opacity: busy ? 0.6 : 1 }}>{busy ? "Saving…" : "Save"}</button>
          <button disabled={busy} onClick={onClose}
            style={{ borderRadius: 999, border: `1px solid ${H.line}`, background: "transparent", color: H.dim, fontSize: 12, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", padding: "11px 22px", cursor: "pointer", fontFamily: H.font }}>Cancel</button>
          <button disabled={busy} onClick={() => { setDelOpen(o => !o); setDelName(""); setErr(null); }}
            style={{ marginLeft: "auto", borderRadius: 999, border: `1px solid ${delOpen ? H.red : H.line}`, background: "transparent", color: delOpen ? H.red : H.faint, fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", padding: "11px 18px", cursor: "pointer", fontFamily: H.font }}>
            {delOpen ? "Keep client" : "Delete client"}
          </button>
        </div>
        <QBCustomerChooser open={qbChooserOpen} mode="link" clientId={client.id} searchedName={form.name || client.name || ""}
          current={qbLinked === "loading" ? undefined : qbLinked} busy={qbBusy} onAction={handleQbAction} onClose={() => setQbChooserOpen(false)} />
      </div>
    </div>
  );
}


// ── The action feed (Jul-24 spec item 2) — the client's active jobs wearing
// the SAME status bars as /projects, ordered action-first: late (red) floats
// above act (our amber move) above wait (client's court). The bar's amber/red
// segments ARE the action items; clicking a segment deep-links, clicking the
// row opens the job. ──
function ActionFeed({ jobs, phaseViews, proofStatus, thumbs, router, secHead }: any) {
  const [raised, setRaised] = useState<string | null>(null);
  const rows = jobs
    .filter((j: any) => !["complete", "cancelled"].includes(j.phase))
    .map((j: any) => ({ job: j, stage: deriveProjectStage(j, phaseViews.get(j.id), j.items || [], j.payment_records || [], proofStatus) }))
    .filter((r: any) => !r.stage.complete);
  const rank = (sig: string) => sig === "late" ? 0 : sig === "act" ? 1 : 2;
  rows.sort((a: any, b: any) => rank(a.stage.signal) - rank(b.stage.signal) || String(a.job.job_number).localeCompare(String(b.job.job_number)));
  if (!rows.length) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      {secHead("The action feed.", "active orders, our moves first — tap a segment to jump in")}
      {rows.map(({ job, stage }: any) => (
        <div key={job.id} onMouseEnter={() => setRaised(job.id)} onMouseLeave={() => setRaised(r => r === job.id ? null : r)}
          onClick={() => router.push(`/jobs/${job.id}`)}
          style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 0", borderBottom: `1px solid ${H.line}`, cursor: "pointer", position: "relative", zIndex: raised === job.id ? 5 : 1 }}>
          <div style={{ width: 190, flexShrink: 0, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span style={{ fontFamily: H.mono, color: H.dim, marginRight: 8 }}>{job.qb_invoice_number ? `#${job.qb_invoice_number}` : job.job_number}</span>
            </div>
            <div style={{ fontSize: 10.5, color: H.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stage.reason || stage.now}</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }} onClick={e => e.stopPropagation()}>
            <JobStatusBar job={job} stage={stage} items={job.items} payments={job.payment_records} navigate />
          </div>
          {/* Items peek — same thumb rail + expanded modal as the /projects strip. */}
          <ItemsPeekRail job={job} stage={stage} thumbs={thumbs || {}} proofStatus={proofStatus} onOpen={() => router.push(`/jobs/${job.id}`)} onPeekChange={o => setRaised(o ? job.id : null)} />
        </div>
      ))}
    </div>
  );
}


// ── Documents — client files (contracts, tax certs, W9s). SAME storage as
// classic: /api/clients/[id]/files → OpsHub Files / Clients / {name} /
// {Tax Documents|W9|MSAs|Other} in Drive + client_files rows, so everything
// uploaded on either page shows on both. ──
// ── Company info & tax (Oct 13 2026) — the client info form's staff side:
// email them their prefilled form (lib/client-info sendInfoRequest), preview
// it, and review resale certificates. Approving one marks the QuickBooks
// customer tax exempt; QB is the tax switch, OpsHub mirrors it.
function InfoTaxBlock({ client, contacts, secHead }: any) {
  const [certs, setCerts] = useState<any[]>([]);
  const [subs, setSubs] = useState<any[]>([]);
  const [arm, setArm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reject, setReject] = useState<{ id: string; note: string } | null>(null);
  // Staff path: turn a tax document already on file into a certificate to approve.
  const [docs, setDocs] = useState<any[]>([]);
  const [addCert, setAddCert] = useState<{ fileId: string; state: string; permit: string; issuedOn: string } | null>(null);
  useEffect(() => { fetch(`/api/clients/${client.id}/files`).then(r => r.json()).then(d => setDocs((d.files || []).filter((f: any) => f.kind === "tax_exempt"))).catch(() => {}); }, [client.id]);
  const saveCert = async () => {
    if (!addCert) return;
    setBusy("addcert"); setMsg(null);
    try {
      const r = await fetch(`/api/clients/${client.id}/tax-certificates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add_from_file", ...addCert }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't add it");
      setAddCert(null); setMsg({ ok: true, t: "Added. Review it below, then Approve." }); load();
    } catch (e: any) { setMsg({ ok: false, t: e.message }); } finally { setBusy(null); }
  };
  const load = () => fetch(`/api/clients/${client.id}/tax-certificates`).then(r => r.json()).then(d => { setCerts(d.certificates || []); setSubs(d.submissions || []); }).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [client.id]);
  // Who gets the form: pick from this client's contacts (pre-checked = their
  // invoice people, the same routing invoices use). Removed contacts hidden.
  const emailable = ((contacts || []) as any[]).filter(x => (x.email || "").includes("@") && !(Array.isArray(x.doc_routing) && x.doc_routing.includes("none")));
  const [pick, setPick] = useState<string[]>([]);
  const send = async () => {
    if (!arm) { setPick(resolveRecipientEmails("invoices", emailable)); setArm(true); setMsg(null); return; }
    if (!pick.length) return;
    setArm(false); setBusy("send");
    try {
      const r = await fetch("/api/clients/info-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientIds: [client.id], to: pick }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Send failed");
      if (d.failed?.length) throw new Error(d.failed[0].error);
      setMsg({ ok: true, t: `Sent to ${(d.results?.[0]?.to || []).join(", ")}` });
    } catch (e: any) { setMsg({ ok: false, t: e.message }); } finally { setBusy(null); }
  };
  const [issuedEdit, setIssuedEdit] = useState<{ id: string; v: string } | null>(null);
  const setIssued = async (certId: string, issuedOn: string | null) => {
    setBusy(certId); setMsg(null);
    try {
      const r = await fetch(`/api/clients/${client.id}/tax-certificates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ certId, action: "set_issued", issuedOn }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't change the date");
      setIssuedEdit(null); setMsg({ ok: true, t: issuedOn ? `Issue date set to ${issuedOn}.` : "Issue date cleared." }); load();
    } catch (e: any) { setMsg({ ok: false, t: e.message }); } finally { setBusy(null); }
  };
  const review = async (certId: string, action: "approve" | "reject", note?: string) => {
    setBusy(certId); setMsg(null);
    try {
      const r = await fetch(`/api/clients/${client.id}/tax-certificates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ certId, action, note }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Review failed");
      setMsg({ ok: true, t: action === "approve" ? d.qb : "Certificate rejected. QuickBooks unchanged." });
      setReject(null); load();
    } catch (e: any) { setMsg({ ok: false, t: e.message }); } finally { setBusy(null); }
  };
  const pill = { borderRadius: 999, border: `1px solid ${H.line}`, background: "transparent", color: H.dim, fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" as const, padding: "7px 12px", cursor: "pointer", fontFamily: H.font, textDecoration: "none" };
  const pending = certs.filter(c => c.status === "pending").length;
  return (
    <div style={{ maxWidth: 560, marginTop: 28 }}>
      {secHead("Company info & tax.", pending ? `${pending} certificate${pending === 1 ? "" : "s"} to review` : "their form, and resale certificates")}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={send} disabled={busy === "send"} style={{ ...pill, color: arm ? H.ink : H.dim, background: arm ? "#fff" : "transparent", borderColor: arm ? "#fff" : H.line }}>
          {busy === "send" ? "Sending…" : arm ? (pick.length ? `Email ${pick.length === 1 ? "this person" : `these ${pick.length}`}` : "Pick who gets it") : "Email them the info form"}
        </button>
        {client.portal_token && <a href={`/portal/client/${client.portal_token}/company`} target="_blank" rel="noreferrer" style={pill}>Preview their form ↗</a>}
        {arm && <button onClick={() => setArm(false)} style={{ ...pill, border: "none" }}>Cancel</button>}
      </div>
      {arm && (
        <div style={{ marginTop: 10, padding: "10px 12px", border: `1px solid ${H.line}`, borderRadius: 10, display: "grid", gap: 6 }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: H.faint }}>Send to</div>
          {emailable.length === 0 && <div style={{ fontSize: 12, color: H.faint }}>No contact has an email yet. Add one in Edit client.</div>}
          {emailable.map((x: any) => {
            const e = String(x.email).trim().toLowerCase(); const on = pick.includes(e);
            return (
              <label key={x.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, color: on ? H.text : H.dim, cursor: "pointer" }}>
                <input type="checkbox" checked={on} onChange={() => setPick(p => on ? p.filter(y => y !== e) : [...p, e])} style={{ accentColor: "#fff" }} />
                {x.name || e} <span style={{ color: H.faint }}>{e}</span>
              </label>
            );
          })}
        </div>
      )}
      {msg && <div style={{ fontSize: 12, marginTop: 10, color: msg.ok ? H.green : H.red }}>{msg.t}</div>}
      <div style={{ fontSize: 12, color: pending ? H.amber : H.faint, marginTop: 12 }}>
        {pending ? `${pending} certificate${pending === 1 ? "" : "s"} waiting for you below.` : "No certificates waiting. Company, contact and address updates apply on their own."}
      </div>
      {docs.length > 0 && (addCert ? (
        <div style={{ marginTop: 10, padding: 12, border: `1px solid ${H.line}`, borderRadius: 10, display: "grid", gap: 8 }}>
          <select value={addCert.fileId} onChange={e => setAddCert({ ...addCert, fileId: e.target.value })} style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${H.line}`, background: H.surface, color: H.text, fontSize: 12.5, fontFamily: H.font }}>
            {docs.map((d: any) => <option key={d.id} value={d.id}>{d.file_name}</option>)}
          </select>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={addCert.state} onChange={e => setAddCert({ ...addCert, state: e.target.value.toUpperCase().slice(0, 5) })} placeholder="State (NV)" style={{ width: 90, padding: "8px 10px", borderRadius: 8, border: `1px solid ${H.line}`, background: H.surface, color: H.text, fontSize: 12.5, fontFamily: H.font }} />
            <input value={addCert.permit} onChange={e => setAddCert({ ...addCert, permit: e.target.value })} placeholder="Permit number" style={{ flex: "1 1 140px", padding: "8px 10px", borderRadius: 8, border: `1px solid ${H.line}`, background: H.surface, color: H.text, fontSize: 12.5, fontFamily: H.mono }} />
            <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: H.faint }}>
              Issue date (optional)
            <input type="date" value={addCert.issuedOn} onChange={e => setAddCert({ ...addCert, issuedOn: e.target.value })} style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${H.line}`, background: H.surface, color: H.text, fontSize: 12.5, fontFamily: H.font }} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={saveCert} disabled={busy === "addcert" || !addCert.state || !addCert.permit} style={{ ...pill, color: H.ink, background: "#fff", borderColor: "#fff", opacity: !addCert.state || !addCert.permit ? 0.5 : 1 }}>{busy === "addcert" ? "Adding…" : "Add for review"}</button>
            <button onClick={() => setAddCert(null)} style={{ ...pill, border: "none" }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAddCert({ fileId: docs[0].id, state: "", permit: "", issuedOn: "" })} style={{ ...pill, marginTop: 10 }}>Confirm a certificate on file</button>
      ))}
      {subs.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint, marginBottom: 4 }}>Their updates (applied automatically)</div>
          {subs.map((s: any) => (
            <details key={s.id} style={{ padding: "8px 0", borderBottom: `1px solid ${H.line}` }}>
              <summary style={{ cursor: "pointer", fontSize: 12.5, color: H.text }}>
                {new Date(s.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" })} · {s.signer_name}{s.signer_title ? `, ${s.signer_title}` : ""}
                <span style={{ color: H.faint }}> · {(s.applied || []).length} change{(s.applied || []).length === 1 ? "" : "s"}</span>
                {(s.applied || []).some((a: string) => /NOT confirmed|no certificate/.test(a)) && <span style={{ color: H.amber, fontWeight: 800, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", marginLeft: 8 }}>Tax not confirmed</span>}
              </summary>
              <div style={{ fontSize: 12, color: H.dim, lineHeight: 1.6, margin: "6px 0 0 12px" }}>{(s.applied || []).map((a: string) => <div key={a}>· {a}</div>)}{!(s.applied || []).length && <div>· Confirmed everything as current</div>}</div>
            </details>
          ))}
        </div>
      )}
      {certs.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {certs.map(c => (
            <div key={c.id} style={{ padding: "11px 0", borderBottom: `1px solid ${H.line}` }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <b style={{ fontSize: 13 }}>{c.state === "MULTI" ? "Multistate" : c.state}</b>
                <span style={{ fontFamily: H.mono, fontSize: 12.5 }}>{c.permit_number}</span>
                {issuedEdit?.id === c.id ? (
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <input type="date" value={issuedEdit?.v || ""} onChange={e => setIssuedEdit({ id: c.id, v: e.target.value })} style={{ padding: "5px 8px", borderRadius: 8, border: `1px solid ${H.line}`, background: H.surface, color: H.text, fontSize: 12, fontFamily: H.font }} />
                    <button onClick={() => setIssued(c.id, issuedEdit?.v || null)} style={{ ...pill, padding: "5px 10px" }}>Save</button>
                    <button onClick={() => setIssued(c.id, null)} style={{ ...pill, padding: "5px 10px" }}>Clear</button>
                    <button onClick={() => setIssuedEdit(null)} style={{ ...pill, border: "none", padding: "5px 6px" }}>Cancel</button>
                  </span>
                ) : c.status === "pending" ? (
                  <span onClick={() => setIssuedEdit({ id: c.id, v: c.issued_on || "" })} title="Click to change the issue date"
                    style={{ fontSize: 11.5, color: H.faint, cursor: "pointer", borderBottom: "1px dotted currentColor" }}>
                    {c.issued_on ? `issued ${c.issued_on}` : "add issue date"}
                  </span>
                ) : c.issued_on && <span style={{ fontSize: 11.5, color: H.faint }}>issued {c.issued_on}</span>}
                <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: c.status === "approved" ? H.green : c.status === "rejected" ? H.red : H.amber }}>{c.status === "pending" ? "To review" : c.status}</span>
              </div>
              <div style={{ fontSize: 11, color: H.faint, marginTop: 3 }}>
                {c.client_info_submissions?.signer_name ? `Signed by ${c.client_info_submissions.signer_name}${c.client_info_submissions.signer_title ? `, ${c.client_info_submissions.signer_title}` : ""}` : ""}
                {c.review_note ? ` · ${c.review_note}` : ""}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                {c.client_files?.drive_file_id && <a href={`/api/files/view/${encodeURIComponent(c.client_files.file_name || "certificate")}?id=${c.client_files.drive_file_id}`} target="_blank" rel="noreferrer" style={pill}>View certificate ↗</a>}
                {c.status === "pending" && (reject?.id === c.id ? (
                  <>
                    <input autoFocus value={reject?.note || ""} onChange={e => setReject({ id: c.id, note: e.target.value })} placeholder="Why? (they won't see this)" style={{ flex: "1 1 180px", padding: "7px 10px", borderRadius: 8, border: `1px solid ${H.line}`, background: H.surface, color: H.text, fontSize: 12, fontFamily: H.font, outline: "none" }} />
                    <button onClick={() => review(c.id, "reject", reject?.note)} disabled={busy === c.id} style={{ ...pill, color: H.red, borderColor: H.red }}>Reject</button>
                    <button onClick={() => setReject(null)} style={{ ...pill, border: "none" }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => review(c.id, "approve")} disabled={busy === c.id} style={{ ...pill, color: H.ink, background: "#fff", borderColor: "#fff" }}>{busy === c.id ? "Updating QuickBooks…" : "Approve · stop charging tax"}</button>
                    <button onClick={() => setReject({ id: c.id, note: "" })} style={pill}>Reject</button>
                  </>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DocsBlock({ clientId, secHead }: any) {
  const [files, setFiles] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [kind, setKind] = useState("tax_exempt");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const load = () => fetch(`/api/clients/${clientId}/files`).then(r => r.json()).then(d => setFiles(d.files || [])).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [clientId]);
  const up = async (f: File) => {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", f); fd.append("kind", kind);
      await fetch(`/api/clients/${clientId}/files`, { method: "POST", body: fd });
      load();
    } finally { setUploading(false); }
  };
  const del = async (id: string) => { await fetch(`/api/clients/${clientId}/files?fileId=${id}`, { method: "DELETE" }); setConfirmId(null); load(); };
  const size = (n: number | null) => !n ? "" : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
  const KINDS: [string, string][] = [["tax_exempt", "Tax Document"], ["w9", "W9"], ["msa", "MSA"], ["other", "Other"]];
  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <div style={{ flex: 1 }}>{secHead("Documents.", "certs, W9s, agreements — on file in Drive")}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", alignSelf: "center" }}>
          <select value={kind} onChange={e => setKind(e.target.value)}
            style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${H.line}`, background: H.surface, color: H.text, fontSize: 11, fontFamily: H.font, outline: "none", cursor: "pointer" }}>
            {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <label style={{ borderRadius: 999, border: `1px solid ${H.line}`, background: "transparent", color: H.dim, fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", padding: "8px 14px", cursor: uploading ? "default" : "pointer", fontFamily: H.font, opacity: uploading ? 0.6 : 1 }}>
            {uploading ? "Uploading…" : "+ Upload"}
            <input type="file" style={{ display: "none" }} disabled={uploading}
              onChange={e => { const f = e.target.files?.[0]; if (f) up(f); e.target.value = ""; }} />
          </label>
        </div>
      </div>
      {files.length === 0 && <div style={{ color: H.faint, fontSize: 12.5 }}>No documents on file.</div>}
      {files.map((f: any) => (
        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${H.line}` }}>
          {/* Through OpsHub, not Drive: client paperwork is private now, so a
              Drive link only opens for whoever owns the file (Sep 19 2026). */}
          <a href={f.drive_file_id ? `/api/files/view/${encodeURIComponent(f.file_name || "document")}?id=${f.drive_file_id}` : (f.drive_link || "#")} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: H.text, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file_name}</a>
          <span style={{ fontSize: 9.5, fontFamily: H.mono, color: H.faint, flexShrink: 0 }}>{size(f.file_size)}</span>
          {confirmId === f.id ? (
            <button onClick={() => del(f.id)} style={{ border: "none", background: H.red, color: "#fff", borderRadius: 999, fontSize: 9.5, fontWeight: 800, padding: "4px 10px", cursor: "pointer", fontFamily: H.font }}>Delete?</button>
          ) : (
            <button onClick={() => setConfirmId(f.id)} style={{ border: "none", background: "transparent", color: H.faint, fontSize: 13, cursor: "pointer", padding: "0 4px" }}>✕</button>
          )}
        </div>
      ))}
    </div>
  );
}

// PipelineRail retired Jul 28 — the Pipeline section renders the shared
// ClientWorkingSheet (moved from classic). Git history holds the old rail.

// ── Catalog: products (the real thing) + produced families (the pre-products era) ──
