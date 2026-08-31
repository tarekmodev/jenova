"use client";

/**
 * Supplier accounts (issue #91): the tenant's OWN credentials per supplier
 * and environment. WRITE-ONLY by design — saved credentials are never
 * displayed again (the api never returns them); the fields always start
 * empty and saving rotates the sealed blob. Test-connection runs the
 * supplier's cheapest authenticated call server-side and reports ok or the
 * unified taxonomy kind.
 */

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  DateText,
  EmptyState,
  FormControlLabel,
  FormField,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
  useToast,
} from "@jenova/ui";

type Environment = "sandbox" | "production";

interface EnvironmentState {
  readonly configured: boolean;
  readonly enabled?: boolean;
  readonly updatedAt?: string;
}

export interface SupplierDto {
  readonly supplierCode: string;
  readonly name: string;
  readonly vertical: string;
  readonly testable: boolean;
  readonly certification: { readonly sandbox: string; readonly production: string };
  readonly environments: Readonly<Record<Environment, EnvironmentState>>;
}

/**
 * Credential field names per supplier. TBO is the M2 supplier; new
 * suppliers add their key set when their adapter lands.
 */
const SECRET_FIELDS: Readonly<Record<string, readonly string[]>> = {
  tbo: ["apiUrl", "username", "password"],
};
const DEFAULT_FIELDS = ["apiUrl", "username", "password"] as const;

export function SuppliersScreen(props: {
  readonly initialSuppliers: readonly SupplierDto[];
}): ReactNode {
  const t = useTranslations("settings.suppliers");
  const [suppliers, setSuppliers] = useState(props.initialSuppliers);

  const refresh = async (): Promise<void> => {
    const response = await fetch("/api/proxy/staff/supplier-accounts");
    if (response.ok) {
      const body = (await response.json()) as { suppliers: SupplierDto[] };
      setSuppliers(body.suppliers);
    }
  };

  if (suppliers.length === 0) {
    return <EmptyState title={t("empty")} />;
  }
  return (
    <Stack spacing={3}>
      {suppliers.map((supplier) => (
        <SupplierCard key={supplier.supplierCode} supplier={supplier} onChanged={refresh} />
      ))}
    </Stack>
  );
}

function SupplierCard(props: {
  readonly supplier: SupplierDto;
  readonly onChanged: () => Promise<void>;
}): ReactNode {
  const t = useTranslations("settings.suppliers");
  const [environment, setEnvironment] = useState<Environment>("sandbox");
  const { supplier } = props;
  return (
    <Card data-testid={`supplier-${supplier.supplierCode}`}>
      <CardHeader
        title={supplier.name}
        subheader={`${supplier.supplierCode} · ${t(`vertical.${supplier.vertical}`)}`}
      />
      <CardContent>
        <Stack spacing={2}>
          <Tabs
            value={environment}
            onChange={(_event, next: Environment) => setEnvironment(next)}
            aria-label={t("environmentTabs")}
          >
            <Tab value="sandbox" label={t("sandbox")} />
            <Tab value="production" label={t("production")} />
          </Tabs>
          <EnvironmentPanel
            key={environment}
            supplier={supplier}
            environment={environment}
            onChanged={props.onChanged}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}

function EnvironmentPanel(props: {
  readonly supplier: SupplierDto;
  readonly environment: Environment;
  readonly onChanged: () => Promise<void>;
}): ReactNode {
  const t = useTranslations("settings.suppliers");
  const toast = useToast();
  const { supplier, environment } = props;
  const state = supplier.environments[environment];
  const fields = SECRET_FIELDS[supplier.supplierCode] ?? DEFAULT_FIELDS;
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; kind?: string } | null>(null);

  const filled = fields.every((field) => (values[field] ?? "") !== "");

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const response = await fetch(
        `/api/proxy/staff/supplier-accounts/${supplier.supplierCode}/${environment}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ secrets: values, enabled: state.enabled ?? true }),
        },
      );
      if (!response.ok) throw new Error("save failed");
      setValues({});
      toast.show({ message: t("saved"), severity: "success" });
      await props.onChanged();
    } catch {
      toast.show({ message: t("errors.saveFailed"), severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (enabled: boolean): Promise<void> => {
    try {
      const response = await fetch(
        `/api/proxy/staff/supplier-accounts/${supplier.supplierCode}/${environment}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled }),
        },
      );
      if (!response.ok) throw new Error("save failed");
      await props.onChanged();
    } catch {
      toast.show({ message: t("errors.saveFailed"), severity: "error" });
    }
  };

  const testConnection = async (): Promise<void> => {
    setBusy(true);
    setTestResult(null);
    try {
      const response = await fetch(
        `/api/proxy/staff/supplier-accounts/${supplier.supplierCode}/${environment}/test-connection`,
        { method: "POST" },
      );
      const body = (await response.json()) as { ok?: boolean; kind?: string; error?: { code: string } };
      if (!response.ok) {
        setTestResult({ ok: false, kind: body.error?.code ?? "internal_error" });
      } else {
        setTestResult(body.ok === true ? { ok: true } : { ok: false, ...(body.kind !== undefined ? { kind: body.kind } : {}) });
      }
    } catch {
      setTestResult({ ok: false, kind: "internal_error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
        {state.configured ? (
          <>
            <Chip size="small" color="success" variant="outlined" label={t("configured")} />
            {state.updatedAt !== undefined && (
              <Typography variant="caption" color="text.secondary">
                {t("updatedAt")} <DateText utc={state.updatedAt} dateStyle="medium" timeStyle="short" variant="caption" />
              </Typography>
            )}
            <FormControlLabel
              control={
                <Switch
                  checked={state.enabled === true}
                  onChange={(event) => void toggleEnabled(event.target.checked)}
                  slotProps={{ input: { "aria-label": t("enabled") } }}
                />
              }
              label={t("enabled")}
            />
          </>
        ) : (
          <Chip size="small" variant="outlined" label={t("notConfigured")} />
        )}
      </Stack>

      <Alert severity="info">{t("writeOnlyNote")}</Alert>

      <Stack spacing={2} sx={{ maxWidth: 480 }}>
        {fields.map((field) => (
          <FormField key={field} label={t(`fields.${field}`)} fullWidth>
            {(fieldId) => (
              <TextField
                id={fieldId}
                type={field === "password" ? "password" : "text"}
                autoComplete="off"
                value={values[field] ?? ""}
                onChange={(event) =>
                  setValues((previous) => ({ ...previous, [field]: event.target.value }))
                }
                size="small"
                fullWidth
                data-testid={`secret-${supplier.supplierCode}-${field}`}
              />
            )}
          </FormField>
        ))}
      </Stack>

      {testResult !== null &&
        (testResult.ok ? (
          <Alert severity="success" data-testid="test-ok">
            {t("testOk")}
          </Alert>
        ) : (
          <Alert severity="error" data-testid="test-failed">
            {t("testFailed", { kind: testResult.kind ?? "unknown" })}
          </Alert>
        ))}

      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={busy || !filled}
          data-testid={`save-${supplier.supplierCode}-${environment}`}
        >
          {t("save")}
        </Button>
        {supplier.testable && (
          <Button
            onClick={() => void testConnection()}
            disabled={busy || !state.configured}
            data-testid={`test-${supplier.supplierCode}-${environment}`}
          >
            {t("testConnection")}
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
