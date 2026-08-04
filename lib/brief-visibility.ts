// What a CLIENT may see of a brief's files — one predicate, every portal
// studio surface. Modern rule: shared_with_client_at stamps the wall
// crossing. Legacy rule (pre-Aug 2026 uploads never stamped): first_draft /
// revision / final kinds were client-facing BY KIND in the old portal, and
// the client's own uploads are always theirs. Poppies/Brain Kick/Franken
// Stein's banked art lives under the legacy rule.
export const LEGACY_CLIENT_KINDS = ["first_draft", "revision", "final"];
export function isClientVisibleFile(f: { shared_with_client_at?: string | null; uploader_role?: string | null; kind?: string | null }): boolean {
  return !!(f.shared_with_client_at || f.uploader_role === "client" || LEGACY_CLIENT_KINDS.includes(String(f.kind || "")));
}
