"use client";

/**
 * TOTP enrollment flow: enroll (api mints + seals a fresh secret) → show
 * QR + manual secret ONCE → activate with a code from the authenticator.
 * The QR is rendered client-side from the otpauth:// URI (the api returns
 * data only — no images cross the wire).
 */

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { Alert, Box, Button, Chip, FormField, Stack, TextField, Typography, useToast } from "@jenova/ui";

interface Enrollment {
  readonly secret: string;
  readonly otpauthUri: string;
  readonly qrDataUrl: string;
}

export function TotpEnrollment(props: { readonly enrolled: boolean }): ReactNode {
  const t = useTranslations("settings.account.totp");
  const router = useRouter();
  const toast = useToast();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (props.enrolled) {
    return <Chip color="success" label={t("enabled")} />;
  }

  const begin = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/proxy/staff/auth/totp/enroll", { method: "POST" });
      if (!response.ok) throw new Error("enroll failed");
      const body = (await response.json()) as { secret: string; otpauthUri: string };
      const qrDataUrl = await QRCode.toDataURL(body.otpauthUri, { margin: 1, width: 220 });
      setEnrollment({ ...body, qrDataUrl });
    } catch {
      setError(t("errors.enrollFailed"));
    } finally {
      setBusy(false);
    }
  };

  const activate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/proxy/staff/auth/totp/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        setError(t("errors.invalidCode"));
        return;
      }
      toast.show({ message: t("activated"), severity: "success" });
      router.refresh();
    } catch {
      setError(t("errors.enrollFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (enrollment === null) {
    return (
      <Stack spacing={2} alignItems="flex-start">
        <Typography variant="body2" color="text.secondary">
          {t("notEnrolled")}
        </Typography>
        <Button variant="contained" onClick={() => void begin()} disabled={busy}>
          {t("enable")}
        </Button>
        {error !== null && <Alert severity="error">{error}</Alert>}
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2">{t("scan")}</Typography>
      <Box
        component="img"
        src={enrollment.qrDataUrl}
        alt={t("qrAlt")}
        sx={{ width: 220, height: 220, alignSelf: "flex-start", borderRadius: 1 }}
      />
      <Typography variant="body2" color="text.secondary">
        {t("manualEntry")}
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontFamily: "monospace", wordBreak: "break-all", userSelect: "all" }}
        data-testid="totp-secret"
      >
        {enrollment.secret}
      </Typography>
      <FormField label={t("codeLabel")} required>
        {(fieldId) => (
          <TextField
            id={fieldId}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            size="small"
            sx={{ maxWidth: 200 }}
          />
        )}
      </FormField>
      {error !== null && <Alert severity="error">{error}</Alert>}
      <Stack direction="row" spacing={1}>
        <Button variant="contained" onClick={() => void activate()} disabled={busy || code === ""}>
          {t("activate")}
        </Button>
        <Button onClick={() => setEnrollment(null)} disabled={busy}>
          {t("cancel")}
        </Button>
      </Stack>
    </Stack>
  );
}
