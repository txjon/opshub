import { createClient } from "@/lib/supabase/server";
import { loadProductionBoard, loadFreightCarriers, loadRecentShipments } from "@/lib/item-state";
import Board from "./Board";

export const dynamic = "force-dynamic";

// Production v2 — parallel dev surface, built on the movement-ledger model
// (lib/item-derivation + lib/item-state). Ship write is gated to the test job.
// Does NOT touch the live /production board.
export default async function Production2Page() {
  const sb = await createClient();
  const [strips, freightCarriers, shippedBoxes] = await Promise.all([
    loadProductionBoard(sb), loadFreightCarriers(sb), loadRecentShipments(sb),
  ]);
  return <Board strips={JSON.parse(JSON.stringify(strips))} freightCarriers={freightCarriers} shippedBoxes={JSON.parse(JSON.stringify(shippedBoxes))} />;
}
