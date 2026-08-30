/**
 * MoneyText + DateText: localized money (latn/arab digits, GCC
 * minor-unit exponents) and Gregorian/Hijri display. Round synthetic
 * amounts and fixed instants only (CLAUDE.md rule 5).
 */

import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { money } from "@jenova/domain";
import { DateText } from "../widgets/DateText";
import { MoneyText } from "../widgets/MoneyText";
import { pickCopy } from "./support";

const meta: Meta = {
  title: "Widgets/MoneyAndDates",
};
export default meta;

const AMOUNTS = [
  money(125000, "SAR"),
  money(-4550, "SAR"),
  money(999999, "AED"),
  money(123456, "BHD"), // 3 minor-unit digits
  money(500000, "KWD"),
  money(750000, "USD"),
];

export const Money: StoryObj = {
  render: (_args, context) => {
    const copy = pickCopy(context.globals, {
      ar: { latn: "أرقام لاتينية (الافتراضي)", arab: "أرقام عربية مشرقية (خيار المستأجر)", code: "برمز العملة" },
      en: { latn: "Latin digits (default)", arab: "Eastern Arabic digits (tenant opt-in)", code: "ISO code display" },
    });
    return (
      <Table size="small" sx={{ maxWidth: 560 }}>
        <TableBody>
          {AMOUNTS.map((amount, index) => (
            <TableRow key={index}>
              <TableCell>
                <Typography variant="body2" color="text.secondary">
                  {amount.currency}
                </Typography>
              </TableCell>
              <TableCell sx={{ textAlign: "end" }}>
                <MoneyText money={amount} />
              </TableCell>
              <TableCell sx={{ textAlign: "end" }}>
                <MoneyText money={amount} numerals="arab" />
              </TableCell>
              <TableCell sx={{ textAlign: "end" }}>
                <MoneyText money={amount} currencyDisplay="code" />
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell />
            <TableCell sx={{ textAlign: "end" }}>
              <Typography variant="body2" color="text.secondary">
                {copy.latn}
              </Typography>
            </TableCell>
            <TableCell sx={{ textAlign: "end" }}>
              <Typography variant="body2" color="text.secondary">
                {copy.arab}
              </Typography>
            </TableCell>
            <TableCell sx={{ textAlign: "end" }}>
              <Typography variant="body2" color="text.secondary">
                {copy.code}
              </Typography>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
  },
};

const INSTANT = "2026-03-12T09:00:00Z";

export const Dates: StoryObj = {
  render: (_args, context) => {
    const copy = pickCopy(context.globals, {
      ar: {
        plain: "ميلادي فقط",
        withTime: "مع الوقت (بتوقيت الرياض)",
        hijri: "مع السطر الهجري (أم القرى)",
        arab: "بأرقام عربية مشرقية",
      },
      en: {
        plain: "Gregorian only",
        withTime: "With time (Riyadh zone)",
        hijri: "With Hijri secondary (Umm al-Qura)",
        arab: "Eastern Arabic digits",
      },
    });
    return (
      <Stack spacing={2} sx={{ maxWidth: 480 }}>
        <LabeledRow label={copy.plain}>
          <DateText utc={INSTANT} />
        </LabeledRow>
        <LabeledRow label={copy.withTime}>
          <DateText utc={INSTANT} timeStyle="short" timeZone="Asia/Riyadh" />
        </LabeledRow>
        <LabeledRow label={copy.hijri}>
          <DateText utc={INSTANT} hijri dateStyle="long" />
        </LabeledRow>
        <LabeledRow label={copy.arab}>
          <DateText utc={INSTANT} hijri numerals="arab" dateStyle="long" />
        </LabeledRow>
      </Stack>
    );
  },
};

function LabeledRow(props: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {props.label}
      </Typography>
      {props.children}
    </Stack>
  );
}
