"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
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
      <h1 style={{ fontSize: 48, fontWeight: 700, margin: 0, color: "#f05353" }}>Something went wrong</h1>
      <p style={{ fontSize: 16, color: "#8a92b0", marginTop: 8 }}>An unexpected error occurred.</p>
      <button
        onClick={() => reset()}
        style={{
          marginTop: 24,
          padding: "10px 24px",
          background: "#4f8ef7",
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
