import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function ShippingPage() {
  const supabase = await createClient();

  const { data: jobs } = await supabase
    .from("jobs")
    .select("*, clients(name), shipments(*)")
    .eq("phase", "shipping")
    .order("target_ship_date", { ascending: true, nullsFirst: false });

  const shipmentStatusColor: Record<string, string> = {
    pending: "text-muted-foreground",
    in_transit: "text-blue-400",
    delivered: "text-green-400",
    exception: "text-destructive",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Shipping</h1>
        <p className="text-muted-foreground text-sm mt-1">{jobs?.length ?? 0} projects in fulfillment</p>
      </div>

      {!jobs?.length && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-muted-foreground text-sm">No projects currently in shipping phase.</p>
        </div>
      )}

      {jobs?.map(job => {
        const shipments = (job.shipments as Array<{
          id: string; shipment_type: string; carrier: string | null;
          tracking_number: string | null; status: string; destination: string | null; est_delivery: string | null;
        }>) ?? [];
        const now = new Date();
        const daysLeft = job.target_ship_date
          ? Math.ceil((new Date(job.target_ship_date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          : null;

        return (
          <div key={job.id} className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div>
                <Link href={`/jobs/${job.id}`} className="font-semibold hover:text-primary transition-colors">
                  {job.title}
                </Link>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {(job.clients as { name: string } | null)?.name} &middot; {job.job_number}
                </p>
              </div>
              {daysLeft !== null && (
                <div className={`text-sm font-bold ${daysLeft < 0 ? "text-destructive" : daysLeft <= 3 ? "text-amber-400" : "text-muted-foreground"}`}>
                  {daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : daysLeft === 0 ? "Ships today" : `${daysLeft}d to ship`}
                </div>
              )}
            </div>

            {shipments.length > 0 ? (
              <div className="divide-y divide-border">
                {shipments.map(s => (
                  <div key={s.id} className="flex items-center gap-4 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium capitalize">{s.shipment_type?.replace(/_/g, " ")}</p>
                      {s.destination && <p className="text-xs text-muted-foreground truncate">{s.destination}</p>}
                    </div>
                    {s.carrier && <p className="text-xs text-muted-foreground">{s.carrier}</p>}
                    {s.tracking_number && (
                      <p className="text-xs font-mono text-muted-foreground">{s.tracking_number}</p>
                    )}
                    <span className={`text-xs font-semibold ${shipmentStatusColor[s.status] ?? "text-muted-foreground"}`}>
                      {s.status.replace(/_/g, " ")}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-3">
                <p className="text-xs text-muted-foreground">No shipments created yet</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
