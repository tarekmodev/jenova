import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@jenova/ui";
import { apiJsonOrLogin } from "../../../../lib/api";
import { QueueScreen, type EscalationDto } from "./queue-screen";

export default async function QueuePage(): Promise<ReactNode> {
  const t = await getTranslations("workspace.queue");
  const { escalations } = await apiJsonOrLogin<{ escalations: EscalationDto[] }>(
    "/staff/escalations",
  );
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <QueueScreen initial={escalations} />
    </>
  );
}
