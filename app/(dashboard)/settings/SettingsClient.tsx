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
  const [sendingPreviews, setSendingPreviews] = useState(false);
  const [previewResult, setPreviewResult] = useState<string | null>(null);
  const [previewDiagnostics, setPreviewDiagnostics] = useState<any>(null);

  async function sendPreviewEmails() {
    setSendingPreviews(true);
    setPreviewResult(null);
    setPreviewDiagnostics(null);
    try {
      const res = await fetch("/api/email/preview-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await res.json();
      if (!res.ok) {
        setPreviewResult(`Error: ${data.error || "Failed"}`);
      } else {
        setPreviewResult(`Sent ${data.totalSent || 0} of ${(data.sent || []).length} to ${data.to}. Sample job: ${data.sampleJob?.jobNumber || "—"} (${data.sampleJob?.clientName || ""}).`);
        setPreviewDiagnostics(data.pdfDiagnostics);
      }
    } catch (e: any) {
      setPreviewResult(`Error: ${e.message}`);
    }
    setSendingPreviews(false);
  }

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

      {/* Email preview — send all 13 active templates to my inbox */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">Email preview</div>
            <div className="text-xs text-muted-foreground mt-1">
              Sends a rendered sample of every active email template to your inbox. 13 emails, no DB writes, clearly labeled [PREVIEW].
            </div>
          </div>
          <button
            onClick={sendPreviewEmails}
            disabled={sendingPreviews}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-secondary hover:bg-secondary/80 border border-border whitespace-nowrap disabled:opacity-50"
          >
            {sendingPreviews ? "Sending..." : "Send me every email"}
          </button>
        </div>
        {previewResult && (
          <div className={`mt-3 text-xs ${previewResult.startsWith("Error") ? "text-red-500" : "text-green-500"}`}>
            {previewResult}
          </div>
        )}
        {previewDiagnostics && (
          <div className="mt-3 rounded border border-border bg-secondary/30 p-3 text-xs space-y-2">
            <div className="font-semibold">PDF attachment status:</div>
            {Object.entries(previewDiagnostics).map(([key, val]: any) => {
              // Try to unwrap JSON error (route returns { error, detail })
              let displayErr = val.error || "";
              try {
                const parsed = JSON.parse(displayErr);
                if (parsed.detail) displayErr = parsed.detail;
                else if (parsed.error) displayErr = parsed.error;
              } catch {}
              return (
                <div key={key} className="flex flex-col gap-1 border-l-2 pl-2" style={{ borderColor: val.ok ? "#22c55e" : "#ef4444" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-muted-foreground">{key}</span>
                    {val.ok ? (
                      <span className="text-green-500">✓ {(val.size / 1024).toFixed(0)} KB</span>
                    ) : (
                      <span className="text-red-500">✕ HTTP {val.status || "—"}</span>
                    )}
                  </div>
                  {!val.ok && displayErr && (
                    <pre className="text-red-500/80 whitespace-pre-wrap break-all font-mono text-[10px] leading-4 bg-red-500/5 p-2 rounded max-h-32 overflow-auto">{displayErr}</pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
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
