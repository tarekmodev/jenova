import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@jenova/ui";
import { apiJsonOrLogin } from "../../../../lib/api";
import { SuppliersScreen, type SupplierDto } from "./suppliers-screen";

export default async function SuppliersSettingsPage(): Promise<ReactNode> {
  const t = await getTranslations("settings.suppliers");
  const { suppliers } = await apiJsonOrLogin<{ suppliers: SupplierDto[] }>(
    "/staff/supplier-accounts",
  );
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <SuppliersScreen initialSuppliers={suppliers} />
    </>
  );
}
