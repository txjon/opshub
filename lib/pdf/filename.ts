// Content-Disposition is an HTTP ByteString (Latin-1). A PDF filename built from
// a job/decorator title containing a non-Latin1 character — em-dash (—), curly
// quotes, accents, emoji — throws "Cannot convert argument to a ByteString" and
// 500s the whole PDF. Build the header safely: an ASCII-only `filename=` that any
// client accepts, plus an RFC 6266 `filename*=UTF-8''…` carrying the full name.
export function contentDisposition(rawName: string, download?: boolean | string | null): string {
  const ascii = rawName.replace(/[^\x20-\x7E]/g, "-").replace(/-+/g, "-");
  const disposition = download ? "attachment" : "inline";
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(rawName)}`;
}
