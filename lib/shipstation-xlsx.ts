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

  // Totals strip — two rows, label + value pairs.
  const totalsRow1: (string | number)[] = [
    "Shipments", data.totals.shipments,
    "Items Shipped", data.totals.items,
    "Shipping Income", data.totals.paid,
    "Shipping Cost", data.totals.cost,
  ];
  const totalsRow2: (string | number)[] = [
    "Insurance", data.totals.insurance,
    "Billed Amount", data.totals.billed,
    "Client Profit", data.totals.margin,
    "", "",
  ];
  ws.getRow(7).values = totalsRow1;
  ws.getRow(8).values = totalsRow2;

  // Style label cells (odd-indexed) and value cells (even-indexed).
  for (const rowNum of [7, 8]) {
    const row = ws.getRow(rowNum);
    row.eachCell((cell, colNum) => {
      if (colNum % 2 === 1) {
        cell.font = { bold: true, size: 9, color: { argb: "FF888888" } };
        cell.alignment = { horizontal: "right" };
      } else {
        cell.font = { bold: true, size: 11, color: { argb: "FF111111" } };
        cell.numFmt = colNum === 4 ? "#,##0" : '"$"#,##0.00';
        cell.alignment = { horizontal: "left" };
      }
    });
  }

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
