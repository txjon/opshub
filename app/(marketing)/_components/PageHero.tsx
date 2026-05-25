// Lightweight subpage hero — smaller than the home Hero, used as a
// header band on /services, /work, and /client-portal. Dark
// photographic background with eyebrow + title + optional sub.

export function PageHero({
  eyebrow,
  title,
  sub,
  image,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  image?: string;
}) {
  return (
    <section style={{
      position: "relative",
      minHeight: 360,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      textAlign: "center",
    }}>
      {/* Optional photo background, otherwise solid dark */}
      {image ? (
        <img
          src={image}
          alt=""
          aria-hidden
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%", objectFit: "cover",
          }}
        />
      ) : (
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(ellipse at 50% 50%, #1f1f2a 0%, #0a0a0c 70%)",
        }} />
      )}
      {/* Dark overlay for legibility */}
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.75) 100%)",
      }} />

      <div style={{
        position: "relative", zIndex: 1,
        maxWidth: 1000, padding: "80px 32px",
      }}>
        {eyebrow && (
          <div style={{
            fontSize: 11, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.14em",
            color: "rgba(255,255,255,0.55)", marginBottom: 16,
          }}>
            {eyebrow}
          </div>
        )}
        <h1 style={{
          fontSize: "clamp(32px, 5.5vw, 60px)",
          fontWeight: 900,
          lineHeight: 1.05,
          letterSpacing: "-0.02em",
          color: "#fff",
          textTransform: "uppercase",
        }}>
          {title}
        </h1>
        {sub && (
          <p style={{
            fontSize: "clamp(15px, 1.4vw, 18px)",
            color: "rgba(255,255,255,0.8)",
            marginTop: 20,
            maxWidth: 680, marginLeft: "auto", marginRight: "auto",
            lineHeight: 1.6,
          }}>
            {sub}
          </p>
        )}
      </div>
    </section>
  );
}
