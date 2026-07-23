// The Lab shell — dark, full-bleed, outside the OpsHub dashboard chrome.
export default function LabLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif" }}>
      {children}
    </div>
  );
}
