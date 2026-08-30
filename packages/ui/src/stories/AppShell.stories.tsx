/**
 * AppShell + NavSection: the dashboard chrome, entitlement-filtered
 * navigation, collapse behavior. Structural synthetic nav only.
 */

import ConfirmationNumberOutlinedIcon from "@mui/icons-material/ConfirmationNumberOutlined";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import PaymentsOutlinedIcon from "@mui/icons-material/PaymentsOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import Avatar from "@mui/material/Avatar";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactElement } from "react";
import { AppShell } from "../shell/AppShell";
import { NavSection } from "../shell/NavSection";
import { PageHeader } from "../shell/PageHeader";
import type { NavItem } from "../shell/navigation";
import { pickCopy } from "./support";

const meta: Meta<typeof AppShell> = {
  title: "Shell/AppShell",
  component: AppShell,
  parameters: { layout: "fullscreen" },
};
export default meta;

function navItems(globals: Record<string, unknown>): readonly NavItem[] {
  const copy = pickCopy(globals, {
    ar: {
      home: "الرئيسية",
      search: "البحث",
      bookings: "الحجوزات",
      finance: "المالية",
      settings: "الإعدادات",
    },
    en: {
      home: "Home",
      search: "Search",
      bookings: "Bookings",
      finance: "Finance",
      settings: "Settings",
    },
  });
  return [
    { id: "home", label: copy.home, icon: <HomeOutlinedIcon /> },
    { id: "search", label: copy.search, icon: <SearchOutlinedIcon /> },
    {
      id: "bookings",
      label: copy.bookings,
      icon: <ConfirmationNumberOutlinedIcon />,
      entitlement: "b2b",
    },
    { id: "finance", label: copy.finance, icon: <PaymentsOutlinedIcon />, entitlement: "finance" },
    { id: "settings", label: copy.settings, icon: <SettingsOutlinedIcon /> },
  ];
}

function renderShell(globals: Record<string, unknown>, defaultCollapsed: boolean): ReactElement {
  const copy = pickCopy(globals, {
    ar: {
      toggle: "طي القائمة الجانبية",
      open: "فتح قائمة التنقل",
      section: "التطبيقات",
      title: "مساحة العمل",
      subtitle: "كل شيء يبدأ من هنا",
      body: "منطقة المحتوى",
    },
    en: {
      toggle: "Collapse sidebar",
      open: "Open navigation",
      section: "Apps",
      title: "Workspace",
      subtitle: "Everything starts here",
      body: "Content area",
    },
  });
  return (
    <AppShell
      logo={<Typography variant="h5">Jenova</Typography>}
      collapseToggleLabel={copy.toggle}
      openNavigationLabel={copy.open}
      defaultCollapsed={defaultCollapsed}
      sidebar={
        <NavSection
          title={copy.section}
          items={navItems(globals)}
          entitlements={["b2b"]}
          selectedId="search"
        />
      }
      topbar={<Avatar sx={{ width: 36, height: 36 }}>ج</Avatar>}
    >
      <PageHeader title={copy.title} subtitle={copy.subtitle} />
      <Card>
        <CardContent>
          <Typography>{copy.body}</Typography>
        </CardContent>
      </Card>
    </AppShell>
  );
}

export const Default: StoryObj = {
  render: (_args, context) => renderShell(context.globals, false),
};

export const Collapsed: StoryObj = {
  render: (_args, context) => renderShell(context.globals, true),
};
