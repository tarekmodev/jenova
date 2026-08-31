"use client";

/**
 * Bookings queue (issue #92): DataTable over the staff list endpoint,
 * filtered by state / supplier / created date range. Filters live in the
 * URL (server component re-fetches) so views are shareable and the data
 * path stays server-side.
 */

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { BOOKING_ITEM_STATES } from "@jenova/domain";
import {
  BookingStateChip,
  Button,
  DataTable,
  DateText,
  EmptyState,
  FormField,
  MenuItem,
  MoneyText,
  Select,
  Stack,
  TextField,
  Typography,
  type BookingStateChipProps,
  type DataTableColumn,
} from "@jenova/ui";

export interface BookingRowDto {
  readonly bookingId: string;
  readonly bookingItemId: string;
  readonly clientReference: string;
  readonly channel: string;
  readonly state: BookingStateChipProps["state"];
  readonly supplierCode: string;
  readonly supplierReference: string | null;
  readonly sell: { readonly amount: number; readonly currency: string };
  readonly escalated: boolean;
  readonly createdAt: string;
}

export interface BookingFilters {
  readonly state: string;
  readonly supplier: string;
  readonly from: string;
  readonly to: string;
}

export function BookingsScreen(props: {
  readonly rows: readonly BookingRowDto[];
  readonly filters: BookingFilters;
}): ReactNode {
  const t = useTranslations("workspace.bookings");
  const tStates = useTranslations("bookingStates");
  const router = useRouter();
  const [filters, setFilters] = useState(props.filters);

  const apply = (): void => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== "") query.set(key, value);
    }
    router.push(query.size > 0 ? `/workspace/bookings?${query.toString()}` : "/workspace/bookings");
  };

  const columns: readonly DataTableColumn<BookingRowDto>[] = [
    {
      id: "reference",
      header: t("columns.reference"),
      cell: (row) => (
        <Stack>
          <Typography variant="body2">{row.clientReference}</Typography>
          <Typography variant="caption" color="text.secondary">
            {row.supplierReference ?? "—"}
          </Typography>
        </Stack>
      ),
    },
    {
      id: "state",
      header: t("columns.state"),
      cell: (row) => (
        <BookingStateChip state={row.state} label={tStates(row.state)} escalated={row.escalated} />
      ),
    },
    { id: "channel", header: t("columns.channel"), cell: (row) => row.channel },
    { id: "supplier", header: t("columns.supplier"), cell: (row) => row.supplierCode },
    {
      id: "sell",
      header: t("columns.sell"),
      money: true,
      cell: (row) => <MoneyText money={row.sell} variant="body2" />,
    },
    {
      id: "created",
      header: t("columns.created"),
      cell: (row) => <DateText utc={row.createdAt} dateStyle="medium" timeStyle="short" variant="body2" />,
      sortable: true,
      sortValue: (row) => row.createdAt,
    },
  ];

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" alignItems="flex-end">
        <FormField label={t("filters.state")}>
          {(fieldId) => (
            <Select
              id={fieldId}
              size="small"
              displayEmpty
              value={filters.state}
              onChange={(event) => setFilters({ ...filters, state: event.target.value })}
              sx={{ minWidth: 180 }}
              data-testid="filter-state"
            >
              <MenuItem value="">{t("filters.any")}</MenuItem>
              {BOOKING_ITEM_STATES.map((state) => (
                <MenuItem key={state} value={state}>
                  {tStates(state)}
                </MenuItem>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label={t("filters.supplier")}>
          {(fieldId) => (
            <TextField
              id={fieldId}
              size="small"
              value={filters.supplier}
              onChange={(event) => setFilters({ ...filters, supplier: event.target.value })}
              sx={{ minWidth: 140 }}
            />
          )}
        </FormField>
        <FormField label={t("filters.from")}>
          {(fieldId) => (
            <TextField
              id={fieldId}
              type="date"
              size="small"
              value={filters.from}
              onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            />
          )}
        </FormField>
        <FormField label={t("filters.to")}>
          {(fieldId) => (
            <TextField
              id={fieldId}
              type="date"
              size="small"
              value={filters.to}
              onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            />
          )}
        </FormField>
        <Button variant="contained" onClick={apply} data-testid="apply-filters">
          {t("filters.apply")}
        </Button>
      </Stack>

      <DataTable
        columns={columns}
        rows={props.rows}
        getRowId={(row) => row.bookingItemId}
        label={t("title")}
        onRowClick={(row) => router.push(`/workspace/bookings/${row.bookingId}`)}
        emptyState={<EmptyState title={t("empty.title")} description={t("empty.description")} dense />}
      />
    </Stack>
  );
}
