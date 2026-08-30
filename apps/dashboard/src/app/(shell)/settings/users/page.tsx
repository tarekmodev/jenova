import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@jenova/ui";
import { apiJsonOrLogin } from "../../../../lib/api";
import { UsersScreen, type PolicyDto, type StaffUserDto } from "./users-screen";

export default async function UsersSettingsPage(): Promise<ReactNode> {
  const t = await getTranslations("settings.users");
  const [users, policy, me] = await Promise.all([
    apiJsonOrLogin<{ users: StaffUserDto[] }>("/staff/users"),
    apiJsonOrLogin<{ policy: PolicyDto }>("/staff/policy"),
    apiJsonOrLogin<{ user: { id: string } }>("/staff/auth/me"),
  ]);
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <UsersScreen
        initialUsers={users.users}
        initialPolicy={policy.policy}
        selfId={me.user.id}
      />
    </>
  );
}
