import { redirect } from "next/navigation";

// The line sheet moved to its own hub tab (Nov 26 2026: one board per
// client). Links already sent to clients land there.
export default function OldReleaseLineSheet({ params }: { params: { token: string } }) {
  redirect(`/portal/client/${params.token}/line-sheet`);
}
