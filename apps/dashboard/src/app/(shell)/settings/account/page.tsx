import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Alert, Card, CardContent, CardHeader, Chip, Stack, Typography } from "@jenova/ui";
import { apiJsonOrLogin } from "../../../../lib/api";
import { TotpEnrollment } from "./totp-enrollment";

interface MeResponse {
  readonly user: {
    readonly email: string;
    readonly displayName: string;
    readonly role: string;
    readonly totpEnrolled: boolean;
  };
  readonly policy: { readonly enforceTotp: boolean };
  readonly totpEnrollmentRequired: boolean;
}

export default async function AccountSettingsPage(): Promise<ReactNode> {
  const t = await getTranslations("settings.account");
  const tr = await getTranslations("roles");
  const me = await apiJsonOrLogin<MeResponse>("/staff/auth/me");

  return (
    <Stack spacing={3} sx={{ maxWidth: 720 }}>
      <Typography variant="h4" component="h1">
        {t("title")}
      </Typography>

      <Card>
        <CardHeader title={t("profile")} />
        <CardContent>
          <Stack spacing={1}>
            <Typography variant="body1">{me.user.displayName}</Typography>
            <Typography variant="body2" color="text.secondary">
              {me.user.email}
            </Typography>
            <Stack direction="row" spacing={1}>
              <Chip size="small" label={tr(me.user.role)} />
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title={t("totp.title")} subheader={t("totp.subtitle")} />
        <CardContent>
          <Stack spacing={2}>
            {me.totpEnrollmentRequired && (
              <Alert severity="warning">{t("totp.enforced")}</Alert>
            )}
            <TotpEnrollment enrolled={me.user.totpEnrolled} />
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
