/**
 * Booking detail (issue #92): items with their normalized policy, the
 * per-item state history straight from AuditEvents, the ledger postings
 * panel (a ledger READ — rule 7), and the documents slot (fills in when
 * Documents v1 lands).
 */

import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import type { BookingItemState, CancellationPolicy } from "@jenova/domain";
import {
  BookingStateChip,
  Card,
  CardContent,
  CardHeader,
  Chip,
  DateText,
  Divider,
  EmptyState,
  MoneyText,
  PageHeader,
  PolicyTimeline,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
} from "@jenova/ui";
import { apiJsonOrLogin } from "../../../../../lib/api";

interface MoneyDto {
  readonly amount: number;
  readonly currency: string;
}

interface BookingDetailDto {
  readonly booking: {
    readonly bookingId: string;
    readonly clientReference: string;
    readonly channel: string;
    readonly paymentState: string;
    readonly total: MoneyDto;
    readonly createdAt: string;
  };
  readonly items: readonly {
    readonly bookingItemId: string;
    readonly vertical: string;
    readonly state: BookingItemState;
    readonly supplierCode: string;
    readonly supplierReference: string | null;
    readonly net: MoneyDto;
    readonly sell: MoneyDto;
    readonly policySnapshot: CancellationPolicy;
    readonly escalated: boolean;
    readonly escalationReason: string | null;
  }[];
  readonly auditTrail: readonly {
    readonly id: string;
    readonly actorType: string;
    readonly actorId: string | null;
    readonly entityType: string;
    readonly entityId: string;
    readonly action: string;
    readonly before: Record<string, unknown> | null;
    readonly after: Record<string, unknown> | null;
    readonly occurredAt: string;
  }[];
  readonly ledger: readonly {
    readonly id: string;
    readonly accountCode: string;
    readonly accountName: string;
    readonly amount: MoneyDto;
    readonly memo: string | null;
    readonly postedAt: string;
  }[];
  readonly documents: readonly unknown[];
}

export default async function BookingDetailPage(props: {
  readonly params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await props.params;
  const t = await getTranslations("workspace.detail");
  const tStates = await getTranslations("bookingStates");
  const tPolicy = await getTranslations("policy");
  const detail = await apiJsonOrLogin<BookingDetailDto>(`/staff/bookings/${id}`);
  const { booking } = detail;

  return (
    <>
      <PageHeader
        title={booking.clientReference}
        subtitle={`${t("channel")}: ${booking.channel} · ${t("paymentState")}: ${booking.paymentState}`}
      />
      <Stack spacing={3}>
        {detail.items.map((item) => (
          <Card key={item.bookingItemId} data-testid="booking-item">
            <CardHeader
              title={`${item.supplierCode} · ${item.supplierReference ?? "—"}`}
              subheader={item.vertical}
              action={
                <BookingStateChip
                  state={item.state}
                  label={tStates(item.state)}
                  escalated={item.escalated}
                />
              }
            />
            <CardContent>
              <Stack spacing={2}>
                {item.escalated && item.escalationReason !== null && (
                  <Typography variant="body2" color="warning.main">
                    {item.escalationReason}
                  </Typography>
                )}
                <Stack direction="row" spacing={4} useFlexGap flexWrap="wrap">
                  <Stack>
                    <Typography variant="caption" color="text.secondary">
                      {t("net")}
                    </Typography>
                    <MoneyText money={item.net} variant="body1" />
                  </Stack>
                  <Stack>
                    <Typography variant="caption" color="text.secondary">
                      {t("sell")}
                    </Typography>
                    <MoneyText money={item.sell} variant="body1" fontWeight={600} />
                  </Stack>
                </Stack>
                <Divider />
                <Typography variant="subtitle2">{t("cancellationPolicy")}</Typography>
                <PolicyTimeline
                  policy={item.policySnapshot}
                  labels={{
                    free: tPolicy("free"),
                    nonRefundable: tPolicy("nonRefundable"),
                    until: tPolicy("until"),
                    from: tPolicy("from"),
                    now: tPolicy("now"),
                  }}
                />
              </Stack>
            </CardContent>
          </Card>
        ))}

        <Card data-testid="state-history">
          <CardHeader title={t("history")} subheader={t("historySubtitle")} />
          <CardContent>
            {detail.auditTrail.length === 0 ? (
              <EmptyState title={t("historyEmpty")} dense />
            ) : (
              <Stack spacing={0} divider={<Divider />}>
                {detail.auditTrail.map((event) => (
                  <Stack
                    key={event.id}
                    direction="row"
                    spacing={2}
                    alignItems="baseline"
                    useFlexGap
                    flexWrap="wrap"
                    sx={{ paddingBlock: 1 }}
                  >
                    <DateText utc={event.occurredAt} dateStyle="medium" timeStyle="medium" variant="caption" />
                    <Chip size="small" variant="outlined" label={event.action} />
                    <Typography variant="caption" color="text.secondary">
                      {event.actorType}
                      {event.actorId !== null ? ` · ${event.actorId}` : ""}
                    </Typography>
                    {typeof event.after?.["reason"] === "string" && (
                      <Typography variant="caption">{event.after["reason"]}</Typography>
                    )}
                  </Stack>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>

        <Card data-testid="ledger-panel">
          <CardHeader title={t("ledger")} subheader={t("ledgerSubtitle")} />
          <CardContent>
            {detail.ledger.length === 0 ? (
              <EmptyState title={t("ledgerEmpty")} dense />
            ) : (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small" aria-label={t("ledger")}>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t("ledgerColumns.account")}</TableCell>
                      <TableCell>{t("ledgerColumns.memo")}</TableCell>
                      <TableCell sx={{ textAlign: "end" }}>{t("ledgerColumns.amount")}</TableCell>
                      <TableCell>{t("ledgerColumns.postedAt")}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {detail.ledger.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>
                          <Stack>
                            <Typography variant="body2">{line.accountName}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {line.accountCode}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>{line.memo ?? "—"}</TableCell>
                        <TableCell sx={{ textAlign: "end", fontVariantNumeric: "tabular-nums" }}>
                          <MoneyText money={line.amount} variant="body2" signDisplay="always" />
                        </TableCell>
                        <TableCell>
                          <DateText utc={line.postedAt} dateStyle="short" timeStyle="short" variant="body2" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader title={t("documents")} />
          <CardContent>
            <EmptyState title={t("documentsEmpty")} description={t("documentsNote")} dense />
          </CardContent>
        </Card>
      </Stack>
    </>
  );
}
