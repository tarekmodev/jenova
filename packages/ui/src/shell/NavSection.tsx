"use client";

/**
 * NavSection — an entitlement-filtered sidebar section.
 *
 * Items whose `entitlement` the tenant lacks never render (CLAUDE.md
 * rule 3: apps are entitlements). In the collapsed icon rail the section
 * renders icons with tooltips; branches auto-expand around the selected
 * item.
 */

import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Collapse from "@mui/material/Collapse";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Tooltip from "@mui/material/Tooltip";
import { useState, type ElementType, type ReactNode } from "react";
import { useDirection } from "../direction/DirectionProvider";
import { useAppShell } from "./AppShell";
import { filterNavByEntitlements, navBranchContains, type NavItem } from "./navigation";

export interface NavSectionProps {
  /** Section heading — hidden in the collapsed rail. */
  readonly title?: string;
  readonly items: readonly NavItem[];
  /** Tenant entitlement flags; omit to show everything (platform admin). */
  readonly entitlements?: readonly string[];
  readonly selectedId?: string;
  readonly onNavigate?: (item: NavItem) => void;
  /** Link element for `href` items — pass the app's router Link. */
  readonly linkComponent?: ElementType;
}

export function NavSection(props: NavSectionProps): ReactNode {
  const { collapsed } = useAppShell();
  const items = filterNavByEntitlements(props.items, props.entitlements);

  return (
    <List
      dense
      {...(props.title !== undefined && !collapsed
        ? {
            subheader: (
              <ListSubheader disableSticky sx={{ backgroundColor: "transparent" }}>
                {props.title}
              </ListSubheader>
            ),
          }
        : {})}
    >
      {items.map((item) => (
        <NavEntry key={item.id} item={item} depth={0} {...props} collapsed={collapsed} />
      ))}
    </List>
  );
}

interface NavEntryProps extends Omit<NavSectionProps, "items" | "title"> {
  readonly item: NavItem;
  readonly depth: number;
  readonly collapsed: boolean;
}

function NavEntry(props: NavEntryProps): ReactNode {
  const { item, collapsed } = props;
  const direction = useDirection();
  const isBranch = item.children !== undefined && item.children.length > 0;
  const selected = item.id === props.selectedId;
  const [expanded, setExpanded] = useState(() => navBranchContains(item, props.selectedId));

  const button = (
    <ListItemButton
      selected={selected}
      {...(item.disabled !== undefined ? { disabled: item.disabled } : {})}
      {...(item.href !== undefined && !isBranch
        ? { component: props.linkComponent ?? "a", href: item.href }
        : {})}
      onClick={() => {
        if (isBranch) setExpanded((open) => !open);
        else props.onNavigate?.(item);
      }}
      sx={{
        marginBlockEnd: 0.25,
        paddingInlineStart: 2 + props.depth * 2,
        justifyContent: collapsed ? "center" : "flex-start",
        "&.Mui-selected": {
          backgroundColor: "primary.light",
          color: "primary.main",
          "& .MuiListItemIcon-root": { color: "primary.main" },
        },
      }}
    >
      {item.icon !== undefined && (
        <ListItemIcon
          sx={{
            minWidth: collapsed ? 0 : 36,
            justifyContent: "center",
            color: selected ? "primary.main" : "text.secondary",
          }}
        >
          {item.icon}
        </ListItemIcon>
      )}
      {!collapsed && <ListItemText primary={item.label} />}
      {!collapsed && isBranch && (
        <ExpandMoreIcon
          fontSize="small"
          sx={{
            color: "text.secondary",
            transform: expanded ? "rotate(180deg)" : "none",
            transition: "transform 150ms",
          }}
        />
      )}
    </ListItemButton>
  );

  // Icon rail: label moves into a tooltip; branches collapse to their icon.
  // Tooltip's Popper positions with JS, outside the stylis flip — derive the side.
  const entry = collapsed ? (
    <Tooltip title={item.label} placement={direction === "rtl" ? "left" : "right"} arrow>
      <span>{button}</span>
    </Tooltip>
  ) : (
    button
  );

  return (
    <>
      {entry}
      {isBranch && !collapsed && (
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          <List dense disablePadding>
            {(item.children ?? []).map((child) => (
              <NavEntry key={child.id} {...props} item={child} depth={props.depth + 1} />
            ))}
          </List>
        </Collapse>
      )}
    </>
  );
}
