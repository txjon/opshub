import { MOCKUP_FRAME_ASPECT } from "@/lib/mockup-crop";

// THE CURE (2026-07-20): the proof PDF is rendered from the SAME component as
// the web proof — ProofDocBody — via renderToStaticMarkup → Browserless. Any
// change to ProofDocBody's layout flows to the PDF automatically; no second
// hand-synced renderer for the ArtTab flow.
//
// react-dom/server + ProofDocBody are imported DYNAMICALLY (not statically):
// ProofDocBody is also a client component (via ProofDocView), and Next's App
// Router forbids statically linking react-dom/server into any client-reachable
// module. Dynamic import keeps this server-only at runtime and dodges the guard.
// This function is only ever called from the nodejs route /api/pdf/proof.
//
// The mockup can't render server-side (MockupFrame needs client measurement),
// so the caller passes a PRE-CROPPED image (baked to the 2:1 frame on the
// client); we render it as a plain contained <img> and strip spec.mockupCrop.

export async function renderProofHtml(opts: {
  spec: any;
  itemName?: string;
  clientName?: string;
  brandName?: string;
  logoSvg?: string;
  mockupUrl?: string | null;
  font?: string;
  mono?: string;
}): Promise<string> {
  const {
    spec,
    itemName = "",
    clientName = "",
    brandName = "",
    logoSvg = "",
    mockupUrl = null,
    font = "Inter, system-ui, sans-serif",
    mono = "'IBM Plex Mono', ui-monospace, monospace",
  } = opts;

  const [{ default: React }, { renderToStaticMarkup }, { default: ProofDocBody }] = await Promise.all([
    import("react"),
    import("react-dom/server"),
    import("@/components/ProofDocBody"),
  ]);

  const specForRender = { ...(spec || {}), mockupCrop: null };

  // Static mockup slot — the pre-cropped image in the same 2:1 frame the web
  // MockupFrame uses (contained). No measurement/hooks → server-renderable.
  // 72% width (centered) on paper — full-width eats half the page height and
  // pushes a 2-location proof onto a second sheet. Web keeps its full-width
  // interactive MockupFrame; this slot is the PDF's only divergence.
  const mockupSlot = mockupUrl
    ? React.createElement(
        "div",
        { style: { padding: "10px 0 8px" } },
        React.createElement(
          "div",
          { style: { position: "relative", width: "72%", margin: "0 auto", aspectRatio: `${MOCKUP_FRAME_ASPECT}`, overflow: "hidden", borderRadius: 10, background: "#fff" } },
          React.createElement("img", { src: mockupUrl, alt: "", style: { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" } })
        )
      )
    : null;

  const body = renderToStaticMarkup(
    React.createElement(ProofDocBody as any, {
      spec: specForRender,
      mockupSlot,
      clientName,
      itemName,
      brandName,
      logoSvg,
      font,
      mono,
    })
  );

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=IBM+Plex+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet"/>
<style>
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: ${font}; color: #1a1a1a; -webkit-font-smoothing: antialiased; }
  img { max-width: 100%; }

  /* ── Print fit ──────────────────────────────────────────────────────────
     This HTML is rendered ONLY for the Letter PDF (the web proof renders
     ProofDocBody with its own inline styles untouched). These overrides
     tighten the layout so a typical 1–3 location proof fits one page, and
     set pagination rules so longer proofs break cleanly — never inside a
     card or section, never an orphaned Approval block. !important is
     required to beat ProofDocBody's inline styles. */
  .proof-header { padding-bottom: 8px !important; }
  .proof-titleblock { padding: 12px 0 2px !important; }
  .proof-title { font-size: 24px !important; }
  .proof-sub { font-size: 12.5px !important; margin-top: 4px !important; }
  .proof-notes { padding: 10px 14px !important; }
  .proof-section { padding-top: 9px !important; margin-top: 12px !important; break-inside: avoid; }
  /* The locations section may break BETWEEN cards (a 6-card grid can be
     taller than a page — an unbreakable block would overflow). Cards
     themselves never split. */
  .proof-locations { break-inside: auto; }
  .proof-loc-grid { gap: 9px !important; }
  .proof-loc-card { break-inside: avoid; padding: 10px 12px !important; }
  .proof-kpi { padding: 9px 12px !important; }
  .proof-kpi-val { font-size: 15px !important; }
  .proof-chip { padding: 7px 11px !important; min-width: 110px !important; }
  .proof-chip-val { font-size: 12.5px !important; }
  .proof-approval { break-before: avoid; }
  .proof-approval-text { font-size: 9.5px !important; }
</style></head>
<body>${body}</body></html>`;
}
