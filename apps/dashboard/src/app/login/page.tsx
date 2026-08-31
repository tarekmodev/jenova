import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Box, Card, CardContent, Stack, Typography } from "@jenova/ui";
import { LocaleSwitcher } from "../../components/LocaleSwitcher";
import { LoginForm } from "./login-form";

export default async function LoginPage(): Promise<ReactNode> {
  const t = await getTranslations("login");
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "background.default",
        padding: 2,
      }}
    >
      <Card sx={{ width: "100%", maxWidth: 420 }}>
        <CardContent>
          <Stack spacing={3}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Box>
                <Typography variant="h4" component="h1">
                  {t("title")}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t("subtitle")}
                </Typography>
              </Box>
              <LocaleSwitcher />
            </Stack>
            <LoginForm />
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
