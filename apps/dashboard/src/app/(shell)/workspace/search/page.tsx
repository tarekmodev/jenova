import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@jenova/ui";
import { SearchConsole } from "./search-console";

export default async function SearchConsolePage(): Promise<ReactNode> {
  const t = await getTranslations("workspace.search");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <SearchConsole />
    </>
  );
}
