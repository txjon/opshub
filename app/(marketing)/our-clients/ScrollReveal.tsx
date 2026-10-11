"use client";
import { useEffect } from "react";

// Touch screens have no hover, so the client name reveals on scroll
// instead: a tile flips to its blue name while it sits in the top quarter
// of the viewport (just under the nav), i.e. as it's about to leave view.
// Desktop (hover-capable) keeps the CSS :hover behavior and never runs this.

export function ScrollReveal() {
  useEffect(() => {
    if (!window.matchMedia("(hover: none)").matches) return;
    const io = new IntersectionObserver(
      entries => entries.forEach(e => e.target.classList.toggle("is-revealed", e.isIntersecting)),
      { rootMargin: "-64px 0px -75% 0px" },
    );
    document.querySelectorAll(".hpd-client-tile").forEach(t => io.observe(t));
    return () => io.disconnect();
  }, []);
  return null;
}
