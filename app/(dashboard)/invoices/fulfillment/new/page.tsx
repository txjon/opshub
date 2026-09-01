"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { groupLineItems } from "@/lib/shipstation-group";

// ── Sales CSV row shape ───────────────────────────────────────────────────
// ShipStation product-sales export: Store, SKU, Description, Category, QtySold, TotalSales
type ParsedRow = {
  idx: number;
  sku: string;
  description: string;
  qty_sold: number;
  product_sales: number;
  included: boolean;
};

// ── Postage CSV row shape ─────────────────────────────────────────────────
// ShipStation shipment export (flattened by Jon to 13 columns):
// Ship Date, Recipient, Order #, Provider, Service, Package, Items, Zone,
// Shipping Paid, Shipping Cost, Insurance Cost, Weight, Weight Unit
type ParsedPostageRow = {
  idx: number;
  ship_date: string;
  recipient: string;
  order_number: string;
  provider: string;
  service: string;
  package_type: string;
  items_count: number;
  zone: string;
  shipping_paid: number;
  shipping_cost: number;
  insurance_cost: number;
  weight: number;
  weight_unit: string;
  included: boolean;
};

// ── Bulk postage CSV row shape ────────────────────────────────────────────
// ShipStation postage-ACCOUNT ledger export: TransactionTime, Tracking#
// (transaction type, e.g. "Purchase"), Amount, Balance. We only consume
// TransactionTime + Amount — each row is a bulk postage purchase HPD made
// on the client's behalf. Billed as a pure pass-through reimbursement
// (no markup, no per-package fee). Balance + Tracking# are ignored.
type ParsedBulkRow = {
  idx: number;
  transaction_date: string;
  amount: number;
  included: boolean;
};

const fmtD = (n: number) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = (n: number) => Number(n || 0).toLocaleString("en-US");
// ShipStation's ship date frequently carries a time component we don't
// want to display. Strip anything after the first space or T separator.
function dateOnly(raw: string): string {
  if (!raw) return "";
  return raw.trim().split(/[\sT]/)[0];
}
// Bulk ledger TransactionTime looks like "March 27, 2026 11:05 AM" — the
// date itself contains spaces, so dateOnly() can't be used. Strip just the
// trailing clock time, keeping the human-readable date.
function stripTime(raw: string): string {
  if (!raw) return "";
  return raw.replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*([AP]\.?M\.?)?\s*$/i, "").trim();
}

// Unit costs / money inputs are often copy-pasted from Excel — the raw
// string can include currency symbols, thousands commas, whitespace, or
// a stray trailing newline. parseFloat silently returns NaN on any of
// those and real values get dropped. Strip the noise first.
function parseMoney(raw: unknown): number {
  if (raw == null) return 0;
  const cleaned = String(raw).replace(/[\$,\s]/g, "").trim();
  if (!cleaned) return 0;
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

// Tiny CSV parser. Handles quoted fields w/ embedded commas + the BOM
// prefix ShipStation adds. Not RFC 4180-strict but covers these exports.
function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Match header by trying multiple aliases — ShipStation field names drift
// slightly between exports. Returns -1 if nothing matches.
function findCol(header: string[], aliases: string[]): number {
  const h = header.map(s => s.trim().toLowerCase());
  for (const alias of aliases) {
    const i = h.indexOf(alias.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

type Client = { id: string; name: string; hpd_fee_pct: number | null; hpd_per_package_fee: number | null };
type ReportType = "sales" | "postage" | "combined" | "fulfillment";

// Prior invoices per client — powers the scoped picker, the stage-1
// "previously billed" card, and the next-period suggestion (Jon, Aug 31:
// "this is where I'd open the invoices page in another tab").
type PriorReport = {
  id: string;
  client_id: string;
  report_type: ReportType;
  postage_mode: "per_shipment" | "bulk" | null;
  period_label: string | null;
  sales_period_label: string | null;
  postage_period_label: string | null;
  qb_invoice_number: string | null;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
};
const PRIOR_TYPE_LABEL: Record<ReportType, string> = { sales: "Sales", postage: "Postage", combined: "Full Service", fulfillment: "Fulfillment" };

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Given the last invoice's period label, suggest the next billing window in
// the SAME format. Handles the two formats in the wild: "July 2026" and
// "7/1/2026 - 7/31/2026" (zero-padded or not). Anything else → no suggestion.
function nextPeriodSuggestion(label: string | null | undefined): string | null {
  const t = (label || "").trim();
  const monthly = t.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthly) {
    const idx = MONTH_NAMES.findIndex(m => m.toLowerCase() === monthly[1].toLowerCase());
    if (idx < 0) return null;
    const y = Number(monthly[2]) + (idx === 11 ? 1 : 0);
    return `${MONTH_NAMES[(idx + 1) % 12]} ${y}`;
  }
  const range = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*[-–—]\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/);
  if (range) {
    const padded = range[4].length === 2 && range[4][0] === "0";
    // (shared regexes with parsePeriodRange below — keep in sync)
    // Numeric Date construction (local) — never bare-parse a date string.
    const end = new Date(Number(range[6]), Number(range[4]) - 1, Number(range[5]));
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
    const last = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    const p = (n: number) => (padded ? String(n).padStart(2, "0") : String(n));
    const f = (d: Date) => `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`;
    return `${f(start)} - ${f(last)}`;
  }
  return null;
}

// Parse a period label into actual dates so the CSV's ship-date span can be
// checked against it. Same two formats as nextPeriodSuggestion.
function parsePeriodRange(label: string): { start: Date; end: Date } | null {
  const t = (label || "").trim();
  const monthly = t.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthly) {
    const idx = MONTH_NAMES.findIndex(m => m.toLowerCase() === monthly[1].toLowerCase());
    if (idx < 0) return null;
    const y = Number(monthly[2]);
    return { start: new Date(y, idx, 1), end: new Date(y, idx + 1, 0) };
  }
  const range = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*[-–—]\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/);
  if (range) {
    return {
      start: new Date(Number(range[3]), Number(range[1]) - 1, Number(range[2])),
      end: new Date(Number(range[6]), Number(range[4]) - 1, Number(range[5])),
    };
  }
  return null;
}

// "Full Service" combines a Sales report and a Postage report into one
// shipstation_reports row → one PDF, one QB invoice, one email. The
// combined flow keeps both halves' parsing, selection, and pricing UI
// intact — every fix made on the individual flows (rounding policy,
// provider normalization, cost persistence, fulfillment fee, etc.)
// applies here unchanged.

export default function NewShipstationReportPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  // Edit mode — when ?edit=<reportId> is present, the wizard hydrates
  // an existing shipstation_reports row instead of starting from a CSV
  // upload, and the Generate button UPDATEs that row instead of
  // INSERTing a new one.
  const editId = searchParams?.get("edit") || null;
  const [editLoading, setEditLoading] = useState<boolean>(!!editId);
  const [editError, setEditError] = useState<string>("");

  // Postage is the default — it's what nearly every client is billed as;
  // picking a client re-defaults to their last billed type anyway.
  const [reportType, setReportType] = useState<ReportType>("postage");
  const [typeMenu, setTypeMenu] = useState(false);
  // Invoice period for Full Service, derived from the two halves.
  const derivePeriod = (a: string, b: string) => {
    const A = a.trim(), B = b.trim();
    if (A && B) return A === B ? A : `${A} / ${B}`;
    return A || B;
  };
  const [dropHot, setDropHot] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [clientListOpen, setClientListOpen] = useState(false);
  const [dropError, setDropError] = useState("");
  // One dropzone, many exports: sniff each file's header row and route it.
  async function routeCsvFiles(files: FileList | null) {
    if (!files) return;
    setDropError("");
    const picked = Array.from(files); // snapshot before any input reset
    for (const f of picked) {
      try {
        const head = (await f.text()).slice(0, 2000).toLowerCase();
        const isSales = /sku/.test(head) && /(qty ?sold|qtysold)/.test(head);
        const isLedger = /transactiontime|transaction time/.test(head);
        const isShipments = /(ship ?date|recipient|shipping ?paid)/.test(head);
        if (isSales && showSales) onSalesCsvFile(f);
        else if (isLedger && showPostage && isBulkPostage) onBulkCsvFile(f);
        else if (isShipments && showPostage && !isBulkPostage) onPostageCsvFile(f);
        else if (isSales || isLedger || isShipments) setDropError(`${f.name}: that's a ${isSales ? "sales" : isLedger ? "postage-ledger" : "shipments"} CSV — this report type doesn't take one.`);
        else setDropError(`${f.name}: couldn't recognize the columns — export ShipStation's ${showSales ? "sales" : ""}${showSales && showPostage ? " / " : ""}${showPostage ? (isBulkPostage ? "postage ledger" : "shipments") : ""} report.`);
      } catch { setDropError(`${f.name}: couldn't read the file.`); }
    }
  }
  const [stage, setStage] = useState<1 | 2 | 3 | 4>(1);

  // Stage 1 — shared
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState<string>("");
  const selectedClient = clients.find(c => c.id === clientId) || null;
  // Prior invoices, newest-first per client. Scopes the picker to clients
  // who've been billed before (most-recently-billed first) and feeds the
  // "previously billed" card + next-period suggestion.
  const [priorByClient, setPriorByClient] = useState<Record<string, PriorReport[]>>({});
  const [showAllClients, setShowAllClients] = useState(false);
  const pickerClients = useMemo(() => {
    const billed = clients
      .filter(c => priorByClient[c.id]?.length)
      .sort((a, b) => priorByClient[b.id][0].created_at.localeCompare(priorByClient[a.id][0].created_at));
    const base = showAllClients ? clients : billed;
    const needle = clientSearch.trim().toLowerCase();
    return needle ? base.filter(c => c.name.toLowerCase().includes(needle)) : base;
  }, [clients, priorByClient, showAllClients, clientSearch]);
  const [periodLabel, setPeriodLabel] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  });
  // Once the user types a period by hand, picking a client stops
  // auto-filling the suggestion over it.
  const [periodTouched, setPeriodTouched] = useState(false);
  // Per-half period overrides (combined only). Blank → inherit periodLabel.
  // The main periodLabel stays the invoice period (title, QB memo, email).
  const [salesPeriodLabel, setSalesPeriodLabel] = useState<string>("");
  const [postagePeriodLabel, setPostagePeriodLabel] = useState<string>("");
  const [csvError, setCsvError] = useState("");
  const [csvErrorPostage, setCsvErrorPostage] = useState("");

  // Sales-specific
  const [rawRows, setRawRows] = useState<ParsedRow[]>([]);
  const [mergedCount, setMergedCount] = useState(0);
  const [groupCosts, setGroupCosts] = useState<Record<string, string>>({});
  const [savedCosts, setSavedCosts] = useState<Record<string, number>>({});
  const [feePct, setFeePct] = useState<string>("0.20");

  // Postage-specific
  const [rawPostageRows, setRawPostageRows] = useState<ParsedPostageRow[]>([]);
  const [markupPct, setMarkupPct] = useState<string>("0.10");
  // Flat per-package fulfillment fee — separate from the markup. Billed
  // additively as (rate × shipments) and reported on its own KPI tile so
  // it doesn't muddy the client's postage performance numbers.
  const [perPackageFee, setPerPackageFee] = useState<string>("0");

  // Postage source mode. "per_shipment" (default) is the original
  // per-package report. "bulk" handles clients where HPD buys postage in
  // bulk (account top-ups) and bills a pure pass-through reimbursement.
  const [postageMode, setPostageMode] = useState<"per_shipment" | "bulk">("per_shipment");
  const [rawBulkRows, setRawBulkRows] = useState<ParsedBulkRow[]>([]);

  const isCombined = reportType === "combined";
  // Fulfillment-only: client runs their own ShipStation and pays their own
  // postage, so we bill ONLY the per-package fee. It reuses the postage
  // CSV upload + shipment selection (to get the shipment count) but skips
  // the markup and never bills postage. Always per-shipment, never bulk.
  const isFulfillment = reportType === "fulfillment";
  const showSales = reportType === "sales" || isCombined;
  const showPostage = reportType === "postage" || isCombined || isFulfillment;
  // Bulk only matters when there's a billed-postage half. Per-shipment is
  // the postage flavor used by all existing reports; fulfillment is always
  // per-shipment.
  const isBulkPostage = showPostage && postageMode === "bulk" && !isFulfillment;

  // Stage 4
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const client = clients.find(c => c.id === clientId) || null;

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, name, hpd_fee_pct, hpd_per_package_fee")
        .order("name");
      setClients(data || []);
    })();
  }, [editId]);

  // Billing history — one query, grouped per client (newest first via the
  // order). Every report type counts: a client billed for anything here is
  // a fulfillment-billing client.
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("shipstation_reports")
        .select("id, client_id, report_type, postage_mode, period_label, sales_period_label, postage_period_label, qb_invoice_number, sent_at, paid_at, created_at")
        .order("created_at", { ascending: false });
      const by: Record<string, PriorReport[]> = {};
      for (const r of (data || []) as PriorReport[]) (by[r.client_id] ||= []).push(r);
      setPriorByClient(by);
    })();
  }, []);

  // Picking a client: (1) re-default the invoice type to their last billed
  // type (only when nothing's uploaded yet — never clear parsed rows under
  // the user), then (2) pre-fill the next billing window from their last
  // invoice, unless the user already typed a period.
  function pickClient(cid: string) {
    setClientId(cid);
    setClientListOpen(false);
    setClientSearch("");
    let effType = reportType;
    const prior = priorByClient[cid]?.[0];
    const rowsLoaded = rawRows.length > 0 || rawPostageRows.length > 0 || rawBulkRows.length > 0;
    if (!isEditing && prior && prior.report_type !== reportType && !rowsLoaded) {
      onChangeType(prior.report_type);
      effType = prior.report_type;
    }
    if (!isEditing && prior && !rowsLoaded) {
      setPostageMode(prior.postage_mode === "bulk" ? "bulk" : "per_shipment");
    }
    applyPeriodSuggestion(cid, effType);
  }
  function applyPeriodSuggestion(cid: string, effType: ReportType = reportType) {
    if (isEditing || periodTouched) return;
    const prior = priorByClient[cid]?.[0];
    if (!prior) return;
    if (effType === "combined") {
      const ss = nextPeriodSuggestion(prior.sales_period_label || prior.period_label);
      const ps = nextPeriodSuggestion(prior.postage_period_label || prior.period_label);
      if (ss) setSalesPeriodLabel(ss);
      if (ps) setPostagePeriodLabel(ps);
      if (ss || ps) setPeriodLabel(derivePeriod(ss || "", ps || ""));
      return;
    }
    const s = nextPeriodSuggestion(prior.period_label);
    if (s) setPeriodLabel(s);
  }

  // Edit mode hydration — load the existing report and populate state
  // so the user can adjust prices / drop rows / etc. and re-save.
  // Hydrates from saved data:
  //   - clientId, periodLabel, reportType, feePct, markupPct, perPackageFee
  //   - rawRows (sales) reverse-mapped from line_items so groupCosts
  //     pre-fill from per-line unit_cost
  //   - rawPostageRows reverse-mapped from line_items / postage_line_items
  //     using shipping_cost_raw as the parsed shipping_cost so the wizard's
  //     markup math re-applies cleanly without double-counting
  // Lands the user on stage 3 (Pricing) — they can step Back to stage 2
  // to uncheck rows. Stage 1 (CSV upload) is unreachable in edit mode
  // because the source CSV isn't kept after generate.
  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("shipstation_reports")
          .select("*")
          .eq("id", editId)
          .single();
        if (error || !data) throw new Error(error?.message || "Report not found");
        const r = data as any;
        setClientId(r.client_id);
        setPeriodLabel(r.period_label || "");
        setSalesPeriodLabel(r.sales_period_label || "");
        setPostagePeriodLabel(r.postage_period_label || "");
        setReportType((r.report_type || "sales") as ReportType);

        const isPostageOnly = r.report_type === "postage";
        const isCombinedSaved = r.report_type === "combined";
        // Fulfillment hydrates like a per-shipment postage report (shipment
        // rows on line_items) but with no sales side and no markup.
        const isFulfillmentSaved = r.report_type === "fulfillment";
        const savedMode: "per_shipment" | "bulk" = r.postage_mode === "bulk" ? "bulk" : "per_shipment";
        setPostageMode(savedMode);

        // Sales side — sales-only and combined have line_items with
        // {sku, description, qty_sold, product_sales, unit_cost}.
        // Fulfillment has no sales side.
        if (!isPostageOnly && !isFulfillmentSaved) {
          const lines: any[] = r.line_items || [];
          const parsed: ParsedRow[] = lines.map((l, i) => ({
            idx: i,
            sku: l.sku || "",
            description: l.description || "",
            qty_sold: Number(l.qty_sold) || 0,
            product_sales: Number(l.product_sales) || 0,
            included: true,
          }));
          setRawRows(parsed);
          setMergedCount(0);

          // Seed groupCosts from per-line unit_cost. Group key matches
          // groupLineItems' output, so we recompute groups here and
          // pull the unit_cost off the first variant.
          const grouped = groupLineItems(lines.map((l: any, i: number) => ({
            sku: l.sku || "",
            description: l.description || "",
            qty_sold: Number(l.qty_sold) || 0,
            product_sales: Number(l.product_sales) || 0,
            unit_cost: Number(l.unit_cost) || 0,
            idx: i,
          })));
          const seed: Record<string, string> = {};
          for (const g of grouped) {
            const cost = Number(g.unit_cost) || 0;
            seed[g.key] = cost > 0 ? String(cost) : "0";
          }
          setGroupCosts(seed);
        }

        // Postage side — for combined it lives on postage_line_items;
        // for postage-only it's on line_items. Either way we use
        // shipping_cost_raw (the carrier cost before markup) so the
        // wizard's markup math re-applies cleanly when the user
        // tweaks the rate.
        if ((isPostageOnly || isCombinedSaved) && savedMode === "bulk") {
          // Bulk ledger reverse-map. Combined keeps it on
          // postage_line_items; postage-only on line_items.
          const lines: any[] = isCombinedSaved
            ? (r.postage_line_items || [])
            : (r.line_items || []);
          const parsed: ParsedBulkRow[] = lines.map((l, i) => ({
            idx: i,
            transaction_date: l.transaction_date || "",
            amount: Number(l.amount) || 0,
            included: true,
          }));
          setRawBulkRows(parsed);
        } else if (isPostageOnly || isCombinedSaved || isFulfillmentSaved) {
          const lines: any[] = isCombinedSaved
            ? (r.postage_line_items || [])
            : (r.line_items || []);
          const parsed: ParsedPostageRow[] = lines.map((l, i) => ({
            idx: i,
            ship_date: l.ship_date || "",
            recipient: l.recipient || "",
            order_number: l.order_number || "",
            provider: l.provider || "",
            service: l.service || "",
            package_type: l.package_type || "",
            items_count: Number(l.items_count) || 0,
            zone: l.zone || "",
            shipping_paid: Number(l.shipping_paid) || 0,
            // shipping_cost_raw is the carrier's actual cost; saved
            // shipping_cost has the markup baked in. Edit mode wants
            // the raw so re-applying the markup gives the same result
            // (or a different one if the user tweaks it).
            shipping_cost: Number(l.shipping_cost_raw ?? l.shipping_cost) || 0,
            insurance_cost: Number(l.insurance_cost) || 0,
            weight: Number(l.weight) || 0,
            weight_unit: l.weight_unit || "",
            included: true,
          }));
          setRawPostageRows(parsed);
        }

        // Rates. hpd_fee_pct doubles as the sales fee for sales/combined
        // and as the markup for postage-only. postage_markup_pct only
        // exists on combined rows.
        if (isPostageOnly) {
          setMarkupPct(String(Number(r.hpd_fee_pct) || 0));
        } else if (isCombinedSaved) {
          setFeePct(String(Number(r.hpd_fee_pct) || 0));
          setMarkupPct(String(Number(r.postage_markup_pct) || 0));
        } else {
          setFeePct(String(Number(r.hpd_fee_pct) || 0));
        }
        setPerPackageFee(String(Number(r.per_package_fee) || 0));

        // Skip upload + selection — jump straight to Pricing. User can
        // step Back to stage 2 if they want to drop rows.
        setStage(3);
      } catch (e: any) {
        setEditError(e.message || "Failed to load report");
      } finally {
        setEditLoading(false);
      }
    })();
    // editId is the only dep that should re-trigger this; clients,
    // supabase, etc. are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // Pull persisted unit costs + client fee when we know the client. Only
  // applies when the report has a sales side. Postage-only reports skip
  // the SKU costs table; combined reports use it.
  useEffect(() => {
    if (!clientId || !showSales) return;
    (async () => {
      const { data } = await supabase
        .from("shipstation_sku_costs")
        .select("sku, unit_cost")
        .eq("client_id", clientId);
      const map: Record<string, number> = {};
      (data || []).forEach((r: any) => { map[r.sku] = Number(r.unit_cost); });
      setSavedCosts(map);
      const c = clients.find(c => c.id === clientId);
      // hpd_fee_pct on the client doubles as both the sales fee % AND
      // the postage markup for postage-only reports. For combined we
      // want it as the sales fee — the postage markup defaults from
      // hpd_per_package_fee's sibling slot but we don't have a separate
      // markup column on clients yet, so combined reports inherit the
      // last sales fee + last postage markup independently and the user
      // confirms both at stage 3.
      if (c?.hpd_fee_pct != null) setFeePct(String(c.hpd_fee_pct));
    })();
  }, [clientId, clients, showSales]);

  // Pre-fill postage rates from the selected client. Both markup and
  // per-package live on clients so next month auto-populates with the
  // values used last time. For combined reports the markup is the
  // postage markup (NOT the sales fee — those are different rates).
  useEffect(() => {
    if (!clientId || !showPostage) return;
    const c = clients.find(c => c.id === clientId);
    if (!c) return;
    // For postage-only, hpd_fee_pct is the markup. For combined, we
    // still seed markup from hpd_fee_pct but the user will set both
    // rates explicitly at stage 3. (The sales effect above already
    // handled the fee rate for combined.)
    if (reportType === "postage" && c.hpd_fee_pct != null) setMarkupPct(String(c.hpd_fee_pct));
    if (c.hpd_per_package_fee != null) setPerPackageFee(String(c.hpd_per_package_fee));
  }, [clientId, clients, showPostage, reportType]);

  async function parseSalesCsv(text: string) {
    const parsed = parseCsv(text);
    if (parsed.length < 2) throw new Error("CSV looks empty");
    const header = parsed[0];
    const skuIdx = findCol(header, ["sku"]);
    const descIdx = findCol(header, ["description"]);
    const qtyIdx = findCol(header, ["qtysold", "qty sold", "qty"]);
    const salesIdx = findCol(header, ["totalsales", "total sales", "sales"]);
    if (skuIdx < 0 || qtyIdx < 0 || salesIdx < 0) {
      throw new Error("CSV is missing required columns (SKU, QtySold, TotalSales)");
    }
    // Aggregate duplicate SKUs. Blank-SKU rows stay individual (refunds).
    const byKey = new Map<string, ParsedRow>();
    const blankSkuRows: ParsedRow[] = [];
    let merged = 0;
    for (let i = 1; i < parsed.length; i++) {
      const r = parsed[i];
      if (!r || r.every(c => !c || !c.trim())) continue;
      const sku = (r[skuIdx] || "").trim();
      const description = descIdx >= 0 ? (r[descIdx] || "").trim() : "";
      const qty_sold = parseMoney(r[qtyIdx]);
      const product_sales = parseMoney(r[salesIdx]);
      if (!sku) {
        blankSkuRows.push({ idx: 0, sku, description, qty_sold, product_sales, included: true });
        continue;
      }
      const existing = byKey.get(sku);
      if (existing) {
        existing.qty_sold += qty_sold;
        existing.product_sales += product_sales;
        if (description.length > existing.description.length) existing.description = description;
        merged++;
      } else {
        byKey.set(sku, { idx: 0, sku, description, qty_sold, product_sales, included: true });
      }
    }
    const rows: ParsedRow[] = [...byKey.values(), ...blankSkuRows].map((r, idx) => ({ ...r, idx }));
    if (rows.length === 0) throw new Error("No data rows found");
    return { rows, merged };
  }

  // Normalize ShipStation's internal provider names to the clean carrier
  // label we show to clients. Hides the tooling we use from the client-
  // facing invoice and keeps the provider column from wrapping.
  function normalizeProvider(raw: string): string {
    const s = (raw || "").trim();
    if (!s) return "";
    const lower = s.toLowerCase();
    if (lower.startsWith("stamps.com") || lower === "stamps") return "USPS";
    if (lower.startsWith("ups by shipstation") || lower === "ups by ss") return "UPS";
    return s;
  }

  async function parsePostageCsv(text: string) {
    const parsed = parseCsv(text);
    if (parsed.length < 2) throw new Error("CSV looks empty");
    const header = parsed[0];
    const col = {
      ship_date: findCol(header, ["ship date", "shipped date", "date", "ship_date"]),
      recipient: findCol(header, ["recipient", "buyer", "ship to", "customer"]),
      order_number: findCol(header, ["order #", "order number", "order", "order_number"]),
      provider: findCol(header, ["provider", "carrier"]),
      service: findCol(header, ["service", "ship service"]),
      package_type: findCol(header, ["package", "package type"]),
      items_count: findCol(header, ["items", "item count", "items count", "item qty", "qty"]),
      zone: findCol(header, ["zone"]),
      shipping_paid: findCol(header, ["shipping paid", "shipping collected", "paid", "postage paid"]),
      shipping_cost: findCol(header, ["shipping cost", "postage cost", "postage", "cost"]),
      insurance_cost: findCol(header, ["insurance cost", "insurance"]),
      weight: findCol(header, ["weight"]),
      weight_unit: findCol(header, ["weight unit", "unit"]),
    };
    if (col.shipping_cost < 0) {
      throw new Error("CSV is missing a Shipping Cost column");
    }
    const rows: ParsedPostageRow[] = [];
    for (let i = 1; i < parsed.length; i++) {
      const r = parsed[i];
      if (!r || r.every(c => !c || !c.trim())) continue;
      const pick = (idx: number) => idx >= 0 ? (r[idx] || "").trim() : "";
      const row: ParsedPostageRow = {
        idx: rows.length,
        ship_date: pick(col.ship_date),
        recipient: pick(col.recipient),
        order_number: pick(col.order_number),
        provider: normalizeProvider(pick(col.provider)),
        service: pick(col.service),
        package_type: pick(col.package_type),
        items_count: parseMoney(pick(col.items_count)),
        zone: pick(col.zone),
        shipping_paid: parseMoney(pick(col.shipping_paid)),
        shipping_cost: parseMoney(pick(col.shipping_cost)),
        insurance_cost: parseMoney(pick(col.insurance_cost)),
        weight: parseMoney(pick(col.weight)),
        weight_unit: pick(col.weight_unit),
        included: true,
      };
      rows.push(row);
    }
    if (rows.length === 0) throw new Error("No data rows found");
    return { rows };
  }

  // Bulk postage ledger parser. Reads TransactionTime + Amount only; the
  // Balance and transaction-type columns are ignored. Each row is one
  // postage purchase HPD made for the client.
  async function parseBulkPostageCsv(text: string) {
    const parsed = parseCsv(text);
    if (parsed.length < 2) throw new Error("CSV looks empty");
    const header = parsed[0];
    const dateIdx = findCol(header, ["transactiontime", "transaction time", "transaction date", "date"]);
    const amountIdx = findCol(header, ["amount", "purchase amount", "cost"]);
    if (amountIdx < 0) {
      throw new Error("CSV is missing an Amount column");
    }
    const rows: ParsedBulkRow[] = [];
    for (let i = 1; i < parsed.length; i++) {
      const r = parsed[i];
      if (!r || r.every(c => !c || !c.trim())) continue;
      const amount = parseMoney(r[amountIdx]);
      // Skip zero/blank-amount rows — they carry no reimbursable value.
      if (!amount) continue;
      rows.push({
        idx: rows.length,
        transaction_date: dateIdx >= 0 ? stripTime((r[dateIdx] || "").trim()) : "",
        amount,
        included: true,
      });
    }
    if (rows.length === 0) throw new Error("No postage purchases found");
    return { rows };
  }

  // Two handlers so the combined flow can target each CSV independently.
  // Single-type flows still call the right one based on reportType.
  async function onSalesCsvFile(file: File) {
    setCsvError("");
    try {
      const text = await file.text();
      const { rows, merged } = await parseSalesCsv(text);
      setRawRows(rows);
      setMergedCount(merged);
    } catch (e: any) {
      setCsvError(e.message || "Failed to parse CSV");
      setRawRows([]);
      setMergedCount(0);
    }
  }
  async function onPostageCsvFile(file: File) {
    setCsvErrorPostage("");
    try {
      const text = await file.text();
      const { rows } = await parsePostageCsv(text);
      setRawPostageRows(rows);
    } catch (e: any) {
      setCsvErrorPostage(e.message || "Failed to parse CSV");
      setRawPostageRows([]);
    }
  }
  async function onBulkCsvFile(file: File) {
    setCsvErrorPostage("");
    try {
      const text = await file.text();
      const { rows } = await parseBulkPostageCsv(text);
      setRawBulkRows(rows);
    } catch (e: any) {
      setCsvErrorPostage(e.message || "Failed to parse CSV");
      setRawBulkRows([]);
    }
  }

  // Reset row state when the user flips the type toggle after uploading —
  // parsed rows from one type don't cross-apply, so we clear all data
  // and bounce back to stage 1.
  function onChangeType(next: ReportType) {
    setReportType(next);
    setStage(1);
    setCsvError("");
    setCsvErrorPostage("");
    setRawRows([]);
    setRawPostageRows([]);
    setRawBulkRows([]);
    setMergedCount(0);
  }

  // Flipping the postage source mode invalidates whichever postage CSV was
  // parsed (per-shipment rows ≠ bulk ledger rows), so clear both and return
  // to stage 1. Sales rows are untouched (combined keeps its sales half).
  function onChangePostageMode(next: "per_shipment" | "bulk") {
    setPostageMode(next);
    setStage(1);
    setCsvErrorPostage("");
    setRawPostageRows([]);
    setRawBulkRows([]);
  }

  // ── Sales flow derivations ────────────────────────────────────────────────
  const selectedRows = useMemo(() => rawRows.filter(r => r.included), [rawRows]);
  const groups = useMemo(() => {
    const raw = selectedRows.map(r => ({
      sku: r.sku,
      description: r.description,
      qty_sold: r.qty_sold,
      product_sales: r.product_sales,
      unit_cost: 0,
      idx: r.idx,
    }));
    return groupLineItems(raw);
  }, [selectedRows]);
  const costByRowIdx = useMemo(() => {
    const m: Record<number, number> = {};
    for (const g of groups) {
      const cost = parseMoney(groupCosts[g.key]);
      for (const v of g.variants) if (typeof v.idx === "number") m[v.idx] = cost;
    }
    return m;
  }, [groups, groupCosts]);
  const salesTotals = useMemo(() => {
    const feeRate = parseMoney(feePct);
    let qty = 0, sales = 0, cost = 0;
    for (const r of selectedRows) {
      const uc = costByRowIdx[r.idx] || 0;
      qty += r.qty_sold;
      sales += r.product_sales;
      cost += uc * r.qty_sold;
    }
    const net = sales - cost;
    const fee = net * feeRate;
    const profit = net - fee;
    return { qty, sales, cost, net, fee, profit };
  }, [selectedRows, costByRowIdx, feePct]);

  // ── Postage flow derivations ─────────────────────────────────────────────
  // billed/margin track the client's POSTAGE economics only (what they
  // collected from end customers vs what HPD charges for the carrier
  // pass-through). The fulfillment fee is HPD's flat handling charge —
  // separate concept. Tracked alongside but never folded into margin.
  //
  // Rounding policy: every per-line dollar value is rounded to 2 decimals
  // at compute time, and aggregate totals are the SUM of those rounded
  // values. Otherwise SUM() in the exported Excel drifts from what the
  // eye adds up — e.g. cost_raw × 1.1 = 9.295 displays as $9.30 but a
  // SUM of three 9.295s would total $27.885 / displayed $27.89, while
  // the human-readable column adds to $27.90.
  const selectedPostageRows = useMemo(() => rawPostageRows.filter(r => r.included), [rawPostageRows]);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const postageTotals = useMemo(() => {
    const mk = parseMoney(markupPct);
    const perPkg = parseMoney(perPackageFee);
    let shipments = 0, items = 0, paid = 0, cost_raw = 0, cost = 0, insurance = 0, billed = 0;
    for (const r of selectedPostageRows) {
      const lineCost = round2(r.shipping_cost * (1 + mk));
      const lineInsurance = round2(r.insurance_cost);
      const lineBilled = round2(lineCost + lineInsurance);
      shipments += 1;
      items += r.items_count || 0;
      paid += r.shipping_paid;
      cost_raw += r.shipping_cost;
      cost += lineCost;
      insurance += lineInsurance;
      billed += lineBilled;
    }
    const margin = round2(paid - billed);
    const fulfillment = round2(perPkg * shipments);
    // Fulfillment-only invoices bill nothing but the per-package fee.
    // Keep shipment + item counts (they drive the fee and the KPIs) but
    // zero every postage figure so no carrier cost/markup reaches the
    // client's invoice or the totals downstream.
    if (isFulfillment) {
      return { shipments, items, paid: 0, cost_raw: 0, cost: 0, insurance: 0, billed: 0, margin: 0, fulfillment, invoice_total: fulfillment };
    }
    const invoice_total = round2(billed + fulfillment);
    return { shipments, items, paid: round2(paid), cost_raw: round2(cost_raw), cost: round2(cost), insurance: round2(insurance), billed: round2(billed), margin, fulfillment, invoice_total };
  }, [selectedPostageRows, markupPct, perPackageFee, isFulfillment]);

  // ── Bulk postage derivations ─────────────────────────────────────────────
  // Pure pass-through: the billed amount IS the sum of the included
  // purchases. No markup, no per-package fee, no shipping income/margin.
  // billed is set equal to total so every downstream "billed + fulfillment"
  // reader (QB invoice, PDF, portal, list) rolls up the reimbursement.
  const selectedBulkRows = useMemo(() => rawBulkRows.filter(r => r.included), [rawBulkRows]);
  const bulkPostageTotals = useMemo(() => {
    let total = 0;
    for (const r of selectedBulkRows) total += r.amount;
    total = round2(total);
    return {
      purchases: selectedBulkRows.length,
      total,
      billed: total,
      shipments: 0,
      items: 0,
      paid: 0,
      cost_raw: total,
      cost: total,
      insurance: 0,
      margin: 0,
      fulfillment: 0,
      invoice_total: total,
    };
  }, [selectedBulkRows]);

  // ── CSV date span ─────────────────────────────────────────────────────
  // The shipments actually in the file are the truth about what window this
  // invoice covers (Jon, Aug 31: exported Jul+Aug in one file while the
  // period still said July). Offer the month-aligned range as a one-tap fix.
  const csvSpan = useMemo(() => {
    let min: Date | null = null, max: Date | null = null;
    for (const r of rawPostageRows) {
      const t = dateOnly(r.ship_date);
      let d: Date | null = null;
      const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (us) d = new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
      else if (iso) d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      if (!d || isNaN(d.getTime())) continue;
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    }
    if (!min || !max) return null;
    const start = new Date(min.getFullYear(), min.getMonth(), 1);
    const end = new Date(max.getFullYear(), max.getMonth() + 1, 0);
    const p = (n: number) => String(n).padStart(2, "0");
    const f = (d: Date) => `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`;
    const short = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
    return { first: short(min), last: short(max), minD: min, maxD: max, suggested: `${f(start)} - ${f(end)}` };
  }, [rawPostageRows]);

  // ── Per-side selection handlers ───────────────────────────────────────
  // Combined mode renders both tables together, each with its own
  // select-all/clear-all + shift-range click. Independent refs keep the
  // shift-anchor scoped per side so a sales click doesn't extend a
  // postage range across panels.
  const lastClickedSalesIdxRef = useRef<number | null>(null);
  const lastClickedPostageIdxRef = useRef<number | null>(null);

  const toggleSalesRow = useCallback((idx: number, shiftKey: boolean) => {
    setRawRows(rs => {
      const target = rs.find(r => r.idx === idx);
      if (!target) return rs;
      const newState = !target.included;
      if (shiftKey && lastClickedSalesIdxRef.current != null && lastClickedSalesIdxRef.current !== idx) {
        const [from, to] = [lastClickedSalesIdxRef.current, idx].sort((a, b) => a - b);
        return rs.map(r => (r.idx >= from && r.idx <= to) ? { ...r, included: newState } : r);
      }
      return rs.map(r => r.idx === idx ? { ...r, included: newState } : r);
    });
    if (!shiftKey) lastClickedSalesIdxRef.current = idx;
  }, []);
  const togglePostageRow = useCallback((idx: number, shiftKey: boolean) => {
    setRawPostageRows(rs => {
      const target = rs.find(r => r.idx === idx);
      if (!target) return rs;
      const newState = !target.included;
      if (shiftKey && lastClickedPostageIdxRef.current != null && lastClickedPostageIdxRef.current !== idx) {
        const [from, to] = [lastClickedPostageIdxRef.current, idx].sort((a, b) => a - b);
        return rs.map(r => (r.idx >= from && r.idx <= to) ? { ...r, included: newState } : r);
      }
      return rs.map(r => r.idx === idx ? { ...r, included: newState } : r);
    });
    if (!shiftKey) lastClickedPostageIdxRef.current = idx;
  }, []);
  const selectAllSales = useCallback(() => setRawRows(rs => rs.map(r => ({ ...r, included: true }))), []);
  const clearAllSales = useCallback(() => setRawRows(rs => rs.map(r => ({ ...r, included: false }))), []);
  const selectAllPostage = useCallback(() => setRawPostageRows(rs => rs.map(r => ({ ...r, included: true }))), []);
  const clearAllPostage = useCallback(() => setRawPostageRows(rs => rs.map(r => ({ ...r, included: false }))), []);

  // Bulk ledger selection — same shift-range behavior as the other tables,
  // with its own anchor ref so ranges don't bleed across panels.
  const lastClickedBulkIdxRef = useRef<number | null>(null);
  const toggleBulkRow = useCallback((idx: number, shiftKey: boolean) => {
    setRawBulkRows(rs => {
      const target = rs.find(r => r.idx === idx);
      if (!target) return rs;
      const newState = !target.included;
      if (shiftKey && lastClickedBulkIdxRef.current != null && lastClickedBulkIdxRef.current !== idx) {
        const [from, to] = [lastClickedBulkIdxRef.current, idx].sort((a, b) => a - b);
        return rs.map(r => (r.idx >= from && r.idx <= to) ? { ...r, included: newState } : r);
      }
      return rs.map(r => r.idx === idx ? { ...r, included: newState } : r);
    });
    if (!shiftKey) lastClickedBulkIdxRef.current = idx;
  }, []);
  const selectAllBulk = useCallback(() => setRawBulkRows(rs => rs.map(r => ({ ...r, included: true }))), []);
  const clearAllBulk = useCallback(() => setRawBulkRows(rs => rs.map(r => ({ ...r, included: false }))), []);

  // Seed groupCosts from savedCosts when entering stage 3 (any flow with
  // a sales side — sales-only or combined). Postage-only skips this.
  useEffect(() => {
    if (stage !== 3 || !showSales) return;
    setGroupCosts(cur => {
      const next = { ...cur };
      for (const g of groups) {
        if (next[g.key] !== undefined) continue;
        const skuWithSaved = g.variants.map(v => v.sku).find(sku => sku && savedCosts[sku] !== undefined);
        if (skuWithSaved) next[g.key] = String(savedCosts[skuWithSaved]);
      }
      return next;
    });
  }, [stage, groups, savedCosts, showSales]);

  // ── Generate helpers ──
  // Re-used by both single-type (sales/postage) and combined flows.
  // Same upsert + save-back-to-client behavior so combined reports
  // refresh the same per-SKU costs and per-client rates that single
  // reports do — no rate drift between types.

  function buildSalesPayload(feeRate: number) {
    const upsertsMap = new Map<string, any>();
    for (const r of selectedRows) {
      if (!r.sku) continue;
      upsertsMap.set(r.sku, {
        client_id: clientId,
        sku: r.sku,
        description: r.description || null,
        unit_cost: costByRowIdx[r.idx] || 0,
        updated_at: new Date().toISOString(),
      });
    }
    const upserts = Array.from(upsertsMap.values());
    const line_items = selectedRows.map(r => ({
      sku: r.sku,
      description: r.description,
      qty_sold: r.qty_sold,
      product_sales: r.product_sales,
      unit_cost: costByRowIdx[r.idx] || 0,
    }));
    return { upserts, line_items, totals: salesTotals, feeRate };
  }

  function buildPostagePayload(markup: number) {
    // Round each line value to 2 decimals so the saved JSON matches
    // what the totals strip / Excel SUM / QB invoice all roll up to.
    // Without this, raw 9.295 values display as $9.30 but column SUMs
    // drift by pennies.
    const line_items = selectedPostageRows.map(r => {
      const cost_marked = round2(r.shipping_cost * (1 + markup));
      const insurance = round2(r.insurance_cost);
      return {
        ship_date: r.ship_date,
        recipient: r.recipient,
        order_number: r.order_number,
        provider: r.provider,
        service: r.service,
        package_type: r.package_type,
        items_count: r.items_count,
        zone: r.zone,
        shipping_paid: round2(r.shipping_paid),
        shipping_cost_raw: round2(r.shipping_cost),
        shipping_cost: cost_marked,
        insurance_cost: insurance,
        weight: r.weight,
        weight_unit: r.weight_unit,
        billed: round2(cost_marked + insurance),
      };
    });
    return { line_items, totals: postageTotals };
  }

  // Bulk pass-through payload — one line per postage purchase, billed = amount.
  function buildBulkPostagePayload() {
    const line_items = selectedBulkRows.map(r => ({
      transaction_date: r.transaction_date,
      amount: round2(r.amount),
      billed: round2(r.amount),
    }));
    return { line_items, totals: bulkPostageTotals };
  }

  async function generate() {
    setSaving(true);
    setSaveError("");
    try {
      const { data: user } = await supabase.auth.getUser();

      if (reportType === "sales") {
        const feeRate = parseMoney(feePct);
        // 1. Upsert per-SKU unit costs so next month pre-fills.
        const upsertsMap = new Map<string, any>();
        for (const r of selectedRows) {
          if (!r.sku) continue;
          upsertsMap.set(r.sku, {
            client_id: clientId,
            sku: r.sku,
            description: r.description || null,
            unit_cost: costByRowIdx[r.idx] || 0,
            updated_at: new Date().toISOString(),
          });
        }
        const upserts = Array.from(upsertsMap.values());
        if (upserts.length) {
          const { error: upErr } = await (supabase as any)
            .from("shipstation_sku_costs")
            .upsert(upserts, { onConflict: "client_id,sku" });
          if (upErr) throw upErr;
        }

        // 2. Save fee rate back to client if it's changed.
        if (client && (client.hpd_fee_pct == null || Math.abs(client.hpd_fee_pct - feeRate) > 1e-9)) {
          await (supabase as any).from("clients").update({ hpd_fee_pct: feeRate }).eq("id", clientId);
        }

        // 3. Insert or update report.
        const line_items = selectedRows.map(r => ({
          sku: r.sku,
          description: r.description,
          qty_sold: r.qty_sold,
          product_sales: r.product_sales,
          unit_cost: costByRowIdx[r.idx] || 0,
        }));
        // source_rows was a write-only audit copy of the full CSV. Never
        // read anywhere, so we don't persist it — saves a large JSONB
        // write on every report. If we ever build a re-edit flow, put
        // it back.
        if (editId) {
          const { error: updErr } = await (supabase as any)
            .from("shipstation_reports")
            .update({
              report_type: "sales",
              postage_mode: "per_shipment",
              period_label: periodLabel,
              sales_period_label: null,
              postage_period_label: null,
              hpd_fee_pct: feeRate,
              line_items,
              totals: salesTotals,
              // Combined-only fields cleared in case the user changed
              // type from combined back to sales-only.
              postage_line_items: null,
              postage_totals: null,
              postage_markup_pct: null,
              per_package_fee: 0,
            })
            .eq("id", editId);
          if (updErr) throw updErr;
          router.push(`/invoices/fulfillment/${editId}`);
        } else {
          const { data: inserted, error: insErr } = await (supabase as any)
            .from("shipstation_reports")
            .insert({
              client_id: clientId,
              report_type: "sales",
              period_label: periodLabel,
              hpd_fee_pct: feeRate,
              line_items,
              totals: salesTotals,
              created_by: user.user?.id || null,
            })
            .select("id")
            .single();
          if (insErr) throw insErr;
          router.push(`/invoices/fulfillment/${inserted.id}`);
        }
      } else if (reportType === "postage" && isBulkPostage) {
        // Bulk postage-only — pure pass-through reimbursement. Ledger rows
        // live on line_items, totals on totals, like a per-shipment postage
        // report, but with postage_mode='bulk' so every reader renders the
        // ledger instead of the shipment table. No markup / per-package /
        // client-rate save-back (those concepts don't apply to bulk).
        const bulk = buildBulkPostagePayload();
        const payload = {
          report_type: "postage" as const,
          postage_mode: "bulk" as const,
          period_label: periodLabel,
          sales_period_label: null,
          postage_period_label: null,
          hpd_fee_pct: 0,
          per_package_fee: 0,
          line_items: bulk.line_items,
          totals: bulk.totals,
          // Clear combined-only fields in case the user edited down from
          // a combined report.
          postage_line_items: null,
          postage_totals: null,
          postage_markup_pct: null,
        };
        if (editId) {
          const { error: updErr } = await (supabase as any)
            .from("shipstation_reports").update(payload).eq("id", editId);
          if (updErr) throw updErr;
          router.push(`/invoices/fulfillment/${editId}`);
        } else {
          const { data: inserted, error: insErr } = await (supabase as any)
            .from("shipstation_reports")
            .insert({ client_id: clientId, ...payload, created_by: user.user?.id || null })
            .select("id").single();
          if (insErr) throw insErr;
          router.push(`/invoices/fulfillment/${inserted.id}`);
        }
      } else if (reportType === "postage") {
        // Postage insert — reuses hpd_fee_pct column to store markup %.
        // per_package_fee is its own column so it can be queried/edited
        // independently from totals JSONB.
        const markup = parseMoney(markupPct);
        const perPkg = parseMoney(perPackageFee);
        // Round each line value to 2 decimals so the saved JSON matches
        // what the totals strip / Excel SUM / QB invoice all roll up to.
        // Without this, raw 9.295 values display as $9.30 but column
        // SUMs drift by pennies. Mirrors how a human builds the sheet
        // in Excel: ROUND(cost × 1.1, 2) per row, then total off that.
        const line_items = selectedPostageRows.map(r => {
          const cost_marked = round2(r.shipping_cost * (1 + markup));
          const insurance = round2(r.insurance_cost);
          return {
            ship_date: r.ship_date,
            recipient: r.recipient,
            order_number: r.order_number,
            provider: r.provider,
            service: r.service,
            package_type: r.package_type,
            items_count: r.items_count,
            zone: r.zone,
            shipping_paid: round2(r.shipping_paid),
            shipping_cost_raw: round2(r.shipping_cost),
            shipping_cost: cost_marked,
            insurance_cost: insurance,
            weight: r.weight,
            weight_unit: r.weight_unit,
            billed: round2(cost_marked + insurance),
          };
        });

        // Save markup + per-package back to the client so next month
        // pre-fills. Skip the write if values are unchanged to avoid
        // bumping clients.updated_at unnecessarily.
        if (client) {
          const patch: Record<string, number> = {};
          if (client.hpd_fee_pct == null || Math.abs(client.hpd_fee_pct - markup) > 1e-9) {
            patch.hpd_fee_pct = markup;
          }
          if (client.hpd_per_package_fee == null || Math.abs(client.hpd_per_package_fee - perPkg) > 1e-9) {
            patch.hpd_per_package_fee = perPkg;
          }
          if (Object.keys(patch).length > 0) {
            await (supabase as any).from("clients").update(patch).eq("id", clientId);
          }
        }

        if (editId) {
          const { error: updErr } = await (supabase as any)
            .from("shipstation_reports")
            .update({
              report_type: "postage",
              postage_mode: "per_shipment",
              period_label: periodLabel,
              sales_period_label: null,
              postage_period_label: null,
              hpd_fee_pct: markup,
              per_package_fee: perPkg,
              line_items,
              totals: postageTotals,
              // Combined-only fields cleared in case the user changed
              // type from combined back to postage-only.
              postage_line_items: null,
              postage_totals: null,
              postage_markup_pct: null,
            })
            .eq("id", editId);
          if (updErr) throw updErr;
          router.push(`/invoices/fulfillment/${editId}`);
        } else {
          const { data: inserted, error: insErr } = await (supabase as any)
            .from("shipstation_reports")
            .insert({
              client_id: clientId,
              report_type: "postage",
              postage_mode: "per_shipment",
              period_label: periodLabel,
              hpd_fee_pct: markup,
              per_package_fee: perPkg,
              line_items,
              totals: postageTotals,
              created_by: user.user?.id || null,
            })
            .select("id")
            .single();
          if (insErr) throw insErr;
          router.push(`/invoices/fulfillment/${inserted.id}`);
        }
      } else if (reportType === "fulfillment") {
        // Fulfillment-only — client pays their own postage, we bill only
        // the per-package fee. Stored like a per-shipment postage report
        // with every postage figure zeroed; totals.fulfillment is the
        // entire invoice. Reuses the postage shipment rows for the line
        // detail (date / order / recipient / items) but strips cost.
        const perPkg = parseMoney(perPackageFee);
        const line_items = selectedPostageRows.map(r => ({
          ship_date: r.ship_date,
          recipient: r.recipient,
          order_number: r.order_number,
          provider: r.provider,
          service: r.service,
          package_type: r.package_type,
          items_count: r.items_count,
          zone: r.zone,
          shipping_paid: 0,
          shipping_cost_raw: 0,
          shipping_cost: 0,
          insurance_cost: 0,
          weight: r.weight,
          weight_unit: r.weight_unit,
          billed: 0,
        }));

        // Persist the per-package rate to the client so next month
        // pre-fills. Leave hpd_fee_pct (postage markup) untouched —
        // fulfillment never sets it.
        if (client && (client.hpd_per_package_fee == null || Math.abs(client.hpd_per_package_fee - perPkg) > 1e-9)) {
          await (supabase as any).from("clients").update({ hpd_per_package_fee: perPkg }).eq("id", clientId);
        }

        if (editId) {
          const { error: updErr } = await (supabase as any)
            .from("shipstation_reports")
            .update({
              report_type: "fulfillment",
              postage_mode: "per_shipment",
              period_label: periodLabel,
              sales_period_label: null,
              postage_period_label: null,
              hpd_fee_pct: 0,
              per_package_fee: perPkg,
              line_items,
              totals: postageTotals,
              postage_line_items: null,
              postage_totals: null,
              postage_markup_pct: null,
            })
            .eq("id", editId);
          if (updErr) throw updErr;
          router.push(`/invoices/fulfillment/${editId}`);
        } else {
          const { data: inserted, error: insErr } = await (supabase as any)
            .from("shipstation_reports")
            .insert({
              client_id: clientId,
              report_type: "fulfillment",
              postage_mode: "per_shipment",
              period_label: periodLabel,
              hpd_fee_pct: 0,
              per_package_fee: perPkg,
              line_items,
              totals: postageTotals,
              created_by: user.user?.id || null,
            })
            .select("id")
            .single();
          if (insErr) throw insErr;
          router.push(`/invoices/fulfillment/${inserted.id}`);
        }
      } else {
        // Full Service / combined — both halves saved on one row.
        // Sales side → existing line_items / totals / hpd_fee_pct.
        // Postage side → new postage_line_items / postage_totals /
        //                postage_markup_pct + existing per_package_fee.
        // Mirrors single-type generators line-for-line so combined
        // inherits every fix (rounding, dedupe, sku-cost persistence,
        // client-rate save-back).
        const feeRate = parseMoney(feePct);
        // Bulk postage is pure pass-through — markup + per-package don't
        // apply, so both persist as 0 on a bulk combined report.
        const markup = isBulkPostage ? 0 : parseMoney(markupPct);
        const perPkg = isBulkPostage ? 0 : parseMoney(perPackageFee);
        const postageModeToSave = isBulkPostage ? "bulk" : "per_shipment";

        const sales = buildSalesPayload(feeRate);
        const postage = isBulkPostage ? buildBulkPostagePayload() : buildPostagePayload(markup);

        // Persist per-SKU unit costs so next month pre-fills.
        if (sales.upserts.length) {
          const { error: upErr } = await (supabase as any)
            .from("shipstation_sku_costs")
            .upsert(sales.upserts, { onConflict: "client_id,sku" });
          if (upErr) throw upErr;
        }

        // Save fee + markup + per-package back to client. We only
        // persist hpd_fee_pct as the SALES rate for combined (matches
        // sales-only behavior). Postage markup for combined doesn't
        // currently round-trip back to clients — it persists per-report
        // and pre-fills from the last single postage report on the
        // client. (Future: a dedicated clients.hpd_postage_markup_pct
        // column to round-trip both rates independently.)
        if (client) {
          const patch: Record<string, number> = {};
          if (client.hpd_fee_pct == null || Math.abs(client.hpd_fee_pct - feeRate) > 1e-9) {
            patch.hpd_fee_pct = feeRate;
          }
          // Don't overwrite the client's saved per-package fee with 0 on a
          // bulk report — bulk doesn't use it.
          if (!isBulkPostage && (client.hpd_per_package_fee == null || Math.abs(client.hpd_per_package_fee - perPkg) > 1e-9)) {
            patch.hpd_per_package_fee = perPkg;
          }
          if (Object.keys(patch).length > 0) {
            await (supabase as any).from("clients").update(patch).eq("id", clientId);
          }
        }

        if (editId) {
          const { error: updErr } = await (supabase as any)
            .from("shipstation_reports")
            .update({
              report_type: "combined",
              postage_mode: postageModeToSave,
              period_label: periodLabel,
              sales_period_label: salesPeriodLabel.trim() || null,
              postage_period_label: postagePeriodLabel.trim() || null,
              hpd_fee_pct: feeRate,
              postage_markup_pct: markup,
              per_package_fee: perPkg,
              line_items: sales.line_items,
              totals: sales.totals,
              postage_line_items: postage.line_items,
              postage_totals: postage.totals,
            })
            .eq("id", editId);
          if (updErr) throw updErr;
          router.push(`/invoices/fulfillment/${editId}`);
        } else {
          const { data: inserted, error: insErr } = await (supabase as any)
            .from("shipstation_reports")
            .insert({
              client_id: clientId,
              report_type: "combined",
              postage_mode: postageModeToSave,
              period_label: periodLabel,
              sales_period_label: salesPeriodLabel.trim() || null,
              postage_period_label: postagePeriodLabel.trim() || null,
              hpd_fee_pct: feeRate,
              postage_markup_pct: markup,
              per_package_fee: perPkg,
              line_items: sales.line_items,
              totals: sales.totals,
              postage_line_items: postage.line_items,
              postage_totals: postage.totals,
              created_by: user.user?.id || null,
            })
            .select("id")
            .single();
          if (insErr) throw insErr;
          router.push(`/invoices/fulfillment/${inserted.id}`);
        }
      }
    } catch (e: any) {
      setSaveError(e.message || "Generate failed");
      setSaving(false);
    }
  }

  // ── UI ──────────────────────────────────────────────────────────────────────
  const card: React.CSSProperties = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px" };
  const input: React.CSSProperties = { padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, outline: "none", fontFamily: font, boxSizing: "border-box" };
  const btnPrimary: React.CSSProperties = { background: T.accent, color: "#0a0a0a", border: "none", borderRadius: 7, padding: "11px 28px", fontSize: 13.5, fontFamily: font, fontWeight: 700, cursor: "pointer" };
  const btnGhost: React.CSSProperties = { background: T.surface, color: T.muted, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 14px", fontSize: 12, fontFamily: font, fontWeight: 600, cursor: "pointer" };
  const thStyle: React.CSSProperties = { padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${T.border}` };
  const tdStyle: React.CSSProperties = { padding: "6px 10px", fontSize: 12, borderBottom: `1px solid ${T.border}`, fontFamily: mono };

  // Slim centered step line — a 4-step wizard needs orientation and jump-
  // back, not four full-width pill bars (Jon, Aug 31). Completed steps click
  // to jump back; forward nav stays gated by the Next buttons. Stage 1 stays
  // locked in edit mode because the source CSV isn't kept after generate.
  const stagePill = (n: number, label: string, active: boolean, done: boolean) => {
    const canJump = n < stage && !(isEditing && n === 1);
    return (
      <span key={n} style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {n > 1 && <span style={{ width: 30, height: 1, background: T.border }} />}
        <span
          onClick={canJump ? () => setStage(n as 1 | 2 | 3 | 4) : undefined}
          title={canJump ? `Back to ${label}` : undefined}
          style={{ display: "flex", alignItems: "center", gap: 7, cursor: canJump ? "pointer" : "default" }}
        >
          <span style={{ width: 20, height: 20, borderRadius: 10, background: active ? T.accent : done ? T.green : "transparent", border: `1px solid ${active ? T.accent : done ? T.green : T.border}`, color: active ? "#0a0a0a" : done ? "#0a0e1a" : T.faint, fontSize: 10.5, fontWeight: 700, display: "grid", placeItems: "center", fontFamily: mono }}>
            {done ? "✓" : n}
          </span>
          <span style={{ fontSize: 12, fontWeight: active ? 800 : 600, color: active ? T.text : done ? T.muted : T.faint }}>{label}</span>
        </span>
      </span>
    );
  };

  const isPostage = reportType === "postage";
  const isSales = reportType === "sales";
  const salesLoaded = rawRows.length;
  const salesSelectedCount = selectedRows.length;
  // Postage "loaded / selected / priced" resolve to either the per-shipment
  // rows or the bulk ledger, depending on the active mode — so the gates,
  // counters, and Next buttons work the same for both flavors.
  const postageLoaded = isBulkPostage ? rawBulkRows.length : rawPostageRows.length;
  const postageSelectedCount = isBulkPostage ? selectedBulkRows.length : selectedPostageRows.length;
  // canNextFrom* gates per type. Combined requires both halves at every
  // stage — empty CSVs / zero rows / missing prices on either side
  // block the Next button.
  // Fulfillment reuses the postage CSV + shipment selection, so stages 1-2
  // gate exactly like a per-shipment postage report.
  const canNextFrom1 =
    !!clientId && !!periodLabel.trim() &&
    (isCombined
      ? salesLoaded > 0 && postageLoaded > 0 && !csvError && !csvErrorPostage
      : (isPostage || isFulfillment)
        ? postageLoaded > 0 && !csvErrorPostage
        : salesLoaded > 0 && !csvError);
  const canNextFrom2 = isCombined
    ? salesSelectedCount > 0 && postageSelectedCount > 0
    : (isPostage || isFulfillment)
      ? postageSelectedCount > 0
      : salesSelectedCount > 0;
  // A blank cost means the product is free ($0) — that's valid, not missing.
  // (The cost input even normalizes a typed 0 back to blank on blur, so
  // requiring a non-empty value here made free items impossible to advance.)
  // The only requirement is that there's at least one product to price.
  const salesPricingComplete = groups.length > 0;
  // Bulk postage has no pricing inputs (pure pass-through) → always complete.
  const postagePricingComplete = isBulkPostage ? true : parseMoney(markupPct) >= 0;
  const canNextFrom3 = isCombined
    ? salesPricingComplete && postagePricingComplete
    : isFulfillment
      ? parseMoney(perPackageFee) >= 0 // only input is the per-package fee
      : isPostage
        ? postagePricingComplete
        : salesPricingComplete;
  const typeLabel = isCombined ? "Full Service" : isFulfillment ? "Fulfillment" : isPostage ? "Postage" : "Sales";
  const isEditing = !!editId;
  const generateBtnLabel = saving
    ? (isEditing ? "Saving..." : "Generating...")
    : (isEditing ? "Save Changes" : "Generate Invoice");

  return (
    <div style={{ fontFamily: font, color: T.text, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <div style={{ width: "100%", maxWidth: 1040 }}>
        <div style={{ fontSize: 11, color: T.muted, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          <a href="/invoices?stream=fulfillment" style={{ color: T.muted, textDecoration: "none" }}>← Invoices</a> · Fulfillment
        </div>
      </div>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 25, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
          {isEditing ? `Edit ${typeLabel} Invoice` : `New ${typeLabel} Invoice`}
        </h1>
        {isEditing && (
          <div style={{ fontSize: 11, color: T.muted, marginTop: 6, maxWidth: "62ch" }}>
            Adjust pricing, drop rows, or update the period. Changes save back to this invoice — then use Update QB Invoice on the invoice page to push them to QuickBooks.
          </div>
        )}
      </div>

      {editLoading && (
        <div style={{ ...card, color: T.muted, fontSize: 13 }}>Loading report…</div>
      )}
      {editError && (
        <div style={{ ...card, color: T.red, fontSize: 13 }}>{editError}</div>
      )}

      {/* The step line — the wizard's spine, centered under the title. */}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "2px 0 6px" }}>
        {stagePill(1, isEditing ? "Upload (skipped)" : "Upload", stage === 1, stage > 1)}
        {stagePill(2, isCombined ? "Select rows" : (isPostage || isFulfillment) ? "Select shipments" : "Select rows", stage === 2, stage > 2)}
        {stagePill(3, isCombined ? "Pricing" : isFulfillment ? "Fulfillment fee" : isPostage ? "Markup %" : "Unit costs", stage === 3, stage > 3)}
        {stagePill(4, isEditing ? "Review + save" : "Review + generate", stage === 4, false)}
      </div>

      {/* ── Stage 1 — Upload ── */}
      {stage === 1 && (
        <div style={{ ...card, display: "flex", flexDirection: "column", gap: 16, width: "100%", maxWidth: isCombined ? 880 : 760, padding: "20px 22px" }}>
          <div style={{ display: "grid", gridTemplateColumns: isCombined ? "1.2fr 1fr 1fr" : "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, display: "block" }}>Client</label>
              <div style={{ position: "relative" }}>
                <input
                  value={clientListOpen ? clientSearch : (selectedClient?.name || "")}
                  onChange={e => { setClientSearch(e.target.value); setClientListOpen(true); }}
                  onFocus={e => { setClientSearch(""); setClientListOpen(true); e.target.select(); }}
                  onBlur={() => setTimeout(() => setClientListOpen(false), 150)}
                  placeholder="Search clients…"
                  autoComplete="off"
                  style={{ ...input, width: "100%" }}
                />
                {clientListOpen && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, maxHeight: 300, overflowY: "auto", zIndex: 30, boxShadow: "0 8px 24px rgba(0,0,0,0.45)" }}>
                    {pickerClients.length === 0 && (
                      <div style={{ padding: "10px 12px", fontSize: 12, color: T.faint }}>
                        {showAllClients ? `No clients match "${clientSearch}"` : clientSearch.trim() ? `No billed clients match "${clientSearch}" — show all below.` : "No fulfillment invoices yet — show all clients below."}
                      </div>
                    )}
                    {pickerClients.map(c => {
                      const last = priorByClient[c.id]?.[0];
                      return (
                        <div key={c.id}
                          onMouseDown={() => pickClient(c.id)}
                          style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "8px 12px", fontSize: 13, color: c.id === clientId ? T.accent : T.text, cursor: "pointer", fontWeight: c.id === clientId ? 700 : 400 }}
                          onMouseEnter={e => (e.currentTarget.style.background = T.surface)}
                          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                          {last && <span style={{ marginLeft: "auto", fontSize: 10.5, color: T.faint, fontFamily: mono, whiteSpace: "nowrap" }}>{last.period_label || "billed"}</span>}
                        </div>
                      );
                    })}
                    {!showAllClients && (
                      <div
                        onMouseDown={e => { e.preventDefault(); setShowAllClients(true); }}
                        style={{ padding: "9px 12px", fontSize: 11.5, fontWeight: 700, color: T.muted, cursor: "pointer", borderTop: `1px solid ${T.border}` }}
                        onMouseEnter={e => (e.currentTarget.style.background = T.surface)}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        Show all clients → <span style={{ fontWeight: 400, color: T.faint }}>(first invoice for a new client)</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            {isCombined ? (
              /* Full Service: sales + postage can run on different timelines,
                 so each half gets its own period; the invoice period derives
                 from the pair (same -> one label, different -> "a / b"). */
              <>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, display: "block" }}>Sales period</label>
                  <input value={salesPeriodLabel} onChange={e => { setPeriodTouched(true); setSalesPeriodLabel(e.target.value); setPeriodLabel(derivePeriod(e.target.value, postagePeriodLabel)); }} placeholder="e.g. April 2026" style={input} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, display: "block" }}>Postage period</label>
                  <input value={postagePeriodLabel} onChange={e => { setPeriodTouched(true); setPostagePeriodLabel(e.target.value); setPeriodLabel(derivePeriod(salesPeriodLabel, e.target.value)); }} placeholder="e.g. April 2026" style={input} />
                </div>
              </>
            ) : (
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, display: "block" }}>Period</label>
                <input value={periodLabel} onChange={e => { setPeriodTouched(true); setPeriodLabel(e.target.value); }} placeholder="e.g. April 2026" style={input} />
              </div>
            )}
          </div>
          {/* Invoice type + postage source — stage-1 decisions, so they live
              IN the stage-1 card (flipping either resets parsed rows; see
              onChangeType). Hidden in edit mode: the saved report fixes both. */}
          {!isEditing && (
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, display: "block" }}>Invoice type</label>
                {(() => {
                  // Postage + Full Service are the two real scenarios (every
                  // invoice ever billed is one of them). Fulfillment-only
                  // (client pays their own postage — bills just the per-package
                  // fee) and Sales-only live behind ⋯ until the fulfillment-only
                  // offering has a signed client. A rare type stays visible
                  // while selected.
                  const primary = [
                    { value: "postage", label: "Postage" },
                    { value: "combined", label: "Full Service" },
                  ] as const;
                  const rare = [
                    { value: "fulfillment", label: "Fulfillment only" },
                    { value: "sales", label: "Sales only" },
                  ] as const;
                  const btn = (t: { value: ReportType; label: string }) => (
                    <button key={t.value} onClick={() => { onChangeType(t.value); setTypeMenu(false); }}
                      style={{
                        background: reportType === t.value ? T.accent : "transparent",
                        color: reportType === t.value ? "#0a0a0a" : T.muted,
                        border: "none", borderRadius: 6,
                        padding: "6px 18px", fontSize: 12, fontWeight: 700,
                        fontFamily: font, cursor: "pointer",
                      }}>{t.label}</button>
                  );
                  return (
                    <div style={{ display: "flex", gap: 6, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 4, width: "fit-content", position: "relative", alignItems: "center" }}>
                      {primary.map(t => btn(t as any))}
                      {rare.filter(t => reportType === t.value).map(t => btn(t as any))}
                      <button onClick={() => setTypeMenu(v => !v)} aria-label="More report types"
                        style={{ background: "transparent", border: "none", color: T.muted, fontSize: 15, fontWeight: 700, padding: "4px 10px", cursor: "pointer", fontFamily: font }}>⋯</button>
                      {typeMenu && (
                        <div style={{ position: "absolute", left: 0, top: "100%", marginTop: 6, zIndex: 30, background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 6, minWidth: 170, boxShadow: "0 8px 30px rgba(0,0,0,0.45)", display: "flex", flexDirection: "column" }}>
                          {rare.map(t => (
                            <button key={t.value} onClick={() => { onChangeType(t.value as ReportType); setTypeMenu(false); }}
                              style={{ textAlign: "left", background: "none", border: "none", color: reportType === t.value ? T.text : T.muted, fontSize: 12.5, fontWeight: 700, padding: "8px 12px", cursor: "pointer", borderRadius: 6, fontFamily: font }}>
                              {t.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
              {showPostage && !isFulfillment && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, display: "block" }}>Postage source</label>
                  <div style={{ display: "flex", gap: 6, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 4, width: "fit-content" }}>
                    {([
                      { value: "per_shipment", label: "Per-shipment" },
                      { value: "bulk", label: "Bulk purchase" },
                    ] as const).map(m => (
                      <button
                        key={m.value}
                        onClick={() => onChangePostageMode(m.value)}
                        style={{
                          background: postageMode === m.value ? T.amber : "transparent",
                          color: postageMode === m.value ? "#0a0e1a" : T.muted,
                          border: "none", borderRadius: 6,
                          padding: "5px 14px", fontSize: 12, fontWeight: 700,
                          fontFamily: font, cursor: "pointer",
                        }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: T.faint, marginTop: 6 }}>
                    {isBulkPostage ? "Pass-through reimbursement of postage purchases (no markup)." : "One row per package · markup + per-package fee."}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Previously billed — the context that used to live in a second
              /invoices tab: this client's last invoices, and the exact date
              range to punch into ShipStation for the next one. */}
          {selectedClient && (() => {
            const prior = priorByClient[clientId] || [];
            if (prior.length === 0) return (
              <div style={{ fontSize: 11, color: T.faint }}>
                First fulfillment invoice for {selectedClient.name} — no billing history.
              </div>
            );
            const last = prior[0];
            const sug = isCombined ? null : nextPeriodSuggestion(last.period_label);
            const ss = isCombined ? nextPeriodSuggestion(last.sales_period_label || last.period_label) : null;
            const ps = isCombined ? nextPeriodSuggestion(last.postage_period_label || last.period_label) : null;
            return (
              <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                  Previously billed
                </div>
                {prior.slice(0, 3).map(r => {
                  const state = r.paid_at ? { label: "Paid", color: T.green } : r.sent_at ? { label: "Sent", color: T.accent } : { label: "Draft", color: T.faint };
                  const halvesDiffer = r.report_type === "combined" && !!(r.sales_period_label || r.postage_period_label) && r.sales_period_label !== r.postage_period_label;
                  return (
                    <div key={r.id} style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: 12, padding: "3px 0" }}>
                      <span style={{ color: T.text, fontWeight: 600, whiteSpace: "nowrap" }}>{PRIOR_TYPE_LABEL[r.report_type]}</span>
                      {halvesDiffer ? (
                        <span style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>sales {r.sales_period_label || r.period_label} · postage {r.postage_period_label || r.period_label}</span>
                      ) : (
                        <span style={{ fontFamily: mono, color: T.muted, whiteSpace: "nowrap" }}>{r.period_label || "—"}</span>
                      )}
                      <span style={{ fontFamily: mono, color: r.qb_invoice_number ? T.text : T.faint, whiteSpace: "nowrap" }}>{r.qb_invoice_number ? `#${r.qb_invoice_number}` : "no QB #"}</span>
                      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: state.color }}>{state.label}</span>
                      <a href={`/invoices/fulfillment/${r.id}`} target="_blank" rel="noreferrer" style={{ marginLeft: "auto", fontSize: 11, color: T.faint, textDecoration: "none", whiteSpace: "nowrap" }}>open ↗</a>
                    </div>
                  );
                })}
                {last.report_type !== reportType && (
                  <div style={{ fontSize: 11, color: T.amber, fontWeight: 600, marginTop: 6 }}>
                    Last billed as {PRIOR_TYPE_LABEL[last.report_type]} — this invoice is set to {PRIOR_TYPE_LABEL[reportType]}.
                  </div>
                )}
                {(sug || ss || ps) && (
                  <div style={{ fontSize: 11, color: T.muted, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.border}`, lineHeight: 1.6 }}>
                    {isCombined ? (
                      <>Next windows — {ss && <>sales <strong style={{ color: T.text, fontFamily: mono }}>{ss}</strong></>}{ss && ps ? " · " : null}{ps && <>postage <strong style={{ color: T.text, fontFamily: mono }}>{ps}</strong></>}. Use these date ranges for the ShipStation exports.</>
                    ) : (
                      <>Next window: <strong style={{ color: T.text, fontFamily: mono }}>{sug}</strong> — use this date range for the ShipStation export.</>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Direct line to the ShipStation report that produces the file —
              one click from here to the export screen (Jon, Aug 31). */}
          {showPostage && !isBulkPostage && (
            <div style={{ fontSize: 11.5, color: T.muted }}>
              Get the file:{" "}
              <a href="https://ship11.shipstation.com/dashboard/reports/ShippingCosts" target="_blank" rel="noopener noreferrer"
                style={{ color: T.blue, fontWeight: 700, textDecoration: "none" }}
                onMouseEnter={e => (e.currentTarget.style.textDecoration = "underline")}
                onMouseLeave={e => (e.currentTarget.style.textDecoration = "none")}>
                ShipStation → Insights → Reports → Shipping Cost ↗
              </a>
              {" "}— set the date range, store and select all providers/services - Export to CSV
            </div>
          )}

          {/* ONE dropzone (Jon, Aug 25: "feels very government website") —
              drop every export at once; each file is classified by its
              header row and routed to the right parser. */}
          <div
            onDragOver={e => { e.preventDefault(); setDropHot(true); }}
            onDragLeave={() => setDropHot(false)}
            onDrop={e => { e.preventDefault(); setDropHot(false); routeCsvFiles(e.dataTransfer.files); }}
            onClick={() => document.getElementById("ssr-file-input")?.click()}
            style={{ border: `1.5px dashed ${dropHot ? T.accent : T.border}`, borderRadius: 12, padding: "48px 20px", background: dropHot ? T.surface : "transparent", textAlign: "center", cursor: "pointer" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>
              Drop the ShipStation export{showSales && showPostage ? "s" : ""} here — or click to choose
            </div>
            <div style={{ fontSize: 11, color: T.faint, marginTop: 5, lineHeight: 1.5 }}>
              {[
                showSales ? "product sales CSV" : null,
                showPostage ? (isBulkPostage ? "postage-ledger CSV (account transactions export)" : "Shipping Cost CSV") : null,
              ].filter(Boolean).join(" + ")} · each file is recognized automatically
            </div>
            <input id="ssr-file-input" type="file" accept=".csv,text/csv" multiple style={{ display: "none" }}
              onChange={e => { routeCsvFiles(e.target.files); (e.target as any).value = ""; }} />
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: salesLoaded > 0 || postageLoaded > 0 ? 14 : 0 }}>
              {salesLoaded > 0 && <span style={{ fontSize: 12, color: T.green, fontFamily: mono, fontWeight: 700 }}>✓ Sales · {salesLoaded} rows</span>}
              {postageLoaded > 0 && <span style={{ fontSize: 12, color: T.green, fontFamily: mono, fontWeight: 700 }}>✓ {isBulkPostage ? "Postage purchases" : "Shipments"} · {postageLoaded}</span>}
              {showSales && salesLoaded === 0 && <span style={{ fontSize: 12, color: T.faint, fontFamily: mono }}>waiting on sales CSV</span>}
              {showPostage && postageLoaded === 0 && <span style={{ fontSize: 12, color: T.faint, fontFamily: mono }}>waiting on {isBulkPostage ? "ledger" : "shipments"} CSV</span>}
            </div>
          </div>
          {/* Ship-date span vs the typed period — the file is the truth about
              what window this invoice covers. Outside the period → amber +
              one-tap fix; period unparseable → neutral offer; matches → ✓. */}
          {csvSpan && (() => {
            const pr = parsePeriodRange(periodLabel);
            const outside = !!pr && (csvSpan.minD < pr.start || csvSpan.maxD > pr.end);
            const matches = !!pr && !outside;
            return (
              <div style={{ fontSize: 11.5, color: outside ? T.amber : T.muted, fontWeight: outside ? 600 : 400 }}>
                Shipments in the file run <strong style={{ color: T.text, fontFamily: mono }}>{csvSpan.first} – {csvSpan.last}</strong>
                {matches ? (
                  <span style={{ color: T.green, fontWeight: 700 }}> — inside the period ✓</span>
                ) : (
                  <>
                    {outside ? " — outside the period above. " : ". "}
                    <button onClick={() => { setPeriodLabel(csvSpan.suggested); setPeriodTouched(true); }}
                      style={{ background: "none", border: "none", color: outside ? T.amber : T.muted, fontWeight: 700, fontSize: 11.5, cursor: "pointer", fontFamily: font, padding: 0, textDecoration: "underline", textUnderlineOffset: 3 }}>
                      Set period to {csvSpan.suggested}
                    </button>
                  </>
                )}
              </div>
            );
          })()}
          {(csvError || csvErrorPostage || dropError) && (
            <div style={{ fontSize: 12, color: T.red }}>{[dropError, csvError, csvErrorPostage].filter(Boolean).join(" · ")}</div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button disabled={!canNextFrom1} onClick={() => setStage(2)} style={{ ...btnPrimary, opacity: canNextFrom1 ? 1 : 0.4, cursor: canNextFrom1 ? "pointer" : "not-allowed" }}>
              Next →
            </button>
          </div>
        </div>
      )}

      {/* ── Stage 2 — Select rows (sales-only) ── */}
      {stage === 2 && isSales && (
        <div style={{ ...card, width: "100%", maxWidth: 1040 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: T.muted }}>
              <span style={{ fontWeight: 700, color: T.text }}>{selectedRows.length}</span> of {rawRows.length} rows included
              <span style={{ marginLeft: 10, fontSize: 11, color: T.faint }}>Shift-click to select a range</span>
              {mergedCount > 0 && (
                <span style={{ marginLeft: 10, fontSize: 11, color: T.amber }}>
                  · Merged {mergedCount} duplicate-SKU row{mergedCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>

          <div style={{ maxHeight: 500, overflow: "auto", border: `1px solid ${T.border}`, borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: T.card, zIndex: 1 }}>
                <tr>
                  <th style={{ ...thStyle, width: 40, textAlign: "center" }}>
                    <MasterCheck count={rawRows.length} selected={selectedRows.length} onAll={selectAllSales} onNone={clearAllSales} />
                  </th>
                  <th style={thStyle}>SKU</th>
                  <th style={thStyle}>Description</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Qty Sold</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Product Sales</th>
                </tr>
              </thead>
              <tbody>
                {rawRows.map(r => {
                  const flagNegative = r.product_sales < 0;
                  const flagNoSku = !r.sku;
                  const flag = flagNegative || flagNoSku;
                  return (
                    <tr key={r.idx} style={{ background: flag ? "rgba(245,158,11,0.06)" : "transparent", opacity: r.included ? 1 : 0.45 }}>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={r.included}
                          onChange={() => {}}
                          onClick={(e) => toggleSalesRow(r.idx, e.shiftKey)}
                          style={{ cursor: "pointer" }}
                        />
                      </td>
                      <td style={{ ...tdStyle, color: flagNoSku ? T.amber : T.text, fontWeight: 600 }}>{r.sku || "(no SKU)"}</td>
                      <td style={{ ...tdStyle, fontFamily: font, color: T.muted }}>{r.description || "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtN(r.qty_sold)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", color: flagNegative ? T.amber : T.text }}>{fmtD(r.product_sales)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
            <button onClick={() => isEditing ? router.push(`/invoices/fulfillment/${editId}`) : setStage(1)} style={btnGhost}>{isEditing ? "Cancel" : "← Back"}</button>
            <button disabled={!canNextFrom2} onClick={() => setStage(3)} style={{ ...btnPrimary, opacity: canNextFrom2 ? 1 : 0.4, cursor: canNextFrom2 ? "pointer" : "not-allowed" }}>Next →</button>
          </div>
        </div>
      )}

      {/* ── Stage 2 — Select shipments (postage-only, per-shipment) ── */}
      {stage === 2 && (isPostage || isFulfillment) && !isBulkPostage && (
        <div style={{ ...card, width: "100%", maxWidth: 1040 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: T.muted }}>
              <span style={{ fontWeight: 700, color: T.text }}>{selectedPostageRows.length}</span> of {rawPostageRows.length} shipments included
              <span style={{ marginLeft: 10, fontSize: 11, color: T.faint }}>Shift-click to select a range</span>
            </div>
          </div>

          <div style={{ maxHeight: 560, overflow: "auto", border: `1px solid ${T.border}`, borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: T.card, zIndex: 1 }}>
                <tr>
                  <th style={{ ...thStyle, width: 36, textAlign: "center" }}>
                    <MasterCheck count={rawPostageRows.length} selected={selectedPostageRows.length} onAll={selectAllPostage} onNone={clearAllPostage} />
                  </th>
                  <th style={thStyle}>Ship Date</th>
                  <th style={thStyle}>Recipient</th>
                  <th style={thStyle}>Order #</th>
                  <th style={thStyle}>Service</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Items</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Zone</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Paid</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Cost</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Insurance</th>
                </tr>
              </thead>
              <tbody>
                {rawPostageRows.map(r => {
                  const svcLine = [r.provider, r.service, r.package_type].filter(Boolean).join(" · ");
                  return (
                    <tr key={r.idx} style={{ opacity: r.included ? 1 : 0.45 }}>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={r.included}
                          onChange={() => {}}
                          onClick={(e) => togglePostageRow(r.idx, e.shiftKey)}
                          style={{ cursor: "pointer" }}
                        />
                      </td>
                      <td style={{ ...tdStyle, fontFamily: mono, color: T.muted, fontSize: 11 }}>{dateOnly(r.ship_date) || "—"}</td>
                      <td style={{ ...tdStyle, fontFamily: font, fontWeight: 600 }}>{r.recipient || "—"}</td>
                      <td style={{ ...tdStyle, fontFamily: mono, fontSize: 11, color: T.muted }}>{r.order_number || "—"}</td>
                      <td style={{ ...tdStyle, fontFamily: font, fontSize: 11, color: T.muted }}>{svcLine || "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{r.items_count ? fmtN(r.items_count) : "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{r.zone || "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtD(r.shipping_paid)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtD(r.shipping_cost)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", color: r.insurance_cost > 0 ? T.text : T.faint }}>{r.insurance_cost > 0 ? fmtD(r.insurance_cost) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
            <button onClick={() => isEditing ? router.push(`/invoices/fulfillment/${editId}`) : setStage(1)} style={btnGhost}>{isEditing ? "Cancel" : "← Back"}</button>
            <button disabled={!canNextFrom2} onClick={() => setStage(3)} style={{ ...btnPrimary, opacity: canNextFrom2 ? 1 : 0.4, cursor: canNextFrom2 ? "pointer" : "not-allowed" }}>Next →</button>
          </div>
        </div>
      )}

      {/* ── Stage 2 — Select purchases (postage-only, bulk) ── */}
      {stage === 2 && isPostage && isBulkPostage && (
        <div style={{ ...card, width: "100%", maxWidth: 1040 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: T.muted }}>
              <span style={{ fontWeight: 700, color: T.text }}>{selectedBulkRows.length}</span> of {rawBulkRows.length} purchases included
              <span style={{ marginLeft: 10, fontSize: 11, color: T.faint }}>Shift-click to select a range</span>
              <span style={{ marginLeft: 10, fontSize: 11, color: T.green, fontFamily: mono }}>· {fmtD(bulkPostageTotals.total)} total</span>
            </div>
          </div>

          <div style={{ maxHeight: 560, overflow: "auto", border: `1px solid ${T.border}`, borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: T.card, zIndex: 1 }}>
                <tr>
                  <th style={{ ...thStyle, width: 36, textAlign: "center" }}>
                    <MasterCheck count={rawBulkRows.length} selected={selectedBulkRows.length} onAll={selectAllBulk} onNone={clearAllBulk} />
                  </th>
                  <th style={thStyle}>Transaction Date</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {rawBulkRows.map(r => (
                  <tr key={r.idx} style={{ opacity: r.included ? 1 : 0.45 }}>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={r.included}
                        onChange={() => {}}
                        onClick={(e) => toggleBulkRow(r.idx, e.shiftKey)}
                        style={{ cursor: "pointer" }}
                      />
                    </td>
                    <td style={{ ...tdStyle, fontFamily: font, fontWeight: 600 }}>{r.transaction_date || "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{fmtD(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
            <button onClick={() => isEditing ? router.push(`/invoices/fulfillment/${editId}`) : setStage(1)} style={btnGhost}>{isEditing ? "Cancel" : "← Back"}</button>
            <button disabled={!canNextFrom2} onClick={() => setStage(3)} style={{ ...btnPrimary, opacity: canNextFrom2 ? 1 : 0.4, cursor: canNextFrom2 ? "pointer" : "not-allowed" }}>Next →</button>
          </div>
        </div>
      )}

      {/* ── Stage 3 — Sales: per-product unit costs ── */}
      {stage === 3 && isSales && (
        <>
          <SalesTotalsStrip totals={salesTotals} />
          <div style={{ ...card, width: "100%", maxWidth: 1040 }}>
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 10 }}>
              One unit cost per product. Variants with different sizes share the same cost. Costs save per client so next month pre-fills.
            </div>
            <div style={{ maxHeight: 540, overflow: "auto", border: `1px solid ${T.border}`, borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, background: T.card, zIndex: 1 }}>
                  <tr>
                    <th style={thStyle}>Product</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Qty</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Sales</th>
                    <th style={{ ...thStyle, width: 120, textAlign: "right" }}>Unit Cost</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Total Cost</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(g => {
                    const raw = groupCosts[g.key] ?? "";
                    const uc = parseMoney(raw);
                    const totalCost = uc * g.qty_sold;
                    const net = g.product_sales - totalCost;
                    const skuWithSaved = g.variants.map(v => v.sku).find(sku => sku && savedCosts[sku] !== undefined);
                    const fromSaved = !!skuWithSaved;
                    const setCostForGroup = (val: string) => {
                      setGroupCosts(c => ({ ...c, [g.key]: val }));
                    };
                    const sizesLabel = g.variants
                      .filter(v => v.size || v.qty_sold > 0)
                      .map(v => `${v.size || v.sku}: ${fmtN(v.qty_sold)}`)
                      .join("  ·  ");
                    return (
                      <tr key={g.key}>
                        <td style={{ ...tdStyle, fontFamily: font, verticalAlign: "top" }}>
                          <div style={{ fontWeight: 600, color: T.text }}>{g.root_description}</div>
                          <div style={{ fontSize: 10, color: T.faint, fontFamily: mono, marginTop: 2 }}>{g.root_sku || "(no SKU)"}</div>
                          {g.variants.length > 1 && (
                            <div style={{ fontSize: 10, color: T.muted, marginTop: 4, fontFamily: mono }}>{sizesLabel}</div>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", verticalAlign: "top" }}>{fmtN(g.qty_sold)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", verticalAlign: "top" }}>{fmtD(g.product_sales)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", padding: "4px 6px", verticalAlign: "top" }}>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={raw}
                            onChange={e => setCostForGroup(e.target.value)}
                            onFocus={e => e.target.select()}
                            onBlur={e => {
                              const v = e.target.value;
                              if (!v.trim()) return;
                              const n = parseMoney(v);
                              const normalized = n === 0 ? "" : String(n);
                              if (normalized !== v) setCostForGroup(normalized);
                            }}
                            placeholder="0.00"
                            title={fromSaved && skuWithSaved ? `Saved from last run: ${fmtD(savedCosts[skuWithSaved])}` : undefined}
                            style={{ ...input, padding: "4px 8px", fontSize: 12, fontFamily: mono, textAlign: "right", width: "100%", borderColor: uc === 0 && raw.trim() ? T.red : fromSaved ? T.green + "55" : T.border }}
                          />
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", color: uc > 0 ? T.text : T.faint, verticalAlign: "top" }}>{uc > 0 ? fmtD(totalCost) : "—"}</td>
                        <td style={{ ...tdStyle, textAlign: "right", color: net >= 0 ? T.green : T.red, verticalAlign: "top" }}>{uc > 0 ? fmtD(net) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
              <button onClick={() => setStage(2)} style={btnGhost}>← Back</button>
              <button disabled={!canNextFrom3} onClick={() => setStage(4)} style={{ ...btnPrimary, opacity: canNextFrom3 ? 1 : 0.4, cursor: canNextFrom3 ? "pointer" : "not-allowed" }}>Next →</button>
            </div>
            {!canNextFrom3 && <div style={{ fontSize: 11, color: T.amber, marginTop: 8 }}>Add at least one product to continue. Blank costs are treated as $0 (free).</div>}
          </div>
        </>
      )}

      {/* ── Stage 3 — Postage: markup % + per-package fulfillment fee ── */}
      {stage === 3 && (isPostage || isFulfillment) && !isBulkPostage && (
        <>
          <PostageTotalsStrip totals={postageTotals} fulfillmentOnly={isFulfillment} />
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 18, width: "100%", maxWidth: 1040 }}>
            {isFulfillment && (
              <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
                This client runs their own ShipStation and pays their own postage. We bill <strong style={{ color: T.text }}>only the per-package fulfillment fee</strong> — no postage cost or markup appears on their invoice.
              </div>
            )}
            {!isFulfillment && (<>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>HPD Markup</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="text" inputMode="decimal"
                  value={markupPct}
                  onChange={e => setMarkupPct(e.target.value)}
                  onFocus={e => e.target.select()}
                  onBlur={e => {
                    const v = e.target.value;
                    if (!v.trim()) { setMarkupPct("0"); return; }
                    const n = parseMoney(v);
                    if (String(n) !== v) setMarkupPct(String(n));
                  }}
                  style={{ ...input, fontSize: 16, fontWeight: 700, width: 140, fontFamily: mono, textAlign: "right" }}
                />
                <span style={{ fontSize: 13, color: T.muted, fontFamily: mono }}>
                  = {(parseMoney(markupPct) * 100).toFixed(1)}% markup on raw ShipStation cost
                </span>
              </div>
              <div style={{ fontSize: 11, color: T.faint, marginTop: 8, lineHeight: 1.5 }}>
                Postage billed: <strong style={{ color: T.text }}>Shipping Cost × (1 + markup) + Insurance</strong>. Client Profit = what they collected from their customer minus what we bill them for postage.
              </div>
            </div>

            <div style={{ borderTop: `1px solid ${T.border}` }} />
            </>)}

            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Fulfillment Fee — per package</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 16, color: T.muted, fontFamily: mono }}>$</span>
                <input
                  type="text" inputMode="decimal"
                  value={perPackageFee}
                  onChange={e => setPerPackageFee(e.target.value)}
                  onFocus={e => e.target.select()}
                  onBlur={e => {
                    const v = e.target.value;
                    if (!v.trim()) { setPerPackageFee("0"); return; }
                    const n = parseMoney(v);
                    if (String(n) !== v) setPerPackageFee(String(n));
                  }}
                  style={{ ...input, fontSize: 16, fontWeight: 700, width: 140, fontFamily: mono, textAlign: "right" }}
                />
                <span style={{ fontSize: 13, color: T.muted, fontFamily: mono }}>
                  × {postageTotals.shipments.toLocaleString()} shipments = <strong style={{ color: T.text }}>{fmtD(postageTotals.fulfillment)}</strong>
                </span>
              </div>
              <div style={{ fontSize: 11, color: T.faint, marginTop: 8, lineHeight: 1.5 }}>
                Flat HPD service charge per shipment (pick / pack / handoff).{isFulfillment ? " This is the entire invoice." : " Billed as a separate line on the invoice — does not affect Client Profit on postage."} Saves to client for next month.
              </div>
            </div>

            {isFulfillment && parseMoney(perPackageFee) === 0 && (
              <div style={{ fontSize: 12, color: T.amber, fontWeight: 600 }}>
                The per-package fee is $0 — this would generate a $0.00 invoice. This client has no saved rate yet; check their agreement before continuing.
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button onClick={() => setStage(2)} style={btnGhost}>← Back</button>
              <button disabled={!canNextFrom3} onClick={() => setStage(4)} style={{ ...btnPrimary, opacity: canNextFrom3 ? 1 : 0.4, cursor: canNextFrom3 ? "pointer" : "not-allowed" }}>Next →</button>
            </div>
          </div>
        </>
      )}

      {/* ── Stage 3 — Postage (bulk): pass-through confirmation ── */}
      {stage === 3 && isPostage && isBulkPostage && (
        <>
          <BulkPostageTotalsStrip totals={bulkPostageTotals} />
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 1040 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Pass-through reimbursement</div>
            <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
              No markup or per-package fee applies to bulk postage. The client is billed exactly what HPD spent on postage —
              <strong style={{ color: T.text }}> {fmtD(bulkPostageTotals.total)}</strong> across {fmtN(bulkPostageTotals.purchases)} purchase{bulkPostageTotals.purchases === 1 ? "" : "s"}.
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button onClick={() => setStage(2)} style={btnGhost}>← Back</button>
              <button disabled={!canNextFrom3} onClick={() => setStage(4)} style={{ ...btnPrimary, opacity: canNextFrom3 ? 1 : 0.4, cursor: canNextFrom3 ? "pointer" : "not-allowed" }}>Next →</button>
            </div>
          </div>
        </>
      )}

      {/* ── Stage 4 — Sales Review + generate ── */}
      {stage === 4 && isSales && (
        <>
          <SalesTotalsStrip totals={salesTotals} />
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 1040 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Client</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{client?.name || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Period</div>
                <input value={periodLabel} onChange={e => setPeriodLabel(e.target.value)} style={{ ...input, fontSize: 13, fontWeight: 700 }} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>HPD Fee</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="text" inputMode="decimal"
                    value={feePct}
                    onChange={e => setFeePct(e.target.value)}
                    onFocus={e => e.target.select()}
                    style={{ ...input, fontSize: 13, fontWeight: 700, width: 90, fontFamily: mono, textAlign: "right" }}
                  />
                  <span style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>({(parseMoney(feePct) * 100).toFixed(1)}%)</span>
                </div>
              </div>
            </div>

            <div style={{ fontSize: 11, color: T.muted }}>
              {groups.length} product{groups.length === 1 ? "" : "s"} ({selectedRows.length} variant{selectedRows.length === 1 ? "" : "s"}) · {fmtN(salesTotals.qty)} units · {fmtD(salesTotals.sales)} in sales · {fmtD(salesTotals.profit)} net to client
            </div>

            {saveError && <div style={{ fontSize: 12, color: T.red, background: T.red + "11", padding: "8px 12px", borderRadius: 6 }}>{saveError}</div>}

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button onClick={() => setStage(3)} style={btnGhost} disabled={saving}>← Back</button>
              <button onClick={generate} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
                {generateBtnLabel}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Stage 4 — Postage / Fulfillment Review + generate (per-shipment) ── */}
      {stage === 4 && (isPostage || isFulfillment) && !isBulkPostage && (
        <>
          <PostageTotalsStrip totals={postageTotals} fulfillmentOnly={isFulfillment} />
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 1040 }}>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${isFulfillment ? 3 : 4}, 1fr)`, gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Client</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{client?.name || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Period</div>
                <input value={periodLabel} onChange={e => setPeriodLabel(e.target.value)} style={{ ...input, fontSize: 13, fontWeight: 700 }} />
              </div>
              {!isFulfillment && (
              <div>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Markup</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="text" inputMode="decimal"
                    value={markupPct}
                    onChange={e => setMarkupPct(e.target.value)}
                    onFocus={e => e.target.select()}
                    style={{ ...input, fontSize: 13, fontWeight: 700, width: 80, fontFamily: mono, textAlign: "right" }}
                  />
                  <span style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>({(parseMoney(markupPct) * 100).toFixed(1)}%)</span>
                </div>
              </div>
              )}
              <div>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Per Package</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, color: T.muted, fontFamily: mono }}>$</span>
                  <input
                    type="text" inputMode="decimal"
                    value={perPackageFee}
                    onChange={e => setPerPackageFee(e.target.value)}
                    onFocus={e => e.target.select()}
                    style={{ ...input, fontSize: 13, fontWeight: 700, width: 80, fontFamily: mono, textAlign: "right" }}
                  />
                  <span style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>× {postageTotals.shipments}</span>
                </div>
              </div>
            </div>

            <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.6 }}>
              {isFulfillment ? (
                <>
                  {postageTotals.shipments} shipment{postageTotals.shipments === 1 ? "" : "s"} · {fmtD(perPackageFee === "" ? 0 : parseMoney(perPackageFee))}/package · <strong style={{ color: T.text }}>Total invoice {fmtD(postageTotals.fulfillment)}</strong>
                </>
              ) : (
                <>
                  {postageTotals.shipments} shipment{postageTotals.shipments === 1 ? "" : "s"} · {fmtD(postageTotals.paid)} shipping income · postage billed {fmtD(postageTotals.billed)} · client profit {fmtD(postageTotals.margin)}
                  <br />
                  + Fulfillment fee {fmtD(postageTotals.fulfillment)} · <strong style={{ color: T.text }}>Total invoice {fmtD(postageTotals.invoice_total)}</strong>
                </>
              )}
            </div>

            {isFulfillment && parseMoney(perPackageFee) === 0 && (
              <div style={{ fontSize: 12, color: T.amber, fontWeight: 600 }}>
                Per-package fee is $0 — this generates a $0.00 invoice. Set the client's rate before generating.
              </div>
            )}

            {saveError && <div style={{ fontSize: 12, color: T.red, background: T.red + "11", padding: "8px 12px", borderRadius: 6 }}>{saveError}</div>}

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button onClick={() => setStage(3)} style={btnGhost} disabled={saving}>← Back</button>
              <button onClick={generate} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
                {generateBtnLabel}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Stage 4 — Postage Review + generate (bulk) ── */}
      {stage === 4 && isPostage && isBulkPostage && (
        <>
          <BulkPostageTotalsStrip totals={bulkPostageTotals} />
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 1040 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Client</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{client?.name || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Period</div>
                <input value={periodLabel} onChange={e => setPeriodLabel(e.target.value)} style={{ ...input, fontSize: 13, fontWeight: 700 }} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Billing</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.green }}>Pass-through</div>
              </div>
            </div>

            <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.6 }}>
              {fmtN(bulkPostageTotals.purchases)} postage purchase{bulkPostageTotals.purchases === 1 ? "" : "s"} · billed at cost · <strong style={{ color: T.text }}>Total invoice {fmtD(bulkPostageTotals.total)}</strong>
            </div>

            {saveError && <div style={{ fontSize: 12, color: T.red, background: T.red + "11", padding: "8px 12px", borderRadius: 6 }}>{saveError}</div>}

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button onClick={() => setStage(3)} style={btnGhost} disabled={saving}>← Back</button>
              <button onClick={generate} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
                {generateBtnLabel}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Stage 2 — Select rows + shipments (Full Service) ── */}
      {/* Two stacked panels in one card so the user moves through both
          halves before clicking one Next button. Each panel keeps the
          same counter / select-all / clear-all / shift-range behavior
          as the single-type flows. */}
      {stage === 2 && isCombined && (
        <div style={{ ...card, display: "flex", flexDirection: "column", gap: 18, width: "100%", maxWidth: 1040 }}>
          {/* Sales rows */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12, color: T.muted }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: T.accent, textTransform: "uppercase", letterSpacing: "0.08em", marginRight: 8 }}>Sales</span>
                <span style={{ fontWeight: 700, color: T.text }}>{selectedRows.length}</span> of {rawRows.length} rows included
                <span style={{ marginLeft: 10, fontSize: 11, color: T.faint }}>Shift-click to select a range</span>
                {mergedCount > 0 && (
                  <span style={{ marginLeft: 10, fontSize: 11, color: T.amber }}>
                    · Merged {mergedCount} duplicate-SKU row{mergedCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </div>
            <div style={{ maxHeight: 360, overflow: "auto", border: `1px solid ${T.border}`, borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, background: T.card, zIndex: 1 }}>
                  <tr>
                    <th style={{ ...thStyle, width: 40, textAlign: "center" }}>
                      <MasterCheck count={rawRows.length} selected={selectedRows.length} onAll={selectAllSales} onNone={clearAllSales} />
                    </th>
                    <th style={thStyle}>SKU</th>
                    <th style={thStyle}>Description</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Qty Sold</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Product Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {rawRows.map(r => {
                    const flagNegative = r.product_sales < 0;
                    const flagNoSku = !r.sku;
                    const flag = flagNegative || flagNoSku;
                    return (
                      <tr key={r.idx} style={{ background: flag ? "rgba(245,158,11,0.06)" : "transparent", opacity: r.included ? 1 : 0.45 }}>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={r.included}
                            onChange={() => {}}
                            onClick={(e) => toggleSalesRow(r.idx, e.shiftKey)}
                            style={{ cursor: "pointer" }}
                          />
                        </td>
                        <td style={{ ...tdStyle, color: flagNoSku ? T.amber : T.text, fontWeight: 600 }}>{r.sku || "(no SKU)"}</td>
                        <td style={{ ...tdStyle, fontFamily: font, color: T.muted }}>{r.description || "—"}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{fmtN(r.qty_sold)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", color: flagNegative ? T.amber : T.text }}>{fmtD(r.product_sales)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${T.border}` }} />

          {/* Postage shipments (per-shipment) */}
          {!isBulkPostage && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12, color: T.muted }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: T.amber, textTransform: "uppercase", letterSpacing: "0.08em", marginRight: 8 }}>Postage</span>
                <span style={{ fontWeight: 700, color: T.text }}>{selectedPostageRows.length}</span> of {rawPostageRows.length} shipments included
                <span style={{ marginLeft: 10, fontSize: 11, color: T.faint }}>Shift-click to select a range</span>
              </div>
            </div>
            <div style={{ maxHeight: 380, overflow: "auto", border: `1px solid ${T.border}`, borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, background: T.card, zIndex: 1 }}>
                  <tr>
                    <th style={{ ...thStyle, width: 36, textAlign: "center" }}>
                      <MasterCheck count={rawPostageRows.length} selected={selectedPostageRows.length} onAll={selectAllPostage} onNone={clearAllPostage} />
                    </th>
                    <th style={thStyle}>Ship Date</th>
                    <th style={thStyle}>Recipient</th>
                    <th style={thStyle}>Order #</th>
                    <th style={thStyle}>Service</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Items</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Zone</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Paid</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Cost</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Insurance</th>
                  </tr>
                </thead>
                <tbody>
                  {rawPostageRows.map(r => {
                    const svcLine = [r.provider, r.service, r.package_type].filter(Boolean).join(" · ");
                    return (
                      <tr key={r.idx} style={{ opacity: r.included ? 1 : 0.45 }}>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={r.included}
                            onChange={() => {}}
                            onClick={(e) => togglePostageRow(r.idx, e.shiftKey)}
                            style={{ cursor: "pointer" }}
                          />
                        </td>
                        <td style={{ ...tdStyle, fontFamily: mono, color: T.muted, fontSize: 11 }}>{dateOnly(r.ship_date) || "—"}</td>
                        <td style={{ ...tdStyle, fontFamily: font, fontWeight: 600 }}>{r.recipient || "—"}</td>
                        <td style={{ ...tdStyle, fontFamily: mono, fontSize: 11, color: T.muted }}>{r.order_number || "—"}</td>
                        <td style={{ ...tdStyle, fontFamily: font, fontSize: 11, color: T.muted }}>{svcLine || "—"}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{r.items_count ? fmtN(r.items_count) : "—"}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{r.zone || "—"}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{fmtD(r.shipping_paid)}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{fmtD(r.shipping_cost)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", color: r.insurance_cost > 0 ? T.text : T.faint }}>{r.insurance_cost > 0 ? fmtD(r.insurance_cost) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          )}

          {/* Postage purchases (bulk) */}
          {isBulkPostage && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12, color: T.muted }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: T.amber, textTransform: "uppercase", letterSpacing: "0.08em", marginRight: 8 }}>Postage</span>
                <span style={{ fontWeight: 700, color: T.text }}>{selectedBulkRows.length}</span> of {rawBulkRows.length} purchases included
                <span style={{ marginLeft: 10, fontSize: 11, color: T.faint }}>Shift-click to select a range</span>
                <span style={{ marginLeft: 10, fontSize: 11, color: T.green, fontFamily: mono }}>· {fmtD(bulkPostageTotals.total)} total</span>
              </div>
            </div>
            <div style={{ maxHeight: 380, overflow: "auto", border: `1px solid ${T.border}`, borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, background: T.card, zIndex: 1 }}>
                  <tr>
                    <th style={{ ...thStyle, width: 36, textAlign: "center" }}>
                      <MasterCheck count={rawBulkRows.length} selected={selectedBulkRows.length} onAll={selectAllBulk} onNone={clearAllBulk} />
                    </th>
                    <th style={thStyle}>Transaction Date</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rawBulkRows.map(r => (
                    <tr key={r.idx} style={{ opacity: r.included ? 1 : 0.45 }}>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={r.included}
                          onChange={() => {}}
                          onClick={(e) => toggleBulkRow(r.idx, e.shiftKey)}
                          style={{ cursor: "pointer" }}
                        />
                      </td>
                      <td style={{ ...tdStyle, fontFamily: font, fontWeight: 600 }}>{r.transaction_date || "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtD(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <button onClick={() => isEditing ? router.push(`/invoices/fulfillment/${editId}`) : setStage(1)} style={btnGhost}>{isEditing ? "Cancel" : "← Back"}</button>
            <button disabled={!canNextFrom2} onClick={() => setStage(3)} style={{ ...btnPrimary, opacity: canNextFrom2 ? 1 : 0.4, cursor: canNextFrom2 ? "pointer" : "not-allowed" }}>Next →</button>
          </div>
        </div>
      )}

      {/* ── Stage 3 — Pricing (Full Service) ── */}
      {/* Sales fee + per-product unit costs on top, postage markup +
          per-package fee on bottom. One stage, all pricing in view at
          once, with both totals strips updating live. */}
      {stage === 3 && isCombined && (
        <>
          <SalesTotalsStrip totals={salesTotals} />
          {isBulkPostage
            ? <BulkPostageTotalsStrip totals={bulkPostageTotals} />
            : <PostageTotalsStrip totals={postageTotals} />}
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 18, width: "100%", maxWidth: 1040 }}>

            {/* Sales pricing */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.accent, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Sales Pricing</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>HPD Fee</span>
                <input
                  type="text" inputMode="decimal"
                  value={feePct}
                  onChange={e => setFeePct(e.target.value)}
                  onFocus={e => e.target.select()}
                  onBlur={e => {
                    const v = e.target.value;
                    if (!v.trim()) { setFeePct("0"); return; }
                    const n = parseMoney(v);
                    if (String(n) !== v) setFeePct(String(n));
                  }}
                  style={{ ...input, fontSize: 14, fontWeight: 700, width: 100, fontFamily: mono, textAlign: "right" }}
                />
                <span style={{ fontSize: 12, color: T.muted, fontFamily: mono }}>= {(parseMoney(feePct) * 100).toFixed(1)}% of Product Net</span>
              </div>
              <div style={{ fontSize: 10, color: T.faint, marginBottom: 10 }}>
                One unit cost per product. Variants with different sizes share the same cost. Costs save per client so next month pre-fills.
              </div>
              <div style={{ maxHeight: 380, overflow: "auto", border: `1px solid ${T.border}`, borderRadius: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead style={{ position: "sticky", top: 0, background: T.card, zIndex: 1 }}>
                    <tr>
                      <th style={thStyle}>Product</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Qty</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Sales</th>
                      <th style={{ ...thStyle, width: 120, textAlign: "right" }}>Unit Cost</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Total Cost</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(g => {
                      const raw = groupCosts[g.key] ?? "";
                      const uc = parseMoney(raw);
                      const totalCost = uc * g.qty_sold;
                      const net = g.product_sales - totalCost;
                      const skuWithSaved = g.variants.map(v => v.sku).find(sku => sku && savedCosts[sku] !== undefined);
                      const fromSaved = !!skuWithSaved;
                      const setCostForGroup = (val: string) => {
                        setGroupCosts(c => ({ ...c, [g.key]: val }));
                      };
                      const sizesLabel = g.variants
                        .filter(v => v.size || v.qty_sold > 0)
                        .map(v => `${v.size || v.sku}: ${fmtN(v.qty_sold)}`)
                        .join("  ·  ");
                      return (
                        <tr key={g.key}>
                          <td style={{ ...tdStyle, fontFamily: font, verticalAlign: "top" }}>
                            <div style={{ fontWeight: 600, color: T.text }}>{g.root_description}</div>
                            <div style={{ fontSize: 10, color: T.faint, fontFamily: mono, marginTop: 2 }}>{g.root_sku || "(no SKU)"}</div>
                            {g.variants.length > 1 && (
                              <div style={{ fontSize: 10, color: T.muted, marginTop: 4, fontFamily: mono }}>{sizesLabel}</div>
                            )}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", verticalAlign: "top" }}>{fmtN(g.qty_sold)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", verticalAlign: "top" }}>{fmtD(g.product_sales)}</td>
                          <td style={{ ...tdStyle, textAlign: "right", padding: "4px 6px", verticalAlign: "top" }}>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={raw}
                              onChange={e => setCostForGroup(e.target.value)}
                              onFocus={e => e.target.select()}
                              onBlur={e => {
                                const v = e.target.value;
                                if (!v.trim()) return;
                                const n = parseMoney(v);
                                const normalized = n === 0 ? "" : String(n);
                                if (normalized !== v) setCostForGroup(normalized);
                              }}
                              placeholder="0.00"
                              title={fromSaved && skuWithSaved ? `Saved from last run: ${fmtD(savedCosts[skuWithSaved])}` : undefined}
                              style={{ ...input, padding: "4px 8px", fontSize: 12, fontFamily: mono, textAlign: "right", width: "100%", borderColor: uc === 0 && raw.trim() ? T.red : fromSaved ? T.green + "55" : T.border }}
                            />
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", color: uc > 0 ? T.text : T.faint, verticalAlign: "top" }}>{uc > 0 ? fmtD(totalCost) : "—"}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: net >= 0 ? T.green : T.red, verticalAlign: "top" }}>{uc > 0 ? fmtD(net) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!salesPricingComplete && <div style={{ fontSize: 11, color: T.amber, marginTop: 6 }}>Add at least one product to continue. Blank costs are treated as $0 (free).</div>}
            </div>

            <div style={{ borderTop: `1px solid ${T.border}` }} />

            {/* Postage pricing — per-shipment markup + fee, or bulk note */}
            {!isBulkPostage && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.amber, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Postage Pricing</div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>HPD Markup</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="text" inputMode="decimal"
                    value={markupPct}
                    onChange={e => setMarkupPct(e.target.value)}
                    onFocus={e => e.target.select()}
                    onBlur={e => {
                      const v = e.target.value;
                      if (!v.trim()) { setMarkupPct("0"); return; }
                      const n = parseMoney(v);
                      if (String(n) !== v) setMarkupPct(String(n));
                    }}
                    style={{ ...input, fontSize: 14, fontWeight: 700, width: 120, fontFamily: mono, textAlign: "right" }}
                  />
                  <span style={{ fontSize: 12, color: T.muted, fontFamily: mono }}>
                    = {(parseMoney(markupPct) * 100).toFixed(1)}% markup on raw ShipStation cost
                  </span>
                </div>
                <div style={{ fontSize: 10, color: T.faint, marginTop: 6, lineHeight: 1.5 }}>
                  Postage billed: <strong style={{ color: T.text }}>Shipping Cost × (1 + markup) + Insurance</strong>.
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Fulfillment Fee — per package</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 14, color: T.muted, fontFamily: mono }}>$</span>
                  <input
                    type="text" inputMode="decimal"
                    value={perPackageFee}
                    onChange={e => setPerPackageFee(e.target.value)}
                    onFocus={e => e.target.select()}
                    onBlur={e => {
                      const v = e.target.value;
                      if (!v.trim()) { setPerPackageFee("0"); return; }
                      const n = parseMoney(v);
                      if (String(n) !== v) setPerPackageFee(String(n));
                    }}
                    style={{ ...input, fontSize: 14, fontWeight: 700, width: 120, fontFamily: mono, textAlign: "right" }}
                  />
                  <span style={{ fontSize: 12, color: T.muted, fontFamily: mono }}>
                    × {postageTotals.shipments.toLocaleString()} shipments = <strong style={{ color: T.text }}>{fmtD(postageTotals.fulfillment)}</strong>
                  </span>
                </div>
                <div style={{ fontSize: 10, color: T.faint, marginTop: 6, lineHeight: 1.5 }}>
                  Flat HPD service charge per shipment. Saves to client for next month.
                </div>
              </div>
            </div>
            )}

            {/* Postage pricing — bulk pass-through note */}
            {isBulkPostage && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.amber, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Postage — Pass-through</div>
              <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
                No markup or per-package fee applies to bulk postage. The client is billed exactly what HPD spent —
                <strong style={{ color: T.text }}> {fmtD(bulkPostageTotals.total)}</strong> across {fmtN(bulkPostageTotals.purchases)} purchase{bulkPostageTotals.purchases === 1 ? "" : "s"}.
              </div>
            </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button onClick={() => setStage(2)} style={btnGhost}>← Back</button>
              <button disabled={!canNextFrom3} onClick={() => setStage(4)} style={{ ...btnPrimary, opacity: canNextFrom3 ? 1 : 0.4, cursor: canNextFrom3 ? "pointer" : "not-allowed" }}>Next →</button>
            </div>
          </div>
        </>
      )}

      {/* ── Stage 4 — Review + generate (Full Service) ── */}
      {stage === 4 && isCombined && (
        <>
          <SalesTotalsStrip totals={salesTotals} />
          {isBulkPostage
            ? <BulkPostageTotalsStrip totals={bulkPostageTotals} />
            : <PostageTotalsStrip totals={postageTotals} />}
          <div style={{ ...card, display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 1040 }}>
            <div style={{ display: "grid", gridTemplateColumns: isBulkPostage ? "repeat(3, 1fr)" : "repeat(5, 1fr)", gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Client</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{client?.name || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Period</div>
                <input value={periodLabel} onChange={e => setPeriodLabel(e.target.value)} style={{ ...input, fontSize: 13, fontWeight: 700 }} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>HPD Fee</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="text" inputMode="decimal"
                    value={feePct}
                    onChange={e => setFeePct(e.target.value)}
                    onFocus={e => e.target.select()}
                    style={{ ...input, fontSize: 13, fontWeight: 700, width: 80, fontFamily: mono, textAlign: "right" }}
                  />
                  <span style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>({(parseMoney(feePct) * 100).toFixed(1)}%)</span>
                </div>
              </div>
              {!isBulkPostage && (<>
              <div>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Markup</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="text" inputMode="decimal"
                    value={markupPct}
                    onChange={e => setMarkupPct(e.target.value)}
                    onFocus={e => e.target.select()}
                    style={{ ...input, fontSize: 13, fontWeight: 700, width: 80, fontFamily: mono, textAlign: "right" }}
                  />
                  <span style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>({(parseMoney(markupPct) * 100).toFixed(1)}%)</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Per Package</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, color: T.muted, fontFamily: mono }}>$</span>
                  <input
                    type="text" inputMode="decimal"
                    value={perPackageFee}
                    onChange={e => setPerPackageFee(e.target.value)}
                    onFocus={e => e.target.select()}
                    style={{ ...input, fontSize: 13, fontWeight: 700, width: 80, fontFamily: mono, textAlign: "right" }}
                  />
                  <span style={{ fontSize: 11, color: T.muted, fontFamily: mono }}>× {postageTotals.shipments}</span>
                </div>
              </div>
              </>)}
            </div>

            {/* Per-half period overrides — editable here too since edit
                mode skips stage 1. Blank inherits the invoice period. */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Sales period <span style={{ color: T.faint, fontWeight: 400 }}>(if different)</span></div>
                <input value={salesPeriodLabel} onChange={e => setSalesPeriodLabel(e.target.value)} placeholder={periodLabel || "defaults to invoice period"} style={{ ...input, fontSize: 13 }} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Postage period <span style={{ color: T.faint, fontWeight: 400 }}>(if different)</span></div>
                <input value={postagePeriodLabel} onChange={e => setPostagePeriodLabel(e.target.value)} placeholder={periodLabel || "defaults to invoice period"} style={{ ...input, fontSize: 13 }} />
              </div>
            </div>

            {/* Combined invoice breakdown — what the client will pay. */}
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Invoice Breakdown</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, fontFamily: mono }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: T.muted }}>Service Fee ({(parseMoney(feePct) * 100).toFixed(1)}% of {fmtD(salesTotals.net)} net sales)</span>
                  <span style={{ color: T.text, fontWeight: 600 }}>{fmtD(salesTotals.fee)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: T.muted }}>{isBulkPostage ? "Postage reimbursement" : "Postage & Insurance"}</span>
                  <span style={{ color: T.text, fontWeight: 600 }}>{fmtD((isBulkPostage ? bulkPostageTotals : postageTotals).billed)}</span>
                </div>
                {!isBulkPostage && postageTotals.fulfillment > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ color: T.muted }}>Fulfillment Fee ({fmtD(parseMoney(perPackageFee))} × {fmtN(postageTotals.shipments)})</span>
                    <span style={{ color: T.text, fontWeight: 600 }}>{fmtD(postageTotals.fulfillment)}</span>
                  </div>
                )}
                <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 4, paddingTop: 6, display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 800 }}>
                  <span style={{ color: T.text }}>Total Invoice</span>
                  <span style={{ color: T.text }}>{fmtD(salesTotals.fee + (isBulkPostage ? bulkPostageTotals.billed : postageTotals.billed + postageTotals.fulfillment))}</span>
                </div>
              </div>
            </div>

            <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.6 }}>
              {groups.length} product{groups.length === 1 ? "" : "s"} ({selectedRows.length} variant{selectedRows.length === 1 ? "" : "s"}) · {fmtN(salesTotals.qty)} units · {fmtD(salesTotals.sales)} in sales
              <br />
              {isBulkPostage
                ? <>{fmtN(bulkPostageTotals.purchases)} postage purchase{bulkPostageTotals.purchases === 1 ? "" : "s"} · billed at cost · {fmtD(bulkPostageTotals.total)} reimbursement</>
                : <>{postageTotals.shipments} shipment{postageTotals.shipments === 1 ? "" : "s"} · {fmtD(postageTotals.paid)} shipping income · client profit {fmtD(postageTotals.margin)}</>}
            </div>

            {saveError && <div style={{ fontSize: 12, color: T.red, background: T.red + "11", padding: "8px 12px", borderRadius: 6 }}>{saveError}</div>}

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button onClick={() => setStage(3)} style={btnGhost} disabled={saving}>← Back</button>
              <button onClick={generate} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
                {generateBtnLabel}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Header master checkbox — replaces the Select all / Clear all buttons
// (Jon, Aug 31). Checked = all included, unchecked = none, dash = partial;
// clicking toggles between all and none.
function MasterCheck({ count, selected, onAll, onNone }: { count: number; selected: number; onAll: () => void; onNone: () => void }) {
  const all = count > 0 && selected === count;
  return (
    <input
      type="checkbox"
      checked={all}
      ref={el => { if (el) el.indeterminate = selected > 0 && selected < count; }}
      onChange={() => (all ? onNone() : onAll())}
      title={all ? "Clear all" : "Select all"}
      style={{ cursor: "pointer" }}
    />
  );
}

function SalesTotalsStrip({ totals }: { totals: { qty: number; sales: number; cost: number; net: number; fee: number; profit: number } }) {
  const fmt = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const items: { label: string; value: string; color?: string }[] = [
    { label: "Qty", value: Number(totals.qty).toLocaleString() },
    { label: "Product Sales", value: fmt(totals.sales) },
    { label: "Total Cost", value: fmt(totals.cost), color: T.muted },
    { label: "Product Net", value: fmt(totals.net) },
    { label: "HPD Fee", value: fmt(totals.fee), color: T.amber },
    { label: "Net Profit", value: fmt(totals.profit), color: T.green },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, width: "100%", maxWidth: 1040 }}>
      {items.map(i => (
        <div key={i.label} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>{i.label}</div>
          <div style={{ fontSize: 14, fontWeight: 700, fontFamily: mono, color: i.color || T.text }}>{i.value}</div>
        </div>
      ))}
    </div>
  );
}

function PostageTotalsStrip({ totals, fulfillmentOnly = false }: { totals: { shipments: number; items: number; paid: number; cost_raw: number; cost: number; insurance: number; billed: number; margin: number; fulfillment: number; invoice_total: number }; fulfillmentOnly?: boolean }) {
  const fmt = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Fulfillment-only: no postage is billed, so drop the income/cost/
  // insurance/billed/margin tiles and show just what's on the invoice.
  const tiles: { label: string; value: string; color?: string }[] = fulfillmentOnly ? [
    { label: "Shipments", value: Number(totals.shipments).toLocaleString() },
    { label: "Items Shipped", value: Number(totals.items || 0).toLocaleString() },
    { label: "Fulfillment Fee", value: fmt(totals.fulfillment), color: T.amber },
    { label: "Total Invoice", value: fmt(totals.fulfillment), color: T.green },
  ] : [
    { label: "Shipments", value: Number(totals.shipments).toLocaleString() },
    { label: "Items Shipped", value: Number(totals.items || 0).toLocaleString() },
    { label: "Shipping Income", value: fmt(totals.paid) },
    { label: "Shipping Cost", value: fmt(totals.cost), color: T.muted },
    { label: "Insurance", value: fmt(totals.insurance), color: T.muted },
    { label: "Billed Amount", value: fmt(totals.billed), color: T.amber },
    { label: "Client Profit", value: fmt(totals.margin), color: totals.margin >= 0 ? T.green : T.red },
    { label: "Fulfillment", value: fmt(totals.fulfillment), color: T.amber },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${fulfillmentOnly ? 4 : 8}, 1fr)`, gap: 8, width: "100%", maxWidth: 1040 }}>
      {tiles.map(i => (
        <div key={i.label} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>{i.label}</div>
          <div style={{ fontSize: 14, fontWeight: 700, fontFamily: mono, color: i.color || T.text }}>{i.value}</div>
        </div>
      ))}
    </div>
  );
}

// Bulk postage = pure pass-through, so only two numbers matter: how many
// purchases and the reimbursement total. Kept as its own 3-tile strip so
// it doesn't borrow the shipment strip's income/margin/markup columns
// (none of which apply to bulk).
function BulkPostageTotalsStrip({ totals }: { totals: { purchases: number; total: number } }) {
  const fmt = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tiles: { label: string; value: string; color?: string }[] = [
    { label: "Purchases", value: Number(totals.purchases).toLocaleString() },
    { label: "Billing", value: "Pass-through" },
    { label: "Reimbursement", value: fmt(totals.total), color: T.green },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, width: "100%", maxWidth: 1040 }}>
      {tiles.map(i => (
        <div key={i.label} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 9, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>{i.label}</div>
          <div style={{ fontSize: 14, fontWeight: 700, fontFamily: mono, color: i.color || T.text }}>{i.value}</div>
        </div>
      ))}
    </div>
  );
}
