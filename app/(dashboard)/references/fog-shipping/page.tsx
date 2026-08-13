"use client";
import { T, font, mono } from "@/lib/theme";

// FOG Shipping — Operator Reference (Goose's desk doc).
// Lives as an authed page (inherits /references access via prefix matching)
// instead of a /public HTML drop because it contains internal numbers
// (Express rate adjustment) and do-not-touch guardrails.
// Content owner: Jon. Updated 2026-08-12.

const S = {
  eyebrow: {
    fontSize: 10, fontWeight: 800 as const, color: T.muted,
    textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 10,
  },
  card: {
    background: T.card, border: `1px solid ${T.border}`,
    borderRadius: 10, padding: "14px 16px",
  },
  p: { fontSize: 13, lineHeight: 1.6, color: T.text, margin: 0 },
  muted: { fontSize: 12.5, lineHeight: 1.6, color: T.muted, margin: 0 },
  lead: { fontWeight: 700 as const },
  monoNum: { fontFamily: mono, fontVariantNumeric: "tabular-nums" as const },
  sec: { marginBottom: 28 },
};

function Label({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5,
      textTransform: "uppercase", color,
    }}>{children}</span>
  );
}

function Row({ lead, children }: { lead: string; children: React.ReactNode }) {
  return (
    <p style={{ ...S.p, marginBottom: 10 }}>
      <span style={S.lead}>{lead}</span> {children}
    </p>
  );
}

export default function FogShippingReference() {
  return (
    <div style={{ fontFamily: font, color: T.text, maxWidth: 760, margin: "0 auto", paddingBottom: 40 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, letterSpacing: "-0.02em" }}>
        FOG Shipping — Operator Reference
      </h1>
      <p style={{ fontSize: 12, color: T.faint, marginBottom: 28 }}>
        Updated August 12, 2026 · What changed, where things live, and what to watch.
      </p>

      {/* What changed */}
      <div style={S.sec}>
        <div style={S.eyebrow}>What changed at checkout</div>
        <p style={{ ...S.muted, marginBottom: 10 }}>Customers now see more options. Nothing was removed.</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ ...S.card, flex: "1 1 240px" }}>
            <div style={{ ...S.eyebrow, marginBottom: 8 }}>Domestic</div>
            <p style={S.p}>USPS Ground Advantage · Priority Mail · Priority Mail Express</p>
            <p style={{ ...S.p, marginTop: 6 }}>
              UPS Ground <Label color={T.green}>new</Label>{"  ·  "}UPS 2-Day <Label color={T.green}>new</Label>
            </p>
          </div>
          <div style={{ ...S.card, flex: "1 1 240px" }}>
            <div style={{ ...S.eyebrow, marginBottom: 8 }}>International</div>
            <p style={S.p}>International Flat Rate, five weight tiers</p>
            <p style={{ ...S.p, marginTop: 6 }}>
              International Express <Label color={T.green}>new</Label>{" "}
              <span style={S.muted}>(UPS Worldwide Expedited)</span>
            </p>
          </div>
        </div>
      </div>

      {/* The one rule */}
      <div style={S.sec}>
        <div style={S.eyebrow}>The one rule that matters</div>
        <div style={{ ...S.card, outline: `2px solid ${T.amber}`, outlineOffset: -1 }}>
          <p style={{ ...S.p, marginBottom: 8 }}>
            <span style={S.lead}>If the order says UPS Ground, UPS 2-Day, or International Express, ship exactly that.</span>{" "}
            The customer paid a premium for a named service. These arrive with Shipping Service pre-filled. Do not rate shop them.
          </p>
          <p style={S.p}>
            <span style={S.lead}>If the order says International Flat Rate, keep doing what you have always done.</span>{" "}
            Buy the most sensible label; FCMI stays the default. These arrive with Shipping Service blank on purpose, and that blank is your signal to choose.
          </p>
        </div>
      </div>

      {/* Where to find things */}
      <div style={S.sec}>
        <div style={S.eyebrow}>Where to find things</div>
        <div style={{ ...S.card, padding: "4px 16px", overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 420 }}>
            <tbody>
              {[
                ["What the customer picked", "Requested Service column on the order"],
                ["What will actually ship", "Shipping Service field"],
                ["Rates shown at checkout", "Settings > Selling Channels > Store Setup > FOG > Checkout Rates"],
                ["Service name translation", "Store Setup > FOG > Shipping Services"],
                ["Shopify import behavior", "Store Setup > FOG > Store Settings (the checkbox list below the tabs)"],
                ["Customs declaration", "On the order, not the product record"],
              ].map(([what, where], i, arr) => (
                <tr key={what}>
                  <td style={{
                    padding: "9px 14px 9px 0", fontSize: 12.5, color: T.muted, verticalAlign: "top",
                    borderBottom: i < arr.length - 1 ? `1px solid ${T.border}` : "none", whiteSpace: "nowrap",
                  }}>{what}</td>
                  <td style={{
                    padding: "9px 0", fontSize: 12.5, color: T.text, fontFamily: mono,
                    borderBottom: i < arr.length - 1 ? `1px solid ${T.border}` : "none",
                  }}>{where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Behaviors */}
      <div style={S.sec}>
        <div style={S.eyebrow}>Behaviors worth knowing</div>
        <div style={S.card}>
          <Row lead="Options disappear rather than fail.">
            Every rate is set so that if the carrier will not quote it, the option simply does not appear at checkout.
            UPS never shows for APO, FPO, DPO, or PO Box addresses (verified; those orders come through USPS automatically).
            When a carrier suspends a country, that option vanishes on its own. Express does not appear where UPS does not deliver.
            If someone ever proposes setting a flat backup price instead, say no: that would let a customer pay for a label we cannot buy.
          </Row>
          <Row lead="Checkout rate names are not service names.">
            ShipStation only auto-connects them when the text matches exactly. &quot;UPS Ground&quot; matched itself; &quot;UPS 2-Day&quot; and
            &quot;International Express&quot; needed manual mapping rows (the real services are UPS 2nd Day Air and UPS Worldwide Expedited).
            If a new rate is ever added, it needs a mapping row too, or orders arrive unmapped and get rate shopped by accident.
          </Row>
          <Row lead="Settings apply at import, not retroactively.">
            Turning something on does not fix orders already sitting in Awaiting Shipment. Always test with a fresh order.
          </Row>
          <Row lead="Rates take time to propagate.">
            A new checkout rate can take 30 minutes to 24 hours to appear on the Shopify side. An empty list right after saving is normal.
          </Row>
          <p style={S.p}>
            <span style={S.lead}>Transit estimates are carrier transit only.</span>{" "}
            &quot;5 business days&quot; starts when the carrier picks the parcel up, not when the customer orders. Processing time is on top. Expect questions.
          </p>
        </div>
      </div>

      {/* Countries */}
      <div style={S.sec}>
        <div style={S.eyebrow}>Countries we do not ship to</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={S.card}>
            <p style={{ ...S.p, marginBottom: 4 }}>
              <Label color={T.amber}>carrier suspended · 8</Label>
            </p>
            <p style={{ ...S.p, marginBottom: 8 }}>
              Afghanistan, Belarus, Bhutan, Haiti, Kiribati, Seychelles, Turkmenistan, Yemen
            </p>
            <p style={S.muted}>
              Held out at the <b>shipping zone</b>, not the market. When USPS restores service, re-enabling is one change in one
              place: Settings &gt; Shipping and delivery &gt; International zone &gt; add the country back.
            </p>
          </div>
          <div style={S.card}>
            <p style={{ ...S.p, marginBottom: 4 }}>
              <Label color={T.red}>blocked permanently · 5</Label>
            </p>
            <p style={{ ...S.p, marginBottom: 8 }}>Cuba, Iran, South Sudan, Sudan, Venezuela</p>
            <p style={S.muted}>
              Sanctions territories, excluded at the <b>market</b> level. Do not re-enable without a decision from above.
            </p>
          </div>
          <p style={S.muted}>
            Plus 32 high-risk destinations excluded by prior decision. Not a gap; intentional.
          </p>
        </div>
      </div>

      {/* Duties */}
      <div style={S.sec}>
        <div style={S.eyebrow}>Duties</div>
        <div style={{ ...S.card, outline: `2px solid ${T.red}`, outlineOffset: -1 }}>
          <p style={{ ...S.p, marginBottom: 8 }}>
            <span style={S.lead}>We do not collect duties at checkout.</span>{" "}
            Customers pay import charges on delivery. Both international options say so at checkout.
          </p>
          <p style={{ ...S.p, marginBottom: 8 }}>
            <span style={S.lead}>Never turn on duty collection, and never enter a VAT or tax registration in Shopify.</span>{" "}
            Entering a registration is what switches duty collection on across nearly every EU and UK order. If that happens while
            parcels ship duties-unpaid, customers get charged twice: once by us and once at their door. That change only happens on
            instruction, in a specific order, after duty-paid shipping is in place.
          </p>
          <p style={S.p}>
            <span style={S.lead}>On individual labels:</span>{" "}
            the &quot;Bill duties and taxes to payor of shipping charges&quot; checkbox is the duty-paid switch. Leave it unchecked.
            Checking it charges the duties to our account at label creation; on one test shipment that turned a{" "}
            <span style={S.monoNum}>$34.91</span> label into <span style={S.monoNum}>$129.39</span>.
          </p>
        </div>
      </div>

      {/* Keep an eye on */}
      <div style={S.sec}>
        <div style={S.eyebrow}>Keep an eye on</div>
        <div style={S.card}>
          <Row lead="Premium orders shipping as the wrong service.">
            The highest-cost mistake available right now. Someone pays <span style={S.monoNum}>$30.95</span> for International
            Express and receives a postal parcel. Spot check these until the habit sets.
          </Row>
          <Row lead="The Cancelled folder.">
            FOG uses Shop Pay, and a ShipStation setting affects whether those orders import correctly. Worth a periodic look for
            real orders sitting there.
          </Row>
          <Row lead="Customs declarations on international labels.">
            HS code and item description are still filling in inconsistently; the automatic HS code lookup covers it for now.
            Vague or marketing-style descriptions are what trigger customs inspections, so &quot;Nylon carrying pouch, empty&quot;
            beats &quot;Roll 1 Trauma Pouch, Multicam Black.&quot;
          </Row>
          <Row lead="Express label cost versus what was quoted.">
            Checkout adds <span style={S.monoNum}>12%</span> to the carrier rate. On the first several Express orders, compare the
            label cost against what the customer paid. If the label consistently lands higher, the adjustment needs raising.
          </Row>
          <Row lead="Canada looks strange and is fine.">
            Express is cheaper and faster than the flat rate there. Not a fault: short-haul courier beats a flat rate built for
            long haul. Customers take the better option and we still make money.
          </Row>
          <p style={S.p}>
            <span style={S.lead}>Korea and Mexico collect an extra field at checkout.</span>{" "}
            Korea requires a Personal Customs Code, Mexico an RFC. Both are customs requirements in those countries. If a parcel to
            either gets held, that field is the first thing to check.
          </p>
        </div>
      </div>

      {/* Troubleshooting */}
      <div style={S.sec}>
        <div style={S.eyebrow}>If something looks wrong</div>
        <div style={S.card}>
          <Row lead="Customer says an option was missing at checkout.">
            Usually correct behavior. Check the address: PO Box, military, or a suspended country all remove UPS on purpose.
          </Row>
          <Row lead="Order came in unmapped.">
            Check Store Setup &gt; FOG &gt; Shipping Services for a row matching that Requested Service name. If it is missing, add
            it. Do not just pick a service manually and move on, or the next one will do the same thing.
          </Row>
          <Row lead="Customs error blocks a label.">
            The declaration lives on the order, not the product record. Missing HS code or description can be typed in directly to
            get the label out.
          </Row>
          <p style={S.p}>
            <span style={S.lead}>Rate looks wrong at checkout.</span>{" "}
            Confirm in ShipStation&apos;s Checkout Rates whether it is Live Rate or Flat Rate, and check the Rate Adjustment.
            Express is set to carrier rate plus <span style={S.monoNum}>12%</span>.
          </p>
        </div>
      </div>

      {/* Do not change */}
      <div style={{ ...S.sec, marginBottom: 0 }}>
        <div style={S.eyebrow}>Do not change without asking</div>
        <div style={{ ...S.card, borderLeft: `3px solid ${T.red}` }}>
          {[
            "Backup Rate settings on any checkout rate",
            "Duty collection toggles, in ShipStation or Shopify",
            "The flat rate prices, which are a deliberate subsidy",
            "Market or shipping zone country lists",
            "The “automatically set the Shipping Service selected by the customer at checkout” setting",
          ].map(item => (
            <p key={item} style={{ ...S.p, marginBottom: 6 }}>· {item}</p>
          ))}
        </div>
      </div>
    </div>
  );
}
