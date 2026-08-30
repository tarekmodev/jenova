"use client";

/**
 * Distributes the server-validated session context (user, agency defaults,
 * tenant branding) to client components. The values originate from the api's
 * /auth/agency/session — nothing here is client-derived.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { SessionContext } from "../lib/types";

const PortalContext = createContext<SessionContext | null>(null);

export function PortalContextProvider(props: {
  value: SessionContext;
  children: ReactNode;
}): ReactNode {
  return <PortalContext.Provider value={props.value}>{props.children}</PortalContext.Provider>;
}

export function usePortalContext(): SessionContext {
  const value = useContext(PortalContext);
  if (value === null) {
    throw new Error("usePortalContext requires the portal layout");
  }
  return value;
}
