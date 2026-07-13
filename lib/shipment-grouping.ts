// Shipment grouping — what becomes ONE box (the Shipment object). Pure.
//
// The agreed rule (spec H1/H7): a box is defined by how it left the vendor, and
// a single box can span multiple jobs (1 to 97). So the key is vendor + method,
// and DOES NOT include job — a freight BOL or a day's pickup consolidates many
// jobs into one box.
//   tracking # → vendor + tracking
//   freight BOL → vendor + BOL   (spans jobs)
//   pickup      → vendor + DAY   (a vendor's whole pickup that day = one box)

export type ShipMethod = "tracking" | "bol" | "pickup";

const norm = (s: string | null | undefined): string => (s || "").trim().toUpperCase() || "none";

export function shipmentGroupKey(f: {
  vendorKey: string | null;      // decorator id (preferred) or name
  method: ShipMethod;
  tracking?: string | null;
  bol?: string | null;
  shipDate?: string | null;      // ISO — only the day is used, for pickup
}): string {
  const v = (f.vendorKey || "unassigned").trim() || "unassigned";
  if (f.method === "tracking") return `${v}::trk:${norm(f.tracking)}`;
  if (f.method === "bol") return `${v}::bol:${norm(f.bol)}`;
  const day = (f.shipDate || "").slice(0, 10) || "unknown";   // per vendor, per day
  return `${v}::pickup:${day}`;
}

// A human label for the box, shown on the receiving list / everywhere.
export function shipmentLabel(f: {
  method: ShipMethod;
  tracking?: string | null;
  bol?: string | null;
  shipDate?: string | null;
  vendorName?: string | null;
}): string {
  if (f.method === "tracking") return f.tracking || "(no tracking)";
  if (f.method === "bol") return `BOL ${f.bol || "—"} · Freight`;
  // pickup — "Pickup · Jul 12"  (the day; a vendor's batch for that day)
  const d = (f.shipDate || "").slice(0, 10);
  return `Pickup${d ? " · " + d : ""}`;
}
