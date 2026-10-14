import { redirect } from "next/navigation";

// Renamed to /account (Oct 14 2026); old links keep working.
export default function CompanyRedirect({ params, searchParams }: { params: { token: string }; searchParams: Record<string, string | undefined> }) {
  const q = searchParams?.view === "1" ? "?view=1" : "";
  redirect(`/portal/client/${params.token}/account${q}`);
}
