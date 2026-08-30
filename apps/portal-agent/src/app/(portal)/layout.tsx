/**
 * Authenticated portal frame: validates the session server-side on every
 * navigation (expired/revoked sessions bounce to /login before any data
 * renders) and mounts the shared shell.
 */

import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { PortalShell } from "../../components/PortalShell";
import { PortalContextProvider } from "../../components/PortalContext";
import { fetchSessionContext } from "../../lib/session";

export const dynamic = "force-dynamic";

export default async function PortalLayout(props: { children: ReactNode }) {
  const session = await fetchSessionContext();
  if (session === null) {
    redirect("/login");
  }
  return (
    <PortalContextProvider value={session}>
      <PortalShell>{props.children}</PortalShell>
    </PortalContextProvider>
  );
}
