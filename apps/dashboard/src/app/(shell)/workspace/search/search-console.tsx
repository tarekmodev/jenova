"use client";

/**
 * Search console (issue #92): staff-side hotel search over the SAME SSE
 * endpoint every surface uses (rule 2 — internal channel is a parameter).
 * The stream flows through the authed BFF proxy into the ui kit's
 * StreamingList reducer; results render progressively per supplier lane.
 *
 * Search targets are canonical property ids (comma-separated) — the
 * hotel/destination autocomplete arrives with the M3 mapping service.
 * Book-on-behalf is deliberately a stub in M2: the flow completes in the
 * Agent Portal ("open in portal"); staff-side booking with sub-tenant
 * attribution lands with the B2B staff workstream.
 */

import { useReducer, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  EmptyState,
  FormField,
  MenuItem,
  MoneyText,
  Select,
  Stack,
  StreamingList,
  TextField,
  Typography,
  initialStreamingListState,
  streamingListReducer,
  type StreamingListEvent,
  type StreamingListState,
} from "@jenova/ui";
import { feedSseChunk, INITIAL_SSE_STATE, type SseFrame } from "../../../../lib/sse";

interface OfferDto {
  readonly offerId: string;
  readonly offerToken: string;
  readonly expiresAt: string;
  readonly supplierCode: string;
  readonly canonicalPropertyId: string;
  readonly supplierRoomName: string;
  readonly boardBasis: string;
  readonly sell: { readonly amount: number; readonly currency: string };
  readonly refundable: boolean;
}

type ConsoleEvent =
  | { readonly type: "reset" }
  | { readonly type: "stream"; readonly event: StreamingListEvent<OfferDto> };

function consoleReducer(
  state: StreamingListState<OfferDto>,
  action: ConsoleEvent,
): StreamingListState<OfferDto> {
  if (action.type === "reset") return initialStreamingListState<OfferDto>();
  return streamingListReducer(state, action.event);
}

function toStreamEvent(frame: SseFrame): StreamingListEvent<OfferDto> | null {
  const data = frame.data as Record<string, unknown>;
  switch (frame.event) {
    case "search.started":
      return { type: "started", laneIds: (data["supplierCodes"] as string[] | undefined) ?? [] };
    case "supplier.results":
      return {
        type: "lane_results",
        laneId: String(data["supplierCode"]),
        items: (data["offers"] as OfferDto[] | undefined) ?? [],
      };
    case "supplier.failed":
      return {
        type: "lane_failed",
        laneId: String(data["supplierCode"]),
        kind: String(data["kind"]),
      };
    case "search.completed":
      return {
        type: "completed",
        status: data["status"] === "budget_exhausted" ? "budget_exhausted" : "complete",
      };
    case "search.failed":
      return { type: "stream_failed" };
    default:
      return null;
  }
}

const CURRENCIES = ["SAR", "USD", "EUR", "AED"] as const;

export function SearchConsole(): ReactNode {
  const t = useTranslations("workspace.search");
  const tErrors = useTranslations("supplierErrors");
  const [state, dispatch] = useReducer(consoleReducer, undefined, () =>
    initialStreamingListState<OfferDto>(),
  );
  const [propertyIds, setPropertyIds] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [adults, setAdults] = useState(1);
  const [nationality, setNationality] = useState("SA");
  const [currency, setCurrency] = useState<string>("SAR");
  const [searching, setSearching] = useState(false);
  const [started, setStarted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const search = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const ids = propertyIds
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value !== "");
    if (ids.length === 0 || checkIn === "" || checkOut === "" || !/^[A-Z]{2}$/.test(nationality)) {
      setFormError(t("errors.form"));
      return;
    }
    setFormError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ type: "reset" });
    setStarted(true);
    setSearching(true);
    try {
      const response = await fetch("/api/proxy/hotel-search", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        signal: controller.signal,
        body: JSON.stringify({
          target: { kind: "properties", canonicalPropertyIds: ids },
          checkIn,
          checkOut,
          rooms: [{ adults, childAges: [] }],
          nationality,
          currency,
        }),
      });
      if (!response.ok || response.body === null) {
        dispatch({ type: "stream", event: { type: "stream_failed" } });
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let parser = INITIAL_SSE_STATE;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const fed = feedSseChunk(parser, decoder.decode(value, { stream: true }));
        parser = fed.state;
        for (const frame of fed.frames) {
          const mapped = toStreamEvent(frame);
          if (mapped !== null) dispatch({ type: "stream", event: mapped });
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        dispatch({ type: "stream", event: { type: "stream_failed" } });
      }
    } finally {
      setSearching(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Card>
        <CardContent>
          <form onSubmit={(event) => void search(event)} noValidate>
            <Stack spacing={2}>
              {formError !== null && <Alert severity="error">{formError}</Alert>}
              <FormField label={t("propertyIds")} hint={t("propertyIdsHint")} required fullWidth>
                {(fieldId) => (
                  <TextField
                    id={fieldId}
                    value={propertyIds}
                    onChange={(event) => setPropertyIds(event.target.value)}
                    multiline
                    minRows={2}
                    fullWidth
                    size="small"
                    data-testid="property-ids"
                  />
                )}
              </FormField>
              <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
                <FormField label={t("checkIn")} required>
                  {(fieldId) => (
                    <TextField
                      id={fieldId}
                      type="date"
                      value={checkIn}
                      onChange={(event) => setCheckIn(event.target.value)}
                      size="small"
                      data-testid="check-in"
                    />
                  )}
                </FormField>
                <FormField label={t("checkOut")} required>
                  {(fieldId) => (
                    <TextField
                      id={fieldId}
                      type="date"
                      value={checkOut}
                      onChange={(event) => setCheckOut(event.target.value)}
                      size="small"
                      data-testid="check-out"
                    />
                  )}
                </FormField>
                <FormField label={t("adults")} required>
                  {(fieldId) => (
                    <TextField
                      id={fieldId}
                      type="number"
                      value={adults}
                      onChange={(event) => setAdults(Math.max(1, Math.min(9, Number(event.target.value))))}
                      size="small"
                      sx={{ width: 90 }}
                    />
                  )}
                </FormField>
                <FormField label={t("nationality")} hint={t("nationalityHint")} required>
                  {(fieldId) => (
                    <TextField
                      id={fieldId}
                      value={nationality}
                      onChange={(event) => setNationality(event.target.value.toUpperCase())}
                      size="small"
                      sx={{ width: 110 }}
                      data-testid="nationality"
                    />
                  )}
                </FormField>
                <FormField label={t("currency")} required>
                  {(fieldId) => (
                    <Select
                      id={fieldId}
                      value={currency}
                      onChange={(event) => setCurrency(event.target.value)}
                      size="small"
                    >
                      {CURRENCIES.map((code) => (
                        <MenuItem key={code} value={code}>
                          {code}
                        </MenuItem>
                      ))}
                    </Select>
                  )}
                </FormField>
              </Stack>
              <Button
                type="submit"
                variant="contained"
                disabled={searching}
                sx={{ alignSelf: "flex-start" }}
                data-testid="run-search"
              >
                {t("search")}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>

      {started && (
        <StreamingList
          state={state}
          labels={{
            laneLabel: (lane) => lane.id,
            laneFailureLabel: (lane) =>
              lane.failureKind !== undefined ? tErrors(lane.failureKind) : undefined,
            budgetExhausted: t("budgetExhausted"),
            streamFailed: t("streamFailed"),
            empty: <EmptyState title={t("empty.title")} description={t("empty.description")} dense />,
            streamingLabel: t("streaming"),
          }}
          renderItem={(offer) => <OfferRow key={offer.offerId} offer={offer} />}
        />
      )}
    </Stack>
  );
}

function OfferRow(props: { readonly offer: OfferDto }): ReactNode {
  const t = useTranslations("workspace.search");
  const { offer } = props;
  return (
    <Card variant="outlined" data-testid="offer-row">
      <CardContent>
        <Stack direction="row" spacing={2} alignItems="center" useFlexGap flexWrap="wrap">
          <Stack sx={{ flexGrow: 1, minWidth: 220 }}>
            <Typography variant="subtitle2">{offer.supplierRoomName}</Typography>
            <Typography variant="caption" color="text.secondary">
              {offer.canonicalPropertyId} · {offer.supplierCode}
            </Typography>
          </Stack>
          <Chip size="small" variant="outlined" label={offer.boardBasis} />
          {offer.refundable ? (
            <Chip size="small" color="success" variant="outlined" label={t("refundable")} />
          ) : (
            <Chip size="small" color="warning" variant="outlined" label={t("nonRefundable")} />
          )}
          <MoneyText money={offer.sell} variant="h6" />
          {/* Book-on-behalf stub (M2): the bookable flow lives in the Agent
              Portal; staff booking with sub-tenant attribution is the B2B
              staff workstream. */}
          <Button size="small" variant="outlined" disabled title={t("openInPortalHint")}>
            {t("openInPortal")}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
