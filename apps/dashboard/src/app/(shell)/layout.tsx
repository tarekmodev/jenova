/**
 * Shell layout for every authenticated surface: fetches the session's
 * profile + the tenant's entitlements ONCE per request and mounts the
 * chrome. A dead session redirects to /login here (apiJsonOrLogin).
 */

import type { ReactNode } from "react";
import type { AppKey } from "@jenova/domain";
import { apiJsonOrLogin } from "../../lib/api";
import { DashboardShell } from "../../components/DashboardShell";

interface MeResponse {
  readonly user: { readonly displayName: string; readonly email: string };
}

interface EntitlementsResponse {
  readonly installed: readonly AppKey[];
}

export default async function ShellLayout(props: {
  readonly children: ReactNode;
}): Promise<ReactNode> {
  const [me, entitlements] = await Promise.all([
    apiJsonOrLogin<MeResponse>("/staff/auth/me"),
    apiJsonOrLogin<EntitlementsResponse>("/me/entitlements"),
  ]);

  return (
    <DashboardShell user={me.user} installed={entitlements.installed} brandName="Jenova">
      {props.children}
    </DashboardShell>
  );
}
