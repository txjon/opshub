import { ReactNode } from "react";
import { ClientPortalProvider } from "./_shared/context";
import Shell from "./_shared/Shell";

// Layout wraps all client portal tabs with a shared shell:
// header (client name), tab nav (Overview / Designs / Orders / Staging),
// toast stack for cross-tab activity, and the data provider.
//
// Each page renders under <Shell> and consumes data via useClientPortal().

export default function ClientPortalLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { token: string };
}) {
  return (
    <ClientPortalProvider token={params.token}>
      <Shell>{children}</Shell>
    </ClientPortalProvider>
  );
}
