"use client";
import { useEffect, useState } from "react";
import { BP } from "./theme";

/**
 * Reactive mobile-viewport detector. Returns true when viewport width is
 * below the mobile breakpoint. Stays in sync with window resize and
 * orientation change — don't rely on a one-shot innerWidth check.
 *
 * Usage: `const isMobile = useIsMobile();`
 *
 * Server-render: returns `false` until hydration so the desktop layout
 * is the default (avoids layout flash on desktop; mobile users get one
 * re-render on hydration which is fine).
 */
export function useIsMobile(breakpoint: number = BP.mobile): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, [breakpoint]);

  return isMobile;
}
