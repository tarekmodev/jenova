/**
 * DataTable: dense sortable rows, tabular-nums money column, built-in
 * loading/empty/error states. Rows are structural synthetic values —
 * placeholder names, round amounts (CLAUDE.md rule 5).
 */

import Button from "@mui/material/Button";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { money, type BookingItemState, type Money } from "@jenova/domain";
import { DataTable, type DataTableColumn } from "../shell/DataTable";
import { EmptyState, ErrorState } from "../shell/StatusStates";
import { BookingStateChip } from "../widgets/BookingStateChip";
import { DateText } from "../widgets/DateText";
import { MoneyText } from "../widgets/MoneyText";
import { pickCopy } from "./support";

const meta: Meta = {
  title: "Shell/DataTable",
};
export default meta;

interface SyntheticRow {
  readonly id: string;
  readonly reference: string;
  readonly guest: string;
  readonly createdUtc: string;
  readonly state: BookingItemState;
  readonly escalated: boolean;
  readonly total: Money;
}

// Obviously-synthetic structural rows (round amounts, placeholder names).
const ROWS: readonly SyntheticRow[] = [
  {
    id: "row-1",
    reference: "BKG-0001",
    guest: "Guest One",
    createdUtc: "2026-03-01T08:00:00Z",
    state: "confirmed",
    escalated: false,
    total: money(125000, "SAR"),
  },
  {
    id: "row-2",
    reference: "BKG-0002",
    guest: "Guest Two",
    createdUtc: "2026-03-02T10:30:00Z",
    state: "pending_confirmation",
    escalated: true,
    total: money(80000, "SAR"),
  },
  {
    id: "row-3",
    reference: "BKG-0003",
    guest: "Guest Three",
    createdUtc: "2026-03-03T14:15:00Z",
    state: "cancelled",
    escalated: false,
    total: money(45500, "SAR"),
  },
];

function columns(globals: Record<string, unknown>): readonly DataTableColumn<SyntheticRow>[] {
  const copy = pickCopy(globals, {
    ar: {
      reference: "المرجع",
      guest: "الضيف",
      created: "تاريخ الإنشاء",
      state: "الحالة",
      total: "الإجمالي",
      states: {
        confirmed: "مؤكد",
        pending_confirmation: "بانتظار التأكيد",
        cancelled: "ملغى",
      } as Partial<Record<BookingItemState, string>>,
    },
    en: {
      reference: "Reference",
      guest: "Guest",
      created: "Created",
      state: "State",
      total: "Total",
      states: {
        confirmed: "Confirmed",
        pending_confirmation: "Pending confirmation",
        cancelled: "Cancelled",
      } as Partial<Record<BookingItemState, string>>,
    },
  });
  return [
    {
      id: "reference",
      header: copy.reference,
      cell: (row) => row.reference,
      sortable: true,
      sortValue: (row) => row.reference,
    },
    {
      id: "guest",
      header: copy.guest,
      cell: (row) => row.guest,
      sortable: true,
      sortValue: (row) => row.guest,
    },
    {
      id: "created",
      header: copy.created,
      cell: (row) => <DateText utc={row.createdUtc} timeStyle="short" />,
      sortable: true,
      sortValue: (row) => row.createdUtc,
    },
    {
      id: "state",
      header: copy.state,
      cell: (row) => (
        <BookingStateChip
          state={row.state}
          escalated={row.escalated}
          label={copy.states[row.state] ?? row.state}
        />
      ),
    },
    {
      id: "total",
      header: copy.total,
      money: true,
      sortable: true,
      sortValue: (row) => row.total.amount,
      cell: (row) => <MoneyText money={row.total} />,
    },
  ];
}

export const Default: StoryObj = {
  render: (_args, context) => (
    <DataTable
      columns={columns(context.globals)}
      rows={ROWS}
      getRowId={(row) => row.id}
      defaultSort={{ columnId: "created", direction: "desc" }}
    />
  ),
};

export const Loading: StoryObj = {
  render: (_args, context) => (
    <DataTable columns={columns(context.globals)} rows={[]} getRowId={(row) => row.id} loading />
  ),
};

export const Empty: StoryObj = {
  render: (_args, context) => {
    const copy = pickCopy(context.globals, {
      ar: { title: "لا توجد حجوزات بعد", hint: "ابدأ بالبحث لإنشاء أول حجز", action: "بحث جديد" },
      en: { title: "No bookings yet", hint: "Run a search to create the first one", action: "New search" },
    });
    return (
      <DataTable
        columns={columns(context.globals)}
        rows={[]}
        getRowId={(row) => row.id}
        emptyState={
          <EmptyState
            title={copy.title}
            description={copy.hint}
            action={<Button variant="contained">{copy.action}</Button>}
            dense
          />
        }
      />
    );
  },
};

export const Failed: StoryObj = {
  render: (_args, context) => {
    const copy = pickCopy(context.globals, {
      ar: { title: "تعذر تحميل القائمة", action: "إعادة المحاولة" },
      en: { title: "Could not load the list", action: "Retry" },
    });
    return (
      <DataTable
        columns={columns(context.globals)}
        rows={[]}
        getRowId={(row) => row.id}
        error
        errorState={
          <ErrorState title={copy.title} action={<Button variant="outlined">{copy.action}</Button>} dense />
        }
      />
    );
  },
};
