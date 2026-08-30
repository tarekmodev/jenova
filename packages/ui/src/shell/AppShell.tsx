"use client";

/**
 * AppShell — the dashboard-class chrome: sidebar + topbar + content.
 *
 * Structure follows the platform's shell language (docs/07): a 270px
 * sidebar that collapses to an 87px icon rail on desktop and becomes a
 * temporary drawer on small screens, under a 70px topbar.
 *
 * Direction correctness: layout is flex-flow (flex flips with direction
 * for free) and logical properties; `anchor="left"` on the temporary
 * drawer is start-anchored in practice because the per-direction emotion
 * cache (stylis-plugin-rtl) flips the physical CSS it generates. Nothing
 * in this file may branch on ltr/rtl except icon mirroring, which uses
 * `useDirection()`.
 */

import MenuIcon from "@mui/icons-material/Menu";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Toolbar from "@mui/material/Toolbar";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useDirection } from "../direction/DirectionProvider";
import { jenovaLayout } from "../theme/tokens";

export interface AppShellContextValue {
  /** True when the desktop sidebar is collapsed to the icon rail. */
  readonly collapsed: boolean;
}

const AppShellContext = createContext<AppShellContextValue>({ collapsed: false });

/** NavSection (and custom sidebar content) reads collapse state from here. */
export function useAppShell(): AppShellContextValue {
  return useContext(AppShellContext);
}

export interface AppShellProps {
  /** Brand slot rendered at the top of the sidebar. */
  readonly logo?: ReactNode;
  /** Sidebar content — typically one or more NavSection. */
  readonly sidebar: ReactNode;
  /** Trailing topbar content (profile menu, locale switch, …). */
  readonly topbar?: ReactNode;
  readonly children: ReactNode;
  /** Controlled collapse state (desktop icon rail). */
  readonly collapsed?: boolean;
  readonly defaultCollapsed?: boolean;
  readonly onCollapsedChange?: (collapsed: boolean) => void;
  /** aria-label for the desktop collapse toggle (i18n via props). */
  readonly collapseToggleLabel: string;
  /** aria-label for the mobile navigation button (i18n via props). */
  readonly openNavigationLabel: string;
  readonly sidebarWidth?: number;
  readonly miniSidebarWidth?: number;
  readonly topbarHeight?: number;
}

export function AppShell(props: AppShellProps): ReactNode {
  const theme = useTheme();
  const direction = useDirection();
  const isDesktop = useMediaQuery(theme.breakpoints.up("lg"));

  const sidebarWidth = props.sidebarWidth ?? jenovaLayout.sidebarWidth;
  const miniWidth = props.miniSidebarWidth ?? jenovaLayout.miniSidebarWidth;
  const topbarHeight = props.topbarHeight ?? jenovaLayout.topbarHeight;

  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(
    props.defaultCollapsed ?? false,
  );
  const collapsed = props.collapsed ?? uncontrolledCollapsed;
  const onCollapsedChange = props.onCollapsedChange;
  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    setUncontrolledCollapsed(next);
    onCollapsedChange?.(next);
  }, [collapsed, onCollapsedChange]);

  const [mobileOpen, setMobileOpen] = useState(false);

  const effectiveCollapsed = isDesktop && collapsed;
  const shellContext = useMemo<AppShellContextValue>(
    () => ({ collapsed: effectiveCollapsed }),
    [effectiveCollapsed],
  );
  const desktopWidth = effectiveCollapsed ? miniWidth : sidebarWidth;

  const sidebarContent = (
    <AppShellContext.Provider value={shellContext}>
      <Box
        sx={{
          height: topbarHeight,
          display: "flex",
          alignItems: "center",
          paddingInline: 2,
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        {props.logo}
      </Box>
      <Box sx={{ overflowY: "auto", overflowX: "hidden", flexGrow: 1, paddingInline: 1 }}>
        {props.sidebar}
      </Box>
    </AppShellContext.Provider>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", backgroundColor: "background.default" }}>
      {isDesktop ? (
        <Drawer
          variant="permanent"
          sx={{
            width: desktopWidth,
            flexShrink: 0,
            transition: theme.transitions.create("width", {
              duration: theme.transitions.duration.shorter,
            }),
            "& .MuiDrawer-paper": {
              width: desktopWidth,
              overflowX: "hidden",
              display: "flex",
              flexDirection: "column",
              boxSizing: "border-box",
              borderInlineEnd: `1px solid ${theme.palette.divider}`,
              transition: theme.transitions.create("width", {
                duration: theme.transitions.duration.shorter,
              }),
            },
          }}
        >
          {sidebarContent}
        </Drawer>
      ) : (
        <Drawer
          variant="temporary"
          // Start-anchored: the rtl emotion cache flips the physical CSS.
          anchor="left"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            "& .MuiDrawer-paper": {
              width: sidebarWidth,
              display: "flex",
              flexDirection: "column",
              boxSizing: "border-box",
            },
          }}
        >
          {sidebarContent}
        </Drawer>
      )}

      <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
        <AppBar position="sticky" color="inherit">
          <Toolbar sx={{ minHeight: topbarHeight, gap: 1 }}>
            {isDesktop ? (
              <IconButton
                aria-label={props.collapseToggleLabel}
                onClick={toggleCollapsed}
                edge="start"
              >
                <MenuOpenIcon
                  sx={{
                    // Directional glyph: mirror in RTL (SVGs are outside the
                    // stylis flip); collapsed state flips it back.
                    transform:
                      (direction === "rtl") !== effectiveCollapsed ? "scaleX(-1)" : "none",
                  }}
                />
              </IconButton>
            ) : (
              <IconButton
                aria-label={props.openNavigationLabel}
                onClick={() => setMobileOpen(true)}
                edge="start"
              >
                <MenuIcon />
              </IconButton>
            )}
            <Box sx={{ flexGrow: 1 }} />
            {props.topbar}
          </Toolbar>
        </AppBar>

        <Box component="main" sx={{ flexGrow: 1, padding: 3, minWidth: 0 }}>
          <AppShellContext.Provider value={shellContext}>{props.children}</AppShellContext.Provider>
        </Box>
      </Box>
    </Box>
  );
}
