import { createClient } from "@/lib/supabase/server";
import { loadShippingBoard, loadForwardedShipments } from "@/lib/item-state";
import Board from "./Board";

export const dynamic = "force-dynamic";

// Shipping v2 — parallel dev surface. ship_through orders whose received goods
// forward to the client. Does NOT touch the live /shipping.
export default async function Shipping2Page() {
  const sb = await createClient();
  const [jobs, forwarded] = await Promise.all([loadShippingBoard(sb), loadForwardedShipments(sb)]);
  return <Board jobs={JSON.parse(JSON.stringify(jobs))} forwarded={JSON.parse(JSON.stringify(forwarded))} />;
}
