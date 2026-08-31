import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@jenova/ui";
import { apiJsonOrLogin } from "../../../../lib/api";
import { BrandingScreen, type BrandingDto } from "./branding-screen";

export default async function BrandingSettingsPage(): Promise<ReactNode> {
  const t = await getTranslations("settings.branding");
  const { branding } = await apiJsonOrLogin<{ branding: BrandingDto }>("/staff/branding");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <BrandingScreen initial={branding} />
    </>
  );
}
