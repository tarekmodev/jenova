"use client";

/**
 * <DateText/> — Gregorian primary line, optional Hijri secondary line.
 *
 * Takes a UTC instant (storage truth). Hijri (Umm al-Qura) is display
 * only (CLAUDE.md rule 9) and renders as a muted secondary line for
 * Umrah-adjacent flows.
 */

import Stack from "@mui/material/Stack";
import Typography, { type TypographyProps } from "@mui/material/Typography";
import type { ReactNode } from "react";
import { useLocale } from "../direction/DirectionProvider";
import { formatGregorian, formatHijri, type FormatDateOptions } from "./formatDate";
import type { NumeralSystem } from "./formatMoney";

export interface DateTextProps {
  /** UTC instant — ISO 8601 string or Date. */
  readonly utc: string | Date;
  /** Show the Hijri secondary line (display only). */
  readonly hijri?: boolean;
  readonly numerals?: NumeralSystem;
  readonly dateStyle?: "full" | "long" | "medium" | "short";
  /** Omit for date-only display. */
  readonly timeStyle?: "full" | "long" | "medium" | "short";
  /** IANA display zone; UTC when omitted. */
  readonly timeZone?: string;
  readonly variant?: TypographyProps["variant"];
  readonly color?: TypographyProps["color"];
}

export function DateText(props: DateTextProps): ReactNode {
  const locale = useLocale();
  const options: FormatDateOptions = {
    locale,
    ...(props.numerals !== undefined ? { numerals: props.numerals } : {}),
    ...(props.dateStyle !== undefined ? { dateStyle: props.dateStyle } : {}),
    ...(props.timeStyle !== undefined ? { timeStyle: props.timeStyle } : {}),
    ...(props.timeZone !== undefined ? { timeZone: props.timeZone } : {}),
  };
  const gregorian = formatGregorian(props.utc, options);

  if (props.hijri !== true) {
    return (
      <Typography
        component="span"
        variant={props.variant ?? "inherit"}
        {...(props.color !== undefined ? { color: props.color } : {})}
        sx={{ unicodeBidi: "isolate" }}
      >
        {gregorian}
      </Typography>
    );
  }

  const hijri = formatHijri(props.utc, options);
  return (
    <Stack component="span" sx={{ display: "inline-flex" }}>
      <Typography
        component="span"
        variant={props.variant ?? "inherit"}
        {...(props.color !== undefined ? { color: props.color } : {})}
        sx={{ unicodeBidi: "isolate" }}
      >
        {gregorian}
      </Typography>
      <Typography component="span" variant="body2" color="text.secondary" sx={{ unicodeBidi: "isolate" }}>
        {hijri}
      </Typography>
    </Stack>
  );
}
