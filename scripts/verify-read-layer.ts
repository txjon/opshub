// Phase 1 integration check — proves lib/item-state.loadItemState wires the real
// tables into the derivation correctly. Loads live items that have ledger
// movements and cross-checks the derived totals against a raw movement sum.
//   run:  npx tsx scripts/verify-read-layer.ts
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { loadItemState } from "../lib/item-state";

let KEY = "", URL = "";
for (const line of readFileSync("/Users/jonburrow/opshub/.env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (!m) continue;
  if (m[1] === "SUPABASE_SERVICE_ROLE_KEY") KEY = m[2].replace(/^"|"$/g, "");
  if (m[1] === "NEXT_PUBLIC_SUPABASE_URL") URL = m[2].replace(/^"|"$/g, "");
}
const sb = createClient(URL, KEY);

const netRaw = (moves: any[], type: string) => {
  const out: Record<string, number> = {};
  for (const m of moves) { if (m.type !== type) continue; for (const [s, n] of Object.entries(m.qtys || {})) out[s] = (out[s] || 0) + (Number(n) || 0); }
  return Object.values(out).reduce((a, n) => a + (n > 0 ? n : 0), 0);
};

(async () => {
  // items that actually have movements
  const { data: moves } = await sb.from("movements").select("item_id, type").limit(4000);
  const ids = Array.from(new Set((moves || []).map((m: any) => m.item_id).filter(Boolean))).slice(0, 12);
  console.log(`Checking ${ids.length} live items with ledger movements\n`);

  let pass = 0, fail = 0;
  for (const id of ids) {
    const st = await loadItemState(sb, id as string);
    if (!st) { console.log(`  ? ${id} — not found`); continue; }
    const { data: raw } = await sb.from("movements").select("type, qtys").eq("item_id", id);
    const rShip = netRaw(raw || [], "ship"), rRecv = netRaw(raw || [], "receive"), rFwd = netRaw(raw || [], "forward");
    const okShip = st.shippedTotal === rShip, okRecv = st.receivedTotal === rRecv, okFwd = st.forwardedTotal === rFwd;
    const good = okShip && okRecv && okFwd;
    good ? pass++ : fail++;
    console.log(`  ${good ? "✓" : "✗"} ${st.name?.slice(0, 28).padEnd(28)} route=${st.route.padEnd(12)} ship=${st.shippedTotal} recv=${st.receivedTotal} fwd=${st.forwardedTotal} owed=${st.owedTotal} short=${st.shortageTotal} status=${st.status}${st.done ? " ·done" : ""}`);
    if (!good) console.log(`      MISMATCH vs raw ledger: ship ${st.shippedTotal}/${rShip} recv ${st.receivedTotal}/${rRecv} fwd ${st.forwardedTotal}/${rFwd}`);
  }
  console.log(`\n${"─".repeat(48)}\n  ${fail === 0 ? "✓ derived totals match the raw ledger" : "✗ MISMATCHES"} — ${pass} ok, ${fail} bad`);
  process.exit(fail ? 1 : 0);
})();
