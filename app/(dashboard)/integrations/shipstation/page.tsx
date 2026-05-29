"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { T, font, mono } from "@/lib/theme";
import { useIsMobile } from "@/lib/useIsMobile";

const fmtD = (n: number) => "$" + Math.round(n).toLocaleString();

type ShipstationReport = {
  id: string;
  client_id: string;
  report_type: string;
  period_label: string;
  created_at: string;
  totals: any;
  postage_totals: any;
  per_package_fee: number | null;
  clients: { name: string } | null;
};

export default function ShipStationIntegrationPage() {
  const supabase = createClient();
  const isMobile = useIsMobile();
  const [reports, setReports] = useState<ShipstationReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("shipstation_reports")
      .select(
        "id, client_id, report_type, postage_mode, period_label, created_at, totals, postage_totals, per_package_fee, clients(name)"
      )
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setReports((data || []) as any);
        setLoading(false);
      });
  }, []);

  const thStyle: React.CSSProperties = {
    padding: "8px 10px",
    fontSize: 10,
    fontWeight: 700,
    color: T.muted,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    borderBottom: `1px solid ${T.border}`,
  };
  const tdStyle: React.CSSProperties = {
    padding: "10px",
    fontSize: 12,
    color: T.text,
    borderBottom: `1px solid ${T.border}`,
  };

  return (
    <div style={{ fontFamily: font, color: T.text, maxWidth: 1100, margin: "0 auto" }}>
      <Link
        href="/integrations"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 12,
          color: T.muted,
          textDecoration: "none",
          marginBottom: 10,
        }}
      >
        <ChevronLeft size={14} />
        Integrations
      </Link>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
            ShipStation
          </h1>
          <p style={{ fontSize: 12, color: T.faint, marginTop: 4 }}>
            Fulfillment reports — postage, sales, and combined invoices. Reports push to QuickBooks
            as line items.
          </p>
        </div>
        <Link
          href="/reports/shipstation/new"
          style={{
            background: T.accent,
            border: "none",
            borderRadius: 6,
            color: "#fff",
            fontSize: 12,
            fontFamily: font,
            fontWeight: 700,
            padding: "8px 16px",
            cursor: "pointer",
            textDecoration: "none",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          + Create Report
        </Link>
      </div>

      <div
        style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          padding: 16,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: T.muted,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            marginBottom: 12,
          }}
        >
          Recent Reports
        </div>
        {loading ? (
          <div style={{ fontSize: 12, color: T.muted, padding: "16px 0", textAlign: "center" }}>
            Loading reports…
          </div>
        ) : reports.length === 0 ? (
          <div style={{ fontSize: 12, color: T.faint, padding: "16px 0", textAlign: "center" }}>
            No reports yet. Create your first one above.
          </div>
        ) : (
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: isMobile ? 680 : "auto",
              }}
            >
              <thead>
                <tr>
                  {["Type", "Client", "Period", "Generated", "Volume", "Revenue", "Result", ""].map(
                    (h) => (
                      <th
                        key={h}
                        style={{
                          ...thStyle,
                          textAlign: ["Type", "Client", "Period"].includes(h) ? "left" : "right",
                        }}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {reports.map((r: any) => {
                  const isPostage = r.report_type === "postage";
                  const isCombined = r.report_type === "combined";
                  const totals = r.totals || {};
                  const post = r.postage_totals || {};
                  // Bulk postage is pass-through: no shipment count / margin.
                  // Show the purchase count, and bill = reimbursement total.
                  const isBulk = (isPostage || isCombined) && r.postage_mode === "bulk";
                  const bulkCount = isCombined ? (Number(post.purchases) || 0) : (Number(totals.purchases) || 0);
                  const volume = isCombined
                    ? `${(totals.qty || 0).toLocaleString()} + ${isBulk ? `${bulkCount.toLocaleString()} buys` : `${(post.shipments || 0).toLocaleString()} ship`}`
                    : isPostage
                    ? (isBulk ? `${bulkCount.toLocaleString()} buys` : `${(totals.shipments || 0).toLocaleString()} ship`)
                    : (totals.qty || 0).toLocaleString();
                  const revenue = isCombined
                    ? (Number(totals.sales) || 0) + (isBulk ? (Number(post.billed) || 0) : (Number(post.paid) || 0))
                    : isPostage
                    ? (isBulk ? (Number(totals.billed) || 0) : (totals.paid || 0))
                    : totals.sales || 0;
                  const result = isCombined
                    ? (Number(totals.fee) || 0) +
                      (Number(post.billed) || 0) +
                      (Number(post.fulfillment) || 0)
                    : isPostage
                    ? (isBulk ? (Number(totals.billed) || 0) : (totals.margin || 0))
                    : totals.profit || 0;
                  const resultColor = !isCombined && isPostage && !isBulk && result < 0 ? T.red : T.green;
                  const typeLabel = isCombined ? "Full Svc" : isPostage ? "Postage" : "Sales";
                  const typeColor = isCombined ? T.purple : isPostage ? T.amber : T.accent;
                  return (
                    <tr key={r.id}>
                      <td
                        style={{
                          ...tdStyle,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          fontSize: 10,
                          color: typeColor,
                          fontWeight: 700,
                        }}
                      >
                        {typeLabel}
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{r.clients?.name || "—"}</td>
                      <td style={tdStyle}>{r.period_label}</td>
                      <td style={{ ...tdStyle, textAlign: "right", color: T.muted }}>
                        {new Date(r.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontFamily: mono }}>
                        {volume}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontFamily: mono, color: T.accent }}>
                        {fmtD(revenue)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontFamily: mono, color: resultColor }}>
                        {fmtD(result)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <Link
                          href={`/reports/shipstation/${r.id}`}
                          style={{ color: T.accent, fontSize: 11, textDecoration: "none" }}
                        >
                          Open →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
