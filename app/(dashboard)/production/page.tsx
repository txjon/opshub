"use client";
import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { T, font, mono } from "@/lib/theme";
import { calculateMilestones } from "@/lib/dates";

const STAGES = [
  { id: "in_production", label: "In Production" },
  { id: "shipped", label: "Shipped" },
];

type ProdItem = {
  id: string;
  name: string;
  job_id: string;
  pipeline_stage: string | null;
  blanks_order_number: string | null;
  blanks_order_cost: number | null;
  ship_tracking: string | null;
  pipeline_timestamps: Record<string, string> | null;
  cost_per_unit: number | null;
  sort_order: number;
  blank_vendor: string | null;
  blank_sku: string | null;
  job_title: string;
  job_number: string;
  client_name: string;
  decorator_name: string | null;
  decorator_short_code: string | null;
  decorator_assignment_id: string | null;
  target_ship_date: string | null;
  total_units: number;
  proof_status: "none" | "pending" | "approved";
};

export default function ProductionPage() {
  const supabase = createClient();
  const router = useRouter();
  const [items, setItems] = useState<ProdItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterDecorator, setFilterDecorator] = useState("");
  const [filterStalled, setFilterStalled] = useState(false);
  const [sortState, setSortState] = useState<Record<string, { col: string; dir: "asc"|"desc" }>>({
    in_production: { col: "client", dir: "asc" },
    shipped: { col: "client", dir: "asc" },
  });
  const now = new Date();

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);

    // Get all items from active jobs (not complete/cancelled)
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, title, job_number, target_ship_date, type_meta, phase, clients(name)")
      .in("phase", ["production", "receiving", "fulfillment"]);

    if (!jobs?.length) { setItems([]); setLoading(false); return; }

    const jobIds = jobs.map(j => j.id);
    const jobMap: Record<string, any> = {};
    jobs.forEach(j => { jobMap[j.id] = j; });

    const { data: allItems } = await supabase
      .from("items")
      .select("*, buy_sheet_lines(qty_ordered), decorator_assignments(id, pipeline_stage, decorators(name, short_code))")
      .in("job_id", jobIds)
      .order("sort_order");

    // Get proof status for all items
    const itemIds = (allItems || []).map(it => it.id);
    const { data: files } = itemIds.length > 0
      ? await supabase.from("item_files").select("item_id, stage, approval").in("item_id", itemIds)
      : { data: [] };

    const proofMap: Record<string, "none" | "pending" | "approved"> = {};
    for (const it of (allItems || [])) {
      const proofs = (files || []).filter(f => f.item_id === it.id && f.stage === "proof");
      if (proofs.length === 0) proofMap[it.id] = "none";
      else if (proofs.every(f => f.approval === "approved")) proofMap[it.id] = "approved";
      else proofMap[it.id] = "pending";
    }

    const mapped: ProdItem[] = (allItems || []).map(it => {
      const job = jobMap[it.job_id];
      const assignment = it.decorator_assignments?.[0];
      const totalUnits = (it.buy_sheet_lines || []).reduce((a: number, l: any) => a + (l.qty_ordered || 0), 0);
      return {
        id: it.id,
        name: it.name,
        job_id: it.job_id,
        pipeline_stage: it.pipeline_stage === "shipped" ? "shipped" : "in_production",
        blanks_order_number: it.blanks_order_number,
        blanks_order_cost: it.blanks_order_cost,
        ship_tracking: it.ship_tracking,
        pipeline_timestamps: it.pipeline_timestamps || {},
        cost_per_unit: it.cost_per_unit,
        sort_order: it.sort_order || 0,
        blank_vendor: it.blank_vendor,
        blank_sku: it.blank_sku,
        job_title: job?.title || "",
        job_number: job?.job_number || "",
        client_name: job?.clients?.name || "",
        decorator_name: assignment?.decorators?.name || null,
        decorator_short_code: assignment?.decorators?.short_code || null,
        decorator_assignment_id: assignment?.id || null,
        target_ship_date: (() => {
          if (job?.type_meta?.decorator_ships) return job.type_meta.decorator_ships;
          const ih = job?.type_meta?.in_hands_date || job?.type_meta?.show_date;
          if (ih) return calculateMilestones(ih).decoratorShips;
          return job?.target_ship_date || null;
        })(),
        total_units: totalUnits,
        proof_status: proofMap[it.id] || "none",
      };
    });

    setItems(mapped);
    setLoading(false);
  }

  async function advanceStage(item: ProdItem, newStage: string) {
    const timestamps = { ...(item.pipeline_timestamps || {}), [newStage]: new Date().toISOString() };
    await supabase.from("items").update({ pipeline_stage: newStage, pipeline_timestamps: timestamps }).eq("id", item.id);
    if (item.decorator_assignment_id) {
      await supabase.from("decorator_assignments").update({ pipeline_stage: newStage }).eq("id", item.decorator_assignment_id);
    }
    setItems(prev => prev.map(it => it.id === item.id ? { ...it, pipeline_stage: newStage, pipeline_timestamps: timestamps } : it));
  }

  const decorators = useMemo(() => [...new Set(items.map(it => it.decorator_name).filter(Boolean))].sort(), [items]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return items.filter(it => {
      if (q && !(it.name.toLowerCase().includes(q) || it.client_name.toLowerCase().includes(q) || it.job_title.toLowerCase().includes(q) || (it.decorator_name || "").toLowerCase().includes(q))) return false;
      if (filterDecorator && it.decorator_name !== filterDecorator) return false;
      if (filterStalled) {
        const ts = it.pipeline_timestamps?.[it.pipeline_stage || ""];
        if (!ts) return true;
        const days = Math.floor((Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24));
        return days >= 7;
      }
      return true;
    });
  }, [items, search, filterDecorator, filterStalled]);

  // Stats
  const atDecorator = items.filter(it => it.pipeline_stage === "in_production").length;
  const pendingProofs = items.filter(it => it.proof_status !== "approved").length;
  const stalled = items.filter(it => {
    const ts = it.pipeline_timestamps?.[it.pipeline_stage || ""];
    if (!ts) return false;
    return Math.floor((Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24)) >= 7;
  }).length;
  const shippingThisWeek = items.filter(it => {
    if (!it.target_ship_date) return false;
    const d = new Date(it.target_ship_date);
    const diff = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diff >= 0 && diff <= 7;
  }).length;

  const getDaysInStage = (item: ProdItem) => {
    const ts = item.pipeline_timestamps?.[item.pipeline_stage || ""];
    if (!ts) return null;
    return Math.floor((Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24));
  };

  const getDaysToShip = (item: ProdItem) => {
    if (!item.target_ship_date) return null;
    return Math.ceil((new Date(item.target_ship_date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  };

  const toggleSort = (stageId: string, col: string) => {
    setSortState(prev => {
      const cur = prev[stageId] || { col: "client", dir: "asc" };
      if (cur.col === col) return { ...prev, [stageId]: { col, dir: cur.dir === "asc" ? "desc" : "asc" } };
      return { ...prev, [stageId]: { col, dir: "asc" } };
    });
  };

  const sortItems = (list: ProdItem[], stageId: string) => {
    const { col: sortCol, dir: sortDir } = sortState[stageId] || { col: "client", dir: "asc" };
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      let av: any, bv: any;
      switch (sortCol) {
        case "client": av = a.client_name; bv = b.client_name; break;
        case "project": av = a.job_title; bv = b.job_title; break;
        case "item": av = a.name; bv = b.name; break;
        case "decorator": av = a.decorator_short_code || a.decorator_name || ""; bv = b.decorator_short_code || b.decorator_name || ""; break;
        case "units": return (a.total_units - b.total_units) * dir;
        case "shipdate": return ((getDaysToShip(a) ?? 999) - (getDaysToShip(b) ?? 999)) * dir;
        case "instage": return ((getDaysInStage(a) ?? 0) - (getDaysInStage(b) ?? 0)) * dir;
        default: av = a.client_name; bv = b.client_name;
      }
      return (av || "").localeCompare(bv || "") * dir;
    });
  };

  const proofBadge = (status: string) => {
    if (status === "approved") return { label: "Approved", bg: T.greenDim, color: T.green };
    if (status === "pending") return { label: "Pending", bg: T.amberDim, color: T.amber };
    return { label: "None", bg: T.surface, color: T.faint };
  };

  if (loading) return <div style={{ padding: "2rem", color: T.muted, fontSize: 13, fontFamily: font }}>Loading production...</div>;

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Production</h1>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>{items.length} items across {new Set(items.map(it => it.job_id)).size} active projects</div>
      </div>

      {/* Stats strip */}
      <div style={{ display: "flex", gap: 8 }}>
        {[
          { label: "In production", count: atDecorator, color: T.accent },
          { label: "Stalled 7+ days", count: stalled, color: T.red },
          { label: "Shipping this week", count: shippingThisWeek, color: T.accent },
        ].map(s => (
          <div key={s.label} style={{ flex: 1, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.count > 0 ? s.color : T.faint, fontFamily: mono }}>{s.count}</div>
            <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items, clients, projects..."
          style={{ flex: 1, maxWidth: 320, padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: font, outline: "none" }} />
        <select value={filterDecorator} onChange={e => setFilterDecorator(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: filterDecorator ? T.text : T.muted, fontSize: 12, fontFamily: font, outline: "none" }}>
          <option value="">All decorators</option>
          {decorators.map(d => <option key={d} value={d!}>{d}</option>)}
        </select>
        <button onClick={() => setFilterStalled(!filterStalled)}
          style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${filterStalled ? T.red : T.border}`, background: filterStalled ? T.redDim : T.surface, color: filterStalled ? T.red : T.muted, fontSize: 12, fontFamily: font, fontWeight: 600, cursor: "pointer" }}>
          Stalled only
        </button>
      </div>

      {/* Stage groups */}
      {STAGES.map(stage => {
        const stageItems = sortItems(filtered.filter(it => it.pipeline_stage === stage.id), stage.id);

        if (stageItems.length === 0 && search) return null;

        return (
          <div key={stage.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>{stage.label}</span>
              <span style={{ fontSize: 11, fontFamily: mono, color: T.accent, fontWeight: 600 }}>{stageItems.length}</span>
            </div>

            {stageItems.length === 0 ? (
              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "16px", textAlign: "center", fontSize: 12, color: T.faint }}>
                No items at this stage
              </div>
            ) : (
              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
                {/* Header row */}
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 1.5fr 1fr 70px 70px 70px 90px", padding: "6px 14px", background: T.surface, borderBottom: `1px solid ${T.border}` }}>
                  {[
                    { label: "Client", key: "client" },
                    { label: "Project", key: "project" },
                    { label: "Item", key: "item" },
                    { label: "Decorator", key: "decorator" },
                    { label: "Units", key: "units" },
                    { label: stage.id === "shipped" ? "Tracking" : "Ship date", key: "shipdate" },
                    { label: "In stage", key: "instage" },
                    { label: "", key: "" },
                  ].map(h => {
                    const ss = sortState[stage.id] || { col: "client", dir: "asc" };
                    return (
                      <div key={h.label||"actions"} onClick={() => h.key && toggleSort(stage.id, h.key)}
                        style={{ fontSize: 9, fontWeight: 700, color: ss.col === h.key ? T.accent : T.muted, textTransform: "uppercase", letterSpacing: "0.07em", cursor: h.key ? "pointer" : "default", userSelect: "none" }}>
                        {h.label}{ss.col === h.key ? (ss.dir === "asc" ? " ↑" : " ↓") : ""}
                      </div>
                    );
                  })}
                </div>

                {stageItems.map((item, i) => {
                  const days = getDaysInStage(item);
                  const daysToShip = getDaysToShip(item);
                  const proof = proofBadge(item.proof_status);
                  const stageIdx = STAGES.findIndex(s => s.id === item.pipeline_stage);
                  const nextStage = STAGES[stageIdx + 1];
                  const prevStage = STAGES[stageIdx - 1];

                  return (
                    <div key={item.id} style={{
                      display: "grid", gridTemplateColumns: "1.2fr 1.2fr 1.5fr 1fr 70px 70px 70px 90px",
                      padding: "8px 14px", alignItems: "center",
                      borderBottom: i < stageItems.length - 1 ? `1px solid ${T.border}` : "none",
                    }}>
                      {/* Client */}
                      <div style={{ fontSize: 12, color: T.text }}>{item.client_name}</div>

                      {/* Project */}
                      <div style={{ fontSize: 12, color: T.muted, cursor: "pointer" }} onClick={() => router.push(`/jobs/${item.job_id}`)}>
                        {item.job_title}
                      </div>

                      {/* Item */}
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{item.name}</div>
                        <div style={{ fontSize: 10, color: T.faint }}>{[item.blank_vendor, item.blank_sku].filter(Boolean).join(" · ")}</div>
                      </div>

                      {/* Decorator (short code) */}
                      <div style={{ fontSize: 11, color: item.decorator_short_code || item.decorator_name ? T.accent : T.faint }}>{item.decorator_short_code || item.decorator_name || "—"}</div>

                      {/* Units */}
                      <div style={{ fontSize: 12, fontFamily: mono, fontWeight: 600 }}>{item.total_units.toLocaleString()}</div>

                      {/* Ship date / Tracking */}
                      <div>
                        {stage.id === "in_production" && (
                          daysToShip !== null ? (
                            <span style={{ fontSize: 11, fontFamily: mono, fontWeight: 600, color: daysToShip < 0 ? T.red : daysToShip <= 3 ? T.amber : daysToShip <= 7 ? T.text : T.muted }}>
                              {daysToShip < 0 ? `${Math.abs(daysToShip)}d over` : daysToShip === 0 ? "today" : `${daysToShip}d`}
                            </span>
                          ) : <span style={{ fontSize: 10, color: T.faint }}>—</span>
                        )}
                        {stage.id === "shipped" && (
                          <span style={{ fontSize: 10, fontFamily: mono, color: item.ship_tracking ? T.green : T.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", maxWidth: 70 }}>
                            {item.ship_tracking || "—"}
                          </span>
                        )}
                      </div>

                      {/* Days in stage */}
                      <div style={{ fontSize: 11, fontFamily: mono, fontWeight: 600, color: days === null ? T.faint : days >= 7 ? T.red : days >= 3 ? T.amber : T.muted }}>
                        {days === null ? "—" : `${days}d`}
                      </div>

                      {/* Advance buttons */}
                      <div style={{ display: "flex", gap: 4 }}>
                        {prevStage && (
                          <button onClick={() => advanceStage(item, prevStage.id)}
                            style={{ fontSize: 10, color: T.faint, background: "none", border: `1px solid ${T.border}`, borderRadius: 4, padding: "2px 6px", cursor: "pointer" }}>
                            ←
                          </button>
                        )}
                        {nextStage && (
                          <button onClick={() => advanceStage(item, nextStage.id)}
                            style={{ fontSize: 10, color: "#fff", background: T.accent, border: "none", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontWeight: 600 }}>
                            {nextStage.label} →
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
