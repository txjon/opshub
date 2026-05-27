"use client";
import { useState } from "react";
import Link from "next/link";

// Plain contact form, dark theme, replaces AWIO Improved Contact Form
// on the legacy Squarespace site. Submits to /api/contact, which sends
// via Resend to hello@housepartydistro.com with reply-to set to the
// sender so the team can reply inline.
//
// For *project* inquiries we steer people to /start (the 6-step intake).
// This route is for everything else: vendor outreach, press, general
// questions, "I lost my client portal link", etc.

export function ContactClient() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  // Honeypot — bots fill hidden fields, humans don't. We bail server-side
  // if this is non-empty.
  const [website, setWebsite] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim() || !message.trim()) {
      setError("Name, email, and message are required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, company, subject, message, website }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Send failed (${res.status})`);
      }
      setSubmitted(true);
    } catch (err: any) {
      setError(err?.message || "Could not send. Try again or email hello@housepartydistro.com directly.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div style={{
        maxWidth: 640, margin: "0 auto", padding: "80px 32px 120px",
        textAlign: "center",
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700,
          textTransform: "uppercase", letterSpacing: "0.16em",
          color: "rgba(255,255,255,0.5)", marginBottom: 16,
        }}>Sent</div>
        <h1 style={{
          fontSize: "clamp(32px, 4.6vw, 56px)",
          fontWeight: 900, letterSpacing: "-0.02em",
          textTransform: "uppercase", lineHeight: 1.05,
          marginBottom: 18,
        }}>
          Thanks. We'll be in touch.
        </h1>
        <p style={{ fontSize: 16, color: "rgba(255,255,255,0.7)", lineHeight: 1.6, marginBottom: 32 }}>
          Your message hit our inbox. Expect a reply within one business day.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/" style={ctaSecondaryStyle}>Back home</Link>
          <Link href="/start" style={ctaPrimaryStyle}>Start a project →</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "60px 32px 120px" }}>
      <div style={{ marginBottom: 48 }}>
        <div style={{
          fontSize: 10, fontWeight: 700,
          textTransform: "uppercase", letterSpacing: "0.16em",
          color: "rgba(255,255,255,0.5)", marginBottom: 16,
        }}>Get in touch</div>
        <h1 style={{
          fontSize: "clamp(36px, 5vw, 64px)",
          fontWeight: 900, letterSpacing: "-0.02em",
          textTransform: "uppercase", lineHeight: 1.02,
          marginBottom: 18,
        }}>
          Say hello.
        </h1>
        <p style={{
          fontSize: 17, lineHeight: 1.55,
          color: "rgba(255,255,255,0.72)",
          maxWidth: 560,
        }}>
          Questions, partnerships, press, or just curious. Drop us a line. For a
          project quote, head to{" "}
          <Link href="/start" style={{ color: "#fff", textDecoration: "underline" }}>
            Start a Project
          </Link>{" "}
          instead, it's faster.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }} className="hpd-contact-grid">
          <Field label="Name" required>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              autoComplete="name"
              style={inputStyle}
              placeholder="Your full name"
            />
          </Field>
          <Field label="Email" required>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={inputStyle}
              placeholder="you@company.com"
            />
          </Field>
        </div>

        <Field label="Company (optional)">
          <input
            type="text"
            value={company}
            onChange={e => setCompany(e.target.value)}
            autoComplete="organization"
            style={inputStyle}
            placeholder="Brand, label, or organization"
          />
        </Field>

        <Field label="Subject">
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            style={inputStyle}
            placeholder="What's this about?"
          />
        </Field>

        <Field label="Message" required>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            required
            rows={7}
            style={{ ...inputStyle, resize: "vertical", minHeight: 160, lineHeight: 1.5 }}
            placeholder="Tell us what you need."
          />
        </Field>

        {/* Honeypot — hidden from sighted users but bots fill it */}
        <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: "-9999px" }}>
          <label>
            Leave this field blank
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={e => setWebsite(e.target.value)}
            />
          </label>
        </div>

        {error && (
          <div style={{
            padding: "12px 16px",
            background: "rgba(255,154,160,0.1)",
            border: "1px solid rgba(255,154,160,0.3)",
            color: "#ff9aa0",
            fontSize: 13,
          }}>{error}</div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
          <button
            type="submit"
            disabled={submitting}
            style={{
              background: "#fff", color: "#0a0a0c",
              border: "none",
              padding: "16px 32px",
              fontSize: 13, fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              cursor: submitting ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              opacity: submitting ? 0.6 : 1,
              transition: "opacity 0.15s",
            }}
          >
            {submitting ? "Sending..." : "Send message →"}
          </button>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
            We reply within one business day.
          </div>
        </div>
      </form>

      <style>{`
        @media (max-width: 640px) {
          .hpd-contact-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{
        fontSize: 10, fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "0.14em",
        color: "rgba(255,255,255,0.55)",
      }}>
        {label}{required && <span style={{ color: "#73B6C9" }}> *</span>}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: "transparent",
  color: "#fff",
  border: "1px solid rgba(255,255,255,0.2)",
  padding: "14px 16px",
  fontSize: 15,
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
  borderRadius: 0,
};

const ctaPrimaryStyle: React.CSSProperties = {
  display: "inline-block",
  background: "#fff", color: "#0a0a0c",
  padding: "14px 28px",
  fontSize: 13, fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  textDecoration: "none",
};

const ctaSecondaryStyle: React.CSSProperties = {
  display: "inline-block",
  background: "transparent", color: "#fff",
  border: "1px solid rgba(255,255,255,0.3)",
  padding: "14px 28px",
  fontSize: 13, fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  textDecoration: "none",
};
