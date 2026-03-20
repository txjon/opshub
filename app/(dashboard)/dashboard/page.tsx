import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: jobs } = await supabase
    .from("jobs")
    .select("*, clients(name)")
    .not("phase", "in", '("complete","cancelled")')
    .order("target_ship_date", { ascending: true, nullsFirst: false });

  const { data: alerts } = await supabase
    .from("alerts")
    .select("*")
    .eq("is_dismissed", false)
    .is("resolved_at", null)
    .in("severity", ["critical", "warning"])
    .order("severity")
    .limit(10);

  const phaseColors: Record<string, string> = {
    intake: "text-muted-foreground",
    pre_production: "text-purple-400",
    production: "text-blue-400",
    receiving: "text-amber-400",
    shipping: "text-green-400",
    complete: "text-green-600",
    on_hold: "text-red-400",
    cancelled: "text-muted-foreground",
  };

  const phaseBg: Record<string, string> = {
    intake: "bg-secondary",
    pre_production: "bg-purple-950",
    production: "bg-blue-950",
    receiving: "bg-amber-950",
    shipping: "bg-green-950",
    complete: "bg-green-950",
    on_hold: "bg-red-950",
    cancelled: "bg-secondary",
  };

  const now = new Date();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {jobs?.length ?? 0} active jobs
        </p>
      </div>

      {/* Critical alerts */}
      {alerts && alerts.length > 0 && (
        <div className="rounded-xl border border-amber-900/50 bg-amber-950/30 p-4 space-y-2">
          <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">Action Needed</p>
          {alerts.map(alert => (
            <div key={alert.id} className="flex items-start gap-3 bg-card rounded-lg p-3">
              <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${alert.severity === "critical" ? "bg-destructive" : "bg-amber-400"}`} />
              <div>
                <p className="text-sm font-medium">{alert.message}</p>
                <p className="text-xs text-muted-foreground mt-0.5 capitalize">{alert.alert_type.replace(/_/g, " ")}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Jobs list */}
      <div className="space-y-2">
        {jobs?.length === 0 && (
          <div className="rounded-xl border border-border bg-card p-12 text-center">
            <p className="text-muted-foreground text-sm">No active jobs. Create your first job to get started.</p>
            <a href="/jobs/new" className="inline-block mt-4 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity">
              Create job
            </a>
          </div>
        )}
        {jobs?.map(job => {
          const daysLeft = job.target_ship_date
            ? Math.ceil((new Date(job.target_ship_date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
            : null;
          return (
            <a
              key={job.id}
              href={`/jobs/${job.id}`}
              className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 hover:bg-secondary/50 transition-colors"
            >
              <div className={`px-2.5 py-1 rounded-md text-xs font-semibold shrink-0 ${phaseBg[job.phase]} ${phaseColors[job.phase]}`}>
                {job.phase.replace(/_/g, " ")}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{job.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {(job.clients as { name: string } | null)?.name} &middot; {job.job_number}
                </p>
              </div>
              <div className="shrink-0 text-right">
                {daysLeft !== null ? (
                  <>
                    <p className={`text-sm font-bold ${daysLeft < 0 ? "text-destructive" : daysLeft <= 3 ? "text-amber-400" : "text-muted-foreground"}`}>
                      {daysLeft < 0 ? `${Math.abs(daysLeft)}d over` : daysLeft === 0 ? "Today" : `${daysLeft}d`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(job.target_ship_date!).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">No date</p>
                )}
              </div>
              <div className={`w-2 h-2 rounded-full shrink-0 ${job.priority === "urgent" ? "bg-destructive" : job.priority === "high" ? "bg-amber-400" : "bg-transparent"}`} />
            </a>
          );
        })}
      </div>
    </div>
  );
}
