import { createClient } from "@/lib/supabase/server";
import { loadReceivingBoard, loadPulls } from "@/lib/item-state";
import Board from "./Board";

export const dynamic = "force-dynamic";

// Receiving v2 — parallel dev surface. Box-centric list of inbound boxes (the
// shipments /production2 creates) + the receive write + held pulls. Does NOT
// touch the live /receiving.
export default async function Receiving2Page() {
  const sb = await createClient();
  const [boxes, pulls] = await Promise.all([loadReceivingBoard(sb), loadPulls(sb)]);
  return <Board boxes={JSON.parse(JSON.stringify(boxes))} pulls={JSON.parse(JSON.stringify(pulls))} />;
}
