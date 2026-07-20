// Non-destructive mockup crop — a transform { zoom, offsetX, offsetY } stored on
// the proof spec. The original mockup file is NEVER modified; the crop is applied
// at render time. The web proof (CSS) and the PDF (a baked canvas) both call this
// same math against a fixed-aspect frame, so the crop frames identically in both.
export const MOCKUP_FRAME_ASPECT = 2; // frame width : height

// Given the source image size, a target frame size, and the crop, return where
// to place the (full) image inside the frame. At zoom 1 the image is CONTAINED
// (whole image visible, letterboxed); zoom > 1 magnifies + offsets pan/crop.
// Frame-size-agnostic, so the CSS frame (px) and the PDF canvas (px) yield the
// same relative framing as long as they share MOCKUP_FRAME_ASPECT.
export function computeMockupLayout(imgW, imgH, frameW, frameH, crop) {
  const zoom = Math.max(1, (crop && crop.zoom) || 1);
  const ox = Math.max(-1, Math.min(1, (crop && crop.offsetX) || 0));
  const oy = Math.max(-1, Math.min(1, (crop && crop.offsetY) || 0));
  const base = Math.min(frameW / imgW, frameH / imgH); // contain at zoom 1
  const scale = base * zoom;
  const dispW = imgW * scale, dispH = imgH * scale;
  const overflowX = Math.max(0, dispW - frameW), overflowY = Math.max(0, dispH - frameH);
  const left = (frameW - dispW) / 2 + ox * overflowX / 2;
  const top = (frameH - dispH) / 2 + oy * overflowY / 2;
  return { dispW, dispH, left, top, overflowX, overflowY };
}
