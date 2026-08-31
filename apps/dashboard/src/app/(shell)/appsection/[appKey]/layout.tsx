/**
 * Route guard for installable-app sections (issue #90): an uninstalled —
 * or unknown — app's routes render the ui kit's ForbiddenState instead of
 * their content. Guarding at the layout covers every nested route of the
 * section. Hiding is UX; the gateway's @RequiresApp refusal on the api is
 * the enforcement (CLAUDE.md rule 3).
 */

import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import type { AppKey } from "@jenova/domain";
import { ForbiddenState } from "@jenova/ui";
import { apiJsonOrLogin } from "../../../../lib/api";
import { pathAllowed } from "../../../../lib/manifest";

export default async function AppSectionLayout(props: {
  readonly children: ReactNode;
  readonly params: Promise<{ appKey: string }>;
}): Promise<ReactNode> {
  const { appKey } = await props.params;
  const { installed } = await apiJsonOrLogin<{ installed: readonly AppKey[] }>(
    "/me/entitlements",
  );

  if (!pathAllowed(`/apps/${appKey}`, installed)) {
    const t = await getTranslations("forbidden");
    return <ForbiddenState title={t("title")} description={t("description")} />;
  }
  return props.children;
}
