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
  const mockupSlot = mockupUrl
    ? React.createElement(
        "div",
        { style: { padding: "16px 0 12px" } },
        React.createElement(
          "div",
          { style: { position: "relative", width: "100%", aspectRatio: `${MOCKUP_FRAME_ASPECT}`, overflow: "hidden", borderRadius: 10, background: "#fff" } },
          React.createElement("img", { src: mockupUrl, alt: "", style: { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" } })
        )
      )
    : null;

  const body = renderToStaticMarkup(
    React.createElement(ProofDocBody, {
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
  .proof-loc-card { break-inside: avoid; }
</style></head>
<body>${body}</body></html>`;
}
