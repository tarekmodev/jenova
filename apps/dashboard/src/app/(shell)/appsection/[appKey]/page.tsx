import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { isAppKey } from "@jenova/domain";
import { Alert, PageHeader } from "@jenova/ui";

/**
 * Installed-app landing page. M2 ships the app FRAMEWORK — each app's real
 * dashboard section arrives with its own milestone (B2B staff side is a
 * separate M2 workstream; finance M3; storefront M4; …). The layout above
 * already guarded entitlement.
 */
export default async function AppSectionPage(props: {
  readonly params: Promise<{ appKey: string }>;
}): Promise<ReactNode> {
  const { appKey } = await props.params;
  const t = await getTranslations();
  const title = isAppKey(appKey) ? t(`nav.app.${appKey}`) : appKey;
  return (
    <>
      <PageHeader title={title} />
      <Alert severity="info">{t("appSection.placeholder")}</Alert>
    </>
  );
}
