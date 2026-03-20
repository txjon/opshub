import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function ProductionPage() {
  const supabase = await createClient();

  const { data: assignments } = await supabase
    .from("decorator_assignments")
    .select("*, items(name, status, job_id, jobs(title, job_number, target_ship_date, clients(name))), decorators(name)")
    .not("pipeline_stage", "eq", "shipped")
    .order("created_at");

  const stageOrder = ["blanks_ordered","blanks_shipped","blanks_received","strikeoff_approval","in_production","shipped"];
  const stageLabel: Record<string, string> = {
    blanks_ordered: "Blanks Ordered", blanks_shipped: "Blanks Shipped",
    blanks_received: "Blanks Received", strikeoff_approval: "Strike-off Approval",
    in_production: "In Production", shipped: "Shipped",
  };

  const byStage = stageOrder.slice(0, 5).reduce((acc, stage) => {
    acc[stage] = (assignments ?? []).filter(a => a.pipeline_stage === stage);
    return acc;
  }, {} as Record<string, typeof assignments>);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Production</h1>
        <p className="text-muted-foreground text-sm mt-1">{assignments?.length ?? 0} active decorator assignments</p>
      </div>

      <div className="grid grid-cols-5 gap-3">
        {stageOrder.slice(0, 5).map(stage => (
          <div key={stage} className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{stageLabel[stage]}</p>
              <span className="text-xs text-muted-foreground font-mono">{byStage[stage]?.length ?? 0}</span>
            </div>
            {byStage[stage]?.map(a => {
              const item = a.items as {
                name: string; status: string; job_id: string;
                jobs: { title: string; job_number: string; target_ship_date: string | null; clients: { name: string } | null } | null;
              } | null;
              return (
                <Link key={a.id} href={`/jobs/${item?.job_id}`}
                  className="block rounded-lg border border-border bg-card p-3 hover:bg-secondary/50 transition-colors space-y-1.5">
                  <p className="text-xs font-semibold leading-tight">{item?.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{item?.jobs?.clients?.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{item?.jobs?.job_number}</p>
                  {(a.decorators as { name: string } | null) && (
                    <p className="text-xs text-primary truncate">{(a.decorators as { name: string }).name}</p>
                  )}
                </Link>
              );
            })}
            {!byStage[stage]?.length && (
              <div className="rounded-lg border border-dashed border-border p-3 text-center">
                <p className="text-xs text-muted-foreground">Empty</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
