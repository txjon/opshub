import { createClient } from "@/lib/supabase/server";
import { loadProductionBoard } from "@/lib/item-state";
import Board from "./Board";

export const dynamic = "force-dynamic";

// Production v2 — parallel dev surface, built on the movement-ledger model
// (lib/item-derivation + lib/item-state). Read-only board + selection here;
// the ship write is the next slice. Does NOT touch the live /production board.
export default async function Production2Page() {
  const sb = await createClient();
  const strips = await loadProductionBoard(sb);
  return <Board strips={JSON.parse(JSON.stringify(strips))} />;
}
