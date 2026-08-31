"use client";

/**
 * Manual-intervention queue (issue #92): escalated items with the exact
 * reason automation gave up, their age, and ONLY the actions the state
 * machine allows (the api computes allowedActions — the UI never invents
 * one; docs/apps/core-workspace.md acceptance heuristic).
 */

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Alert,
  BookingStateChip,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  EmptyState,
  FormField,
  MoneyText,
  Stack,
  TextField,
  Typography,
  useToast,
  type BookingStateChipProps,
} from "@jenova/ui";

export interface EscalationDto {
  readonly bookingId: string;
  readonly bookingItemId: string;
  readonly clientReference: string;
  readonly state: BookingStateChipProps["state"];
  readonly supplierCode: string;
  readonly supplierReference: string | null;
  readonly sell: { readonly amount: number; readonly currency: string };
  readonly reason: string | null;
  readonly escalatedAt: string | null;
  readonly allowedActions: readonly ("retry_poll" | "resolve")[];
}

function ageLabel(escalatedAt: string | null, locale: string): string {
  if (escalatedAt === null) return "—";
  const ms = Date.now() - Date.parse(escalatedAt);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return formatter.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 48) return formatter.format(-hours, "hour");
  return formatter.format(-Math.round(hours / 24), "day");
}

export function QueueScreen(props: { readonly initial: readonly EscalationDto[] }): ReactNode {
  const t = useTranslations("workspace.queue");
  const tStates = useTranslations("bookingStates");
  const locale = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [items, setItems] = useState(props.initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resolveTarget, setResolveTarget] = useState<EscalationDto | null>(null);
  const [note, setNote] = useState("");
  const [lastOutcome, setLastOutcome] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    const response = await fetch("/api/proxy/staff/escalations");
    if (response.ok) {
      const body = (await response.json()) as { escalations: EscalationDto[] };
      setItems(body.escalations);
    }
  };

  const retry = async (item: EscalationDto): Promise<void> => {
    setBusyId(item.bookingItemId);
    setLastOutcome(null);
    try {
      const response = await fetch(
        `/api/proxy/staff/escalations/${item.bookingItemId}/retry-poll`,
        { method: "POST" },
      );
      const body = (await response.json()) as { outcome?: string; error?: { code: string } };
      if (!response.ok) throw new Error(body.error?.code ?? "internal_error");
      setLastOutcome(t(`outcomes.${body.outcome ?? "error"}`));
      await refresh();
    } catch {
      toast.show({ message: t("errors.actionFailed"), severity: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const resolve = async (): Promise<void> => {
    if (resolveTarget === null) return;
    setBusyId(resolveTarget.bookingItemId);
    try {
      const response = await fetch(
        `/api/proxy/staff/escalations/${resolveTarget.bookingItemId}/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ note }),
        },
      );
      if (!response.ok) throw new Error("resolve failed");
      toast.show({ message: t("resolved"), severity: "success" });
      setResolveTarget(null);
      setNote("");
      await refresh();
    } catch {
      toast.show({ message: t("errors.actionFailed"), severity: "error" });
    } finally {
      setBusyId(null);
    }
  };

  if (items.length === 0) {
    return (
      <>
        {lastOutcome !== null && <Alert severity="info">{lastOutcome}</Alert>}
        <EmptyState title={t("empty.title")} description={t("empty.description")} />
      </>
    );
  }

  return (
    <Stack spacing={2}>
      {lastOutcome !== null && <Alert severity="info">{lastOutcome}</Alert>}
      {items.map((item) => (
        <Card key={item.bookingItemId} data-testid="escalation-item">
          <CardContent>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={2} alignItems="center" useFlexGap flexWrap="wrap">
                <Typography variant="subtitle1">{item.clientReference}</Typography>
                <BookingStateChip state={item.state} label={tStates(item.state)} escalated />
                <Chip size="small" variant="outlined" label={item.supplierCode} />
                <MoneyText money={item.sell} variant="body2" />
                <Typography variant="caption" color="text.secondary">
                  {t("age")}: {ageLabel(item.escalatedAt, locale)}
                </Typography>
              </Stack>
              <Typography variant="body2" color="warning.main">
                {item.reason ?? "—"}
              </Typography>
              <Stack direction="row" spacing={1}>
                {item.allowedActions.includes("retry_poll") && (
                  <Button
                    size="small"
                    variant="contained"
                    disabled={busyId !== null}
                    onClick={() => void retry(item)}
                    data-testid="retry-poll"
                  >
                    {t("retryPoll")}
                  </Button>
                )}
                <Button
                  size="small"
                  disabled={busyId !== null}
                  onClick={() => setResolveTarget(item)}
                  data-testid="mark-resolved"
                >
                  {t("markResolved")}
                </Button>
                <Button size="small" onClick={() => router.push(`/workspace/bookings/${item.bookingId}`)}>
                  {t("openBooking")}
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      ))}

      <Dialog open={resolveTarget !== null} onClose={() => setResolveTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>{t("resolveTitle")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ paddingBlockStart: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {resolveTarget?.clientReference}
            </Typography>
            <FormField label={t("resolveNote")} required fullWidth>
              {(fieldId) => (
                <TextField
                  id={fieldId}
                  multiline
                  minRows={2}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  fullWidth
                  size="small"
                />
              )}
            </FormField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResolveTarget(null)}>{t("cancel")}</Button>
          <Button
            variant="contained"
            disabled={note === "" || busyId !== null}
            onClick={() => void resolve()}
            data-testid="confirm-resolve"
          >
            {t("markResolved")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
