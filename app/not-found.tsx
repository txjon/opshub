import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "#0f1117",
      color: "#e8eaf2",
      fontFamily: "'IBM Plex Sans','Helvetica Neue',Arial,sans-serif",
    }}>
      <h1 style={{ fontSize: 64, fontWeight: 700, margin: 0, color: "#4f8ef7" }}>404</h1>
      <p style={{ fontSize: 18, color: "#8a92b0", marginTop: 8 }}>Page not found</p>
      <Link
        href="/"
        style={{
          marginTop: 24,
          padding: "10px 24px",
          background: "#4f8ef7",
          color: "#fff",
          borderRadius: 8,
          textDecoration: "none",
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
