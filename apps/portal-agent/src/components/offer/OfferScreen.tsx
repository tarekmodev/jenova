"use client";

/**
 * Offer detail → check → book (issue #97).
 *
 * MONEY-PATH ADJACENT — the client-side half of the offer gate:
 * - the book form is rendered ONLY after a successful /offers/check whose
 *   result is `unchanged` (or an explicitly re-approved `price_changed`
 *   successor, which is born checked);
 * - the book call always sends EXACTLY the token the check returned;
 * - the moment the checked offer's expiry passes, the UI drops back to the
 *   un-checked state (countdown-driven) — no bookable state is ever shown
 *   that the server would refuse.
 * The server guard (signed token + checked-window) remains authoritative;
 * everything here only narrows what can be attempted.
 */

import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Divider,
  Grid,
  LoadingState,
  MoneyText,
  PageHeader,
  PolicyTimeline,
  Stack,
  Typography,
} from "@jenova/ui";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CancellationPolicy } from "@jenova/domain";
import { useAppLocale, useMessages } from "../../i18n/I18nProvider";
import { PortalApiError, portalPost } from "../../lib/client-api";
import { loadOfferContext } from "../../lib/offer-storage";
import type { CheckResponse, MoneyPayload, StoredOfferContext } from "../../lib/types";
import { BookPanel } from "./BookPanel";

const DAY_MS = 86_400_000;

/** The live, bookable thing on this screen — always the LAST check's truth. */
interface CheckedOffer {
  readonly offerToken: string;
  readonly sell: MoneyPayload;
  readonly expiresAt: string;
  readonly policy: CancellationPolicy | null;
}

type CheckPhase =
  | { readonly kind: "checking" }
  | { readonly kind: "checked"; readonly offer: CheckedOffer }
  | {
      readonly kind: "price_changed";
      readonly oldSell: MoneyPayload;
      readonly successor: CheckedOffer;
      readonly policyChanged: boolean;
    }
  | { readonly kind: "sold_out" }
  | { readonly kind: "expired" }
  | { readonly kind: "failed" };

export function OfferScreen(props: { offerId: string }): ReactNode {
  const messages = useMessages();
  const locale = useAppLocale();

  const [context, setContext] = useState<StoredOfferContext | null | "loading">("loading");
  const [phase, setPhase] = useState<CheckPhase>({ kind: "checking" });
  const [now, setNow] = useState(() => Date.now());
  const checkedOnce = useRef(false);

  useEffect(() => {
    setContext(loadOfferContext(props.offerId));
  }, [props.offerId]);

  // Countdown tick: the bookable state must DROP at expiry, client-side too.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const runCheck = useCallback(
    async (offerToken: string): Promise<void> => {
      setPhase({ kind: "checking" });
      try {
        const result = await portalPost<CheckResponse>("offers/check", { offerToken, locale });
        if (result.status === "unchanged") {
          setPhase({
            kind: "checked",
            offer: {
              offerToken: result.offerToken,
              sell: result.sell,
              expiresAt: result.expiresAt,
              policy: result.cancellationPolicy,
            },
          });
        } else {
          setPhase({
            kind: "price_changed",
            oldSell: result.oldSell,
            successor: {
              offerToken: result.newOfferToken,
              sell: result.newSell,
              expiresAt: result.newExpiresAt,
              policy: result.newCancellationPolicy,
            },
            policyChanged: result.policyChanged,
          });
        }
      } catch (error) {
        if (error instanceof PortalApiError) {
          if (error.code === "sold_out") {
            setPhase({ kind: "sold_out" });
            return;
          }
          if (error.code === "offer_expired" || error.code === "offer_invalidated") {
            setPhase({ kind: "expired" });
            return;
          }
          if (error.code === "price_changed") {
            // Adapter-level rejection with no fresh state: re-search.
            setPhase({ kind: "expired" });
            return;
          }
        }
        setPhase({ kind: "failed" });
      }
    },
    [locale],
  );

  useEffect(() => {
    if (context === "loading" || context === null || checkedOnce.current) {
      return;
    }
    checkedOnce.current = true;
    void runCheck(context.offer.offerToken);
  }, [context, runCheck]);

  const nights = useMemo(() => {
    if (context === "loading" || context === null) return 0;
    return Math.max(1, Math.round((Date.parse(context.checkOut) - Date.parse(context.checkIn)) / DAY_MS));
  }, [context]);

  if (context === "loading") {
    return <LoadingState label={messages.common.loading} />;
  }
  if (context === null) {
    return (
      <Box>
        <PageHeader title={messages.offer.missing} />
        <Alert severity="warning">{messages.offer.missingExplainer}</Alert>
        <Box sx={{ marginBlockStart: 2 }}>
          <Button component={Link} href="/search" variant="contained">
            {messages.offer.backToResults}
          </Button>
        </Box>
      </Box>
    );
  }

  const { offer } = context;
  const adults = context.rooms.reduce((sum, room) => sum + room.adults, 0);
  const children = context.rooms.reduce((sum, room) => sum + room.childAges.length, 0);

  const checkedOffer = phase.kind === "checked" ? phase.offer : null;
  const checkedExpired =
    checkedOffer !== null && Date.parse(checkedOffer.expiresAt) <= now;
  const bookable = checkedOffer !== null && !checkedExpired;

  const displayedSell = checkedOffer?.sell ?? offer.sell;
  const displayedPolicy: CancellationPolicy =
    checkedOffer?.policy ?? offer.cancellationPolicy;

  return (
    <Box>
      <PageHeader title={messages.offer.title} subtitle={context.hotelName} />

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Stack spacing={3}>
            <Card>
              <CardHeader title={messages.offer.staySummary} />
              <CardContent>
                <Stack spacing={1.25}>
                  <SummaryRow label={messages.offer.hotel} value={context.hotelName} testId="offer-detail-hotel" />
                  <SummaryRow label={messages.offer.roomName} value={offer.supplierRoomName} />
                  <SummaryRow label={messages.offer.board} value={messages.board[offer.boardBasis]} />
                  <SummaryRow
                    label={messages.offer.dates}
                    value={`${context.checkIn} → ${context.checkOut} (${messages.offer.nights(nights)})`}
                  />
                  <SummaryRow
                    label={messages.offer.occupancy}
                    value={messages.offer.guests(adults, children)}
                  />
                  <SummaryRow label={messages.offer.nationality} value={context.nationality} />
                  <SummaryRow label={messages.offer.supplier} value={offer.supplierCode.toUpperCase()} />
                  <Divider />
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="subtitle1">{messages.offer.sellPrice}</Typography>
                    <MoneyText money={displayedSell} variant="h5" fontWeight={700} />
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardHeader title={messages.offer.cancellationPolicy} />
              <CardContent>
                <PolicyTimeline
                  policy={displayedPolicy}
                  labels={messages.policy}
                  now={new Date(now)}
                  hijri={locale === "ar"}
                />
              </CardContent>
            </Card>
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Stack spacing={3}>
            <Card data-testid="check-panel">
              <CardHeader title={messages.offer.checkTitle} />
              <CardContent>
                {phase.kind === "checking" && <LoadingState label={messages.offer.checking} dense />}

                {phase.kind === "checked" && !checkedExpired && (
                  <Alert severity="success" data-testid="check-unchanged">
                    <AlertTitle>{messages.offer.checkedOk}</AlertTitle>
                    {messages.offer.checkedOkUntil}
                  </Alert>
                )}

                {phase.kind === "checked" && checkedExpired && (
                  <ExpiredPanel messages={messages} />
                )}

                {phase.kind === "price_changed" && (
                  <Stack spacing={2} data-testid="price-delta">
                    <Alert severity="warning">
                      <AlertTitle>{messages.offer.priceChangedTitle}</AlertTitle>
                      {messages.offer.priceChangedExplainer}
                      {phase.policyChanged && (
                        <Typography variant="body2" sx={{ marginBlockStart: 1 }}>
                          {messages.offer.policyAlsoChanged}
                        </Typography>
                      )}
                    </Alert>
                    <Stack direction="row" spacing={3} justifyContent="center">
                      <Stack alignItems="center" spacing={0.5}>
                        <Typography variant="caption" color="text.secondary">
                          {messages.offer.oldPrice}
                        </Typography>
                        <Box sx={{ textDecoration: "line-through", opacity: 0.6 }}>
                          <MoneyText money={phase.oldSell} variant="h6" />
                        </Box>
                      </Stack>
                      <Stack alignItems="center" spacing={0.5}>
                        <Typography variant="caption" color="text.secondary">
                          {messages.offer.newPrice}
                        </Typography>
                        <MoneyText
                          money={phase.successor.sell}
                          variant="h6"
                          fontWeight={700}
                          color="warning.main"
                        />
                      </Stack>
                    </Stack>
                    <Stack direction="row" spacing={1.5} justifyContent="center">
                      <Button
                        variant="contained"
                        color="warning"
                        onClick={() =>
                          // The successor is born checked — approving it makes
                          // it THE bookable offer, no second supplier trip.
                          setPhase({ kind: "checked", offer: phase.successor })
                        }
                        data-testid="accept-new-price"
                      >
                        {messages.offer.acceptNewPrice}
                      </Button>
                      <Button component={Link} href="/search" color="inherit">
                        {messages.offer.declineNewPrice}
                      </Button>
                    </Stack>
                  </Stack>
                )}

                {phase.kind === "sold_out" && (
                  <Alert severity="error" data-testid="check-sold-out">
                    {messages.offer.soldOut}
                  </Alert>
                )}
                {phase.kind === "expired" && <ExpiredPanel messages={messages} />}
                {phase.kind === "failed" && (
                  <Stack spacing={2}>
                    <Alert severity="error">{messages.offer.checkFailed}</Alert>
                    <Button onClick={() => void runCheck(context.offer.offerToken)}>
                      {messages.common.retry}
                    </Button>
                  </Stack>
                )}
              </CardContent>
            </Card>

            {bookable && checkedOffer !== null && (
              <BookPanel
                offerToken={checkedOffer.offerToken}
                sell={checkedOffer.sell}
                rooms={context.rooms}
              />
            )}
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
}

function SummaryRow(props: { label: string; value: string; testId?: string }): ReactNode {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {props.label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 500, textAlign: "end" }} data-testid={props.testId}>
        {props.value}
      </Typography>
    </Stack>
  );
}

function ExpiredPanel(props: { messages: ReturnType<typeof useMessages> }): ReactNode {
  const { messages } = props;
  return (
    <Stack spacing={2} data-testid="check-expired">
      <Alert severity="warning">
        <AlertTitle>{messages.offer.expired}</AlertTitle>
        {messages.offer.expiredExplainer}
      </Alert>
      <Button component={Link} href="/search" variant="contained">
        {messages.offer.backToResults}
      </Button>
    </Stack>
  );
}
