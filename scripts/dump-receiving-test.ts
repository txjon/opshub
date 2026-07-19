// Read-only: dump ALL data that carried over into Receiving for the test job's
// shipments, both (a) what the receiving surface shows and (b) the raw records.
//   run:  npx tsx scripts/dump-receiving-test.ts
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { loadReceivingBoard } from "../lib/item-state";

let KEY = "", URL = "";
for (const line of readFileSync("/Users/jonburrow/opshub/.env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (!m) continue;
  if (m[1] === "SUPABASE_SERVICE_ROLE_KEY") KEY = m[2].replace(/^"|"$/g, "");
  if (m[1] === "NEXT_PUBLIC_SUPABASE_URL") URL = m[2].replace(/^"|"$/g, "");
}
const sb = createClient(URL, KEY);
const tq = (q: any) => Object.entries(q || {}).filter(([, n]) => n).map(([s, n]) => `${s}:${n}`).join(" ") || "—";

(async () => {
  const boxes = await loadReceivingBoard(sb as any);
  const test = boxes.filter(b => b.lines.some(l => l.client === "Playwright Test Co"));
  console.log(`\n===== SURFACE VIEW — ${test.length} test box(es) in Receiving =====`);
  for (const b of test) {
    console.log(`\n┌─ BOX ${b.id}`);
    console.log(`│  vendor:        ${b.vendorName}`);
    console.log(`│  how it left:   ${b.pickup ? "PICKUP" : "carrier=" + (b.carrier || "—") + "  tracking=" + (b.tracking || "—")}`);
    console.log(`│  status:        ${b.status}   allReceived=${b.allReceived}`);
    console.log(`│  ETA:           ${b.expectedArrival || "—"}`);
    console.log(`│  created:       ${b.createdAt}`);
    console.log(`│  received_at:   ${b.receivedAt || "—"}`);
    console.log(`│  slips:         ${b.slips.length ? b.slips.map(s => s.name).join(", ") : "none"}`);
    console.log(`│  clients:       ${b.clients.join(", ")}`);
    console.log(`│  totals:        ${b.lines.length} items · ${b.totalUnits} shipped units · ${b.receivedUnits} received`);
    for (const l of b.lines) {
      console.log(`│   • ITEM ${l.itemName}  (item_id ${l.itemId.slice(0, 8)}…, job ${l.jobId.slice(0, 8)}…)`);
      console.log(`│       client/invoice: ${l.client} / ${l.invoiceNumber || "no invoice"}`);
      console.log(`│       route:          ${l.route}`);
      console.log(`│       ordered total:  ${l.orderedTotal}`);
      console.log(`│       shipped (per size): ${tq(l.shipQtys)}`);
      console.log(`│       received (per size): ${tq(l.receivedQtys)}   cumReceived: ${tq(l.cumReceived)}`);
      console.log(`│       received flag:   ${l.received}`);
      console.log(`│       thumbnail:       ${l.mockupFileId ? "yes (" + l.mockupFileId.slice(0, 8) + "…)" : "none"}`);
      console.log(`│       pulls carried:   ${l.pullRequests.length ? l.pullRequests.map(p => `${p.kind || "pull"} ${tq(p.qtys)}${p.reason ? " → " + p.reason : ""}`).join(" | ") : "none"}`);
    }
    console.log(`└─`);
  }

  // raw shipment + line + movement records, so nothing hidden
  const ids = test.map(b => b.id);
  if (ids.length) {
    const { data: ships } = await sb.from("shipments").select("*").in("id", ids);
    console.log(`\n===== RAW shipments rows (every column) =====`);
    for (const s of ships || []) console.log(JSON.stringify(s, null, 0));
    const { data: lines } = await sb.from("shipment_lines").select("*").in("shipment_id", ids);
    console.log(`\n===== RAW shipment_lines rows =====`);
    for (const l of lines || []) console.log(JSON.stringify(l, null, 0));
    const itemIds = Array.from(new Set((lines || []).map((l: any) => l.item_id)));
    const { data: movs } = await sb.from("movements").select("item_id, type, qtys, tracking, shipment_id, reverses_id, reason, created_at").in("item_id", itemIds).order("created_at", { ascending: true });
    console.log(`\n===== RAW movements (ledger) for these items =====`);
    for (const m of movs || []) console.log(`${m.created_at}  ${m.type.padEnd(8)} ${tq(m.qtys).padEnd(28)} ship=${(m.shipment_id || "—").toString().slice(0, 8)} ${m.reverses_id ? "[REVERSAL]" : ""} ${m.reason || ""}`);
  }
})();
