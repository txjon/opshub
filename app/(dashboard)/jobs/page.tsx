import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function JobsPage() {
  const supabase = await createClient();

  const { data: jobs } = await supabase
    .from("jobs")
    .select("*, clients(name)")
    .order("created_at", { ascending: false });

  const phaseLabel: Record<string, string> = {
    intake: "Intake", pre_production: "Pre-Production", production: "Production",
    receiving: "Receiving", shipping: "Shipping", complete: "Complete",
    on_hold: "On Hold", cancelled: "Cancelled",
  };

  const jobTypeColor: Record<string, string> = {
    tour: "text-purple-400 bg-purple-950",
    webstore: "text-blue-400 bg-blue-950",
    corporate: "text-amber-400 bg-amber-950",
    brand: "text-green-400 bg-green-950",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Jobs</h1>
          <p className="text-muted-foreground text-sm mt-1">{jobs?.length ?? 0} total</p>
        </div>
        <Link href="/jobs/new"
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity">
          New job
        </Link>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/50">
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Job #</th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Title</th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Client</th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Type</th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Phase</th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Ship Date</th>
            </tr>
          </thead>
          <tbody>
            {jobs?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  No jobs yet.{" "}
                  <Link href="/jobs/new" className="text-primary hover:underline">Create your first job</Link>
                </td>
              </tr>
            )}
            {jobs?.map((job, i) => (
              <tr key={job.id}
                className={`border-b border-border last:border-0 hover:bg-secondary/30 transition-colors`}>
                <td className="px-4 py-3">
                  <Link href={`/jobs/${job.id}`} className="font-mono text-xs text-muted-foreground hover:text-foreground">
                    {job.job_number}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/jobs/${job.id}`} className="font-semibold hover:text-primary transition-colors">
                    {job.title}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {(job.clients as { name: string } | null)?.name ?? "-"}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${jobTypeColor[job.job_type] ?? ""}`}>
                    {job.job_type}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground capitalize">
                  {phaseLabel[job.phase] ?? job.phase}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {job.target_ship_date
                    ? new Date(job.target_ship_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                    : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
