"use client";

/**
 * Login form: email + password, with the TOTP field appearing only once
 * the api answers `totp_required` (i.e. after the password verified).
 * Prices/policies/credentials logic all live server-side — this form only
 * relays and localizes error CODES.
 */

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Alert, Button, FormField, Stack, TextField } from "@jenova/ui";

type LoginErrorCode = "unauthorized" | "totp_required" | "totp_invalid" | "internal_error";

interface LoginResponse {
  readonly totpEnrollmentRequired?: boolean;
  readonly error?: { readonly code: string };
}

export function LoginForm(): ReactNode {
  const t = useTranslations("login");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpStep, setTotpStep] = useState(false);
  const [error, setError] = useState<LoginErrorCode | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          ...(totpStep && totpCode !== "" ? { totpCode } : {}),
        }),
      });
      const body = (await response.json()) as LoginResponse;
      if (response.ok) {
        router.replace(body.totpEnrollmentRequired === true ? "/settings/account" : "/");
        router.refresh();
        return;
      }
      const code = body.error?.code;
      if (code === "totp_required") {
        setTotpStep(true);
        setError(totpStep ? "totp_required" : null);
      } else if (code === "totp_invalid") {
        setTotpStep(true);
        setError("totp_invalid");
      } else {
        setError("unauthorized");
      }
    } catch {
      setError("internal_error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <Stack spacing={2}>
        {error !== null && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
        <FormField label={t("email")} required fullWidth>
          {(fieldId) => (
            <TextField
              id={fieldId}
              type="email"
              autoComplete="email"
              data-testid="login-email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              fullWidth
              size="small"
            />
          )}
        </FormField>
        <FormField label={t("password")} required fullWidth>
          {(fieldId) => (
            <TextField
              id={fieldId}
              type="password"
              autoComplete="current-password"
              data-testid="login-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              fullWidth
              size="small"
            />
          )}
        </FormField>
        {totpStep && (
          <FormField label={t("totpCode")} hint={t("totpHint")} required fullWidth>
            {(fieldId) => (
              <TextField
                id={fieldId}
                inputMode="numeric"
                autoComplete="one-time-code"
                data-testid="login-totp"
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value)}
                fullWidth
                size="small"
              />
            )}
          </FormField>
        )}
        <Button type="submit" variant="contained" disabled={busy} fullWidth data-testid="login-submit">
          {totpStep ? t("verify") : t("signIn")}
        </Button>
      </Stack>
    </form>
  );
}
