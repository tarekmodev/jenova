"use client";

/**
 * <MoneyText/> — the ONLY way money renders in dashboard-class apps.
 *
 * Domain Money in (integer minor units — CLAUDE.md rule 6), localized
 * display out. Digits follow the tenant numeral setting (latn default);
 * currency placement is locale-driven by Intl and the span is
 * bidi-isolated so an amount never scrambles surrounding RTL text.
 * Always tabular-nums so columns of amounts align.
 */

import Typography, { type TypographyProps } from "@mui/material/Typography";
import type { ReactNode } from "react";
import type { Money } from "@jenova/domain";
import { useLocale } from "../direction/DirectionProvider";
import { formatMoney, type NumeralSystem } from "./formatMoney";

export interface MoneyTextProps {
  readonly money: Money;
  /** Tenant display setting; Latin digits by default (docs/06). */
  readonly numerals?: NumeralSystem;
  readonly currencyDisplay?: "symbol" | "code";
  readonly signDisplay?: "auto" | "always" | "never" | "exceptZero";
  readonly variant?: TypographyProps["variant"];
  readonly color?: TypographyProps["color"];
  readonly fontWeight?: number | string;
}

export function MoneyText(props: MoneyTextProps): ReactNode {
  const locale = useLocale();
  const text = formatMoney(props.money, {
    locale,
    ...(props.numerals !== undefined ? { numerals: props.numerals } : {}),
    ...(props.currencyDisplay !== undefined ? { currencyDisplay: props.currencyDisplay } : {}),
    ...(props.signDisplay !== undefined ? { signDisplay: props.signDisplay } : {}),
  });
  return (
    <Typography
      component="span"
      variant={props.variant ?? "inherit"}
      {...(props.color !== undefined ? { color: props.color } : {})}
      sx={{
        fontVariantNumeric: "tabular-nums",
        unicodeBidi: "isolate",
        ...(props.fontWeight !== undefined ? { fontWeight: props.fontWeight } : {}),
      }}
    >
      {text}
    </Typography>
  );
}
