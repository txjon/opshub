"use client";
import { useEffect } from "react";

// App-feel for a client page on a phone: the page itself doesn't pinch- or
// double-tap-zoom. Pinch to look closer lives in ImageLightbox instead.
//
// iOS Safari ignores user-scalable=no (since iOS 10), so it takes three locks:
//   - viewport meta maximum-scale=1 / user-scalable=no (Android Chrome)
//   - touch-action pan-x pan-y on <html> (no pinch, no double-tap zoom)
//   - gesturestart preventDefault (WebKit's pinch event, iOS Safari)
// All three come off on unmount, so the rest of the portal is untouched.
export function useNoPageZoom() {
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    const prevMeta = meta?.getAttribute("content") ?? null;
    if (meta && prevMeta != null) meta.setAttribute("content", `${prevMeta}, maximum-scale=1, user-scalable=no`);
    const html = document.documentElement;
    const prevTouch = html.style.touchAction;
    html.style.touchAction = "pan-x pan-y";
    const block = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", block);
    document.addEventListener("gesturechange", block);
    return () => {
      if (meta && prevMeta != null) meta.setAttribute("content", prevMeta);
      html.style.touchAction = prevTouch;
      document.removeEventListener("gesturestart", block);
      document.removeEventListener("gesturechange", block);
    };
  }, []);
}
