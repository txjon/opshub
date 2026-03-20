import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function ClientsPage() {
  const supabase = await createClient();
  const { data: clients } = await supabase
    .from("clients")
    .select("*, contacts(id), jobs(id)")
    .order("name");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Clients</h1>
      </div>
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/50">
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Name</th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Type</th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Jobs</th>
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Terms</th>
            </tr>
          </thead>
          <tbody>
            {!clients?.length && (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">No clients yet.</td></tr>
            )}
            {clients?.map(client => (
              <tr key={client.id} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                <td className="px-4 py-3 font-semibold">{client.name}</td>
                <td className="px-4 py-3 text-muted-foreground capitalize">{client.client_type ?? "-"}</td>
                <td className="px-4 py-3 text-muted-foreground">{(client.jobs as unknown[]).length}</td>
                <td className="px-4 py-3 text-muted-foreground capitalize">{client.default_terms?.replace(/_/g, " ") ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
