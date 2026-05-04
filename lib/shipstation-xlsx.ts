import ExcelJS from "exceljs";

export type PostageLine = {
  ship_date: string;
  recipient: string;
  order_number: string;
  provider: string;
  service: string;
  package_type: string;
  items_count: number;
  zone: string;
  shipping_paid: number;
  shipping_cost_raw: number;
  shipping_cost: number;
  insurance_cost: number;
  weight: number;
  weight_unit: string;
  billed: number;
};

export type PostageTotals = {
  shipments: number;
  items: number;
  paid: number;
  cost_raw: number;
  cost: number;
  insurance: number;
  billed: number;
  margin: number;
  // Per-package fulfillment fee (added v2). Older reports omit these
  // and downstream readers default to 0.
  fulfillment?: number;
  invoice_total?: number;
};

function dateOnly(raw: string): string {
  if (!raw) return "";
  return raw.trim().split(/[\sT]/)[0];
}

export async function generatePostageXlsx(data: {
  clientName: string;
  periodLabel: string;
  invoiceNumber: string | null;
  generatedOn: string;
  perPackageFee?: number;
  lines: PostageLine[];
  totals: PostageTotals;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "House Party Distro";
  wb.created = new Date();

  const ws = wb.addWorksheet("Shipments", {
    views: [{ state: "frozen", ySplit: 10 }],
  });

  // Header block (no column widths yet — set at bottom).
  ws.mergeCells("A1:M1");
  const title = ws.getCell("A1");
  title.value = "HOUSE PARTY DISTRO — FULFILLMENT INVOICE";
  title.font = { name: "Helvetica", size: 14, bold: true, color: { argb: "FF111111" } };
  title.alignment = { vertical: "middle", horizontal: "left" };

  ws.getCell("A2").value = "Client:";
  ws.getCell("B2").value = data.clientName;
  ws.getCell("A3").value = "Period:";
  ws.getCell("B3").value = data.periodLabel;
  ws.getCell("A4").value = "Invoice #:";
  ws.getCell("B4").value = data.invoiceNumber || "—";
  ws.getCell("A5").value = "Generated:";
  ws.getCell("B5").value = data.generatedOn;

  for (const addr of ["A2", "A3", "A4", "A5"]) {
    ws.getCell(addr).font = { bold: true, color: { argb: "FF666666" }, size: 10 };
  }
  for (const addr of ["B2", "B3", "B4", "B5"]) {
    ws.getCell(addr).font = { size: 11, color: { argb: "FF111111" } };
  }

  // Totals strip — two rows of 4 label/value pairs each. Labels are
  // merged across two columns so longer ones ("Shipping Cost",
  // "Fulfillment Fee") don't get clipped by the narrow data-table
  // columns underneath. Each pair occupies 3 columns (2 for label, 1
  // for value) — 4 pairs × 3 cols = 12 columns of the 13 (A-M) wide.
  const fulfillment = Number(data.totals.fulfillment) || 0;
  const totalInvoice = Number(data.totals.billed || 0) + fulfillment;
  const FMT_INT = "#,##0";
  const FMT_USD = '"$"#,##0.00';
  type Pair = { label: string; value: number; fmt: string };
  const row7Pairs: Pair[] = [
    { label: "Shipments",       value: data.totals.shipments, fmt: FMT_INT },
    { label: "Items Shipped",   value: data.totals.items,     fmt: FMT_INT },
    { label: "Shipping Income", value: data.totals.paid,      fmt: FMT_USD },
    { label: "Shipping Cost",   value: data.totals.cost,      fmt: FMT_USD },
  ];
  const row8Pairs: Pair[] = [
    { label: "Insurance",       value: data.totals.insurance, fmt: FMT_USD },
    { label: "Billed Amount",   value: data.totals.billed,    fmt: FMT_USD },
    { label: "Client Profit",   value: data.totals.margin,    fmt: FMT_USD },
    { label: "Fulfillment Fee", value: fulfillment,           fmt: FMT_USD },
  ];
  // Pair n (0-indexed) occupies columns starting at 1 + n*3:
  //   pair 0 → A:B (label) / C (value)
  //   pair 1 → D:E (label) / F (value)
  //   pair 2 → G:H (label) / I (value)
  //   pair 3 → J:K (label) / L (value)
  const writePair = (rowNum: number, pairIdx: number, p: Pair) => {
    const labelStartCol = 1 + pairIdx * 3;
    const valueCol = labelStartCol + 2;
    const labelCell = ws.getCell(rowNum, labelStartCol);
    const valueCell = ws.getCell(rowNum, valueCol);
    labelCell.value = p.label;
    valueCell.value = p.value;
    ws.mergeCells(rowNum, labelStartCol, rowNum, labelStartCol + 1);
    labelCell.font = { bold: true, size: 9, color: { argb: "FF888888" } };
    labelCell.alignment = { horizontal: "right", vertical: "middle" };
    valueCell.font = { bold: true, size: 11, color: { argb: "FF111111" } };
    valueCell.numFmt = p.fmt;
    valueCell.alignment = { horizontal: "left", vertical: "middle" };
  };
  row7Pairs.forEach((p, i) => writePair(7, i, p));
  row8Pairs.forEach((p, i) => writePair(8, i, p));

  // Total Invoice row — grand total = postage billed + fulfillment.
  // Label spans A9:B9 so "Total Invoice:" doesn't overflow into the
  // value cell. Value lives in C9, formatted as currency.
  ws.mergeCells("A9:B9");
  const totalLabel = ws.getCell("A9");
  totalLabel.value = "Total Invoice:";
  totalLabel.font = { bold: true, size: 11, color: { argb: "FF111111" } };
  totalLabel.alignment = { horizontal: "right", vertical: "middle" };
  const totalValue = ws.getCell("C9");
  totalValue.value = totalInvoice;
  totalValue.font = { bold: true, size: 13, color: { argb: "FF111111" } };
  totalValue.numFmt = FMT_USD;
  totalValue.alignment = { horizontal: "left", vertical: "middle" };

  // Column headers at row 10.
  const headers = [
    "Date",
    "Order #",
    "Recipient",
    "Provider",
    "Service",
    "Package",
    "Items",
    "Weight",
    "Zone",
    "Shipping Paid",
    "Shipping Cost",
    "Insurance",
    "Billed",
  ];
  const headerRow = ws.getRow(10);
  headerRow.values = headers;
  headerRow.eachCell(cell => {
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A1A1A" } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = { bottom: { style: "thin", color: { argb: "FF1A1A1A" } } };
  });

  // Data rows start at row 11.
  for (const r of data.lines) {
    const weight = r.weight ? `${r.weight} ${r.weight_unit || ""}`.trim() : "";
    ws.addRow([
      dateOnly(r.ship_date),
      r.order_number || "",
      r.recipient || "",
      r.provider || "",
      r.service || "",
      r.package_type || "",
      Number(r.items_count) || 0,
      weight,
      r.zone || "",
      Number(r.shipping_paid) || 0,
      Number(r.shipping_cost) || 0,
      Number(r.insurance_cost) || 0,
      Number(r.billed) || 0,
    ]);
  }

  // Totals row at the bottom.
  const firstDataRow = 11;
  const lastDataRow = 10 + data.lines.length;
  const totalsRowIdx = lastDataRow + 1;
  ws.getCell(`A${totalsRowIdx}`).value = "TOTALS";
  ws.getCell(`A${totalsRowIdx}`).font = { bold: true, size: 10 };
  ws.getCell(`G${totalsRowIdx}`).value = { formula: `SUM(G${firstDataRow}:G${lastDataRow})` };
  ws.getCell(`J${totalsRowIdx}`).value = { formula: `SUM(J${firstDataRow}:J${lastDataRow})` };
  ws.getCell(`K${totalsRowIdx}`).value = { formula: `SUM(K${firstDataRow}:K${lastDataRow})` };
  ws.getCell(`L${totalsRowIdx}`).value = { formula: `SUM(L${firstDataRow}:L${lastDataRow})` };
  ws.getCell(`M${totalsRowIdx}`).value = { formula: `SUM(M${firstDataRow}:M${lastDataRow})` };
  for (const col of ["G", "J", "K", "L", "M"]) {
    const c = ws.getCell(`${col}${totalsRowIdx}`);
    c.font = { bold: true, size: 10 };
    if (col === "G") c.numFmt = "#,##0";
    else c.numFmt = '"$"#,##0.00';
    c.border = { top: { style: "thin", color: { argb: "FF1A1A1A" } } };
  }

  // Number formats on the money + count columns for all data rows.
  for (let r = firstDataRow; r <= lastDataRow; r++) {
    ws.getCell(`G${r}`).numFmt = "#,##0";
    ws.getCell(`J${r}`).numFmt = '"$"#,##0.00';
    ws.getCell(`K${r}`).numFmt = '"$"#,##0.00';
    ws.getCell(`L${r}`).numFmt = '"$"#,##0.00';
    ws.getCell(`M${r}`).numFmt = '"$"#,##0.00';
  }

  // Column widths tuned to the content.
  ws.columns = [
    { width: 12 },  // Date
    { width: 16 },  // Order #
    { width: 28 },  // Recipient
    { width: 12 },  // Provider
    { width: 22 },  // Service
    { width: 18 },  // Package
    { width: 8 },   // Items
    { width: 12 },  // Weight
    { width: 8 },   // Zone
    { width: 14 },  // Shipping Paid
    { width: 14 },  // Shipping Cost
    { width: 12 },  // Insurance
    { width: 12 },  // Billed
  ];

  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab as ArrayBuffer);
}
