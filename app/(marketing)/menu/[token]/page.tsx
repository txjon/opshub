import { redirect } from "next/navigation";

// The experience was renamed The Build (Sep 9 2026) — /menu links live in
// already-sent emails, so this route forwards forever.
export default async function MenuRedirect({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  redirect(`/build/${token}`);
}
