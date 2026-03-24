import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function ReceivingPage() {
  const supabase = await createClient();

  // Find items where decorator has shipped but not yet received at HPD
  const { data: lines } = await supabase
    .from("buy_sheet_lines")
    .select("*, items(name, job_id, jobs(title, job_number, clients(name)))")
    .gt("qty_shipped_from_vendor", 0)
    .filter("qty_received_at_hpd", "lt", "qty_shipped_from_vendor")
    .order("item_id");

  // Group by job
  const byJob = (lines ?? []).reduce((acc, line) => {
    const item = line.items as {
      name: string; job_id: string;
      jobs: { title: string; job_number: string; clients: { name: string } | null } | null;
    } | null;
    const jobId = item?.job_id ?? "unknown";
    if (!acc[jobId]) acc[jobId] = { job: item?.jobs, lines: [] };
    acc[jobId].lines.push(line);
    return acc;
  }, {} as Record<string, { job: { title: string; job_number: string; clients: { name: string } | null } | null; lines: typeof lines }>);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Receiving</h1>
        <p className="text-muted-foreground text-sm mt-1">{Object.keys(byJob).length} projects with inbound inventory</p>
      </div>

      {Object.keys(byJob).length === 0 && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-muted-foreground text-sm">No inbound shipments to receive right now.</p>
        </div>
      )}

      {Object.entries(byJob).map(([jobId, { job, lines: jobLines }]) => (
        <div key={jobId} className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div>
              <Link href={`/jobs/${jobId}`} className="font-semibold hover:text-primary transition-colors">
                {job?.title ?? "Unknown Project"}
              </Link>
              <p className="text-xs text-muted-foreground mt-0.5">{job?.clients?.name} &middot; {job?.job_number}</p>
            </div>
            <span className="text-xs text-amber-400 font-semibold">{jobLines?.length} items pending</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Item / Size</th>
                <th className="text-center px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Shipped</th>
                <th className="text-center px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Received</th>
                <th className="text-center px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Variance</th>
              </tr>
            </thead>
            <tbody>
              {jobLines?.map(line => {
                const variance = line.qty_received_at_hpd - line.qty_shipped_from_vendor;
                const item = line.items as { name: string } | null;
                return (
                  <tr key={line.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      <span className="font-medium text-xs">{item?.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground font-mono">{line.size}</span>
                    </td>
                    <td className="px-4 py-2 text-center font-mono text-xs">{line.qty_shipped_from_vendor}</td>
                    <td className="px-4 py-2 text-center font-mono text-xs">{line.qty_received_at_hpd}</td>
                    <td className={`px-4 py-2 text-center font-mono text-xs font-semibold ${variance < 0 ? "text-amber-400" : variance > 0 ? "text-green-400" : "text-muted-foreground"}`}>
                      {variance === 0 ? "-" : variance > 0 ? `+${variance}` : variance}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
