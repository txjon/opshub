"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "#f4f4f6",
      color: "#1a1a1a",
      fontFamily: "'IBM Plex Sans','Helvetica Neue',Arial,sans-serif",
    }}>
      <h1 style={{ fontSize: 48, fontWeight: 700, margin: 0, color: "#ff324d" }}>Something went wrong</h1>
      <p style={{ fontSize: 16, color: "#6b6b78", marginTop: 8 }}>An unexpected error occurred.</p>
      <button
        onClick={() => reset()}
        style={{
          marginTop: 24,
          padding: "10px 24px",
          background: "#73b6c9",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Try Again
      </button>
    </div>
  );
}
