"use client";

/**
 * The dashboard chrome: @jenova/ui AppShell + one NavSection per manifest
 * section, filtered by the tenant's entitlements (issue #90). Labels
 * localize here (the kit takes strings, apps own catalogs); selection
 * follows the pathname via the manifest's longest-prefix match.
 */

import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { AppKey } from "@jenova/domain";
import {
  AppShell,
  Avatar,
  Box,
  Button,
  Divider,
  Menu,
  MenuItem,
  NavSection,
  Typography,
  type NavItem,
} from "@jenova/ui";
import { DASHBOARD_MANIFEST, selectedNavId } from "../lib/manifest";
import { LocaleSwitcher } from "./LocaleSwitcher";

export interface ShellUser {
  readonly displayName: string;
  readonly email: string;
}

export function DashboardShell(props: {
  readonly user: ShellUser;
  readonly installed: readonly AppKey[];
  readonly brandName: string;
  readonly children: ReactNode;
}): ReactNode {
  const t = useTranslations("nav");
  const tShell = useTranslations("shell");
  const pathname = usePathname();
  const router = useRouter();
  const selected = selectedNavId(pathname);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const logout = async (): Promise<void> => {
    await fetch("/api/session", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  };

  const sidebar = (
    <>
      {DASHBOARD_MANIFEST.map((section) => (
        <NavSection
          key={section.id}
          title={t(`sections.${section.titleKey}`)}
          entitlements={props.installed}
          items={section.items.map(
            (item): NavItem => ({
              id: item.id,
              label: t(item.labelKey),
              href: item.href,
              ...(item.entitlement !== undefined ? { entitlement: item.entitlement } : {}),
            }),
          )}
          {...(selected !== undefined ? { selectedId: selected } : {})}
          linkComponent={NextLink}
        />
      ))}
    </>
  );

  return (
    <AppShell
      logo={
        <Typography variant="h5" component="span" sx={{ fontWeight: 700 }} noWrap>
          {props.brandName}
        </Typography>
      }
      sidebar={sidebar}
      collapseToggleLabel={tShell("collapseNav")}
      openNavigationLabel={tShell("openNav")}
      topbar={
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <LocaleSwitcher />
          <Button
            onClick={(event) => setMenuAnchor(event.currentTarget)}
            color="inherit"
            startIcon={<Avatar sx={{ width: 28, height: 28 }}>{props.user.displayName.charAt(0)}</Avatar>}
            data-testid="user-menu"
          >
            {props.user.displayName}
          </Button>
          <Menu
            anchorEl={menuAnchor}
            open={menuAnchor !== null}
            onClose={() => setMenuAnchor(null)}
          >
            <Box sx={{ paddingInline: 2, paddingBlock: 1 }}>
              <Typography variant="body2" color="text.secondary">
                {props.user.email}
              </Typography>
            </Box>
            <Divider />
            <MenuItem component={NextLink} href="/settings/account" onClick={() => setMenuAnchor(null)}>
              {tShell("accountSettings")}
            </MenuItem>
            <MenuItem onClick={() => void logout()} data-testid="logout">
              {tShell("logout")}
            </MenuItem>
          </Menu>
        </Box>
      }
    >
      {props.children}
    </AppShell>
  );
}
