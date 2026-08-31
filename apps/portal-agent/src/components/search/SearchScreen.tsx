"use client";

/**
 * Streaming hotel search (issue #96): destination/city from the content
 * endpoints, multi-room occupancy, NATIONALITY always visible and required
 * (CLAUDE.md rule 9, defaulted per agency), results streamed progressively
 * over the POST-SSE endpoint into <StreamingList/>, filters applied
 * client-side over the streamed set.
 */

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  FormField,
  Grid,
  MenuItem,
  PageHeader,
  Select,
  Stack,
  StreamingList,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  currencyFractionDigits,
  initialStreamingListState,
  streamingListReducer,
  type StreamingListState,
} from "@jenova/ui";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useMessages } from "../../i18n/I18nProvider";
import { portalGet } from "../../lib/client-api";
import { applyOfferFilters, NO_FILTERS, sortBySellAscending, type BoardBasis, type OfferFilters } from "../../lib/filters";
import { storeOfferContext } from "../../lib/offer-storage";
import { consumeSseResponse } from "../../lib/sse";
import { useAppLocale } from "../../i18n/I18nProvider";
import type {
  ContentCity,
  ContentCountry,
  ContentProperty,
  OfferSummary,
  SearchCompletedFrame,
  SearchRequestBody,
  SearchStartedFrame,
  SupplierFailedFrame,
  SupplierResultsFrame,
} from "../../lib/types";
import { usePortalContext } from "../PortalContext";
import { OccupancyBuilder } from "./OccupancyBuilder";
import { OfferCard } from "./OfferCard";

/** Alpha cap until M3 location search: a city search targets its top N properties. */
const DEFAULT_CITY_PROPERTY_COUNT = 10;

const BOARD_VALUES: readonly BoardBasis[] = ["RO", "BB", "HB", "FB", "AI"];

interface SearchContext {
  readonly body: SearchRequestBody;
  readonly hotelNames: ReadonlyMap<string, string>;
}

export function SearchScreen(): ReactNode {
  const messages = useMessages();
  const locale = useAppLocale();
  const session = usePortalContext();
  const router = useRouter();

  // --- content pickers ------------------------------------------------------
  const [countries, setCountries] = useState<readonly ContentCountry[]>([]);
  const [countryCode, setCountryCode] = useState<string>("");
  const [cities, setCities] = useState<readonly ContentCity[]>([]);
  const [city, setCity] = useState<ContentCity | null>(null);
  const [properties, setProperties] = useState<readonly ContentProperty[]>([]);
  const [selectedHotels, setSelectedHotels] = useState<readonly ContentProperty[]>([]);
  const [contentError, setContentError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    portalGet<{ countries: readonly ContentCountry[] }>(`hotel-content/countries?locale=${locale}`)
      .then(({ countries: list }) => {
        if (cancelled) return;
        setCountries(list);
        const fallback = list.some((c) => c.code === "SA") ? "SA" : (list[0]?.code ?? "");
        setCountryCode((current) => (current === "" ? fallback : current));
      })
      .catch(() => {
        if (!cancelled) setContentError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    if (countryCode === "") return;
    let cancelled = false;
    setCities([]);
    setCity(null);
    portalGet<{ cities: readonly ContentCity[] }>(
      `hotel-content/countries/${countryCode}/cities?locale=${locale}`,
    )
      .then(({ cities: list }) => {
        if (!cancelled) setCities(list);
      })
      .catch(() => {
        if (!cancelled) setContentError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [countryCode, locale]);

  useEffect(() => {
    if (city === null) {
      setProperties([]);
      setSelectedHotels([]);
      return;
    }
    let cancelled = false;
    portalGet<{ properties: readonly ContentProperty[] }>(
      `hotel-content/cities/${city.cityId}/properties?locale=${locale}`,
    )
      .then(({ properties: list }) => {
        if (!cancelled) setProperties(list);
      })
      .catch(() => {
        if (!cancelled) setContentError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [city, locale]);

  // --- form state -----------------------------------------------------------
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [rooms, setRooms] = useState<readonly { adults: number; childAges: readonly number[] }[]>([
    { adults: 2, childAges: [] },
  ]);
  const [nationality, setNationality] = useState<string>(
    session.agency.defaultNationality ?? "",
  );
  const currencies =
    session.agency.allowedCurrencies.length > 0 ? session.agency.allowedCurrencies : ["USD"];
  const [currency, setCurrency] = useState<string>(currencies[0] ?? "USD");

  // --- streaming state ------------------------------------------------------
  const [streamState, dispatch] = useReducer(
    streamingListReducer<OfferSummary>,
    undefined,
    initialStreamingListState<OfferSummary>,
  );
  const [searching, setSearching] = useState(false);
  const [searchContext, setSearchContext] = useState<SearchContext | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const canSubmit =
    city !== null &&
    checkIn !== "" &&
    checkOut !== "" &&
    checkOut > checkIn &&
    /^[A-Z]{2}$/.test(nationality) &&
    !searching;

  const runSearch = async (): Promise<void> => {
    if (city === null) return;
    const targets =
      selectedHotels.length > 0
        ? selectedHotels
        : properties.slice(0, DEFAULT_CITY_PROPERTY_COUNT);
    const body: SearchRequestBody = {
      target: {
        kind: "properties",
        canonicalPropertyIds: targets.map((p) => p.canonicalPropertyId),
      },
      checkIn,
      checkOut,
      rooms,
      nationality,
      currency,
      locale,
    };
    const hotelNames = new Map(targets.map((p) => [p.canonicalPropertyId, p.name]));
    setSearchContext({ body, hotelNames });
    setSearching(true);
    dispatch({ type: "started", laneIds: [] });

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    try {
      const response = await fetch("/portal-api/hotel-search", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) {
        dispatch({ type: "stream_failed" });
        return;
      }
      await consumeSseResponse(
        response,
        (event) => {
          switch (event.event) {
            case "search.started": {
              const frame = JSON.parse(event.data) as SearchStartedFrame;
              dispatch({ type: "started", laneIds: [...frame.supplierCodes] });
              break;
            }
            case "supplier.results": {
              const frame = JSON.parse(event.data) as SupplierResultsFrame;
              dispatch({ type: "lane_results", laneId: frame.supplierCode, items: frame.offers });
              break;
            }
            case "supplier.failed": {
              const frame = JSON.parse(event.data) as SupplierFailedFrame;
              dispatch({ type: "lane_failed", laneId: frame.supplierCode, kind: frame.kind });
              break;
            }
            case "search.completed": {
              const frame = JSON.parse(event.data) as SearchCompletedFrame;
              dispatch({ type: "completed", status: frame.status });
              break;
            }
            case "search.failed":
              dispatch({ type: "stream_failed" });
              break;
          }
        },
        controller.signal,
      );
    } catch {
      if (!controller.signal.aborted) {
        dispatch({ type: "stream_failed" });
      }
    } finally {
      setSearching(false);
    }
  };

  // --- filters --------------------------------------------------------------
  const [filters, setFilters] = useState<OfferFilters>(NO_FILTERS);
  const [maxPriceInput, setMaxPriceInput] = useState("");

  const visibleState = useMemo((): StreamingListState<OfferSummary> => {
    const filtered = applyOfferFilters(streamState.items, filters);
    return { ...streamState, items: sortBySellAscending(filtered) };
  }, [streamState, filters]);

  const selectOffer = (offer: OfferSummary): void => {
    if (searchContext === null) return;
    storeOfferContext({
      offer,
      hotelName: searchContext.hotelNames.get(offer.canonicalPropertyId) ?? offer.canonicalPropertyId,
      checkIn: searchContext.body.checkIn,
      checkOut: searchContext.body.checkOut,
      rooms: searchContext.body.rooms,
      nationality: searchContext.body.nationality,
      currency: searchContext.body.currency,
    });
    router.push(`/offers/${offer.offerId}`);
  };

  const searchStarted = searchContext !== null;

  return (
    <Box>
      <PageHeader title={messages.search.title} subtitle={messages.search.subtitle} />

      <Card sx={{ marginBlockEnd: 3 }}>
        <CardContent>
          <Stack spacing={2.5}>
            {contentError && <Alert severity="error">{messages.common.genericError}</Alert>}
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 3 }}>
                <FormField label={messages.search.destination} required fullWidth>
                  {(fieldId) => (
                    <Select
                      id={fieldId}
                      size="small"
                      fullWidth
                      value={countryCode}
                      onChange={(event) => setCountryCode(String(event.target.value))}
                      data-testid="search-country"
                    >
                      {countries.map((entry) => (
                        <MenuItem key={entry.code} value={entry.code}>
                          {entry.name}
                        </MenuItem>
                      ))}
                    </Select>
                  )}
                </FormField>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormField label={messages.search.destinationPlaceholder} required fullWidth>
                  {(fieldId) => (
                    <Autocomplete
                      id={fieldId}
                      size="small"
                      options={cities}
                      value={city}
                      loading={cities.length === 0}
                      loadingText={messages.search.destinationLoading}
                      getOptionLabel={(option) => option.name}
                      isOptionEqualToValue={(a, b) => a.cityId === b.cityId}
                      onChange={(_, value) => setCity(value)}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          slotProps={{
                            htmlInput: {
                              ...params.inputProps,
                              "data-testid": "search-city",
                            },
                          }}
                        />
                      )}
                    />
                  )}
                </FormField>
              </Grid>
              <Grid size={{ xs: 6, sm: 2.5 }}>
                <FormField label={messages.search.checkIn} required fullWidth>
                  {(fieldId) => (
                    <TextField
                      id={fieldId}
                      size="small"
                      type="date"
                      fullWidth
                      value={checkIn}
                      onChange={(event) => setCheckIn(event.target.value)}
                      slotProps={{ htmlInput: { "data-testid": "search-checkin" } }}
                    />
                  )}
                </FormField>
              </Grid>
              <Grid size={{ xs: 6, sm: 2.5 }}>
                <FormField label={messages.search.checkOut} required fullWidth>
                  {(fieldId) => (
                    <TextField
                      id={fieldId}
                      size="small"
                      type="date"
                      fullWidth
                      value={checkOut}
                      onChange={(event) => setCheckOut(event.target.value)}
                      slotProps={{ htmlInput: { "data-testid": "search-checkout" } }}
                    />
                  )}
                </FormField>
              </Grid>
            </Grid>

            <FormField
              label={messages.search.hotelsOptional}
              hint={messages.search.hotelsHint}
              fullWidth
            >
              {(fieldId) => (
                <Autocomplete
                  id={fieldId}
                  multiple
                  size="small"
                  options={properties}
                  value={[...selectedHotels]}
                  getOptionLabel={(option) => option.name}
                  isOptionEqualToValue={(a, b) => a.canonicalPropertyId === b.canonicalPropertyId}
                  onChange={(_, value) => setSelectedHotels(value)}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      slotProps={{
                        htmlInput: { ...params.inputProps, "data-testid": "search-hotels" },
                      }}
                    />
                  )}
                />
              )}
            </FormField>

            <Grid container spacing={2}>
              <Grid size={{ xs: 6, sm: 3 }}>
                {/* Nationality: first-class, ALWAYS visible, required (rule 9). */}
                <FormField
                  label={messages.search.nationality}
                  hint={messages.search.nationalityHint}
                  required
                  fullWidth
                >
                  {(fieldId) => (
                    <Autocomplete
                      id={fieldId}
                      size="small"
                      options={countries}
                      value={countries.find((c) => c.code === nationality) ?? null}
                      getOptionLabel={(option) => `${option.name} (${option.code})`}
                      isOptionEqualToValue={(a, b) => a.code === b.code}
                      onChange={(_, value) => setNationality(value?.code ?? "")}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          slotProps={{
                            htmlInput: {
                              ...params.inputProps,
                              "data-testid": "search-nationality",
                            },
                          }}
                        />
                      )}
                    />
                  )}
                </FormField>
              </Grid>
              <Grid size={{ xs: 6, sm: 2 }}>
                <FormField label={messages.search.currency} required fullWidth>
                  {(fieldId) => (
                    <Select
                      id={fieldId}
                      size="small"
                      fullWidth
                      value={currency}
                      onChange={(event) => setCurrency(String(event.target.value))}
                      data-testid="search-currency"
                    >
                      {currencies.map((code) => (
                        <MenuItem key={code} value={code}>
                          {code}
                        </MenuItem>
                      ))}
                    </Select>
                  )}
                </FormField>
              </Grid>
            </Grid>

            <OccupancyBuilder rooms={rooms} onChange={setRooms} />

            <Stack direction="row" spacing={2} alignItems="center">
              <Button
                variant="contained"
                size="large"
                disabled={!canSubmit}
                onClick={() => void runSearch()}
                data-testid="search-submit"
              >
                {searching ? messages.search.searching : messages.search.submit}
              </Button>
              {selectedHotels.length === 0 && city !== null && (
                <Typography variant="caption" color="text.secondary">
                  {messages.search.topHotelsNote}
                </Typography>
              )}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {searchStarted && (
        <Stack spacing={2}>
          <Typography variant="h5">{messages.search.resultsTitle}</Typography>

          <Card variant="outlined">
            <CardContent sx={{ paddingBlock: 1.5, "&:last-child": { paddingBlockEnd: 1.5 } }}>
              <Stack direction="row" spacing={2} alignItems="center" useFlexGap flexWrap="wrap">
                <Typography variant="subtitle2">{messages.search.filters}</Typography>
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={filters.refundableOnly}
                      onChange={(_, checked) =>
                        setFilters((f) => ({ ...f, refundableOnly: checked }))
                      }
                      data-testid="filter-refundable"
                    />
                  }
                  label={messages.search.filterRefundableOnly}
                />
                <ToggleButtonGroup
                  size="small"
                  value={[...filters.boards]}
                  onChange={(_, boards: BoardBasis[]) => setFilters((f) => ({ ...f, boards }))}
                  aria-label={messages.search.filterBoard}
                >
                  {BOARD_VALUES.map((board) => (
                    <ToggleButton key={board} value={board}>
                      {messages.board[board]}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
                <TextField
                  size="small"
                  type="number"
                  label={`${messages.search.filterMaxPrice} (${currency})`}
                  value={maxPriceInput}
                  onChange={(event) => {
                    const raw = event.target.value;
                    setMaxPriceInput(raw);
                    const major = Number(raw);
                    setFilters((f) => ({
                      ...f,
                      maxSellMinor:
                        raw === "" || !Number.isFinite(major)
                          ? null
                          : Math.round(major * 10 ** currencyFractionDigits(currency)),
                    }));
                  }}
                  sx={{ width: 180 }}
                  slotProps={{ htmlInput: { "data-testid": "filter-max-price" } }}
                />
                <Typography variant="caption" color="text.secondary">
                  {messages.search.offersShown(visibleState.items.length, streamState.items.length)}
                </Typography>
              </Stack>
            </CardContent>
          </Card>

          <StreamingList
            state={visibleState}
            renderItem={(offer) => (
              <OfferCard
                key={offer.offerId}
                offer={offer}
                hotelName={
                  searchContext?.hotelNames.get(offer.canonicalPropertyId) ??
                  offer.canonicalPropertyId
                }
                onSelect={selectOffer}
              />
            )}
            labels={{
              laneLabel: (lane) => lane.id.toUpperCase(),
              laneFailureLabel: (lane) =>
                lane.failureKind === undefined
                  ? undefined
                  : (messages.supplierErrors[
                      lane.failureKind as keyof typeof messages.supplierErrors
                    ] ?? lane.failureKind),
              budgetExhausted: messages.search.budgetExhausted,
              streamFailed: messages.search.streamFailed,
              empty: (
                <Alert severity="info" data-testid="search-empty">
                  {messages.search.noResults}
                </Alert>
              ),
              streamingLabel: messages.search.streamingLabel,
            }}
          />
        </Stack>
      )}
    </Box>
  );
}
