"use client";

/**
 * Agency bookings list (issue #98): DataTable over the api's agency-scoped
 * list — persisted states and sell amounts only, rendered through
 * BookingStateChip / MoneyText / DateText.
 */

import {
  Box,
  BookingStateChip,
  Chip,
  DataTable,
  DateText,
  EmptyState,
  ErrorState,
  MoneyText,
  PageHeader,
  Stack,
  Typography,
} from "@jenova/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useMessages } from "../../i18n/I18nProvider";
import { portalGet } from "../../lib/client-api";
import type { BookingListRow } from "../../lib/types";
import { cancellationInProgress, stateLabel } from "./stateLabels";

export function BookingsScreen(): ReactNode {
  const messages = useMessages();
  const router = useRouter();
  const [rows, setRows] = useState<readonly BookingListRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    portalGet<{ bookings: readonly BookingListRow[] }>("bookings")
      .then(({ bookings }) => {
        if (!cancelled) setRows(bookings);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Box data-testid="bookings-list">
      <PageHeader title={messages.bookings.title} subtitle={messages.bookings.subtitle} />
      <DataTable<BookingListRow>
        label={messages.bookings.title}
        columns={[
          {
            id: "reference",
            header: messages.bookings.colReference,
            cell: (row) => (
              <Typography variant="body2" sx={{ fontWeight: 600, unicodeBidi: "isolate" }}>
                {row.clientReference}
              </Typography>
            ),
          },
          {
            id: "supplierRef",
            header: messages.bookings.colSupplierRef,
            cell: (row) => row.supplierReference ?? "—",
          },
          {
            id: "state",
            header: messages.bookings.colState,
            cell: (row) => (
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <BookingStateChip
                  state={row.state}
                  label={stateLabel(messages, row.state)}
                  escalated={row.escalated}
                />
                {row.escalated && (
                  <Chip size="small" color="warning" variant="outlined" label={messages.states.escalated} />
                )}
                {cancellationInProgress(row.state, row.cancellationRequestedAt) && (
                  <Chip
                    size="small"
                    color="warning"
                    variant="outlined"
                    label={messages.states.cancellation_in_progress}
                  />
                )}
              </Stack>
            ),
          },
          {
            id: "amount",
            header: messages.bookings.colAmount,
            money: true,
            cell: (row) => <MoneyText money={row.sell} />,
            sortable: true,
            sortValue: (row) => row.sell.amount,
          },
          {
            id: "created",
            header: messages.bookings.colCreated,
            cell: (row) => <DateText utc={row.createdAt} dateStyle="medium" timeStyle="short" />,
            sortable: true,
            sortValue: (row) => row.createdAt,
          },
        ]}
        rows={rows ?? []}
        getRowId={(row) => row.bookingId}
        loading={rows === null && !failed}
        error={failed}
        emptyState={<EmptyState title={messages.bookings.empty} dense />}
        errorState={<ErrorState title={messages.bookings.loadFailed} dense />}
        onRowClick={(row) => router.push(`/bookings/${row.bookingId}`)}
        defaultSort={{ columnId: "created", direction: "desc" }}
      />
    </Box>
  );
}
