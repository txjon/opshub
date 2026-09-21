// The pixel size of an image, read from its header bytes.
//
// The proof renderer needs this and nothing else about the file: the crop is
// stored as zoom + offsets, and placing it needs the source dimensions. Reading
// 30 bytes beats storing a second, cropped copy of every mockup in Drive (the
// approach this replaced) and beats a native image dependency, which Vercel
// will not take.
//
// Returns null for anything it cannot read, and the caller falls back to
// letting the image simply fit its frame.

export type ImageSize = { w: number; h: number };

export function imageSize(buf: Buffer): ImageSize | null {
  if (!buf || buf.length < 24) return null;

  // PNG: 8-byte signature, then IHDR width/height as big-endian uint32.
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }

  // GIF: little-endian uint16 at 6 and 8.
  if (buf.toString("ascii", 0, 3) === "GIF") {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  }

  // WebP: RIFF container, three possible chunk layouts.
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8 " && buf.length >= 30) {
      return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === "VP8L" && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X" && buf.length >= 30) {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { w, h };
    }
    return null;
  }

  // JPEG: walk the segments to a start-of-frame marker, which carries the size.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }          // resync on padding
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) return null;
      // SOF0-SOF15, minus the four that are not frame headers.
      const isFrameHeader = marker >= 0xc0 && marker <= 0xcf
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrameHeader) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}
