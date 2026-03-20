import { createClient } from "@/lib/supabase/server";

export default async function TemplatesPage() {
  const supabase = await createClient();
  const { data: templates } = await supabase
    .from("job_templates")
    .select("*, clients(name)")
    .order("name");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Templates</h1>
      </div>
      {!templates?.length ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-muted-foreground text-sm">No templates yet. Complete a job and save it as a template to reuse it.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map(t => (
            <div key={t.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
              <p className="font-semibold">{t.name}</p>
              {(t.clients as { name: string } | null) && (
                <p className="text-xs text-muted-foreground">{(t.clients as { name: string }).name}</p>
              )}
              <p className="text-xs text-muted-foreground capitalize">{t.job_type?.replace(/_/g, " ") ?? "General"}</p>
              <button className="mt-1 text-xs text-primary hover:underline">Use template</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
