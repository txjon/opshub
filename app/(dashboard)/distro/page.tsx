import { redirect } from "next/navigation";

// /distro merged into /the-distro (2026-08-13): the arrival radar's content
// now renders inside The Distro's hub skin. This route survives only as a
// redirect so bookmarks and old links keep working; access-wise the twin
// pair in lib/access.ts lets a /distro grant reach /the-distro.
export default function DistroLegacyRedirect() {
  redirect("/the-distro");
}
