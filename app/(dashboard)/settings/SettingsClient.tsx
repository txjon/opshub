"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Profile = {
  id: string;
  full_name: string | null;
  role: string;
  email: string | null;
};

export default function SettingsClient({ profiles: initialProfiles, currentUserId }: { profiles: Profile[]; currentUserId: string }) {
  const router = useRouter();
  const [profiles, setProfiles] = useState(initialProfiles);
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("ops");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [editingRole, setEditingRole] = useState<string | null>(null);

  async function invite() {
    if (!email.trim()) return;
    setSending(true);
    setError("");
    const res = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), fullName: fullName.trim(), role }),
    });
    const data = await res.json();
    setSending(false);
    if (!res.ok) {
      setError(data.error || "Failed to invite");
      return;
    }
    setEmail("");
    setFullName("");
    setRole("viewer");
    setInviting(false);
    router.refresh();
  }

  async function updateRole(profileId: string, newRole: string) {
    setProfiles(prev => prev.map(p => p.id === profileId ? { ...p, role: newRole } : p));
    setEditingRole(null);
    await fetch("/api/team", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId, role: newRole }),
    });
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage team access and roles</p>
        </div>
        <button
          onClick={() => setInviting(!inviting)}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          + Invite member
        </button>
      </div>

      {inviting && (
        <div className="rounded-xl border border-primary/30 bg-card p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email *</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="team@housepartydistro.com"
                onKeyDown={e => e.key === "Enter" && invite()}
                className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-border bg-secondary/50 text-foreground outline-none focus:border-primary/50"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Full name"
                onKeyDown={e => e.key === "Enter" && invite()}
                className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-border bg-secondary/50 text-foreground outline-none focus:border-primary/50"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              className="mt-1 px-3 py-2 text-sm rounded-lg border border-border bg-secondary/50 text-foreground outline-none"
            >
              <option value="owner">Owner — full access including Owner tab (Insights, Reports, God Mode)</option>
              <option value="manager">Manager — full access incl. Settings, no Owner tab</option>
              <option value="ops">Ops — full Labs workflow + Contacts</option>
              <option value="warehouse">Warehouse — Distro only</option>
              <option value="viewer">Viewer — read-only everywhere</option>
            </select>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button onClick={invite} disabled={sending || !email.trim()}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {sending ? "Sending invite..." : "Send invite"}
            </button>
            <button onClick={() => { setInviting(false); setError(""); }}
              className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-secondary/50">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="font-semibold text-sm">Team Members</h2>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Role</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map(p => (
              <tr key={p.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium">{p.full_name ?? "Unnamed"}</p>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {p.email ?? "—"}
                </td>
                <td className="px-4 py-3">
                  {p.id === currentUserId ? (
                    <span className="capitalize text-muted-foreground">{p.role}</span>
                  ) : editingRole === p.id ? (
                    <select
                      value={p.role}
                      onChange={e => updateRole(p.id, e.target.value)}
                      onBlur={() => setEditingRole(null)}
                      autoFocus
                      className="px-2 py-1 text-sm rounded border border-border bg-secondary/50 text-foreground outline-none"
                    >
                      <option value="owner">Owner</option>
                      <option value="manager">Manager</option>
                      <option value="ops">Ops</option>
                      <option value="warehouse">Warehouse</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  ) : (
                    <button
                      onClick={() => setEditingRole(p.id)}
                      className="capitalize text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none text-sm"
                    >
                      {p.role}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
