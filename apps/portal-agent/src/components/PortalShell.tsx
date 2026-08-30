"use client";

import {
  AppShell,
  Box,
  Button,
  Chip,
  NavSection,
  Stack,
  ToastProvider,
  Typography,
  type NavItem,
} from "@jenova/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useMessages } from "../i18n/I18nProvider";
import { usePortalContext } from "./PortalContext";
import { LocaleSwitcher } from "./LocaleSwitcher";

export function PortalShell(props: { children: ReactNode }): ReactNode {
  const messages = useMessages();
  const session = usePortalContext();
  const pathname = usePathname();
  const router = useRouter();

  const items: NavItem[] = [
    { id: "search", label: messages.nav.search, href: "/search" },
    { id: "bookings", label: messages.nav.bookings, href: "/bookings" },
  ];
  const selectedId = pathname.startsWith("/bookings") ? "bookings" : "search";

  const logout = async (): Promise<void> => {
    await fetch("/portal-session/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  const brandName =
    typeof session.tenant.branding["displayName"] === "string"
      ? (session.tenant.branding["displayName"] as string)
      : session.tenant.name;

  return (
    <AppShell
      logo={
        <Box>
          <Typography variant="h6" component="div" noWrap data-testid="tenant-brand">
            {brandName}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {messages.common.portalName}
          </Typography>
        </Box>
      }
      sidebar={<NavSection items={items} selectedId={selectedId} linkComponent={Link} />}
      topbar={
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Chip size="small" label={session.agency.name} data-testid="agency-name" />
          <Typography variant="body2" color="text.secondary" data-testid="user-name">
            {session.user.displayName}
          </Typography>
          <LocaleSwitcher />
          <Button size="small" color="inherit" onClick={() => void logout()} data-testid="logout">
            {messages.common.logout}
          </Button>
        </Stack>
      }
      collapseToggleLabel={messages.common.collapseNavigation}
      openNavigationLabel={messages.common.openNavigation}
    >
      <ToastProvider>{props.children}</ToastProvider>
    </AppShell>
  );
}
