import { createClient } from "@/lib/supabase/server";
import { loadStagingBoard } from "@/lib/item-state";
import StagingBoard from "@/components/StagingBoard";

export const dynamic = "force-dynamic";

// Staging — front-office E-Comm side. The SAME surface as the distro /staging2,
// mirrored: shared state, one action ("Enter into Shopify" ends OpsHub's road).
export default async function EcommStagingPage() {
  const sb = await createClient();
  const items = await loadStagingBoard(sb);
  return <StagingBoard items={JSON.parse(JSON.stringify(items))} side="ecomm" />;
}
