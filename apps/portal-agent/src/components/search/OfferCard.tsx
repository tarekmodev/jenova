"use client";

/**
 * One streamed result. Sell price renders through MoneyText ONLY (rule 6 /
 * rule 10); refundability comes from the normalized CancellationPolicy the
 * server attached — nothing here computes a verdict.
 */

import {
  Button,
  Card,
  CardContent,
  Chip,
  MoneyText,
  Stack,
  Typography,
} from "@jenova/ui";
import type { ReactNode } from "react";
import { useMessages } from "../../i18n/I18nProvider";
import type { OfferSummary } from "../../lib/types";

export function OfferCard(props: {
  offer: OfferSummary;
  hotelName: string;
  onSelect: (offer: OfferSummary) => void;
}): ReactNode {
  const messages = useMessages();
  const { offer } = props;

  return (
    <Card variant="outlined" data-testid="offer-card" data-offer-id={offer.offerId}>
      <CardContent>
        <Stack
          direction="row"
          spacing={2}
          alignItems="center"
          justifyContent="space-between"
          useFlexGap
          flexWrap="wrap"
        >
          <Stack spacing={0.5} sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }} data-testid="offer-hotel">
              {props.hotelName}
            </Typography>
            <Typography variant="body2" color="text.secondary" data-testid="offer-room">
              {offer.supplierRoomName}
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Chip size="small" variant="outlined" label={messages.board[offer.boardBasis]} />
              {offer.refundable ? (
                <Chip size="small" color="success" variant="outlined" label={messages.search.refundable} />
              ) : (
                <Chip size="small" color="error" variant="outlined" label={messages.search.nonRefundable} />
              )}
            </Stack>
          </Stack>
          <Stack spacing={0.5} alignItems="flex-end">
            <MoneyText money={offer.sell} variant="h6" fontWeight={700} />
            <Typography variant="caption" color="text.secondary">
              {messages.search.perStay}
            </Typography>
            <Button
              size="small"
              variant="contained"
              onClick={() => props.onSelect(offer)}
              data-testid="offer-select"
            >
              {messages.search.viewOffer}
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
