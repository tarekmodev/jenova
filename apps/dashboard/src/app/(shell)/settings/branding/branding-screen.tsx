"use client";

/**
 * Branding (issue #91): legal name, brand color, logo. The logo goes to
 * the object store via the api; the preview is served back through the
 * authed proxy (the store is never exposed to the browser directly).
 */

import { useState, type ChangeEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  FormField,
  Stack,
  TextField,
  useToast,
} from "@jenova/ui";

export interface BrandingDto {
  readonly legalName: string;
  readonly brandColor: string | null;
  readonly hasLogo: boolean;
}

const LOGO_MAX_BYTES = 512 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];

/** data: URL detour — constant-memory base64 for files of any size. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function BrandingScreen(props: { readonly initial: BrandingDto }): ReactNode {
  const t = useTranslations("settings.branding");
  const toast = useToast();
  const [legalName, setLegalName] = useState(props.initial.legalName);
  const [brandColor, setBrandColor] = useState(props.initial.brandColor ?? "#1f6feb");
  const [hasLogo, setHasLogo] = useState(props.initial.hasLogo);
  const [logoVersion, setLogoVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/proxy/staff/branding", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ legalName, brandColor }),
      });
      if (!response.ok) throw new Error("save failed");
      toast.show({ message: t("saved"), severity: "success" });
    } catch {
      setError(t("errors.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const uploadLogo = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    if (!LOGO_TYPES.includes(file.type) || file.size > LOGO_MAX_BYTES) {
      setError(t("errors.badLogo"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const dataBase64 = await fileToBase64(file);
      const response = await fetch("/api/proxy/staff/branding/logo", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contentType: file.type, dataBase64 }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: { code: string } }
          | null;
        setError(
          body?.error?.code === "object_store_unconfigured"
            ? t("errors.storeUnconfigured")
            : t("errors.uploadFailed"),
        );
        return;
      }
      setHasLogo(true);
      setLogoVersion((version) => version + 1);
      toast.show({ message: t("logoSaved"), severity: "success" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card sx={{ maxWidth: 640 }}>
      <CardHeader title={t("identity")} />
      <CardContent>
        <Stack spacing={3}>
          {error !== null && <Alert severity="error">{error}</Alert>}

          <FormField label={t("legalName")} hint={t("legalNameHint")} required fullWidth>
            {(fieldId) => (
              <TextField
                id={fieldId}
                value={legalName}
                onChange={(event) => setLegalName(event.target.value)}
                size="small"
                fullWidth
                data-testid="legal-name"
              />
            )}
          </FormField>

          <FormField label={t("brandColor")} fullWidth>
            {(fieldId) => (
              <TextField
                id={fieldId}
                type="color"
                value={brandColor}
                onChange={(event) => setBrandColor(event.target.value)}
                size="small"
                sx={{ maxWidth: 120 }}
                data-testid="brand-color"
              />
            )}
          </FormField>

          <Stack spacing={1}>
            <FormField label={t("logo")} hint={t("logoHint")}>
              {() => (
                <Button component="label" variant="outlined" disabled={busy}>
                  {t("uploadLogo")}
                  <input
                    hidden
                    type="file"
                    accept={LOGO_TYPES.join(",")}
                    onChange={(event) => void uploadLogo(event)}
                  />
                </Button>
              )}
            </FormField>
            {hasLogo && (
              <Box
                component="img"
                src={`/api/proxy/staff/branding/logo?v=${String(logoVersion)}`}
                alt={t("logoAlt")}
                sx={{
                  maxWidth: 220,
                  maxHeight: 96,
                  objectFit: "contain",
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 1,
                  padding: 1,
                }}
              />
            )}
          </Stack>

          <Button
            variant="contained"
            onClick={() => void save()}
            disabled={busy || legalName === ""}
            sx={{ alignSelf: "flex-start" }}
            data-testid="save-branding"
          >
            {t("save")}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
