"use client";
// THE CLIENT SPACE (Jul 22 2026) — the internal mirror of the client's hub.
// Same spine the client sees (Studio · Drops · Orders · Pipeline · Catalog),
// plus our layers (Archive, Money, contacts, the wire). One mental model on
// both sides of the glass; ours just has more doors.
// The old client page lives at /clients/[id]/classic during the transition
// (reorder machinery, QB link, file manager) and dies when the space wins.
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { H } from "@/components/hub/theme";
import { JOB_DIRECTIVES } from "@/lib/directives";

const PURPLE = "#fd3aa3";
const thumbSrc = (id: string, size = 300) => `/api/files/thumbnail?id=${id}&thumb=1&size=${size}`;
const fmt$ = (n: number) => "$" + Math.round(n).toLocaleString();
const fmtDate = (iso?: string | null) => iso ? new Date(String(iso).includes("T") ? iso : iso + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
const fmtShort = (iso?: string | null) => iso ? new Date(String(iso).includes("T") ? iso : iso + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

const SECTIONS = ["Overview", "Studio", "Drops", "Orders", "Pipeline", "Catalog", "Archive", "Money"] as const;
type Section = typeof SECTIONS[number];

export default function ClientSpacePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [section, setSection] = useState<Section>("Overview");
  const [client, setClient] = useState<any | null>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [releases, setReleases] = useState<any[]>([]);
  const [briefs, setBriefs] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [archive, setArchive] = useState<any[]>([]);
  const [hist, setHist] = useState<{ gross: number; units: number } | null>(null);
  const [wire, setWire] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const id = params.id;
      const [{ data: c }, { data: cts }, { data: js }, { data: rel }, { data: prods }, { data: arc }] = await Promise.all([
        supabase.from("clients").select("*").eq("id", id).single(),
        supabase.from("contacts").select("*").eq("client_id", id).order("name"),
        supabase.from("jobs")
          .select("id, job_number, title, phase, target_ship_date, created_at, quote_approved, type_meta, costing_summary, items(id, name, pipeline_stage, received_at_hpd, forwarded_at, webstore_entered_at, sell_per_unit, product_id, design_id, buy_sheet_lines(qty_ordered)), payment_records(id, amount, status, due_date, invoice_number)")
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
          .select("message, created_at, jobs(job_number)").in("job_id", jobIds)
          .order("created_at", { ascending: false }).limit(14);
        setWire(act || []);
      }
      try {
        const res = await fetch("/api/art-briefs");
        const body = await res.json();
        setBriefs((body.briefs || []).filter((b: any) => b.client_id === id && !b.client_aborted_at));
      } catch {}
      setLoaded(true);
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
    // pre-products era's history — products table rows are the real catalog)
    const fam = new Map<string, { name: string; runs: number; lastJob: any; units: number; price: number | null; productId: string | null }>();
    for (const j of jobs) for (const i of (j.items || [])) {
      const key = (i.name || "").trim().toLowerCase();
      if (!key) continue;
      const units = (i.buy_sheet_lines || []).reduce((s: number, l: any) => s + (Number(l.qty_ordered) || 0), 0);
      const cur = fam.get(key);
      if (cur) { cur.runs++; cur.units += units; }
      else fam.set(key, { name: i.name, runs: 1, lastJob: j, units, price: i.sell_per_unit ?? null, productId: i.product_id || null });
    }
    const families = Array.from(fam.values()).sort((a, b) => b.units - a.units);
    const payments = jobs.flatMap(j => (j.payment_records || []).map((p: any) => ({ ...p, job: j })));
    const outstanding = payments.filter(p => !["paid", "void", "draft"].includes(p.status)).reduce((a, p) => a + (Number(p.amount) || 0), 0);
    return { liveGross, liveUnits, active, done, inFlight, stageOf, families, payments, outstanding };
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
    <div style={{ background: H.ink, minHeight: "100vh", margin: -24, padding: 24, color: H.text, fontFamily: H.font }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .cs-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px 14px}
        @media(min-width:900px){.cs-grid{grid-template-columns:repeat(4,1fr)}}
        .cs-card{background:${H.panel};border:1px solid ${H.line};border-radius:14px;overflow:hidden;cursor:pointer;text-align:left;color:${H.text};font-family:${H.font};padding:0;transition:transform .15s ease,border-color .15s ease;display:block;width:100%;text-decoration:none}
        .cs-card:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.3)}
        .cs-row{display:flex;gap:14px;align-items:baseline;padding:13px 0;border-bottom:1px solid ${H.line};text-decoration:none;color:${H.text};flex-wrap:wrap}
        .cs-row:hover{background:rgba(255,255,255,0.02)}
        @media(prefers-reduced-motion:reduce){.cs-card,.cs-card:hover{transition:none;transform:none}}
      ` }} />
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "26px 0 90px" }}>
        {/* ── Header ── */}
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: H.faint }}>
          Client space · {client.client_type || "client"}{client.default_terms ? ` · ${String(client.default_terms).replace(/_/g, " ")}` : ""}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: "clamp(34px,5vw,64px)", fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.02em", textTransform: "uppercase", margin: "6px 0 8px" }}>{client.name}.</h1>
          <span style={{ display: "inline-flex", gap: 10, alignItems: "baseline" }}>
            {client.portal_token && (
              <a href={`/portal/client/${client.portal_token}`} target="_blank" rel="noreferrer" style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: PURPLE, textDecoration: "none" }}>their hub ↗</a>
            )}
            <a href={`/clients/${params.id}/classic`} style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: H.faint, textDecoration: "none" }}>classic view →</a>
          </span>
        </div>
        <div style={{ fontSize: 12, color: H.dim }}>
          {grants.length ? `hub features: ${grants.join(" + ")}` : "no hub features granted yet"}
        </div>

        {/* ── KPI strip — the whole relationship, archive included ── */}
        <div style={{ display: "flex", gap: "clamp(18px,4vw,44px)", flexWrap: "wrap", borderTop: `1px solid ${H.line}`, borderBottom: `1px solid ${H.line}`, padding: "16px 0", margin: "16px 0 0" }}>
          <div><div style={{ fontSize: "clamp(22px,3vw,32px)", fontWeight: 900, lineHeight: 1 }}>{fmt$((hist?.gross || 0) + model.liveGross)}</div><div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginTop: 5 }}>lifetime gross</div></div>
          <div><div style={{ fontSize: "clamp(22px,3vw,32px)", fontWeight: 900, lineHeight: 1, color: H.blue }}>{Math.round((hist?.units || 0) + model.liveUnits).toLocaleString()}</div><div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: H.faint, marginTop: 5 }}>lifetime units</div></div>
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
                {s}{n > 0 && s !== "Overview" && s !== "Money" ? ` · ${n > 999 ? "999+" : n}` : ""}
              </button>
            );
          })}
        </div>

        {section === "Overview" && <Overview client={client} contacts={contacts} wire={wire} model={model} briefs={briefs} secHead={secHead} />}
        {section === "Studio" && <StudioRail briefs={briefs} secHead={secHead} />}
        {section === "Drops" && <DropsRail releases={releases} secHead={secHead} />}
        {section === "Orders" && <OrdersRail model={model} secHead={secHead} />}
        {section === "Pipeline" && <PipelineRail model={model} secHead={secHead} />}
        {section === "Catalog" && <CatalogRail products={products} briefs={briefs} model={model} router={router} secHead={secHead} />}
        {section === "Archive" && <ArchiveRail archive={archive} briefs={briefs} clientId={params.id} secHead={secHead} />}
        {section === "Money" && <MoneyRail model={model} hist={hist} secHead={secHead} />}
      </div>
    </div>
  );
}

// ── Overview: the room at a glance ──
function Overview({ client, contacts, wire, model, briefs, secHead }: any) {
  const wt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 40 }}>
        <div>
          {secHead("People.", "who picks up when you call")}
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
          {client.notes && (
            <>
              {secHead("Notes.", "the standing context")}
              <div style={{ fontSize: 13, color: H.dim, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{client.notes}</div>
            </>
          )}
        </div>
        <div>
          {secHead("The wire.", "every move in this room, newest first")}
          {wire.length === 0 && <div style={{ color: H.faint, fontSize: 12.5 }}>Quiet so far.</div>}
          {wire.map((w: any, i: number) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "9px 0", borderBottom: `1px solid ${H.line}` }}>
              <span style={{ fontSize: 10, fontFamily: H.mono, color: H.faint, whiteSpace: "nowrap", flexShrink: 0 }}>{wt(w.created_at)}</span>
              <span style={{ fontSize: 12.5, lineHeight: 1.5, minWidth: 0 }}>
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: H.faint, marginRight: 7 }}>{w.jobs?.job_number || ""}</span>
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
            <a key={b.id} className="cs-card" href={`/studio2?open=${b.id}`}>
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
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: b.state === "final_approved" ? H.green : H.amber, marginTop: 4 }}>
                  {b.state === "draft" ? "New idea" : b.state === "final_approved" ? "Greenlit" : b.state === "client_review" ? "With them" : "In motion"}
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
      {secHead("The drops.", "their releases — building, live, and cut")}
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
function OrdersRail({ model, secHead }: any) {
  const row = (j: any) => {
    const units = (j.items || []).reduce((a: number, i: any) => a + (i.buy_sheet_lines || []).reduce((s: number, l: any) => s + (Number(l.qty_ordered) || 0), 0), 0);
    const ref = j.type_meta?.qb_invoice_number ? `#${j.type_meta.qb_invoice_number}` : j.job_number;
    const d = JOB_DIRECTIVES[j.phase];
    return (
      <a key={j.id} className="cs-row" href={`/jobs/${j.id}`}>
        <span style={{ fontSize: 12, fontFamily: H.mono, fontWeight: 700, color: H.blue, minWidth: 74 }}>{ref}</span>
        <span style={{ fontSize: 13.5, fontWeight: 800, textTransform: "uppercase", flex: 1, minWidth: 160 }}>{j.title}</span>
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: ["complete"].includes(j.phase) ? H.green : H.amber }}>{["complete", "cancelled"].includes(j.phase) ? j.phase : (d?.verb || j.phase)}</span>
        <span style={{ fontSize: 11, fontFamily: H.mono, color: H.dim }}>{units ? `${units.toLocaleString()} pcs` : ""}{j.costing_summary?.grossRev ? ` · ${fmt$(j.costing_summary.grossRev)}` : ""}{j.target_ship_date ? ` · ship ${fmtShort(j.target_ship_date)}` : ""}</span>
      </a>
    );
  };
  return (
    <>
      {secHead("Orders in motion.", "verbs first — tap into the job for the full machine")}
      {model.active.length === 0 && <div style={{ color: H.faint, fontSize: 12.5 }}>Nothing in motion.</div>}
      {model.active.map(row)}
      {model.done.length > 0 && (
        <>
          {secHead("The record.", `${model.done.length} completed`)}
          {model.done.slice(0, 15).map(row)}
        </>
      )}
    </>
  );
}

// ── Pipeline: items in flight ──
function PipelineRail({ model, secHead }: any) {
  return (
    <>
      {secHead("The pipeline.", "every unit somewhere between press and shelf")}
      {model.inFlight.length === 0 && <div style={{ color: H.faint, fontSize: 12.5 }}>Nothing on press or in the air.</div>}
      {model.inFlight.map((i: any) => {
        const st = model.stageOf(i);
        return (
          <a key={i.id} className="cs-row" href={`/jobs/${i.job.id}`}>
            <span style={{ fontSize: 13.5, fontWeight: 800, textTransform: "uppercase", flex: 1, minWidth: 160 }}>{i.name}</span>
            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: st.c }}>{st.t}</span>
            <span style={{ fontSize: 11, fontFamily: H.mono, color: H.dim }}>{i.job.type_meta?.qb_invoice_number ? `#${i.job.type_meta.qb_invoice_number}` : i.job.job_number}</span>
          </a>
        );
      })}
    </>
  );
}

// ── Catalog: products (the real thing) + produced families (the pre-products era) ──
function CatalogRail({ products, briefs, model, router, secHead }: any) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const artFor = (p: any) => {
    const b = briefs.find((x: any) => x.id === p.brief_id);
    const t = (b?.thumbs || []).find((x: any) => x.preview_drive_file_id || x.drive_file_id);
    return t ? thumbSrc(t.preview_drive_file_id || t.drive_file_id) : null;
  };
  async function runIt(p: any) {
    setBusy(p.id); setErr(null);
    try {
      const res = await fetch(`/api/products/${p.id}/run`, { method: "POST" });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error || "Couldn't start the run");
      router.push(`/jobs/${b.jobId}`);
    } catch (e: any) { setErr(e.message); setBusy(null); }
  }
  async function flipIt(p: any) {
    setBusy(`flip-${p.id}`); setErr(null);
    try {
      const res = await fetch(`/api/products/${p.id}/flip`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error || "Couldn't open the flip");
      router.push(`/studio2?open=${b.briefId}`);
    } catch (e: any) { setErr(e.message); setBusy(null); }
  }
  return (
    <>
      {secHead("The catalog.", "their products — greenlit designs and everything ever produced")}
      {err && <div style={{ color: H.red, fontSize: 12, fontWeight: 700, marginBottom: 10 }}>{err}</div>}
      {products.length > 0 && (
        <div className="cs-grid" style={{ marginBottom: 30 }}>
          {products.map((p: any) => {
            const src = artFor(p);
            return (
              <div key={p.id} className="cs-card" style={{ cursor: "default" }}>
                {src ? (
                  <div style={{ background: "#fff", aspectRatio: "1" }}>
                    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />
                  </div>
                ) : (
                  <div style={{ aspectRatio: "1", display: "flex", alignItems: "flex-end", padding: 14, background: H.surface }}>
                    <span style={{ fontSize: 14, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.15, color: H.dim }}>{p.title}</span>
                  </div>
                )}
                <div style={{ padding: "10px 13px 13px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.25 }}>{p.title}</div>
                  <div style={{ fontSize: 10, fontFamily: H.mono, color: H.blue, marginTop: 3 }}>
                    {p.format || "product"}{p.retail != null ? ` · $${p.retail} retail` : ""}{p.model && p.model !== "not_sure" ? ` · ${p.model === "preorder" ? "pre-order" : "fixed run"}` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <button onClick={() => runIt(p)} disabled={busy === p.id}
                      style={{ background: "#fff", color: H.ink, border: 0, borderRadius: 999, padding: "8px 14px", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font, opacity: busy === p.id ? 0.5 : 1 }}>
                      {busy === p.id ? "Starting…" : "Run it →"}
                    </button>
                    <button onClick={() => flipIt(p)} disabled={busy === `flip-${p.id}`}
                      style={{ background: "transparent", color: PURPLE, border: `1px solid ${PURPLE}`, borderRadius: 999, padding: "8px 14px", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font, opacity: busy === `flip-${p.id}` ? 0.5 : 1 }}>
                      {busy === `flip-${p.id}` ? "Opening…" : "Flip it"}
                    </button>
                    {p.brief_id && <a href={`/studio2?open=${p.brief_id}`} style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: H.dim, textDecoration: "none", padding: "8px 4px" }}>The idea →</a>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {model.families.length > 0 && (
        <>
          {secHead("Everything produced.", "every item ever run, grouped — repeats counted")}
          {model.families.map((f: any) => (
            <a key={f.name} className="cs-row" href={`/jobs/${f.lastJob.id}`}>
              <span style={{ fontSize: 13.5, fontWeight: 800, textTransform: "uppercase", flex: 1, minWidth: 180 }}>{f.name}</span>
              {f.runs > 1 && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: PURPLE }}>×{f.runs} runs</span>}
              <span style={{ fontSize: 11, fontFamily: H.mono, color: H.dim }}>{f.units.toLocaleString()} pcs{f.price != null ? ` · last at $${f.price}` : ""}</span>
            </a>
          ))}
        </>
      )}
      {products.length === 0 && model.families.length === 0 && (
        <div style={{ color: H.faint, fontSize: 12.5 }}>Empty shelf — the greenlight fork fills it.</div>
      )}
    </>
  );
}

// ── Archive: the indexed pre-OpsHub art, browsable in place ──
function ArchiveRail({ archive, briefs, clientId, secHead }: any) {
  const supabase = createClient();
  const [path, setPath] = useState<string>("");
  const [q, setQ] = useState("");
  const [picker, setPicker] = useState<any | null>(null);   // the file being sent
  const [sent, setSent] = useState<{ briefId: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // "use this" — promotion by pointer: the archive file joins an idea's
  // thread as a reference; nothing in Drive moves or copies
  async function sendToBrief(file: any, briefId: string, briefTitle: string) {
    setBusy(true);
    try {
      const { error } = await supabase.from("art_brief_files").insert({
        brief_id: briefId,
        file_name: file.file_name,
        drive_file_id: file.drive_file_id,
        drive_link: `https://drive.google.com/file/d/${file.drive_file_id}/view`,
        mime_type: file.mime_type || null,
        kind: "reference",
        uploader_role: "hpd",
      } as never);
      if (error) throw new Error(error.message);
      setSent({ briefId, title: briefTitle });
      setPicker(null);
    } catch { /* surface stays quiet; retry is a tap away */ }
    setBusy(false);
  }
  async function sendToNewIdea(file: any) {
    setBusy(true);
    try {
      const title = String(file.file_name || "Archive pull").replace(/\.\w+$/, "").slice(0, 140);
      const { data: brief, error } = await supabase.from("art_briefs").insert({
        client_id: clientId, title, state: "draft", source: "hpd",
        concept: `Pulled from the archive: ${file.folder_path || ""}/${file.file_name}`,
      } as never).select("id").single();
      if (error || !brief) throw new Error(error?.message || "failed");
      await sendToBrief(file, (brief as any).id, title);
    } catch { setBusy(false); }
  }
  const isImg = (r: any) => /image\//.test(r.mime_type || "") || /\.(png|jpe?g|gif|webp)$/i.test(r.file_name || "");
  const needle = q.trim().toLowerCase();
  const hits = needle
    ? archive.filter((r: any) => `${r.file_name || ""} ${r.folder_path || ""}`.toLowerCase().includes(needle)).slice(0, 60)
    : null;
  const here = archive.filter((r: any) => (r.folder_path || "") === path);
  const subfolders = new Map<string, { n: number; thumb: string | null }>();
  for (const r of archive) {
    const p = r.folder_path || "";
    if (path && !p.startsWith(path + "/")) continue;
    if (!path && !p) continue;
    const rest = path ? p.slice(path.length + 1) : p;
    const seg = rest.split("/")[0];
    if (!seg) continue;
    const cur = subfolders.get(seg) || { n: 0, thumb: null };
    cur.n++;
    if (!cur.thumb && isImg(r)) cur.thumb = r.drive_file_id;
    subfolders.set(seg, cur);
  }
  const crumb = path ? path.split("/") : [];
  const fileCard = (r: any) => (
    <a key={r.id} className="cs-card" href={`https://drive.google.com/file/d/${r.drive_file_id}/view`} target="_blank" rel="noreferrer">
      <div style={{ background: "#fff", aspectRatio: "1", position: "relative" }}>
        <img src={thumbSrc(r.drive_file_id)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "contain" }}
          onError={(e: any) => { e.target.style.display = "none"; e.target.parentElement.style.background = "#1e1e1e"; }} />
        <span style={{ position: "absolute", left: 8, bottom: 6, fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#888", background: "rgba(0,0,0,0.55)", borderRadius: 999, padding: "3px 8px" }}>
          {((r.file_name || "").match(/\.(\w+)$/) || [, "file"])[1]}
        </span>
        <button onClick={e => { e.preventDefault(); e.stopPropagation(); setSent(null); setPicker(r); }}
          title="Send to the Studio"
          style={{ position: "absolute", right: 6, top: 6, background: "rgba(0,0,0,0.7)", color: "#fff", border: 0, borderRadius: 999, padding: "6px 11px", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", cursor: "pointer", fontFamily: H.font }}>
          → Studio
        </button>
      </div>
      <div style={{ padding: "8px 11px 11px", fontSize: 10.5, lineHeight: 1.35, wordBreak: "break-word" }}>{r.file_name}</div>
    </a>
  );
  return (
    <>
      {secHead("The archive.", `${archive.length.toLocaleString()} files, indexed in place — nothing moved, everything findable`)}
      {sent && (
        <div style={{ fontSize: 12.5, color: H.green, fontWeight: 700, marginBottom: 14 }}>
          ✓ Sent to "{sent.title}" — <a href={`/studio2?open=${sent.briefId}`} style={{ color: H.green }}>open it in the Studio →</a>
        </div>
      )}
      {picker && (
        <div onClick={() => setPicker(null)} style={{ position: "fixed", inset: 0, zIndex: 220, background: "rgba(0,0,0,0.66)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#161616", border: `1px solid ${H.line}`, borderRadius: 16, width: "100%", maxWidth: 440, padding: 22, maxHeight: "80vh", overflow: "auto" }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint, marginBottom: 4 }}>Send to the Studio</div>
            <div style={{ fontSize: 14, fontWeight: 900, textTransform: "uppercase", marginBottom: 14, wordBreak: "break-word" }}>{picker.file_name}</div>
            <button onClick={() => sendToNewIdea(picker)} disabled={busy}
              style={{ display: "block", width: "100%", textAlign: "left", background: "#fff", color: H.ink, border: 0, borderRadius: 10, padding: "12px 15px", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer", fontFamily: H.font, marginBottom: 14, opacity: busy ? 0.5 : 1 }}>
              + New idea from this file
            </button>
            {briefs.length > 0 && <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: H.faint, marginBottom: 8 }}>or onto an existing idea</div>}
            {briefs.map((b: any) => (
              <button key={b.id} onClick={() => sendToBrief(picker, b.id, b.title || "Untitled idea")} disabled={busy}
                style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", color: H.text, border: `1px solid ${H.line}`, borderRadius: 10, padding: "10px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: H.font, marginBottom: 8, opacity: busy ? 0.5 : 1 }}>
                {b.title || "Untitled idea"}
                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: H.faint, marginLeft: 8 }}>{b.state === "draft" ? "new" : b.state === "final_approved" ? "greenlit" : "in motion"}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {archive.length === 0 && <div style={{ color: H.faint, fontSize: 12.5 }}>No archive indexed for this client yet — one pasted Drive link does it.</div>}
      {archive.length > 0 && (
        <>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the archive…"
            style={{ margin: "0 0 16px", padding: "10px 16px", fontSize: 13, background: H.card, border: `1px solid ${H.line}`, borderRadius: 999, outline: "none", color: H.text, fontFamily: H.font, width: 300, maxWidth: "100%" }} />
          {hits ? (
            <>
              <div style={{ fontSize: 10.5, color: H.faint, marginBottom: 12 }}>{hits.length} hit{hits.length === 1 ? "" : "s"}{hits.length === 60 ? " (first 60)" : ""}</div>
              <div className="cs-grid">{hits.map(fileCard)}</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 11, fontFamily: H.mono, color: H.dim, marginBottom: 14 }}>
                <span style={{ cursor: "pointer", color: path ? H.blue : H.text }} onClick={() => setPath("")}>archive</span>
                {crumb.map((seg, i) => (
                  <span key={i}>
                    {" / "}
                    <span style={{ cursor: "pointer", color: i === crumb.length - 1 ? H.text : H.blue }} onClick={() => setPath(crumb.slice(0, i + 1).join("/"))}>{seg}</span>
                  </span>
                ))}
              </div>
              {subfolders.size > 0 && (
                <div className="cs-grid" style={{ marginBottom: here.length ? 24 : 0 }}>
                  {Array.from(subfolders.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([seg, v]) => (
                    <button key={seg} className="cs-card" onClick={() => setPath(path ? `${path}/${seg}` : seg)} style={{ cursor: "pointer" }}>
                      <div style={{ background: v.thumb ? "#fff" : H.surface, aspectRatio: "1" }}>
                        {v.thumb && <img src={thumbSrc(v.thumb)} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e: any) => { e.target.style.display = "none"; }} />}
                      </div>
                      <div style={{ padding: "9px 12px 12px" }}>
                        <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", lineHeight: 1.25 }}>{seg}</div>
                        <div style={{ fontSize: 9.5, fontFamily: H.mono, color: H.faint, marginTop: 3 }}>{v.n} file{v.n === 1 ? "" : "s"}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {here.length > 0 && <div className="cs-grid">{here.map(fileCard)}</div>}
            </>
          )}
        </>
      )}
    </>
  );
}

// ── Money: internal only ──
function MoneyRail({ model, hist, secHead }: any) {
  const open = model.payments.filter((p: any) => !["paid", "void"].includes(p.status));
  const paid = model.payments.filter((p: any) => p.status === "paid");
  const row = (p: any) => (
    <a key={p.id} className="cs-row" href={`/jobs/${p.job.id}`}>
      <span style={{ fontSize: 12, fontFamily: H.mono, fontWeight: 700, color: H.blue, minWidth: 90 }}>{p.invoice_number ? `#${p.invoice_number}` : p.job.job_number}</span>
      <span style={{ fontSize: 13.5, fontWeight: 800, flex: 1 }}>{fmt$(Number(p.amount) || 0)}</span>
      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: p.status === "paid" ? H.green : ["overdue"].includes(p.status) ? H.red : H.amber }}>{p.status}</span>
      <span style={{ fontSize: 11, fontFamily: H.mono, color: H.dim }}>{p.due_date ? `due ${fmtShort(p.due_date)}` : ""}</span>
    </a>
  );
  return (
    <>
      {secHead("The money.", "internal eyes only — the hub never shows this framing")}
      <div style={{ fontSize: 12.5, color: H.dim, marginBottom: 18 }}>
        Pre-OpsHub era: <strong style={{ color: H.text }}>{fmt$(hist?.gross || 0)}</strong> across {Math.round(hist?.units || 0).toLocaleString()} units · OpsHub era: <strong style={{ color: H.text }}>{fmt$(model.liveGross)}</strong>
      </div>
      {open.length > 0 && (<>{secHead("Open.", "unpaid, unsettled")}{open.map(row)}</>)}
      {paid.length > 0 && (<>{secHead("Settled.", `${paid.length} payments`)}{paid.slice(0, 12).map(row)}</>)}
      {model.payments.length === 0 && <div style={{ color: H.faint, fontSize: 12.5 }}>No payment records yet.</div>}
    </>
  );
}
