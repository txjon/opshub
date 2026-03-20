"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function NewJobPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "",
    job_type: "tour" as "tour" | "webstore" | "corporate" | "brand",
    phase: "intake" as const,
    priority: "normal" as "normal" | "high" | "urgent",
    payment_terms: "" as "" | "net_15" | "net_30" | "deposit_balance" | "prepaid",
    target_ship_date: "",
    notes: "",
    client_name: "", // will create client on the fly for now
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // Create or find client
      let clientId: string | null = null;
      if (form.client_name.trim()) {
        const { data: existingClient } = await supabase
          .from("clients")
          .select("id")
          .ilike("name", form.client_name.trim())
          .single();

        if (existingClient) {
          clientId = existingClient.id;
        } else {
          const { data: newClient, error: clientError } = await supabase
            .from("clients")
            .insert({ name: form.client_name.trim() })
            .select("id")
            .single();
          if (clientError) throw clientError;
          clientId = newClient.id;
        }
      }

      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          title: form.title,
          job_type: form.job_type,
          phase: form.phase,
          priority: form.priority,
          payment_terms: form.payment_terms || null,
          target_ship_date: form.target_ship_date || null,
          notes: form.notes || null,
          client_id: clientId,
          job_number: "", // triggers auto-generate
        })
        .select("id")
        .single();

      if (jobError) throw jobError;
      router.push(`/jobs/${job.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  };

  const inputClass = "w-full px-3 py-2 rounded-md bg-secondary border border-border text-foreground text-sm outline-none focus:border-primary transition-colors";
  const labelClass = "block text-sm font-medium mb-1.5";

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New Job</h1>
        <p className="text-muted-foreground text-sm mt-1">Create a new production job</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Job Details</h2>

          <div>
            <label className={labelClass}>Job Title *</label>
            <input value={form.title} onChange={e => set("title", e.target.value)} required
              placeholder="e.g. The Amity Affliction US Tour 2026"
              className={inputClass} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Job Type *</label>
              <select value={form.job_type} onChange={e => set("job_type", e.target.value)} className={inputClass}>
                <option value="tour">Tour</option>
                <option value="webstore">Webstore</option>
                <option value="corporate">Corporate</option>
                <option value="brand">Brand</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Priority</label>
              <select value={form.priority} onChange={e => set("priority", e.target.value)} className={inputClass}>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>Client</label>
            <input value={form.client_name} onChange={e => set("client_name", e.target.value)}
              placeholder="Client or band name"
              className={inputClass} />
            <p className="text-xs text-muted-foreground mt-1">Creates a new client if not found</p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Timeline & Payment</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Target Ship Date</label>
              <input type="date" value={form.target_ship_date} onChange={e => set("target_ship_date", e.target.value)}
                className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Payment Terms</label>
              <select value={form.payment_terms} onChange={e => set("payment_terms", e.target.value)} className={inputClass}>
                <option value="">Not set</option>
                <option value="net_15">Net 15</option>
                <option value="net_30">Net 30</option>
                <option value="deposit_balance">Deposit + Balance</option>
                <option value="prepaid">Prepaid</option>
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Notes</h2>
          <textarea value={form.notes} onChange={e => set("notes", e.target.value)}
            placeholder="Any additional context..."
            rows={3}
            className={inputClass + " resize-none"} />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-3">
          <button type="submit" disabled={loading}
            className="px-6 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
            {loading ? "Creating..." : "Create job"}
          </button>
          <button type="button" onClick={() => router.back()}
            className="px-6 py-2 rounded-md border border-border text-sm font-medium hover:bg-secondary transition-colors">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
