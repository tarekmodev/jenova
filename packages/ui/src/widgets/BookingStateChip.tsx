"use client";

/**
 * <BookingStateChip/> — a booking item state at a glance.
 *
 * Color/variant per canonical state; the escalated flag overrides with
 * the alarm look plus a warning icon. The localized label arrives via
 * props (apps own catalogs).
 */

import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import Chip, { type ChipProps } from "@mui/material/Chip";
import type { ReactNode } from "react";
import type { BookingItemState } from "@jenova/domain";
import { bookingStateAppearance } from "./bookingStateAppearance";

export interface BookingStateChipProps {
  readonly state: BookingItemState;
  /** Localized state label (apps own the ar/en catalogs). */
  readonly label: string;
  /** Manual-intervention flag (booking_items.escalated_at). */
  readonly escalated?: boolean;
  readonly size?: ChipProps["size"];
}

export function BookingStateChip(props: BookingStateChipProps): ReactNode {
  const appearance = bookingStateAppearance(props.state, props.escalated);
  return (
    <Chip
      label={props.label}
      size={props.size ?? "small"}
      variant={appearance.variant}
      {...(appearance.tone !== "default" ? { color: appearance.tone } : {})}
      {...(props.escalated === true
        ? { icon: <ReportProblemOutlinedIcon />, sx: { fontWeight: 700 } }
        : {})}
      data-state={props.state}
      data-escalated={props.escalated === true ? "true" : undefined}
    />
  );
}
