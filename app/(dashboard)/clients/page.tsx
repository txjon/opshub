"use client";
import { createClient } from "@/lib/supabase/client";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { SkeletonTable } from "@/components/Skeleton";

type Client = {
  id: string;
  name: string;
  client_type: string | null;
  default_terms: string | null;
  jobs: { id: string }[];
  contacts: { id: string }[];
};

export default function ClientsPage() {
  const supabase = createClient();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("clients")
        .select("*, contacts(id), jobs(id)")
        .order("name");
      setClients((data || []) as Client[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return clients;
    const q = search.toLowerCase();
    return clients.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.client_type || "").toLowerCase().includes(q)
    );
  }, [clients, search]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Clients</h1>
        <button onClick={() => setAdding(true)}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90">
          + New Client
        </button>
      </div>
      {adding && (
        <div className="flex items-center gap-3">
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={async e => {
              if (e.key === "Enter" && newName.trim()) {
                const { data } = await supabase.from("clients").insert({ name: newName.trim() }).select("*, contacts(id), jobs(id)").single();
                if (data) { setClients(prev => [...prev, data as Client].sort((a, b) => a.name.localeCompare(b.name))); }
                setNewName(""); setAdding(false);
              }
              if (e.key === "Escape") { setNewName(""); setAdding(false); }
            }}
            placeholder="Client name..."
            className="px-3 py-2 text-sm rounded-lg border border-border bg-secondary/50 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
          />
          <button onClick={async () => {
            if (!newName.trim()) return;
            const { data } = await supabase.from("clients").insert({ name: newName.trim() }).select("*, contacts(id), jobs(id)").single();
            if (data) { setClients(prev => [...prev, data as Client].sort((a, b) => a.name.localeCompare(b.name))); }
            setNewName(""); setAdding(false);
          }} className="px-3 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground">Save</button>
          <button onClick={() => { setNewName(""); setAdding(false); }}
            className="px-3 py-2 text-sm rounded-lg border border-border text-muted-foreground">Cancel</button>
        </div>
      )}
      <div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients..."
          className="w-full max-w-xs px-3 py-2 text-sm rounded-lg border border-border bg-secondary/50 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
        />
      </div>
      <div className="rounded-xl border border-border overflow-hidden">
        {loading ? (
          <div className="p-4"><SkeletonTable rows={6} cols={4} /></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Projects</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Terms</th>
              </tr>
            </thead>
            <tbody>
              {!filtered.length && (
                <tr><td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
                  {search ? "No clients match your search." : "No clients yet."}
                </td></tr>
              )}
              {filtered.map(client => (
                <tr key={client.id} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3 font-semibold"><Link href={`/clients/${client.id}`} className="hover:text-primary transition-colors">{client.name}</Link></td>
                  <td className="px-4 py-3 text-muted-foreground capitalize">{client.client_type ?? "-"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{client.jobs.length}</td>
                  <td className="px-4 py-3 text-muted-foreground capitalize">{client.default_terms?.replace(/_/g, " ") ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
