import { createClient } from "@/lib/supabase/server";

export default async function DecoratorsPage() {
  const supabase = await createClient();
  const { data: decorators } = await supabase
    .from("decorators")
    .select("*")
    .order("name");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Decorators</h1>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {!decorators?.length && (
          <p className="text-muted-foreground text-sm col-span-full">No decorators added yet.</p>
        )}
        {decorators?.map(d => (
          <div key={d.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div>
              <p className="font-semibold">{d.name}</p>
              {d.location && <p className="text-xs text-muted-foreground mt-0.5">{d.location}</p>}
            </div>
            {d.capabilities.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {d.capabilities.map((cap: string) => (
                  <span key={cap} className="px-2 py-0.5 rounded bg-secondary text-xs font-medium capitalize">
                    {cap.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            )}
            {d.lead_time_days && (
              <p className="text-xs text-muted-foreground">{d.lead_time_days} day lead time</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
