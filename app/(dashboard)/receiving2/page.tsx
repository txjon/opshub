import { createClient } from "@/lib/supabase/server";
import { loadReceivingBoard } from "@/lib/item-state";
import Board from "./Board";

export const dynamic = "force-dynamic";

// Receiving v2 — parallel dev surface. Box-centric list of inbound boxes (the
// shipments /production2 creates), built on the same read layer. Read-only board
// here; the receive write is the next slice. Does NOT touch the live /receiving.
export default async function Receiving2Page() {
  const sb = await createClient();
  const boxes = await loadReceivingBoard(sb);
  return <Board boxes={JSON.parse(JSON.stringify(boxes))} />;
}
