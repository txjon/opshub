import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("*, clients(name, client_type)")
    .eq("id", id)
    .single();

  if (!job) notFound();

  const { data: items } = await supabase
    .from("items")
    .select("*, decorator_assignments(*, decorators(name))")
    .eq("job_id", id)
    .order("sort_order");

  const { data: payments } = await supabase
    .from("payment_records")
    .select("*")
    .eq("job_id", id)
    .order("created_at");

  const { data: jobContacts } = await supabase
    .from("job_contacts")
    .select("*, contacts(*)")
    .eq("job_id", id);

  const phaseBadge: Record<string, string> = {
    intake: "bg-secondary text-muted-foreground",
    pre_production: "bg-purple-950 text-purple-400",
    production: "bg-blue-950 text-blue-400",
    receiving: "bg-amber-950 text-amber-400",
    shipping: "bg-green-950 text-green-400",
    complete: "bg-green-950 text-green-500",
    on_hold: "bg-red-950 text-red-400",
    cancelled: "bg-secondary text-muted-foreground",
  };

  const stageLabel: Record<string, string> = {
    blanks_ordered: "Blanks Ordered",
    blanks_shipped: "Blanks Shipped",
    blanks_received: "Blanks Received",
    strikeoff_approval: "Strike-off",
    in_production: "In Production",
    shipped: "Shipped",
  };

  const stageIdx: Record<string, number> = {
    blanks_ordered: 0, blanks_shipped: 1, blanks_received: 2,
    strikeoff_approval: 3, in_production: 4, shipped: 5,
  };

  const totalPaid = payments?.filter(p => p.status === "paid").reduce((a, p) => a + (p.amount ?? 0), 0) ?? 0;
  const totalDue = payments?.filter(p => p.status !== "paid" && p.status !== "void").reduce((a, p) => a + (p.amount ?? 0), 0) ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Link href="/jobs" className="text-muted-foreground hover:text-foreground text-sm transition-colors">Jobs</Link>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm font-mono text-muted-foreground">{job.job_number}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{job.title}</h1>
          <div className="flex items-center gap-3 mt-2">
            <span className={`px-2.5 py-1 rounded-md text-xs font-semibold ${phaseBadge[job.phase]}`}>
              {job.phase.replace(/_/g, " ")}
            </span>
            {(job.clients as { name: string } | null) && (
              <span className="text-sm text-muted-foreground">{(job.clients as { name: string }).name}</span>
            )}
            <span className="text-sm text-muted-foreground capitalize">{job.job_type}</span>
          </div>
        </div>
        {job.target_ship_date && (
          <div className="text-right shrink-0">
            <p className="text-xs text-muted-foreground">Ship date</p>
            <p className="font-semibold">
              {new Date(job.target_ship_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Items */}
        <div className="col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Items</h2>
            <Link href={`/jobs/${id}/items/new`}
              className="text-xs text-primary hover:underline">+ Add item</Link>
          </div>

          {!items?.length && (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <p className="text-muted-foreground text-sm">No items yet</p>
              <Link href={`/jobs/${id}/items/new`}
                className="inline-block mt-3 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90">
                Add first item
              </Link>
            </div>
          )}

          {items?.map(item => {
            const assignments = (item.decorator_assignments as Array<{
              id: string;
              pipeline_stage: string;
              decoration_type: string;
              decorators: { name: string } | null;
            }>) ?? [];
            const maxStageIdx = assignments.reduce((max, a) => Math.max(max, stageIdx[a.pipeline_stage] ?? 0), 0);
            const pct = assignments.length ? Math.round((maxStageIdx / 5) * 100) : 0;

            return (
              <div key={item.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{item.name}</span>
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${item.status === "confirmed" ? "bg-green-950 text-green-400" : "bg-amber-950 text-amber-400"}`}>
                        {item.status}
                      </span>
                    </div>
                    {item.blank_vendor && (
                      <p className="text-xs text-muted-foreground mt-0.5">{item.blank_vendor} {item.blank_sku}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">Progress</p>
                    <p className="text-sm font-bold text-primary">{pct}%</p>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>

                {/* Decorator assignments */}
                {assignments.length > 0 && (
                  <div className="space-y-1.5">
                    {assignments.map(a => (
                      <div key={a.id} className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground capitalize">{a.decoration_type?.replace(/_/g, " ")}</span>
                        <span className="text-muted-foreground">at</span>
                        <span className="font-medium">{a.decorators?.name ?? "Unassigned"}</span>
                        <span className="ml-auto text-muted-foreground">{stageLabel[a.pipeline_stage] ?? a.pipeline_stage}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Contacts */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Contacts</h3>
            </div>
            {!jobContacts?.length && (
              <p className="text-xs text-muted-foreground">No contacts assigned</p>
            )}
            {jobContacts?.map(jc => {
              const contact = jc.contacts as { name: string; email: string | null; role_label: string | null } | null;
              return (
                <div key={jc.id} className="mb-2 last:mb-0">
                  <p className="text-sm font-medium">{contact?.name}</p>
                  <p className="text-xs text-muted-foreground">{contact?.role_label ?? jc.role_on_job}</p>
                  {contact?.email && <p className="text-xs text-muted-foreground">{contact.email}</p>}
                </div>
              );
            })}
          </div>

          {/* Payment */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="font-semibold text-sm mb-3">Payment</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Terms</span>
                <span className="capitalize">{job.payment_terms?.replace(/_/g, " ") ?? "Not set"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Paid</span>
                <span className="text-green-400 font-medium">${totalPaid.toLocaleString()}</span>
              </div>
              {totalDue > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Outstanding</span>
                  <span className="text-amber-400 font-medium">${totalDue.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Contract</span>
                <span className="capitalize">{job.contract_status.replace(/_/g, " ")}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {job.notes && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="font-semibold text-sm mb-2">Notes</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{job.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
