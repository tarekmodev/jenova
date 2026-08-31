"use client";

/**
 * Booking detail + cancellation (issue #98).
 *
 * Cancellation is two honest steps: the api's fee preview (computed from the
 * STORED normalized policy — no supplier call) is shown BEFORE anything is
 * asked of the supplier; only explicit confirmation calls cancel. Async
 * supplier cancels (status cancellation_pending) render as "cancellation in
 * progress" — never prematurely as cancelled.
 */

import {
  Alert,
  AlertTitle,
  Box,
  BookingStateChip,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  ConfirmDialog,
  DateText,
  Divider,
  ErrorState,
  Grid,
  LoadingState,
  MoneyText,
  PageHeader,
  PolicyTimeline,
  Stack,
  Typography,
  useToast,
} from "@jenova/ui";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAppLocale, useMessages } from "../../i18n/I18nProvider";
import { PortalApiError, portalGet, portalPost } from "../../lib/client-api";
import type { BookingDetail, CancelResponse, CancellationPreviewPayload } from "../../lib/types";
import { cancellationInProgress, stateLabel } from "./stateLabels";

export function BookingDetailScreen(props: { bookingId: string }): ReactNode {
  const messages = useMessages();
  const locale = useAppLocale();
  const toast = useToast();

  const [detail, setDetail] = useState<BookingDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<CancellationPreviewPayload | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelResult, setCancelResult] = useState<CancelResponse | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setDetail(await portalGet<BookingDetail>(`bookings/${props.bookingId}`));
    } catch {
      setFailed(true);
    }
  }, [props.bookingId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (failed) {
    return <ErrorState title={messages.bookings.loadFailed} />;
  }
  if (detail === null) {
    return <LoadingState label={messages.common.loading} />;
  }

  const { item } = detail;
  const cancellable =
    (item.state === "confirmed" || item.state === "pending_confirmation") &&
    !cancellationInProgress(item.state, item.cancellationRequestedAt);

  const openPreview = async (): Promise<void> => {
    setPreviewLoading(true);
    try {
      const loaded = await portalGet<CancellationPreviewPayload>(
        `bookings/${props.bookingId}/cancellation-preview`,
      );
      setPreview(loaded);
      setPreviewOpen(true);
    } catch (error) {
      if (error instanceof PortalApiError && error.code === "booking_not_cancellable") {
        toast.show({ message: messages.bookings.cancelNotAllowed, severity: "warning" });
      } else {
        toast.show({ message: messages.bookings.cancelFailed, severity: "error" });
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  const confirmCancel = async (): Promise<void> => {
    setCancelling(true);
    try {
      const result = await portalPost<CancelResponse>(`bookings/${props.bookingId}/cancel`, {});
      setCancelResult(result);
      setPreviewOpen(false);
      toast.show({
        message:
          result.status === "cancelled"
            ? messages.bookings.cancelled
            : messages.bookings.cancellationPending,
        severity: result.status === "cancelled" ? "success" : "info",
      });
      await reload();
    } catch (error) {
      setPreviewOpen(false);
      if (error instanceof PortalApiError && error.code === "booking_not_cancellable") {
        toast.show({ message: messages.bookings.cancelNotAllowed, severity: "warning" });
      } else {
        toast.show({ message: messages.bookings.cancelFailed, severity: "error" });
      }
    } finally {
      setCancelling(false);
    }
  };

  const inProgress = cancellationInProgress(item.state, item.cancellationRequestedAt);

  return (
    <Box data-testid="booking-detail">
      <PageHeader
        title={messages.bookings.detailTitle}
        subtitle={detail.clientReference}
        actions={
          cancellable ? (
            <Button
              color="error"
              variant="outlined"
              disabled={previewLoading}
              onClick={() => void openPreview()}
              data-testid="cancel-booking"
            >
              {messages.bookings.cancelButton}
            </Button>
          ) : undefined
        }
      />

      {cancelResult?.status === "cancellation_pending" || inProgress ? (
        <Alert severity="warning" sx={{ marginBlockEnd: 3 }} data-testid="cancellation-pending">
          <AlertTitle>{messages.bookings.cancellationPending}</AlertTitle>
          {messages.bookings.cancellationPendingExplainer}
        </Alert>
      ) : null}

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card>
            <CardHeader title={messages.bookings.item} />
            <CardContent>
              <Stack spacing={1.25}>
                <Row label={messages.bookings.colReference}>
                  <Typography variant="body2" sx={{ fontWeight: 600, unicodeBidi: "isolate" }}>
                    {detail.clientReference}
                  </Typography>
                </Row>
                <Row label={messages.bookings.supplier}>
                  <Typography variant="body2">{item.supplierCode.toUpperCase()}</Typography>
                </Row>
                <Row label={messages.bookings.colSupplierRef}>
                  <Typography variant="body2" data-testid="detail-supplier-ref">
                    {item.supplierReference ?? "—"}
                  </Typography>
                </Row>
                <Row label={messages.bookings.colState}>
                  <Stack direction="row" spacing={1}>
                    <BookingStateChip
                      state={item.state}
                      label={stateLabel(messages, item.state)}
                      escalated={item.escalated}
                    />
                    {item.escalated && (
                      <Chip size="small" color="warning" variant="outlined" label={messages.states.escalated} />
                    )}
                  </Stack>
                </Row>
                <Row label={messages.bookings.paymentState}>
                  <Typography variant="body2">{messages.payment[detail.paymentState]}</Typography>
                </Row>
                {detail.createdAt !== null && (
                  <Row label={messages.bookings.colCreated}>
                    <DateText utc={detail.createdAt} dateStyle="medium" timeStyle="short" />
                  </Row>
                )}
                <Divider />
                <Row label={messages.bookings.colAmount}>
                  <MoneyText money={item.sell} variant="subtitle1" fontWeight={700} />
                </Row>
                <Typography variant="caption" color="text.secondary">
                  {messages.bookings.sellOnlyNote}
                </Typography>
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ marginBlockStart: 3 }}>
            <CardHeader title={messages.bookings.history} />
            <CardContent>
              {detail.history.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {messages.bookings.historyEmpty}
                </Typography>
              ) : (
                <Stack spacing={1} data-testid="state-history">
                  {detail.history.map((entry, index) => (
                    <Stack
                      key={index}
                      direction="row"
                      spacing={2}
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <Stack direction="row" spacing={1} alignItems="center">
                        {entry.toState !== null ? (
                          <>
                            <Chip size="small" variant="outlined" label={labelFor(messages, entry.toState)} />
                            {entry.fromState !== null && (
                              <Typography variant="caption" color="text.secondary">
                                ({labelFor(messages, entry.fromState)})
                              </Typography>
                            )}
                          </>
                        ) : (
                          <Typography variant="body2">{entry.action}</Typography>
                        )}
                      </Stack>
                      <DateText utc={entry.occurredAt} dateStyle="medium" timeStyle="short" />
                    </Stack>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Card>
            <CardHeader title={messages.bookings.policy} />
            <CardContent>
              {item.policy === null ? (
                <Typography variant="body2" color="text.secondary">
                  —
                </Typography>
              ) : (
                <PolicyTimeline
                  policy={item.policy}
                  labels={messages.policy}
                  now={new Date()}
                  hijri={locale === "ar"}
                />
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <ConfirmDialog
        open={previewOpen}
        title={messages.bookings.feePreviewTitle}
        description={
          preview === null ? undefined : (
            <Stack spacing={1.5} sx={{ marginBlockStart: 1 }} data-testid="fee-preview">
              <Typography variant="body2">{messages.bookings.feePreviewExplainer}</Typography>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="body2" color="text.secondary">
                  {messages.bookings.penaltyNow}
                </Typography>
                <MoneyText
                  money={preview.penalty}
                  variant="subtitle1"
                  fontWeight={700}
                  color={preview.penalty.amount > 0 ? "error.main" : "success.main"}
                />
              </Stack>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="body2" color="text.secondary">
                  {messages.bookings.refundNow}
                </Typography>
                {preview.refund === null ? (
                  <Typography variant="body2">{messages.bookings.refundUnknown}</Typography>
                ) : (
                  <MoneyText money={preview.refund} variant="subtitle1" fontWeight={700} />
                )}
              </Stack>
              {/* The policy line that fired, highlighted at the preview instant. */}
              {item.policy !== null && (
                <Box>
                  <PolicyTimeline
                    policy={item.policy}
                    labels={messages.policy}
                    now={new Date(preview.asOf)}
                    hijri={locale === "ar"}
                  />
                </Box>
              )}
              <Typography variant="caption" color="text.secondary">
                {messages.bookings.asOf} <DateText utc={preview.asOf} dateStyle="medium" timeStyle="short" />
              </Typography>
            </Stack>
          )
        }
        confirmLabel={cancelling ? messages.bookings.cancelling : messages.bookings.confirmCancel}
        cancelLabel={messages.bookings.keepBooking}
        destructive
        busy={cancelling}
        onConfirm={() => void confirmCancel()}
        onCancel={() => setPreviewOpen(false)}
      />
    </Box>
  );
}

function labelFor(messages: ReturnType<typeof useMessages>, state: string): string {
  const states = messages.states as Record<string, string | undefined>;
  return states[state] ?? state;
}

function Row(props: { label: string; children: ReactNode }): ReactNode {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2} alignItems="center">
      <Typography variant="body2" color="text.secondary">
        {props.label}
      </Typography>
      {props.children}
    </Stack>
  );
}
