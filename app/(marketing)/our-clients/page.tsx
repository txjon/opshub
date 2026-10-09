import fs from "node:fs";
import path from "node:path";
import Image from "next/image";
import { PageHero } from "../_components/PageHero";
import { CLIENTS } from "./clients";

// /our-clients — every client, past and present, one alphabetical grid.
// Each tile is the client's white logo on black, over an optional square
// photo + scrim. Art lives in public/marketing/clients/<slug>.png (logo)
// and <slug>.jpg (photo, optional). No logo = name-only tile (some clients
// can't be shown by logo), so the page ships while art is still coming in. (/clients is the OpsHub dashboard;
// marketing + app share one route tree.) force-static: the art check runs
// once at build, where public/ is on disk.

export const dynamic = "force-static";

export const metadata = {
  title: "Clients | House Party Distro",
  description: "The brands, teams, and creators we make merch for.",
};

const ART_DIR = path.join(process.cwd(), "public/marketing/clients");

const has = (file: string) => fs.existsSync(path.join(ART_DIR, file));

export default function ClientsPage() {
  return (
    <>
      <PageHero
        title="Clients"
        sub="Past and present"
      />

      <section style={{ padding: "80px 32px 120px", background: "#fff" }}>
        <div className="hpd-clients-grid" style={{
          maxWidth: 1280, margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}>
          {CLIENTS.map(c => (
            <div key={c.slug} className="hpd-client-tile" style={{
              position: "relative",
              aspectRatio: "1 / 1",
              background: "#0a0a0c",
              borderRadius: 8,
              overflow: "hidden",
            }}>
              {has(`${c.slug}.png`) ? (
                <>
                  {has(`${c.slug}.jpg`) && (
                    <>
                      <Image
                        src={`/marketing/clients/${c.slug}.jpg`}
                        alt=""
                        fill
                        sizes="(max-width: 540px) 50vw, (max-width: 900px) 33vw, 320px"
                        className="hpd-client-photo"
                        style={{ objectFit: "cover" }}
                      />
                      <div className="hpd-client-scrim" />
                    </>
                  )}
                  <Image
                    src={`/marketing/clients/${c.slug}.png`}
                    alt={c.name}
                    fill
                    sizes="(max-width: 540px) 30vw, (max-width: 900px) 20vw, 200px"
                    style={{ objectFit: "contain", padding: "22%" }}
                  />
                </>
              ) : (
                <div style={{
                  position: "absolute", inset: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: 20, textAlign: "center",
                  color: "#fff", fontSize: 15, fontWeight: 800,
                  letterSpacing: "0.06em", textTransform: "uppercase", lineHeight: 1.25,
                }}>
                  {c.name}
                </div>
              )}
            </div>
          ))}
        </div>

        <style>{`
          .hpd-client-scrim {
            position: absolute; inset: 0;
            background: radial-gradient(circle, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.35) 70%);
            transition: background 0.25s ease;
          }
          .hpd-client-photo { transition: transform 0.4s ease; }
          .hpd-client-tile:hover .hpd-client-photo { transform: scale(1.04); }
          .hpd-client-tile:hover .hpd-client-scrim {
            background: radial-gradient(circle, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.2) 70%);
          }
          @media (max-width: 900px) {
            .hpd-clients-grid { grid-template-columns: repeat(3, 1fr) !important; }
          }
          @media (max-width: 540px) {
            .hpd-clients-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 8px !important; }
          }
        `}</style>
      </section>
    </>
  );
}
