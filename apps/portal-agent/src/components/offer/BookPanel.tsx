"use client";

/**
 * Book form + confirmation (issue #97). Rendered ONLY while a checked,
 * unexpired offer exists (OfferScreen gate); submits EXACTLY the checked
 * token. clientReference is generated client-side (idempotency key,
 * CLAUDE.md rule 8) and stays editable — agencies carry their own refs.
 */

import {
  Alert,
  Button,
  BookingStateChip,
  Card,
  CardContent,
  CardHeader,
  Divider,
  FormField,
  Grid,
  MoneyText,
  Stack,
  TextField,
  Typography,
} from "@jenova/ui";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useAppLocale, useMessages } from "../../i18n/I18nProvider";
import { PortalApiError, portalPost } from "../../lib/client-api";
import type { BookResponse, MoneyPayload, RoomOccupancyInput } from "../../lib/types";

interface GuestField {
  firstName: string;
  lastName: string;
  /** Age for children (required by adapters); undefined for adults. */
  readonly age?: number;
}

function newClientReference(): string {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `AG-${Date.now().toString(36).toUpperCase()}-${random}`;
}

export function BookPanel(props: {
  offerToken: string;
  sell: MoneyPayload;
  rooms: readonly RoomOccupancyInput[];
}): ReactNode {
  const messages = useMessages();
  const locale = useAppLocale();

  const [holder, setHolder] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [guestRooms, setGuestRooms] = useState<GuestField[][]>(() =>
    props.rooms.map((room) => [
      ...Array.from({ length: room.adults }, (): GuestField => ({ firstName: "", lastName: "" })),
      ...room.childAges.map((age): GuestField => ({ firstName: "", lastName: "", age })),
    ]),
  );
  const [clientReference, setClientReference] = useState(newClientReference);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BookResponse | null>(null);

  const valid = useMemo(() => {
    if (
      holder.firstName.trim() === "" ||
      holder.lastName.trim() === "" ||
      !holder.email.includes("@") ||
      holder.phone.trim().length < 5 ||
      clientReference.trim() === "" ||
      clientReference.length > 64
    ) {
      return false;
    }
    return guestRooms.every((room) =>
      room.every((guest) => guest.firstName.trim() !== "" && guest.lastName.trim() !== ""),
    );
  }, [holder, guestRooms, clientReference]);

  const updateGuest = (roomIndex: number, guestIndex: number, patch: Partial<GuestField>): void => {
    setGuestRooms((rooms) =>
      rooms.map((room, r) =>
        r === roomIndex
          ? room.map((guest, g) => (g === guestIndex ? { ...guest, ...patch } : guest))
          : room,
      ),
    );
  };

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await portalPost<BookResponse>("bookings", {
        offerToken: props.offerToken,
        clientReference: clientReference.trim(),
        holder,
        rooms: guestRooms.map((room) => ({
          guests: room.map((guest) => ({
            firstName: guest.firstName.trim(),
            lastName: guest.lastName.trim(),
            ...(guest.age === undefined ? {} : { age: guest.age }),
          })),
        })),
        locale,
      });
      setResult(response);
    } catch (caught) {
      if (caught instanceof PortalApiError && caught.code === "client_reference_conflict") {
        setError(messages.book.conflictReference);
      } else if (caught instanceof PortalApiError && (caught.code === "offer_not_checked" || caught.code === "offer_expired")) {
        // Server guard fired (the authoritative one): surface it honestly.
        setError(messages.book.mustCheckFirst);
      } else {
        setError(messages.book.bookFailed);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (result !== null) {
    const pending = result.state === "pending_confirmation";
    return (
      <Card data-testid="booking-confirmation">
        <CardHeader
          title={pending ? messages.confirmation.pendingTitle : messages.confirmation.title}
        />
        <CardContent>
          <Stack spacing={1.5}>
            {result.idempotentReplay && (
              <Alert severity="info">{messages.confirmation.idempotentReplay}</Alert>
            )}
            <Row label={messages.confirmation.bookingRef} value={result.clientReference} testId="confirmation-ref" />
            <Row
              label={messages.confirmation.supplierRef}
              value={result.supplierReference ?? "—"}
              testId="confirmation-supplier-ref"
            />
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="body2" color="text.secondary">
                {messages.confirmation.state}
              </Typography>
              <BookingStateChip state={result.state} label={messages.states[result.state]} />
            </Stack>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="body2" color="text.secondary">
                {messages.confirmation.amount}
              </Typography>
              <MoneyText money={result.sell} variant="subtitle1" fontWeight={700} />
            </Stack>
            <Divider />
            {/* Voucher link stub: documents service is a parallel M2
                workstream — state that honestly instead of a dead link. */}
            <Typography variant="body2" color="text.secondary" data-testid="voucher-stub">
              {messages.confirmation.voucher}: {messages.confirmation.voucherPending}
            </Typography>
            <Stack direction="row" spacing={1.5}>
              <Button
                component={Link}
                href={`/bookings/${result.bookingId}`}
                variant="contained"
                data-testid="go-to-booking"
              >
                {messages.confirmation.goToBooking}
              </Button>
              <Button component={Link} href="/bookings" color="inherit">
                {messages.confirmation.goToBookings}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="book-panel">
      <CardHeader title={messages.book.title} />
      <CardContent>
        <Stack spacing={2.5}>
          {error !== null && <Alert severity="error" data-testid="book-error">{error}</Alert>}

          <Typography variant="subtitle2">{messages.book.holder}</Typography>
          <Grid container spacing={1.5}>
            <Grid size={6}>
              <FormField label={messages.book.firstName} required fullWidth>
                {(id) => (
                  <TextField
                    id={id}
                    size="small"
                    fullWidth
                    value={holder.firstName}
                    onChange={(e) => setHolder({ ...holder, firstName: e.target.value })}
                    slotProps={{ htmlInput: { "data-testid": "holder-first-name" } }}
                  />
                )}
              </FormField>
            </Grid>
            <Grid size={6}>
              <FormField label={messages.book.lastName} required fullWidth>
                {(id) => (
                  <TextField
                    id={id}
                    size="small"
                    fullWidth
                    value={holder.lastName}
                    onChange={(e) => setHolder({ ...holder, lastName: e.target.value })}
                    slotProps={{ htmlInput: { "data-testid": "holder-last-name" } }}
                  />
                )}
              </FormField>
            </Grid>
            <Grid size={7}>
              <FormField label={messages.book.email} required fullWidth>
                {(id) => (
                  <TextField
                    id={id}
                    size="small"
                    type="email"
                    fullWidth
                    value={holder.email}
                    onChange={(e) => setHolder({ ...holder, email: e.target.value })}
                    slotProps={{ htmlInput: { dir: "ltr", "data-testid": "holder-email" } }}
                  />
                )}
              </FormField>
            </Grid>
            <Grid size={5}>
              <FormField label={messages.book.phone} required fullWidth>
                {(id) => (
                  <TextField
                    id={id}
                    size="small"
                    fullWidth
                    value={holder.phone}
                    onChange={(e) => setHolder({ ...holder, phone: e.target.value })}
                    slotProps={{ htmlInput: { dir: "ltr", "data-testid": "holder-phone" } }}
                  />
                )}
              </FormField>
            </Grid>
          </Grid>

          {guestRooms.map((room, roomIndex) => (
            <Stack key={roomIndex} spacing={1.5}>
              <Typography variant="subtitle2">{messages.book.roomGuests(roomIndex + 1)}</Typography>
              {room.map((guest, guestIndex) => {
                const label =
                  guest.age === undefined
                    ? messages.book.guestAdult(guestIndex + 1)
                    : messages.book.guestChild(guestIndex + 1, guest.age);
                return (
                  <Grid container spacing={1.5} key={guestIndex}>
                    <Grid size={6}>
                      <FormField label={`${label} — ${messages.book.firstName}`} required fullWidth>
                        {(id) => (
                          <TextField
                            id={id}
                            size="small"
                            fullWidth
                            value={guest.firstName}
                            onChange={(e) =>
                              updateGuest(roomIndex, guestIndex, { firstName: e.target.value })
                            }
                            slotProps={{
                              htmlInput: {
                                "data-testid": `guest-${String(roomIndex)}-${String(guestIndex)}-first`,
                              },
                            }}
                          />
                        )}
                      </FormField>
                    </Grid>
                    <Grid size={6}>
                      <FormField label={`${label} — ${messages.book.lastName}`} required fullWidth>
                        {(id) => (
                          <TextField
                            id={id}
                            size="small"
                            fullWidth
                            value={guest.lastName}
                            onChange={(e) =>
                              updateGuest(roomIndex, guestIndex, { lastName: e.target.value })
                            }
                            slotProps={{
                              htmlInput: {
                                "data-testid": `guest-${String(roomIndex)}-${String(guestIndex)}-last`,
                              },
                            }}
                          />
                        )}
                      </FormField>
                    </Grid>
                  </Grid>
                );
              })}
            </Stack>
          ))}

          <FormField
            label={messages.book.clientReference}
            hint={messages.book.clientReferenceHint}
            required
            fullWidth
          >
            {(id) => (
              <TextField
                id={id}
                size="small"
                fullWidth
                value={clientReference}
                onChange={(e) => setClientReference(e.target.value)}
                slotProps={{ htmlInput: { dir: "ltr", "data-testid": "client-reference" } }}
              />
            )}
          </FormField>

          <Button
            variant="contained"
            size="large"
            disabled={!valid || submitting}
            onClick={() => void submit()}
            data-testid="book-submit"
          >
            {submitting ? messages.book.submitting : messages.book.submit}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

function Row(props: { label: string; value: string; testId?: string }): ReactNode {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {props.label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }} data-testid={props.testId}>
        {props.value}
      </Typography>
    </Stack>
  );
}
