// Branded HPD email template. Matches the art-brief layout visual language:
// small uppercase eyebrow, bold H1, readable body paragraph, dark CTA button,
// optional secondary CTA, optional grey hint at bottom.
//
// All OpsHub client/decorator/designer emails render through this function
// so brand voice + typography stays consistent in every inbox.

type CtaStyle = "dark" | "green" | "outline";

type Cta = { label: string; url: string; style?: CtaStyle };

export type BrandedEmailOptions = {
  heading: string;
  bodyHtml: string;           // inner HTML (can include <strong>, <br/>, tracking blocks, etc.)
  greeting?: string;          // "Hi [Client]," prepended to bodyHtml with double line-break
  cta?: Cta;
  secondaryCta?: Cta;
  hint?: string;              // small grey footer sentence
  extraHtml?: string;         // injected between body and CTAs (e.g., inline tracking, alert banner)
  eyebrow?: string;           // defaults to "House Party Distro"
  closing?: string;           // defaults to "Welcome to the party,\nHouse Party Distro"
  align?: "center" | "left";  // wrapper alignment — defaults to "left" (margin:0)
};

function ctaButton({ label, url, style = "dark" }: Cta): string {
  const styles: Record<CtaStyle, string> = {
    dark:
      "padding:12px 24px;background:#222;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;",
    green:
      "padding:12px 24px;background:#34c97a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;",
    outline:
      "padding:12px 24px;background:transparent;color:#222;border:1px solid #dcdce0;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;",
  };
  return `<a href="${url}" style="display:inline-block;margin-right:8px;margin-bottom:8px;${styles[style] || styles.dark}">${label}</a>`;
}

// Sign-off line picker. IHM uses its own house copy; everything else
// (HPD, future tenants without their own override) uses the HPD-voice
// "Welcome to the party," line — pass a different `hpdLine` for the
// few one-off variants ("Welcome to the party!", "Thanks,", "—").
//
// Returns a two-line string ready to drop into `closing` on
// renderBrandedEmail. The template renders \n as line breaks.
export function tenantClosing(
  slug: string | null | undefined,
  tenantName: string,
  hpdLine: string = "Welcome to the party,",
): string {
  if (slug === "ihm") return `Thank you for keeping it In House,\n${tenantName}`;
  return `${hpdLine}\n${tenantName}`;
}

export function renderBrandedEmail(opts: BrandedEmailOptions): string {
  const eyebrow = opts.eyebrow ?? "House Party Distro";
  const closingRaw = opts.closing ?? "Welcome to the party,\nHouse Party Distro";
  const greeting = opts.greeting ? `<p style="font-size:14px;color:#444;line-height:1.55;margin:0 0 12px;">${opts.greeting}</p>` : "";
  const bodyBlock = `<div style="font-size:14px;color:#444;line-height:1.55;margin:0 0 16px;">${opts.bodyHtml}</div>`;
  const extra = opts.extraHtml ? opts.extraHtml : "";
  const ctaPrimary = opts.cta ? ctaButton(opts.cta) : "";
  const ctaSecondary = opts.secondaryCta ? ctaButton({ ...opts.secondaryCta, style: opts.secondaryCta.style || "outline" }) : "";
  const ctaBlock = ctaPrimary || ctaSecondary
    ? `<div style="margin:20px 0 8px;">${ctaPrimary}${ctaSecondary}</div>`
    : "";
  const hint = opts.hint
    ? `<p style="font-size:12px;color:#888;margin-top:20px;line-height:1.5;">${opts.hint}</p>`
    : "";
  const closing = `<p style="font-size:14px;color:#444;line-height:1.55;margin:24px 0 0;">${closingRaw.replace(/\n/g, "<br/>")}</p>`;

  const wrapperMargin = opts.align === "center" ? "margin:0 auto;" : "margin:0;";
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:560px;${wrapperMargin}padding:24px 20px;color:#111;">
  <div style="font-size:11px;color:#888;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">${eyebrow}</div>
  <h1 style="font-size:24px;font-weight:700;margin:0 0 16px;color:#111;line-height:1.25;letter-spacing:-0.01em;">${opts.heading}</h1>
  ${greeting}
  ${bodyBlock}
  ${extra}
  ${ctaBlock}
  ${closing}
  ${hint}
</div>
`.trim();
}

// Tracking block for shipping emails — small, inline, below body.
export function trackingBlock(trackingNumber: string | null, carrier?: string | null): string {
  if (!trackingNumber) return "";
  return `<p style="font-size:13px;color:#444;margin:0 0 12px;"><span style="color:#888;font-weight:600;">Tracking:</span> <strong style="font-family:'SF Mono',Menlo,monospace;">${trackingNumber}</strong>${carrier ? ` <span style="color:#888;"> · ${carrier}</span>` : ""}</p>`;
}

// Missing-attachment warning (used by preview-all when a PDF fails to render).
export function missingAttachmentBlock(expected: string, error: string | null): string {
  return `<div style="margin:20px 0;padding:12px 14px;background:#fef9ee;border:1px solid #f5dfa8;border-radius:8px;font-size:12px;color:#b45309;"><strong>⚠ Expected attachment missing:</strong> ${expected}<br/><span style="font-size:11px;opacity:0.85;">Sample job couldn't render this PDF${error ? `: ${error}` : "."} In real sends this attachment would appear.</span></div>`;
}
