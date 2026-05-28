"use client";
import { useState } from "react";
import { PageHero } from "../_components/PageHero";

// /client-portal — entry point for existing HPD clients to get their
// portal magic link by email. Posts to /api/portal-access which looks
// up the client(s) tied to the email and emails the portal URL.
//
// Privacy: the API always returns ok — we never reveal whether the
// email matched an account. The UI shows a single generic
// "Check your inbox" confirmation either way.

export default function ClientPortalPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setSubmitting(true);
    try {
      await fetch("/api/portal-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      setSubmitted(true);
    } catch {
      // Always show success — never leak which emails are clients.
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHero
        eyebrow="Client portal"
        title="Pick up where you left off."
        sub="Enter your email and we&rsquo;ll send a secure link to your projects."
      />

      <section style={{ padding: "100px 32px", background: "#fff" }}>
        <div style={{ maxWidth: 480, margin: "0 auto" }}>
          {!submitted ? (
            <form onSubmit={handleSubmit} style={{
              background: "#fff",
              border: "1px solid #e0e0e4",
              borderRadius: 12,
              padding: 32,
            }}>
              <label htmlFor="email" style={{
                display: "block",
                fontSize: 11, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: "0.08em",
                color: "#6b6b78",
                marginBottom: 8,
              }}>
                Your email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@yourbrand.com"
                autoFocus
                required
                style={{
                  width: "100%",
                  padding: "14px 16px",
                  fontSize: 15,
                  border: "1px solid #e0e0e4",
                  borderRadius: 8,
                  outline: "none",
                  fontFamily: "inherit",
                  color: "#1a1a1a",
                  background: "#f8f8f9",
                  marginBottom: 16,
                  boxSizing: "border-box",
                }}
              />
              {error && (
                <div style={{
                  background: "#ffe8ec",
                  border: "1px solid #ffc3cc",
                  color: "#c43030",
                  fontSize: 13,
                  padding: "10px 14px",
                  borderRadius: 8,
                  marginBottom: 16,
                }}>
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={submitting}
                style={{
                  width: "100%",
                  padding: "14px 24px",
                  background: "#1a1a1a",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 14, fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  cursor: submitting ? "default" : "pointer",
                  opacity: submitting ? 0.6 : 1,
                  fontFamily: "inherit",
                }}
              >
                {submitting ? "Sending..." : "Send portal link"}
              </button>
              <p style={{
                fontSize: 12, color: "#a0a0ad",
                marginTop: 16, lineHeight: 1.5, textAlign: "center",
              }}>
                Not a client yet? <a href="/start" style={{ color: "#1a1a1a", fontWeight: 600 }}>Start a project →</a>
              </p>
            </form>
          ) : (
            <div style={{
              background: "#edf7f2",
              border: "1px solid #b4dfc9",
              color: "#166534",
              borderRadius: 12,
              padding: 32,
              textAlign: "center",
            }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>✓</div>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Check your inbox</h3>
              <p style={{ fontSize: 13, lineHeight: 1.6 }}>
                If <strong>{email}</strong> matches an active account, we just sent you a portal link.
                It should arrive within a minute.
              </p>
              <button
                onClick={() => { setSubmitted(false); setEmail(""); }}
                style={{
                  marginTop: 20,
                  background: "transparent",
                  border: "none",
                  color: "#166534",
                  fontSize: 12, fontWeight: 600,
                  textDecoration: "underline",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Try a different email
              </button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
