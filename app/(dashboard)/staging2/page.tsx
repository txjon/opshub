import { createClient } from "@/lib/supabase/server";
import { loadStagingBoard } from "@/lib/item-state";
import StagingBoard from "@/components/StagingBoard";

export const dynamic = "force-dynamic";

// Staging v2 (distro side) — stage-route items staged for Shopify entry.
// Mirrored with the front-office E-Comm page (/ecomm/staging), same component.
export default async function Staging2Page() {
  const sb = await createClient();
  const items = await loadStagingBoard(sb);
  return <StagingBoard items={JSON.parse(JSON.stringify(items))} side="distro" />;
}
