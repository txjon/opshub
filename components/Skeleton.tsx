"use client";
import { T } from "@/lib/theme";

export function Skeleton({ width, height = 16, radius = 6, style }: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        width: width ?? "100%",
        height,
        borderRadius: radius,
        background: `linear-gradient(90deg, ${T.surface} 25%, ${T.border}40 50%, ${T.surface} 75%)`,
        backgroundSize: "200% 100%",
        animation: "shimmer 1.5s ease-in-out infinite",
        ...style,
      }}
    />
  );
}

export function SkeletonRows({ rows = 5, gap = 10 }: { rows?: number; gap?: number }) {
  return (
    <>
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      <div style={{ display: "flex", flexDirection: "column", gap }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Skeleton width={40} height={40} radius={8} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <Skeleton width={`${60 + Math.random() * 30}%`} height={14} />
              <Skeleton width={`${30 + Math.random() * 25}%`} height={10} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <>
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} style={{ display: "flex", gap: 16, padding: "10px 16px" }}>
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} width={c === 0 ? "35%" : `${15 + Math.random() * 10}%`} height={14} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
